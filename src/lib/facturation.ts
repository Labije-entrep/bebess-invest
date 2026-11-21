// La facturation (lot 12) : ce que le traitement quotidien en lit et en écrit, et le passage d'un bon à « émise ».
//
// Le calcul est dans tarif.ts (pur). Ici : lire les accès et les parrainages, poser les bons, les numéroter, les annuler.
// Montants en centimes entiers (hors taxes), dates ISO 8601. Toute requête est bornée au locataire ou au contrat.
//
// Rejouabilité : la clé (contrat_id, periode_debut) de `bon_a_facturer` fait qu'une passe rejouée dix fois ne crée qu'un bon. Un
// BROUILLON suit le contrat (accès, modules, remises) tant qu'il n'est pas émis ; un bon ÉMIS ne bouge plus.
//
// Aucun courriel ici. « Notifier l'éditeur », c'est une ligne dans les incidents de la console (incidents.ts) : les six courriels
// de la sortie (quatre pour l'essai, deux pour la résiliation, essai.ts) sont les seuls envois automatiques du produit vers un cabinet,
// et rien n'en part sur l'abonnement.

import type { Base } from './db';
import { contratsActifs, plusJours, saisirRemise, STATUTS_EN_COURS, type Contrat } from './contrat';
import { lignesModifiees, unePremiereFois, type Contexte } from './envois';
import { noterIncident } from './incidents';
import { EVENEMENT, requeteEvenement, type Acteur } from './journal';
import { cleDeFacture, cleFacture, deposer, type Bucket, type Depot } from './fichiers';
import { identiteFacturation, identiteManquante, type ChampIdentite, type IdentiteFacturation } from './identite';
import { ACCES_FACTURABLES, enSql } from './roles';
import {
  calculerBon, calculerComplementaire, calculerTva, motifRemise, periodeAu, periodesDebutant, retenirRemises, tauxParrainage, tauxRemise, totauxDuBon, TVA_TAUX,
  type LigneBon, type Periode,
} from './tarif';
import { creditsEnAttente, enRemises, remisesDuBon, type RemiseLigne } from './remises';

/** Un bon est généré à l'avance : celui dont la date anniversaire tombe dans les 30 jours. */
export const JOURS_AVANT_ANNIVERSAIRE = 30;
/** Six mois de service payant valident un parrainage. */
const MOIS_PARRAINAGE = 6;

const eur = (centimes: number): string => `${(centimes / 100).toFixed(2).replace('.', ',')} €`;

// ---------------------------------------------------------------- les compteurs

