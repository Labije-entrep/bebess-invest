// L'essai (lot 12) : 45 jours à compter de `date_mise_en_production`, le produit entier, rien de bridé. Quatre jalons, déclenchés par le
// traitement quotidien :
//
//   J+38  courriel « l'essai se termine dans une semaine » ;
//   J+45  le cabinet ET les espaces de ses clients finaux sont suspendus (le contrat passe en `essai_non_converti`, auth.ts lit ce
//         statut) ; courriel : la suppression aura lieu au J+75, avec le lien d'export ;
//   J+68  courriel « suppression dans une semaine » ;
//   J+75  suppression réelle (purge.ts).
//
// Ces quatre courriels sont les SEULS envois automatiques du produit vers un cabinet. Aucun autre, sur aucun sujet, et rien sur
// l'abonnement : les gabarits ci-dessous sont fixes, sans texte généré. Le destinataire est chaque associé actif du cabinet.
//
// La suspension d'essai coupe les viewers ; la suspension commerciale d'un cabinet sous contrat (admin.ts) les laisse en ligne. Les deux
// mécanismes sont opposés et ne se fusionnent pas : celui-ci ne vit que dans le statut du contrat (HORS_ESSAI_ECHU, auth.ts), l'autre que
// dans la table `suspension` (HORS_SUSPENSION).
//
// Rejouabilité : le changement de statut est conditionnel (`WHERE statut = 'essai'`), chaque courriel passe par le registre des envois
// (envois.ts, une clé par jalon et par destinataire).

import type { Base } from './db';
import { JOURS_ESSAI, plusJours, STATUTS_EN_COURS } from './contrat';
import { lignesModifiees, unePremiereFois, type Contexte } from './envois';
import { noterIncident } from './incidents';
import { EVENEMENT, requeteEvenement } from './journal';
import { purgerCabinet } from './purge';
import { EXPORT_ESSAI_ECHU } from './roles';

export const J_RAPPEL = 38;
export const J_FIN = JOURS_ESSAI;
export const J_AVIS_SUPPRESSION = 68;
export const J_SUPPRESSION = 75;
/** Délai minimal entre un avis reçu et la suppression : une semaine. */
const JOURS_DE_PREAVIS = 7;

type Avis = 'J38' | 'J45' | 'J68' | 'TARD';

const CONDITION_EN_COURS = `statut IN (${STATUTS_EN_COURS.map((x) => `'${x}'`).join(',')})`;

/** Le cabinet est-il en fin d'essai non converti, sans autre contrat en cours ? C'est ce que lit le middleware pour borner l'associé à l'export. */
export async function essaiEchu(db: Base, tenantId: string): Promise<boolean> {
  const r = await db
    .prepare(
      `SELECT 1 AS ok FROM contrat WHERE tenant_id = ? AND statut = 'essai_non_converti'
          AND NOT EXISTS (SELECT 1 FROM contrat WHERE tenant_id = ? AND ${CONDITION_EN_COURS})`,
    )
    .bind(tenantId, tenantId)
    .first();
  return r !== null;
}

// ---------------------------------------------------------------- les courriels (gabarits fixes)

const dateFr = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

const HOTE_LOCAL = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

/** L'export complet, sur l'hôte du cabinet : l'associé s'y connecte, puis le télécharge (la seule route que l'essai échu lui laisse). */
export const lienExport = (domaine: string | null): string | null =>
  domaine ? `${HOTE_LOCAL.test(domaine) ? 'http' : 'https'}://${domaine}${EXPORT_ESSAI_ECHU}` : null;

interface Gabarit {
  cabinet: string;
  nom: string;
  fin: string;
  suppression: string;
  lien: string | null;
}

