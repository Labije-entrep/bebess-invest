// Le traitement quotidien (lot 12) : UN Cron Trigger (wrangler.toml, `[triggers]`), appelé par `scheduled` (src/worker.ts). C'est le
// seul endroit du produit où une tâche planifiée est permise.
//
// IDEMPOTENT : rejoué dix fois le même jour, il ne crée qu'un bon, n'envoie qu'un courriel, ne passe qu'un contrat en fin d'essai.
// Rien n'est dédupliqué « après coup » : chaque travail est conditionnel dans la base elle-même (clé d'unicité du bon, `WHERE statut`,
// registre des envois). Un travail qui échoue n'arrête pas les autres : l'échec est un incident de la console, sans cabinet.
//
// Six travaux, dans cet ordre : b (parrainages validés, pour que le bon du jour les compte), a (bons des contrats dont la date
// anniversaire tombe dans 30 jours, remise de parrainage recalculée), c (sorties : l'essai à J+38, J+45, J+68, J+75 ; la résiliation à sa
// date d'effet J, J+23, J+30, lot 17), d (remises à revoir),
// e (modules : bascule de ceux dont la date d'effet de désactivation est atteinte, lot 15), f (cours : l'historique des symboles suivis par
// tous les cabinets, un appel par symbole, dans la limite du budget quotidien du fournisseur).
// Aucun appel à un modèle de langage.

import { creerMailer, type Env, type Mailer } from './mail';
import { signalerRevues, genererBons, validerParrainages, type RapportBons } from './facturation';
import { traiterEssais, type RapportEssais } from './essai';
import { basculerModulesEchus } from './contrat';
import type { Contexte } from './envois';
import { noterIncident } from './incidents';
import { recupererCoursQuotidien, type RapportCours } from './cours';

export interface RapportTraitement {
  jour: string;
  parrainages_valides: number | null;
  bons: RapportBons | null;
  essais: RapportEssais | null;
  remises_a_revoir: number | null;
  /** Les modules dont la désactivation a pris effet ce jour. */
  modules_desactives: number | null;
  /** Les cours de marché : symboles rangés, en échec, ignorés. Un échec par symbole est un incident, pas un échec du travail. */
  cours: RapportCours | null;
  echecs: string[];
}

export interface OptionsTraitement {
  /** Pour les essais : l'instant à traiter. Par défaut, maintenant. */
  maintenant?: Date;
  /** Pour les essais : un pilote de courriel imposé. Par défaut, celui de l'environnement. */
  mailer?: (hote: string) => Mailer;
}

export async function traitementQuotidien(env: Env, options: OptionsTraitement = {}): Promise<RapportTraitement> {
  const instant = options.maintenant ?? new Date();
  const ctx: Contexte = {
    db: env.DB,
    env,
    jour: instant.toISOString().slice(0, 10),
    maintenant: instant.toISOString(),
    mailer: options.mailer ?? ((hote) => creerMailer(env, hote)),
  };
  const rapport: RapportTraitement = { jour: ctx.jour, parrainages_valides: null, bons: null, essais: null, remises_a_revoir: null, modules_desactives: null, cours: null, echecs: [] };

  const travail = async <T>(nom: string, fait: () => Promise<T>): Promise<T | null> => {
    try {
      return await fait();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'erreur';
      rapport.echecs.push(`${nom} : ${message}`);
      console.error(`[traitement] ${nom} en échec :`, message);
      await noterIncident(env.DB, null, `traitement_echec:${nom}`, message);
      return null;
    }
  };

  rapport.parrainages_valides = await travail('parrainages', () => validerParrainages(ctx));
  rapport.bons = await travail('bons', () => genererBons(ctx));
  rapport.essais = await travail('essais', () => traiterEssais(ctx));
  rapport.remises_a_revoir = await travail('remises', async () => (await signalerRevues(ctx)).length);
  rapport.modules_desactives = await travail('modules', () => basculerModulesEchus(ctx.db, ctx.jour));
  rapport.cours = await travail('cours', () => recupererCoursQuotidien(ctx.db, env, ctx.jour));
  console.log(`[traitement] ${JSON.stringify(rapport)}`);
  return rapport;
}