/** Les accès facturables d'un cabinet : associés et collaborateurs actifs. Lecture, support, éditeur et viewers : jamais. */
export async function accesFacturables(db: Base, tenantId: string): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM utilisateur WHERE tenant_id = ? AND actif = 1 AND role IN (${enSql(ACCES_FACTURABLES)})`)
    .bind(tenantId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** Les parrainages VALIDÉS dont ce cabinet est le parrain. */
export async function parrainagesValides(db: Base, tenantId: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM parrainage WHERE tenant_id = ? AND statut = 'valide'")
    .bind(tenantId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

// ---------------------------------------------------------------- parrainages en attente → validés

/**
 * Un parrainage en attente devient validé quand le cabinet parrainé a six mois de SERVICE PAYANT : son contrat est actif et son
 * début de service (`debut_le`, d'où partent aussi ses bons) a six mois. Chaque validation part avec son événement, dans la même
 * transaction ; rejouée, elle ne retrouve plus rien à valider.
 */
export async function validerParrainages(ctx: Contexte): Promise<number> {
  const { results } = await ctx.db
    .prepare(
      `SELECT p.id, p.tenant_id, p.filleul_tenant_id
         FROM parrainage p JOIN contrat c ON c.tenant_id = p.filleul_tenant_id
        WHERE p.statut = 'en_attente' AND c.statut = 'actif' AND c.debut_le IS NOT NULL
          AND date(c.debut_le, '+${MOIS_PARRAINAGE} months') <= ?
        ORDER BY p.id`,
    )
    .bind(ctx.jour)
    .all<{ id: string; tenant_id: string; filleul_tenant_id: string }>();
  let valides = 0;
  for (const p of results) {
    const r = await ctx.db.batch([
      ctx.db.prepare("UPDATE parrainage SET statut = 'valide', valide_le = ? WHERE id = ? AND statut = 'en_attente'").bind(ctx.maintenant, p.id),
      requeteEvenement(
        ctx.db,
        { tenantId: p.tenant_id, type: EVENEMENT.PARRAINAGE_VALIDE, acteur: null, cible: { type: 'cabinet', id: p.tenant_id }, detail: { parrainage_id: p.id, filleul: p.filleul_tenant_id } },
        true,
      ),
    ]);
    valides += lignesModifiees(r[0]);
  }
  return valides;
}

// ---------------------------------------------------------------- poser un bon

interface Calcul {
  lignes: LigneBon[];
  recurrent_ht: number;
  remise_taux: number;
  remise_montant: number;
  /** Le motif de la remise en clair (tarif.ts, motifRemise), figé avec le bon. Null : pas de remise. */
  remise_motif: string | null;
  /** Somme des remises ponctuelles retenues (remises.ts) : calculée par `poserBon`, qui relit les remises du bon. */
  remise_ponctuelle_montant?: number;
  total_ht: number;
}

type EtatBon = 'cree' | 'actualise' | 'inchange' | 'fige';

/**
 * Pose le bon d'une période : le crée, ou met à jour le brouillon existant s'il a changé, ou ne touche à rien (déjà là et pareil,
 * ou déjà émis). La CRÉATION seule écrit un événement et prévient l'éditeur : rejouer ne prévient jamais deux fois.
 */
async function poserBon(db: Base, c: Contrat, type: 'periode' | 'complementaire' | 'installation', p: Periode, calc: Calcul, acces: number): Promise<EtatBon> {
  const lignes = JSON.stringify(calc.lignes);
  const existant = await db
    .prepare('SELECT id, statut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, remise_ponctuelle_montant, remise_motif, tva_taux, total_ht FROM bon_a_facturer WHERE contrat_id = ? AND periode_debut = ? AND type = ?')
    .bind(c.id, p.debut, type)
    .first<{ id: string; statut: string; periode_fin: string; acces_facturables: number; lignes: string; recurrent_ht: number; remise_taux: number; remise_montant: number; remise_ponctuelle_montant: number; remise_motif: string | null; tva_taux: number; total_ht: number }>();
  if (existant && existant.statut !== 'brouillon') return 'fige';

  // Les remises ponctuelles SURVIVENT au recalcul : celles que le brouillon porte déjà (posées à la main, ou crédits déjà rattachés) sont
  // relues dans leur table et réappliquées. Un crédit de prorata en attente se rattache au bon PÉRIODIQUE dont la période commence à
  // (ou après) la date anniversaire de la sienne, dans la limite de ce qu'il reste à remiser sur la ligne « accès supplémentaires » ; le
  // surplus reste en attente pour le bon d'après.
  const portees: RemiseLigne[] = existant ? await remisesDuBon(db, c.tenant_id, existant.id) : [];
  const rattacher: { credit: RemiseLigne; part: number }[] = [];
  if (type === 'periode') {
    // Un crédit s'impute d'abord sur la ligne « accès supplémentaires », puis sur le reste du récurrent (tarif.ts, `repli`) : ce qu'un bon peut
    // encore absorber est son récurrent moins ce que les remises déjà portées en retiennent.
    let reste = calc.recurrent_ht - totauxDuBon(calc.lignes, calc.remise_taux, enRemises(portees)).remise_ponctuelle_montant;
    for (const credit of await creditsEnAttente(db, c.tenant_id, c.id, p.debut)) {
      if (reste <= 0) break;
      const part = Math.min(credit.montant, reste);
      rattacher.push({ credit, part });
      reste -= part;
    }
  }
  const toutes = [...enRemises(portees), ...rattacher.map((r) => ({ code: r.credit.code_ligne, montant: r.part, repli: true }))];
  const t = totauxDuBon(calc.lignes, calc.remise_taux, toutes);
  calc = { ...calc, remise_montant: t.remise_montant, remise_ponctuelle_montant: t.remise_ponctuelle_montant, total_ht: t.total_ht };

  let etat: EtatBon;
  let bonId: string;
  if (existant) {
    bonId = existant.id;
    if (
      existant.periode_fin === p.fin && existant.acces_facturables === acces && existant.lignes === lignes && existant.recurrent_ht === calc.recurrent_ht
      && existant.remise_taux === calc.remise_taux && existant.remise_montant === calc.remise_montant && existant.remise_motif === calc.remise_motif
      && existant.remise_ponctuelle_montant === calc.remise_ponctuelle_montant && existant.tva_taux === TVA_TAUX && existant.total_ht === calc.total_ht
    ) {
      etat = 'inchange';
    } else {
      await db
        .prepare(
          `UPDATE bon_a_facturer SET periode_fin = ?, acces_facturables = ?, lignes = ?, recurrent_ht = ?, remise_taux = ?, remise_montant = ?, remise_ponctuelle_montant = ?,
                                     remise_motif = ?, tva_taux = ?, total_ht = ?
            WHERE id = ? AND statut = 'brouillon'`,
        )
        .bind(p.fin, acces, lignes, calc.recurrent_ht, calc.remise_taux, calc.remise_montant, calc.remise_ponctuelle_montant ?? 0, calc.remise_motif, TVA_TAUX, calc.total_ht, existant.id)
        .run();
      etat = 'actualise';
    }
  } else {
    bonId = crypto.randomUUID();
    const r = await db.batch([
      db
        .prepare(
          `INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht,
                                       remise_taux, remise_montant, remise_ponctuelle_montant, remise_motif, tva_taux, total_ht, cree_le)
           VALUES (?, ?, ?, ?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(contrat_id, periode_debut) DO NOTHING`,
        )
        .bind(bonId, c.tenant_id, c.id, type, p.debut, p.fin, acces, lignes, calc.recurrent_ht, calc.remise_taux, calc.remise_montant, calc.remise_ponctuelle_montant ?? 0, calc.remise_motif, TVA_TAUX, calc.total_ht, new Date().toISOString()),
      requeteEvenement(
        db,
        {
          tenantId: c.tenant_id, type: EVENEMENT.BON_GENERE, acteur: null, cible: { type: 'contrat', id: c.id },
          detail: { bon_id: bonId, type, periode_debut: p.debut, periode_fin: p.fin, acces_facturables: acces, remise_taux: calc.remise_taux, total_ht: calc.total_ht },
        },
        true,
      ),
    ]);
    // Une autre passe l'a posé entre la lecture et l'écriture : rien n'a été écrit ici, et la notification est déjà partie.
    if (lignesModifiees(r[0]) === 0) return 'inchange';
    await noterIncident(
      db, c.tenant_id, 'bon_a_emettre',
      `Bon ${type === 'complementaire' ? 'complémentaire ' : ''}du ${p.debut} au ${p.fin} : ${eur(calc.total_ht)} HT, ${acces} accès facturables, remise ${calc.remise_taux / 100} %. À émettre.`,
    );
    etat = 'cree';
  }

  // Le rattachement s'écrit APRÈS le bon (clé étrangère) ; si la passe s'arrête entre les deux, la suivante retrouve le crédit en attente et
  // recalcule le brouillon : rien ne se perd, rien ne se double (la mise à jour est conditionnée à l'état `en_attente`).
  for (const { credit, part } of rattacher) {
    const now = new Date().toISOString();
    const r = await db.batch([
      db
        .prepare("UPDATE remise_ponctuelle SET bon_id = ?, etat = 'appliquee', montant = ?, maj_le = ? WHERE id = ? AND tenant_id = ? AND etat = 'en_attente'")
        .bind(bonId, part, now, credit.id, c.tenant_id),
      requeteEvenement(
        db,
        { tenantId: c.tenant_id, type: EVENEMENT.CREDIT_PRORATA_APPLIQUE, acteur: null, cible: { type: 'contrat', id: c.id }, detail: { remise_id: credit.id, bon_id: bonId, montant: part } },
        true,
      ),
    ]);
    if (lignesModifiees(r[0]) > 0 && part < credit.montant) {
      await db
        .prepare(
          `INSERT INTO remise_ponctuelle (id, tenant_id, contrat_id, bon_id, code_ligne, montant, motif, origine, acces_id, etat, applicable_des, cree_le, maj_le)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'en_attente', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), c.tenant_id, c.id, credit.code_ligne, credit.montant - part, credit.motif, credit.origine, credit.acces_id, credit.applicable_des, credit.cree_le, now)
        .run();
    }
  }
  return etat;
}