function courriel(avis: Avis, g: Gabarit): { sujet: string; texte: string } {
  const lien = g.lien ? `\n\nL'export complet de vos données, à télécharger une fois connecté en tant qu'associé :\n${g.lien}` : '';
  const entree = `Bonjour ${g.nom},\n\n`;
  const sortie = "\n\nCordialement,\nBeBess'Invest";
  switch (avis) {
    case 'J38':
      return {
        sujet: "L'essai de votre cabinet se termine dans une semaine",
        texte:
          `${entree}L'essai du cabinet « ${g.cabinet} » se termine dans une semaine, le ${dateFr(g.fin)}.\n\n` +
          `À cette date, l'accès du cabinet et les espaces de ses clients seront suspendus.${sortie}`,
      };
    case 'J45':
      return {
        sujet: "L'essai de votre cabinet est terminé : suppression des données le " + dateFr(g.suppression),
        texte:
          `${entree}L'essai du cabinet « ${g.cabinet} » s'est terminé le ${dateFr(g.fin)} : l'accès du cabinet et les espaces de ses clients sont suspendus.\n\n` +
          `Vos données seront définitivement supprimées le ${dateFr(g.suppression)}. Jusqu'à cette date, vous pouvez en tirer l'export complet.${lien}${sortie}`,
      };
    case 'J68':
    case 'TARD':
      return {
        sujet: 'Vos données seront supprimées dans une semaine',
        texte:
          `${entree}Les données du cabinet « ${g.cabinet} » seront définitivement supprimées le ${dateFr(g.suppression)}, dans une semaine. ` +
          `Après cette date, il ne restera plus rien à exporter.${lien}${sortie}`,
      };
  }
}

/** Envoie l'avis à chaque associé actif, une fois chacun. Un échec est un incident de la console ; il se retentera à la passe suivante. */
async function aviser(ctx: Contexte, e: Essai, avis: Avis, suppression: string): Promise<number> {
  const { results: associes } = await ctx.db
    .prepare("SELECT id, email, nom FROM utilisateur WHERE tenant_id = ? AND role = 'associe' AND actif = 1 ORDER BY id")
    .bind(e.tenant_id)
    .all<{ id: string; email: string; nom: string }>();
  if (associes.length === 0) {
    await unePremiereFois(ctx.db, e.tenant_id, `essai:${e.id}:${avis}:aucun`, ctx.maintenant, () =>
      noterIncident(ctx.db, e.tenant_id, 'mail_refuse', `Avis ${avis} de fin d'essai : aucun associé actif à qui l'adresser.`),
    );
    return 0;
  }
  let envoyes = 0;
  for (const a of associes) {
    const { sujet, texte } = courriel(avis, {
      cabinet: e.cabinet, nom: a.nom, fin: plusJours(e.mep, J_FIN), suppression, lien: lienExport(e.domaine),
    });
    const r = await unePremiereFois(ctx.db, e.tenant_id, `essai:${e.id}:${avis}:${a.id}`, ctx.maintenant, () =>
      ctx.mailer(e.domaine ?? 'localhost').envoyer(a.email, sujet, texte),
    );
    if (r.etat === 'fait') envoyes++;
    if (r.etat === 'echec') await noterIncident(ctx.db, e.tenant_id, 'mail_refuse', `Avis ${avis} de fin d'essai non envoyé à ${a.email} : ${r.message}`);
  }
  return envoyes;
}

// ---------------------------------------------------------------- le traitement

interface Essai {
  id: string;
  tenant_id: string;
  statut: string;
  mep: string;
  cabinet: string;
  domaine: string | null;
}

export interface RapportEssais {
  /** Courriels réellement partis pendant cette passe (jamais ceux d'une passe précédente). */
  courriels: number;
  /** Contrats passés en `essai_non_converti` pendant cette passe. */
  suspendus: number;
  purges: number;
  /** Suppressions retenues : la raison est dans les incidents de la console. */
  retenues: number;
}

/** J+45 : le contrat passe en `essai_non_converti`, avec son événement, dans la même transaction. Rejoué, il ne trouve plus d'essai. */
async function suspendreEssai(ctx: Contexte, e: Essai): Promise<boolean> {
  const r = await ctx.db.batch([
    ctx.db
      .prepare("UPDATE contrat SET statut = 'essai_non_converti', maj_le = ? WHERE id = ? AND tenant_id = ? AND statut = 'essai'")
      .bind(ctx.maintenant, e.id, e.tenant_id),
    requeteEvenement(
      ctx.db,
      {
        tenantId: e.tenant_id, type: EVENEMENT.ESSAI_NON_CONVERTI, acteur: null, cible: { type: 'contrat', id: e.id },
        detail: { date_mise_en_production: e.mep, date_fin_essai: plusJours(e.mep, J_FIN), statut_avant: 'essai', statut_apres: 'essai_non_converti' },
      },
      true,
    ),
  ]);
  return lignesModifiees(r[0]) > 0;
}