/**
 * La remise de parrainage du contrat, recalculée sur les parrainages validés. Le bon ne la LIT pas sur le contrat (il compte les
 * parrainages lui-même) : cette écriture tient la fiche du contrat à jour, avec son événement `remise_modifiee` (acteur : le système).
 */
async function recalculerRemiseParrainage(db: Base, c: Contrat, valides: number): Promise<void> {
  const taux = tauxParrainage(valides);
  if (taux !== c.remise_parrainage_taux) await saisirRemise(db, c.tenant_id, { parrainage_taux: taux }, null);
}

export interface RapportBons {
  crees: number;
  actualises: number;
  complementaires: number;
}

/**
 * Les contrats actifs dont une date anniversaire (début de période) tombe dans les 30 jours : lire les accès facturables, recalculer
 * la remise de parrainage, générer le bon, prévenir l'éditeur. Un contrat qui n'a encore AUCUN bon reçoit celui de sa période en
 * cours (une mise en service tardive ne doit pas rester sans facture).
 */
export async function genererBons(ctx: Contexte): Promise<RapportBons> {
  const rapport: RapportBons = { crees: 0, actualises: 0, complementaires: 0 };
  const fenetre = plusJours(ctx.jour, JOURS_AVANT_ANNIVERSAIRE);
  for (const c of await contratsActifs(ctx.db)) {
    const debut = c.debut_le as string;
    // Une résiliation enregistrée met fin au contrat à sa date d'effet (la date anniversaire) : la période qui commencerait ce jour-là, ou
    // après, n'aura pas lieu et ne se facture pas. La période en cours va à son terme, sans remboursement.
    const periodes = periodesDebutant(debut, c.periodicite, ctx.jour, fenetre).filter((p) => c.resiliation_effet_le === null || p.debut < c.resiliation_effet_le);
    // Le bon d'installation (posé à la signature) n'est pas un bon de période : il ne dispense pas du premier, celui de la période en cours.
    const aUnBon = await ctx.db.prepare("SELECT 1 AS ok FROM bon_a_facturer WHERE contrat_id = ? AND type <> 'installation' LIMIT 1").bind(c.id).first();
    if (!aUnBon) {
      const courante = periodeAu(debut, c.periodicite, ctx.jour);
      if (courante && !periodes.some((p) => p.debut === courante.debut)) periodes.unshift(courante);
    }
    if (periodes.length === 0) continue;

    const acces = await accesFacturables(ctx.db, c.tenant_id);
    const valides = await parrainagesValides(ctx.db, c.tenant_id);
    await recalculerRemiseParrainage(ctx.db, c, valides);
    const motif = motifRemise({ parrainages_valides: valides, remise_commerciale_taux: c.remise_commerciale_taux, motif_commercial: c.remise_motif });
    for (const p of periodes) {
      // Une désactivation prend effet à la date anniversaire : le drapeau reste à 1 jusque-là, mais une période qui commence à cette date
      // (ou après) ne porte plus le module. Le bon est posé 30 jours avant : c'est lui qui doit déjà le savoir.
      const sortant = (fin: string | null): boolean => fin !== null && fin <= p.debut;
      const calc: Calcul = {
        ...calculerBon({
          ...c,
          module_pilotage: sortant(c.module_pilotage_fin_le) ? 0 : c.module_pilotage,
          module_site: sortant(c.module_site_fin_le) ? 0 : c.module_site,
          acces_facturables: acces, parrainages_valides: valides,
          // Le bon périodique ne porte JAMAIS les frais d'installation (tarif.ts) : ils se facturent une fois, à part. Le contrat les
          // porte (`...c`), il ne faut pas les transmettre au calcul, sans quoi chaque période les refacturerait.
          frais_installation: 0,
        }),
        remise_motif: motif,
      };
      const etat = await poserBon(ctx.db, c, 'periode', p, calc, acces);
      if (etat === 'cree') rapport.crees++;
      if (etat === 'actualise') rapport.actualises++;
    }
  }
  rapport.complementaires = await genererComplementaires(ctx);
  return rapport;
}

/**
 * Un module OU UN ACCÈS SUPPLÉMENTAIRE ajouté EN COURS de période d'un contrat annuel : un bon complémentaire, au prorata (tarif.ts,
 * calculerComplementaire : mêmes mois entiers arrondis au supérieur, jusqu'à la date anniversaire), daté du jour de l'ajout. On attend
 * le lendemain (`< jour`) : tout ce qui est ajouté une même date entre alors dans le même bon, dont la clé est (contrat, date).
 *
 * MODULES : l'activation se lit dans le JOURNAL (événement `module_active`, jamais modifié) ; seule la dernière compte, et seulement si
 * le module est toujours actif. Un module déjà au bon de la période n'est pas refacturé.
 *
 * ACCÈS (retour de recette du 21/11/2026 : fini « l'accès est offert jusqu'à l'anniversaire ») : un accès facturable ajouté (créé, réactivé,
 * ou passé de lecture à collaborateur) APRÈS l'émission du bon périodique de la période est facturé tout de suite, au prorata. Pas de
 * double facturation :
 *   - bon périodique de la période EN BROUILLON qui suit encore le contrat (la période n'a pas commencé : il est recalculé chaque nuit), ou
 *     pas encore posé (le premier bon de rattrapage les comptera) : il compte déjà l'accès, aucun complémentaire ;
 *   - bon périodique ÉMIS (ou brouillon que sa période commencée ne recalcule plus) : seuls les accès ajoutés après son émission (ou après
 *     le début de la période) peuvent donner un complémentaire, et au plus autant que d'accès facturables au-delà des inclus (un accès
 *     « inclus » ne coûte rien) ; on retient les plus récents. Même règle que pour les modules.
 * Rejouée, la passe retombe sur les mêmes bons (clé du contrat et de la date) : rien n'est dupliqué, un bon émis ne bouge plus.
 * Une activation faite avant le début de la période relève du bon périodique (un brouillon suit le contrat).
 */
async function genererComplementaires(ctx: Contexte): Promise<number> {
  let crees = 0;
  for (const c of await contratsActifs(ctx.db)) {
    if (c.periodicite !== 'annuelle') continue;
    const periode = periodeAu(c.debut_le as string, 'annuelle', ctx.jour);
    if (!periode) continue;
    const { results } = await ctx.db
      .prepare(
        `SELECT type, cree_le, json_extract(detail, '$.module') AS module
           FROM evenement
          WHERE tenant_id = ? AND cible_type = 'contrat' AND cible_id = ? AND type IN ('module_active', 'module_desactive')
          ORDER BY cree_le, id`,
      )
      .bind(c.tenant_id, c.id)
      .all<{ type: string; cree_le: string; module: string | null }>();
    const dernier = new Map<string, { actif: boolean; jour: string }>();
    for (const e of results) if (e.module) dernier.set(e.module, { actif: e.type === 'module_active', jour: e.cree_le.slice(0, 10) });

    const regulier = await ctx.db
      .prepare("SELECT lignes, statut, emis_le, cree_le FROM bon_a_facturer WHERE contrat_id = ? AND periode_debut = ? AND type = 'periode' AND statut <> 'annulee'")
      .bind(c.id, periode.debut)
      .first<{ lignes: string; statut: string; emis_le: string | null; cree_le: string }>();
    const dejaAuBon = new Set<string>(regulier ? (JSON.parse(regulier.lignes) as LigneBon[]).map((l) => l.code) : []);

    const parJour = new Map<string, { modules: { code: 'pilotage' | 'site'; prix: number }[]; acces: number }>();
    const jourDuBon = (jour: string) => {
      const e = parJour.get(jour) ?? { modules: [], acces: 0 };
      parJour.set(jour, e);
      return e;
    };
    for (const [module, d] of dernier) {
      if (module !== 'pilotage' && module !== 'site') continue;
      if (!d.actif || !(module === 'pilotage' ? c.module_pilotage : c.module_site)) continue;
      if (!(d.jour > periode.debut && d.jour < periode.fin && d.jour < ctx.jour)) continue;
      if (dejaAuBon.has(module)) continue;
      jourDuBon(d.jour).modules.push({ code: module, prix: module === 'pilotage' ? c.prix_pilotage : c.prix_site });
    }

    const acces = await accesFacturables(ctx.db, c.tenant_id);
    if (regulier && acces > c.acces_inclus) {
      // L'instant où le bon périodique a COMPTÉ les accès : son émission (il ne bouge plus) ; pour un brouillon, le début de la période (il suit
      // le contrat jusque-là, puis le traitement ne le recalcule plus) ou sa création si elle est plus tardive (premier bon de rattrapage).
      const reference = regulier.statut === 'emise' && regulier.emis_le ? regulier.emis_le : regulier.cree_le > `${periode.debut}T00:00:00.000Z` ? regulier.cree_le : `${periode.debut}T00:00:00.000Z`;
      // Les accès facturables actuels, avec l'instant où chacun l'est devenu : sa création, sa dernière réactivation, ou son passage à un
      // rôle facturable (le journal des rôles). Un accès sans événement vaut sa création (colonne `cree_le`).
      const { results: actifs } = await ctx.db
        .prepare(
          `SELECT u.id, u.cree_le,
                  (SELECT MAX(e.cree_le) FROM evenement e
                    WHERE e.tenant_id = u.tenant_id AND e.cible_type = 'acces' AND e.cible_id = u.id
                      AND (e.type = 'acces_reactive'
                           OR (e.type = 'acces_role' AND json_extract(e.detail, '$.vers') IN (${enSql(ACCES_FACTURABLES)}) AND json_extract(e.detail, '$.de') NOT IN (${enSql(ACCES_FACTURABLES)})))) AS depuis
             FROM utilisateur u WHERE u.tenant_id = ? AND u.actif = 1 AND u.role IN (${enSql(ACCES_FACTURABLES)})`,
        )
        .bind(c.tenant_id)
        .all<{ id: string; cree_le: string; depuis: string | null }>();
      const arrivees = actifs
        .map((u) => ({ id: u.id, instant: u.depuis && u.depuis > u.cree_le ? u.depuis : u.cree_le }))
        .filter((u) => u.instant > reference && u.instant.slice(0, 10) < ctx.jour && u.instant.slice(0, 10) < periode.fin)
        .sort((x, y) => (x.instant < y.instant ? -1 : x.instant > y.instant ? 1 : x.id < y.id ? -1 : 1));
      const a_facturer = arrivees.slice(Math.max(0, arrivees.length - (acces - c.acces_inclus)));
      for (const u of a_facturer) {
        // Un accès arrivé le jour même du début de période partage la clé du bon périodique : il est daté du lendemain.
        const jour = u.instant.slice(0, 10) > periode.debut ? u.instant.slice(0, 10) : plusJours(periode.debut, 1);
        jourDuBon(jour).acces++;
      }
    }
    if (parJour.size === 0) continue;

    const valides = await parrainagesValides(ctx.db, c.tenant_id);
    const taux = tauxRemise(tauxParrainage(valides), c.remise_commerciale_taux);
    const motif = motifRemise({ parrainages_valides: valides, remise_commerciale_taux: c.remise_commerciale_taux, motif_commercial: c.remise_motif });
    for (const [activation, { modules, acces: nouveaux }] of parJour) {
      const brut = calculerComplementaire({
        periodicite: c.periodicite, modules, acces_sup: nouveaux > 0 ? { quantite: nouveaux, prix: c.prix_acces_sup } : undefined,
        activation, anniversaire: periode.fin, remise_taux: taux,
      });
      if (!brut) continue;
      const calc: Calcul = { ...brut, remise_motif: motif };
      if ((await poserBon(ctx.db, c, 'complementaire', { debut: activation, fin: periode.fin }, calc, acces)) === 'cree') crees++;
    }
  }
  return crees;
}