/**
 * Le jour de l'avis de suppression le plus ancien qui soit réellement parti (J+45 ou J+68, ou l'avis tardif), ou null. La suppression
 * est irréversible : elle n'a lieu que si un associé a été prévenu au moins une semaine avant.
 */
async function premierAvis(db: Base, contratId: string): Promise<string | null> {
  const r = await db
    .prepare(
      `SELECT MIN(substr(envoye_le, 1, 10)) AS jour FROM envoi_automatique
        WHERE envoye_le IS NOT NULL AND (cle LIKE ? OR cle LIKE ? OR cle LIKE ?)`,
    )
    .bind(`essai:${contratId}:J45:%`, `essai:${contratId}:J68:%`, `essai:${contratId}:TARD:%`)
    .first<{ jour: string | null }>();
  return r?.jour ?? null;
}

export async function traiterEssais(ctx: Contexte): Promise<RapportEssais> {
  const rapport: RapportEssais = { courriels: 0, suspendus: 0, purges: 0, retenues: 0 };
  const { results } = await ctx.db
    .prepare(
      `SELECT c.id, c.tenant_id, c.statut, c.date_mise_en_production AS mep, t.nom AS cabinet, t.domaine
         FROM contrat c JOIN tenant t ON t.id = c.tenant_id
        WHERE c.statut IN ('essai', 'essai_non_converti') AND c.date_mise_en_production IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM envoi_automatique p WHERE p.cle = 'purge:' || c.id)
          AND NOT EXISTS (SELECT 1 FROM contrat x WHERE x.tenant_id = c.tenant_id AND x.id <> c.id AND x.statut IN (${STATUTS_EN_COURS.map((s) => `'${s}'`).join(',')}))
        ORDER BY c.id`,
    )
    .all<Essai>();

  for (const e of results) {
    const j = (n: number): string => plusJours(e.mep, n);
    let statut = e.statut;

    if (statut === 'essai') {
      if (ctx.jour >= j(J_FIN)) {
        if (await suspendreEssai(ctx, e)) rapport.suspendus++;
        statut = 'essai_non_converti';
      } else if (ctx.jour >= j(J_RAPPEL)) {
        rapport.courriels += await aviser(ctx, e, 'J38', j(J_SUPPRESSION));
        continue;
      } else continue;
    }

    // essai_non_converti : le cabinet est fermé ; il ne reste que les avis et, au J+75, la suppression.
    if (ctx.jour < j(J_SUPPRESSION)) {
      rapport.courriels += await aviser(ctx, e, ctx.jour >= j(J_AVIS_SUPPRESSION) ? 'J68' : 'J45', j(J_SUPPRESSION));
      continue;
    }

    // J+75 et après. Si aucun avis n'est jamais parti (messagerie en panne tout ce temps), on prévient maintenant et on supprime une
    // semaine plus tard : une suppression irréversible ne tombe pas sur quelqu'un qui n'a rien reçu.
    let avis = await premierAvis(ctx.db, e.id);
    if (!avis) {
      rapport.courriels += await aviser(ctx, e, 'TARD', plusJours(ctx.jour, JOURS_DE_PREAVIS));
      avis = await premierAvis(ctx.db, e.id);
    }
    if (!avis || avis > plusJours(ctx.jour, -JOURS_DE_PREAVIS)) {
      rapport.retenues++;
      await unePremiereFois(ctx.db, e.tenant_id, `essai:${e.id}:retenue:${avis ?? 'sans-avis'}`, ctx.maintenant, () =>
        noterIncident(ctx.db, e.tenant_id, 'purge_bloquee', avis ? `Suppression du J+75 reportée : avis du ${avis}, une semaine de préavis requise.` : 'Suppression du J+75 retenue : aucun avis n’a pu être envoyé.'),
      );
      continue;
    }
    const p = await purgerCabinet(ctx, e.id, e.tenant_id);
    if (p.etat === 'purge') rapport.purges++;
    else {
      rapport.retenues++;
      await unePremiereFois(ctx.db, e.tenant_id, `essai:${e.id}:bloquee:${ctx.jour}`, ctx.maintenant, () =>
        noterIncident(ctx.db, e.tenant_id, 'purge_bloquee', `Suppression du J+75 non faite : ${p.raison}.`),
      );
    }
  }
  return rapport;
}