/**
 * Le bon périodique de la période en cours est-il ÉMIS ? Si oui, un accès ajouté aujourd'hui donne un bon complémentaire ; sinon (brouillon, ou
 * pas encore posé) le bon périodique le compte lui-même. Sert à la phrase de la création d'un accès (depassement.ts).
 */
export async function bonDeLaPeriodeEstEmis(db: Base, c: Contrat, jour: string): Promise<boolean> {
  if (!c.debut_le) return false;
  const periode = periodeAu(c.debut_le, c.periodicite, jour);
  if (!periode) return false;
  const r = await db
    .prepare("SELECT 1 AS ok FROM bon_a_facturer WHERE contrat_id = ? AND tenant_id = ? AND periode_debut = ? AND type = 'periode' AND statut = 'emise'")
    .bind(c.id, c.tenant_id, periode.debut)
    .first();
  return !!r;
}

/**
 * Ce que coûterait (ou coûte) l'activation d'un module AUJOURD'HUI, par le calcul du bon complémentaire (`calculerComplementaire`,
 * tarif.ts) : rien n'est réécrit ici. Les conditions sont celles de `genererComplementaires` : contrat actif et annuel, activation
 * strictement après le début de la période. Sinon null : le module entre dans le bon de la période suivante (ou dans le premier bon).
 * C'est un aperçu : le bon lui-même est posé par le traitement quotidien, le lendemain de l'activation.
 */
export async function apercuComplementaire(db: Base, c: Contrat, module: 'pilotage' | 'site', jour: string): Promise<{ mois: number; total_ht: number; anniversaire: string } | null> {
  if (c.statut !== 'actif' || c.periodicite !== 'annuelle' || !c.debut_le) return null;
  const periode = periodeAu(c.debut_le, 'annuelle', jour);
  if (!periode || jour <= periode.debut) return null;
  const taux = tauxRemise(tauxParrainage(await parrainagesValides(db, c.tenant_id)), c.remise_commerciale_taux);
  const bon = calculerComplementaire({
    periodicite: c.periodicite, modules: [{ code: module, prix: module === 'pilotage' ? c.prix_pilotage : c.prix_site }],
    activation: jour, anniversaire: periode.fin, remise_taux: taux,
  });
  return bon ? { mois: bon.mois, total_ht: bon.total_ht, anniversaire: periode.fin } : null;
}

// ---------------------------------------------------------------- les bons que la résiliation rend caducs

export interface BonsApresEffet {
  /** Brouillons annulés (chacun avec son événement `bon_annule`, motif `preavis_resiliation`). */
  annules: number;
  /** Bons déjà émis : intouchés, un incident par bon, à annuler à la main si l'éditeur le décide. */
  emis: number;
}

/**
 * Un préavis enregistré alors que le bon de la période suivante (début à la date d'effet ou après) est déjà posé : le bon est généré à J-30
 * de la date anniversaire et le préavis est recevable jusqu'à J-30, les deux tombent donc le même jour.
 *  - BROUILLON : annulé tout de suite, avec son événement. Il n'a aucune conséquence (ni numéro) ; l'attente d'un geste
 *    manuel risquerait l'émission d'un bon pour une année résiliée.
 *  - ÉMIS : rien n'est touché. Un numéro attribué ne se libère jamais. Un incident, par bon, nomme le bon de commande émis.
 * Appelé après l'écriture du préavis ; rejoué, il ne retrouve plus de brouillon et ne redit rien de plus (les incidents d'un bon émis
 * ne sont notés qu'à l'enregistrement du préavis, qui n'a lieu qu'une fois).
 */
export async function traiterBonsApresEffet(db: Base, tenantId: string, contratId: string, effet: string, acteur: Acteur): Promise<BonsApresEffet> {
  const { results } = await db
    .prepare("SELECT id FROM bon_a_facturer WHERE contrat_id = ? AND tenant_id = ? AND statut <> 'annulee' AND periode_debut >= ? ORDER BY periode_debut, id")
    .bind(contratId, tenantId, effet)
    .all<{ id: string }>();
  const rapport: BonsApresEffet = { annules: 0, emis: 0 };
  for (const { id } of results) {
    const avant = await bonDe(db, tenantId, id);
    if (avant?.statut === 'brouillon') {
      const r = await annulerBon(db, tenantId, id, acteur, 'preavis_resiliation');
      if (r.ok) {
        rapport.annules++;
        continue;
      }
    }
    // Émis (ou émis entre la lecture et l'annulation) : on relit, on ne touche à rien.
    const bon = await bonDe(db, tenantId, id);
    if (bon?.statut !== 'emise') continue;
    rapport.emis++;
    await noterIncident(
      db, tenantId, 'bon_apres_resiliation',
      `Bon de commande ${bon.numero} (période du ${bon.periode_debut} au ${bon.periode_fin}, ${eur(bon.total_ht)} HT) déjà émis : la résiliation prend effet le ${effet}, cette période n'aura pas lieu. Il reste en l'état ; l'annuler si besoin (le numéro ne se libère pas).`,
    );
  }
  return rapport;
}

/**
 * La résiliation est ANNULÉE : les brouillons que son enregistrement avait annulés ne reviennent pas. Un bon annulé garde sa période (clé
 * unique du contrat, un bon ne s'efface ni ne se rouvre) : le traitement quotidien ne le recrée pas. Un incident par bon le dit à l'éditeur.
 */
export async function signalerBonsAnnulesParPreavis(db: Base, tenantId: string, contratId: string, effet: string): Promise<number> {
  const { results } = await db
    .prepare("SELECT periode_debut, periode_fin, total_ht FROM bon_a_facturer WHERE contrat_id = ? AND tenant_id = ? AND statut = 'annulee' AND numero IS NULL AND periode_debut >= ? ORDER BY periode_debut")
    .bind(contratId, tenantId, effet)
    .all<{ periode_debut: string; periode_fin: string; total_ht: number }>();
  for (const b of results) {
    await noterIncident(
      db, tenantId, 'bon_preavis_annule',
      `Bon du ${b.periode_debut} au ${b.periode_fin} (${eur(b.total_ht)} HT) annulé à l'enregistrement du préavis ; le préavis est annulé, mais ce bon ne se recrée pas : la période est à facturer à la main.`,
    );
  }
  return results.length;
}

// ---------------------------------------------------------------- remises à revoir

export interface RemiseARevoir {
  contrat_id: string;
  tenant_id: string;
  cabinet: string;
  remise_commerciale_taux: number;
  remise_motif: string | null;
  remise_revue_le: string;
}

/** Les remises commerciales dont la date de revue est PASSÉE (avant le jour donné) : la liste que lit la console. */
export async function remisesARevoir(db: Base, jour: string): Promise<RemiseARevoir[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS contrat_id, c.tenant_id, t.nom AS cabinet, c.remise_commerciale_taux, c.remise_motif, c.remise_revue_le
         FROM contrat c JOIN tenant t ON t.id = c.tenant_id
        WHERE c.statut IN (${STATUTS_EN_COURS.map((x) => `'${x}'`).join(',')}) AND c.remise_commerciale_taux > 0
          AND c.remise_revue_le IS NOT NULL AND c.remise_revue_le < ?
        ORDER BY c.remise_revue_le, c.id`,
    )
    .bind(jour)
    .all<RemiseARevoir>();
  return results;
}

/** Une ligne d'incident par remise et par date de revue, une seule fois : la console les liste sans que rien ne soit répété chaque jour. */
export async function signalerRevues(ctx: Contexte): Promise<RemiseARevoir[]> {
  const liste = await remisesARevoir(ctx.db, ctx.jour);
  for (const r of liste) {
    await unePremiereFois(ctx.db, r.tenant_id, `revue:${r.contrat_id}:${r.remise_revue_le}`, ctx.maintenant, () =>
      noterIncident(ctx.db, r.tenant_id, 'remise_a_revoir', `Remise commerciale de ${r.remise_commerciale_taux / 100} % : revue prévue le ${r.remise_revue_le}, dépassée.`),
    );
  }
  return liste;
}

// ---------------------------------------------------------------- émettre, annuler

export interface Bon {
  id: string;
  tenant_id: string;
  contrat_id: string;
  type: 'periode' | 'complementaire' | 'installation';
  periode_debut: string;
  periode_fin: string;
  statut: 'brouillon' | 'emise' | 'annulee';
  total_ht: number;
  numero: string | null;
  emis_le: string | null;
  annule_le: string | null;
}

const COLONNES_BON = 'id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, total_ht, numero, emis_le, annule_le';

export function bonDe(db: Base, tenantId: string, bonId: string): Promise<Bon | null> {
  return db.prepare(`SELECT ${COLONNES_BON} FROM bon_a_facturer WHERE id = ? AND tenant_id = ?`).bind(bonId, tenantId).first<Bon>();
}

export type CodeBon = 'interdit' | 'introuvable' | 'pas_brouillon' | 'deja_annule' | 'pas_annulable' | 'identite_incomplete' | 'pas_emis';
export type ResultatBon = { ok: true; bon: Bon } | { ok: false; code: CodeBon };
export const MESSAGES_BON: Record<CodeBon, string> = {
  interdit: 'Seul l’éditeur émet ou annule un bon.',
  introuvable: 'Bon introuvable.',
  pas_brouillon: 'Ce bon n’est plus un brouillon : il est déjà émis ou annulé.',
  deja_annule: 'Ce bon est déjà annulé.',
  pas_annulable: 'Ce bon ne peut pas être annulé.',
  identite_incomplete: 'L’identité de facturation du cabinet est incomplète : le bon n’est pas émis. Complétez la fiche du cabinet, ou confirmez l’émission malgré le manque.',
  pas_emis: 'Seul un bon émis reçoit le PDF de sa facture.',
};

// L'année et l'instant se lisent DANS la requête (`strftime('now')` est constant pendant une instruction) : le numéro et la date
// d'émission viennent du même instant, et l'ordre des numéros est celui des instants d'exécution, pas celui des appels.
const ANNEE = "CAST(strftime('%Y', 'now') AS INTEGER)";
const INSTANT = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Fait passer un brouillon à `emise` ET lui donne son numéro BC-AAAA-NNNN, dans UNE instruction (donc une transaction) :
 * l'attribution et l'écriture du numéro ne sont pas séparables. NNNN est le plus grand numéro de l'année + 1, lu pendant l'écriture ;
 * D1 exécute les écritures l'une après l'autre, et l'index unique (annee, seq) fait échouer toute collision au lieu de la laisser
 * passer. Un bon qui n'est pas un brouillon ne consomme aucun numéro : pas de trou. Le numéro n'est jamais un paramètre.
 */
export async function emettreBon(
  db: Base,
  tenantId: string,
  bonId: string,
  acteur: Acteur,
  options: { malgreIdentiteIncomplete?: boolean } = {},
): Promise<ResultatBon> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const avant = await bonDe(db, tenantId, bonId);
  if (!avant) return { ok: false, code: 'introuvable' };
  if (avant.statut !== 'brouillon') return { ok: false, code: 'pas_brouillon' };
  // Un bon ne s'émet pas incomplet SANS QU'ON LE VOIE : il faut le confirmer, et l'événement garde ce qui manquait.
  const identite = await identiteFacturation(db, tenantId);
  const manque = identite ? identiteManquante(identite) : [];
  if (manque.length > 0 && !options.malgreIdentiteIncomplete) return { ok: false, code: 'identite_incomplete' };
  const suivant = `(SELECT COALESCE(MAX(seq), 0) + 1 FROM bon_a_facturer WHERE annee = ${ANNEE})`;
  const resultats = await db.batch([
    db
      .prepare(
        `UPDATE bon_a_facturer
            SET statut = 'emise', annee = ${ANNEE}, seq = ${suivant},
                numero = 'BC-' || strftime('%Y', 'now') || '-' || printf('%04d', ${suivant}),
                emis_le = ${INSTANT}
          WHERE id = ? AND tenant_id = ? AND statut = 'brouillon'`,
      )
      .bind(bonId, tenantId),
    requeteEvenement(
      db,
      {
        tenantId, type: EVENEMENT.BON_EMIS, acteur, cible: { type: 'contrat', id: avant.contrat_id },
        detail: {
          bon_id: bonId, periode_debut: avant.periode_debut, periode_fin: avant.periode_fin, total_ht: avant.total_ht,
          ...(manque.length > 0 ? { identite_incomplete: manque } : {}),
        },
      },
      true,
    ),
  ]);
  // Une autre émission a pris ce brouillon entre la lecture et l'écriture : la nôtre n'a rien numéroté, et ne le prétend pas.
  if (lignesModifiees(resultats[0]) === 0) return { ok: false, code: 'pas_brouillon' };
  const apres = await bonDe(db, tenantId, bonId);
  if (!apres || apres.statut !== 'emise') return { ok: false, code: 'pas_brouillon' };
  return { ok: true, bon: apres };
}

/**
 * Annule un bon : il passe à `annulee` (l'écran dit « annulé »), avec sa date et son événement `bon_annule`. Un brouillon s'annule sans
 * trace (il n'a jamais eu de numéro). Un bon ÉMIS garde son numéro BC-… à jamais : il n'est jamais réattribué. Aucune autre écriture
 * (la notion d'avoir n'existe pas dans le produit).
 */
export async function annulerBon(db: Base, tenantId: string, bonId: string, acteur: Acteur, motif?: 'preavis_resiliation'): Promise<ResultatBon> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const avant = await bonDe(db, tenantId, bonId);
  if (!avant) return { ok: false, code: 'introuvable' };
  if (avant.statut === 'annulee') return { ok: false, code: 'deja_annule' };
  const detail = { bon_id: bonId, periode_debut: avant.periode_debut, periode_fin: avant.periode_fin, total_ht: avant.total_ht, ...(motif ? { motif } : {}) };
  const resultats = await db.batch([
    // Un BROUILLON qui s'annule rend les crédits de prorata qu'il portait : ils retournent en attente, pour le bon suivant. Avant le changement
    // de statut (un bon annulé est figé, ses remises avec lui). Un bon ÉMIS annulé garde les siens : ils sont consommés.
    db
      .prepare("UPDATE remise_ponctuelle SET bon_id = NULL, etat = 'en_attente' WHERE bon_id = ? AND tenant_id = ? AND origine <> 'manuelle' AND etat = 'appliquee' AND ? = 'brouillon'")
      .bind(bonId, tenantId, avant.statut),
    db
      .prepare(`UPDATE bon_a_facturer SET statut = 'annulee', annule_le = ${INSTANT} WHERE id = ? AND tenant_id = ? AND statut = ?`)
      .bind(bonId, tenantId, avant.statut),
    requeteEvenement(db, { tenantId, type: EVENEMENT.BON_ANNULE, acteur, cible: { type: 'contrat', id: avant.contrat_id }, detail }, true),
  ]);
  // Annulé entre-temps par un autre appel : le nôtre n'a rien écrit (ni événement).
  if (lignesModifiees(resultats[1]) === 0) return { ok: false, code: 'deja_annule' };
  const apres = await bonDe(db, tenantId, bonId);
  if (!apres || apres.statut !== 'annulee') return { ok: false, code: 'pas_annulable' };
  return { ok: true, bon: apres };
}

// ---------------------------------------------------------------- le bon imprimable et la facture (lot 13)

export interface LigneBonComplet extends LigneBon {
  libelle: string;
}

/** Une remise ponctuelle telle que le bon l'affiche : `montant` est ce que la remise retient réellement sur sa ligne. */
export interface RemisePonctuelleBon {
  id: string;
  code_ligne: LigneBon['code'];
  libelle: string;
  montant: number;
  motif: string;
  origine: 'manuelle' | 'acces' | 'module';
}

/** Les libellés des postes, tels que le bon et la page d'abonnement les écrivent. */
export const LIBELLES_LIGNE: Record<LigneBon['code'], string> = {
  socle: 'Socle',
  pilotage: 'Module Pilotage',
  site: 'Module Site vitrine',
  acces_sup: 'Accès supplémentaires',
  installation: 'Frais d’installation',
};

/** Tout ce qu'il faut pour taper la facture sans rien chercher ailleurs. */
export interface BonComplet {
  id: string;
  tenant_id: string;
  contrat_id: string;
  type: 'periode' | 'complementaire' | 'installation';
  statut: 'brouillon' | 'emise' | 'annulee';
  numero: string | null;
  emis_le: string | null;
  annule_le: string | null;
  periode_debut: string;
  periode_fin: string;
  periodicite: string;
  facture_cle: string | null;
  acces_facturables: number;
  lignes: LigneBonComplet[];
  recurrent_ht: number;
  remise_taux: number;
  remise_montant: number;
  remise_motif: string | null;
  /** Les remises ponctuelles du bon, et leur somme (déjà déduite du total). */
  remises_ponctuelles: RemisePonctuelleBon[];
  remise_ponctuelle_montant: number;
  total_ht: number;
  tva_taux: number;
  tva_montant: number;
  total_ttc: number;
  identite: IdentiteFacturation;
  /** Ce qui manque à l'identité : à signaler sur le bon. */
  manque: ChampIdentite[];
}

interface LigneSql {
  id: string; tenant_id: string; contrat_id: string; type: 'periode' | 'complementaire' | 'installation'; statut: 'brouillon' | 'emise' | 'annulee';
  numero: string | null; emis_le: string | null; annule_le: string | null; periode_debut: string; periode_fin: string; periodicite: string;
  facture_cle: string | null; acces_facturables: number; lignes: string; recurrent_ht: number; remise_taux: number; remise_montant: number;
  remise_motif: string | null; remise_ponctuelle_montant: number; total_ht: number; tva_taux: number;
  raison_sociale: string; siren: string | null; adresse_facturation: string | null; contact_facturation: string | null;
}

/** Le bon, ses lignes et l'identité du cabinet. La console seule le lit (par identifiant de bon) ; jamais depuis l'hôte d'un cabinet. */
export async function bonComplet(db: Base, bonId: string): Promise<BonComplet | null> {
  const r = await db
    .prepare(
      `SELECT b.id, b.tenant_id, b.contrat_id, b.type, b.statut, b.numero, b.emis_le, b.annule_le, b.periode_debut, b.periode_fin,
              c.periodicite, b.facture_cle, b.acces_facturables, b.lignes, b.recurrent_ht, b.remise_taux, b.remise_montant, b.remise_motif, b.remise_ponctuelle_montant,
              b.total_ht, b.tva_taux, t.nom AS raison_sociale, t.siren, t.adresse_facturation, t.contact_facturation
         FROM bon_a_facturer b
         JOIN contrat c ON c.id = b.contrat_id AND c.tenant_id = b.tenant_id
         JOIN tenant t ON t.id = b.tenant_id
        WHERE b.id = ?`,
    )
    .bind(bonId)
    .first<LigneSql>();
  if (!r) return null;
  const identite: IdentiteFacturation = {
    raison_sociale: r.raison_sociale, siren: r.siren, adresse_facturation: r.adresse_facturation, contact_facturation: r.contact_facturation,
  };
  const brutes = JSON.parse(r.lignes) as LigneBon[];
  const portees = await remisesDuBon(db, r.tenant_id, r.id);
  const retenues = retenirRemises(brutes, enRemises(portees));
  const lignes: LigneBonComplet[] = brutes.map((l) => ({ ...l, libelle: LIBELLES_LIGNE[l.code] ?? l.code }));
  const remises_ponctuelles: RemisePonctuelleBon[] = portees.map((x, i) => ({
    id: x.id, code_ligne: x.code_ligne, libelle: LIBELLES_LIGNE[x.code_ligne] ?? x.code_ligne, montant: retenues[i], motif: x.motif, origine: x.origine,
  }));
  return {
    id: r.id, tenant_id: r.tenant_id, contrat_id: r.contrat_id, type: r.type, statut: r.statut, numero: r.numero, emis_le: r.emis_le,
    annule_le: r.annule_le, periode_debut: r.periode_debut, periode_fin: r.periode_fin, periodicite: r.periodicite, facture_cle: r.facture_cle,
    acces_facturables: r.acces_facturables, lignes, recurrent_ht: r.recurrent_ht, remise_taux: r.remise_taux, remise_montant: r.remise_montant,
    remise_motif: r.remise_motif, remises_ponctuelles, remise_ponctuelle_montant: r.remise_ponctuelle_montant, total_ht: r.total_ht, ...calculerTva(r.total_ht, r.tva_taux), identite, manque: identiteManquante(identite),
  };
}

export interface LigneListeBon {
  id: string;
  tenant_id: string;
  cabinet: string;
  type: 'periode' | 'complementaire' | 'installation';
  statut: 'brouillon' | 'emise' | 'annulee';
  periode_debut: string;
  periode_fin: string;
  total_ht: number;
  numero: string | null;
  siren: string | null;
  adresse_facturation: string | null;
  contact_facturation: string | null;
}

export type FiltreBons = 'brouillon' | 'emise' | 'annulee';
export const FILTRES_BONS: FiltreBons[] = ['brouillon', 'emise', 'annulee'];

/** Les bons d'un statut, TRIÉS PAR DATE (début de période, puis identifiant), de tous les cabinets : la liste de la console. */
export async function bonsParStatut(db: Base, statut: FiltreBons): Promise<LigneListeBon[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.tenant_id, t.nom AS cabinet, b.type, b.statut, b.periode_debut, b.periode_fin, b.total_ht, b.numero,
              t.siren, t.adresse_facturation, t.contact_facturation
         FROM bon_a_facturer b JOIN tenant t ON t.id = b.tenant_id
        WHERE b.statut = ?
        ORDER BY b.periode_debut, b.id`,
    )
    .bind(statut)
    .all<LigneListeBon>();
  return results;
}

/**
 * Les factures d'un cabinet : ses bons ÉMIS dont le PDF est déposé, du plus récent au plus ancien. Lecture seule. Un bon émis dont le
 * PDF n'est pas encore déposé n'y figure pas : la liste est celle des PDF.
 */
export async function facturesDuCabinet(db: Base, tenantId: string): Promise<{ id: string; numero: string; periode_debut: string; periode_fin: string; total_ht: number; emis_le: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, numero, periode_debut, periode_fin, total_ht, emis_le FROM bon_a_facturer
        WHERE tenant_id = ? AND statut = 'emise' AND facture_cle IS NOT NULL
        ORDER BY emis_le DESC, id DESC`,
    )
    .bind(tenantId)
    .all<{ id: string; numero: string; periode_debut: string; periode_fin: string; total_ht: number; emis_le: string }>();
  return results;
}

/** La clé et le numéro du PDF d'un bon émis du locataire, ou null. Bornée au locataire ET au préfixe `factures/<locataire>/`. */
export async function factureDuBon(db: Base, tenantId: string, bonId: string): Promise<{ cle: string; numero: string } | null> {
  const r = await db
    .prepare("SELECT facture_cle, numero FROM bon_a_facturer WHERE id = ? AND tenant_id = ? AND statut = 'emise'")
    .bind(bonId, tenantId)
    .first<{ facture_cle: string | null; numero: string | null }>();
  return r?.facture_cle && r.numero && cleDeFacture(r.facture_cle, tenantId) ? { cle: r.facture_cle, numero: r.numero } : null;
}

/**
 * L'éditeur dépose le PDF de la facture qu'il a tapée dans son outil. Réservé à l'éditeur ; seul un bon ÉMIS en reçoit un ; un
 * deuxième dépôt remplace le premier. Le PDF d'un bon n'est pas un montant du contrat : la clé n'entre pas dans le journal, l'identifiant
 * du bon si.
 */
export async function deposerFacture(db: Base, bucket: Bucket, tenantId: string, bonId: string, depot: Depot, acteur: Acteur): Promise<ResultatBon> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const bon = await bonDe(db, tenantId, bonId);
  if (!bon) return { ok: false, code: 'introuvable' };
  if (bon.statut !== 'emise') return { ok: false, code: 'pas_emis' };
  const cle = cleFacture(tenantId, bonId);
  await deposer(bucket, cle, depot);
  await db.batch([
    db.prepare("UPDATE bon_a_facturer SET facture_cle = ? WHERE id = ? AND tenant_id = ? AND statut = 'emise'").bind(cle, bonId, tenantId),
    requeteEvenement(db, { tenantId, type: EVENEMENT.FACTURE_DEPOSEE, acteur, cible: { type: 'contrat', id: bon.contrat_id }, detail: { bon_id: bonId } }, true),
  ]);
  return { ok: true, bon: (await bonDe(db, tenantId, bonId)) ?? bon };
}
