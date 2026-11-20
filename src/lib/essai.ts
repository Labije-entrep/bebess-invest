// La sortie d'un cabinet : l'essai non converti (lot 12) et le contrat résilié (lot 17). Même mécanisme, deux calendriers, tous deux
// déclenchés par le traitement quotidien et tous deux comptés à partir d'une DATE DE FIN :
//
//   L'ESSAI : 45 jours à compter de `date_mise_en_production`, le produit entier, rien de bridé. La date de fin est J+45.
//
//     J+38  courriel « l'essai se termine dans une semaine » ;
//     J+45  le cabinet ET les espaces de ses clients finaux sont suspendus (le contrat passe en `essai_non_converti`, auth.ts lit ce
//           statut) ; courriel : la suppression aura lieu au J+75, avec le lien d'export ;
//     J+68  courriel « suppression dans une semaine » ;
//     J+75  suppression réelle (purge.ts).
//
//   LA RÉSILIATION : un préavis enregistré (contrat.ts, `enregistrerPreavis`) fixe une date d'effet, la date anniversaire. Le contrat
//   reste `actif` jusqu'à elle ; la date de fin est cette date d'effet, notée J.
//
//     J     le contrat passe en `resilie` (même effet que ci-dessus : le cabinet ET les espaces de ses clients sont suspendus) ;
//           courriel : la suppression aura lieu à J+30, avec le lien d'export ;
//     J+23  courriel « suppression dans une semaine » ;
//     J+30  suppression réelle, la même (purge.ts).
//
// Ces six courriels (quatre pour l'essai, deux pour la résiliation) sont les SEULS envois automatiques du produit vers un cabinet. Aucun
// autre, sur aucun sujet, et rien sur l'abonnement : les gabarits ci-dessous sont fixes, sans texte généré. Tous portent sur des données
// qui vont disparaître. Le destinataire est chaque associé actif du cabinet.
//
// La suspension de sortie coupe les viewers ; la suspension commerciale d'un cabinet sous contrat (admin.ts) les laisse en ligne. Les deux
// mécanismes sont opposés et ne se fusionnent pas : celui-ci ne vit que dans le statut du contrat (HORS_ESSAI_ECHU, auth.ts), l'autre que
// dans la table `suspension` (HORS_SUSPENSION).
//
// Rejouabilité : le changement de statut est conditionnel (`WHERE statut = 'essai'`, `WHERE statut IN ('actif','suspendu')`), chaque
// courriel passe par le registre des envois (envois.ts, une clé par jalon et par destinataire), la suppression par la marque `purge:`.

import type { Base } from './db';
import { JOURS_ESSAI, plusJours, STATUTS_DE_SORTIE, STATUTS_EN_COURS, STATUTS_EN_SERVICE, statutsEnSql } from './contrat';
import { lignesModifiees, unePremiereFois, type Contexte } from './envois';
import { noterIncident } from './incidents';
import { EVENEMENT, requeteEvenement } from './journal';
import { purgerCabinet } from './purge';
import { EXPORT_ESSAI_ECHU } from './roles';

/** Les jalons, comptés à partir de la date de fin : l'essai (J+45) et la résiliation (sa date d'effet) partagent ces trois délais. */
export const JOURS_RAPPEL_AVANT_FIN = 7;
export const JOURS_AVIS_APRES_FIN = 23;
export const JOURS_SUPPRESSION_APRES_FIN = 30;
/** Les mêmes, pour l'essai, comptés depuis la mise en production : 38, 45, 68 et 75. */
export const J_FIN = JOURS_ESSAI;
export const J_RAPPEL = J_FIN - JOURS_RAPPEL_AVANT_FIN;
export const J_AVIS_SUPPRESSION = J_FIN + JOURS_AVIS_APRES_FIN;
export const J_SUPPRESSION = J_FIN + JOURS_SUPPRESSION_APRES_FIN;
/** Délai minimal entre un avis reçu et la suppression : une semaine. */
const JOURS_DE_PREAVIS = 7;

export type GenreSortie = 'essai' | 'resiliation';
type Avis = 'J38' | 'J45' | 'J68' | 'R0' | 'R23' | 'TARD';

/**
 * Ce qui distingue les deux sorties. `prefixe` : celui des clés du registre des envois (les clés de l'essai n'ont pas changé : une
 * passe rejouée après la mise en production du lot 17 ne renvoie rien). `avisSuppression` : les avis qui annoncent la suppression,
 * ceux dont le plus ancien fonde le préavis d'une semaine. `jour` : le libellé de la suppression, pour les incidents de la console.
 */
const GENRES: Record<GenreSortie, { prefixe: string; ouverture: Avis; rappel: Avis; avisSuppression: Avis[]; jour: string; objet: string }> = {
  essai: { prefixe: 'essai', ouverture: 'J45', rappel: 'J68', avisSuppression: ['J45', 'J68', 'TARD'], jour: 'J+75', objet: "de fin d'essai" },
  resiliation: { prefixe: 'resiliation', ouverture: 'R0', rappel: 'R23', avisSuppression: ['R0', 'R23', 'TARD'], jour: 'J+30', objet: 'de résiliation' },
};

/**
 * Le cabinet est-il fermé par la sortie d'un contrat (essai non converti ou résilié), sans autre contrat en cours ? Lequel des deux ?
 * C'est ce que lit le middleware pour borner l'associé à l'export, et pour lui dire pourquoi. Null : le cabinet n'est pas fermé.
 */
export async function sortieDuCabinet(db: Base, tenantId: string): Promise<GenreSortie | null> {
  const r = await db
    .prepare(
      `SELECT statut FROM contrat WHERE tenant_id = ? AND statut IN (${statutsEnSql(STATUTS_DE_SORTIE)})
          AND NOT EXISTS (SELECT 1 FROM contrat WHERE tenant_id = ? AND statut IN (${statutsEnSql(STATUTS_EN_COURS)}))
        ORDER BY maj_le DESC, id DESC LIMIT 1`,
    )
    .bind(tenantId, tenantId)
    .first<{ statut: string }>();
  return r === null ? null : r.statut === 'resilie' ? 'resiliation' : 'essai';
}

// ---------------------------------------------------------------- les courriels (gabarits fixes)

const dateFr = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

const HOTE_LOCAL = /^(localhost|127\.0\.0\.1|([a-z0-9-]+\.)+localhost)(:\d+)?$/;

/** L'export complet, sur l'hôte du cabinet : l'associé s'y connecte, puis le télécharge (la seule route que la sortie lui laisse). */
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
    case 'R0':
      return {
        sujet: 'Votre contrat est résilié : suppression des données le ' + dateFr(g.suppression),
        texte:
          `${entree}La résiliation du contrat du cabinet « ${g.cabinet} » a pris effet le ${dateFr(g.fin)} : l'accès du cabinet et les espaces de ses clients sont suspendus.\n\n` +
          `Vos données seront définitivement supprimées le ${dateFr(g.suppression)}. Jusqu'à cette date, vous pouvez en tirer l'export complet.${lien}${sortie}`,
      };
    case 'J68':
    case 'R23':
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
async function aviser(ctx: Contexte, e: Sortie, avis: Avis, suppression: string): Promise<number> {
  const { prefixe, objet } = GENRES[e.genre];
  const { results: associes } = await ctx.db
    .prepare("SELECT id, email, nom FROM utilisateur WHERE tenant_id = ? AND role = 'associe' AND actif = 1 ORDER BY id")
    .bind(e.tenant_id)
    .all<{ id: string; email: string; nom: string }>();
  if (associes.length === 0) {
    await unePremiereFois(ctx.db, e.tenant_id, `${prefixe}:${e.id}:${avis}:aucun`, ctx.maintenant, () =>
      noterIncident(ctx.db, e.tenant_id, 'mail_refuse', `Avis ${avis} ${objet} : aucun associé actif à qui l'adresser.`),
    );
    return 0;
  }
  let envoyes = 0;
  for (const a of associes) {
    const { sujet, texte } = courriel(avis, {
      cabinet: e.cabinet, nom: a.nom, fin: e.fin, suppression, lien: lienExport(e.domaine),
    });
    const r = await unePremiereFois(ctx.db, e.tenant_id, `${prefixe}:${e.id}:${avis}:${a.id}`, ctx.maintenant, () =>
      ctx.mailer(e.domaine ?? 'localhost').envoyer(a.email, sujet, texte),
    );
    if (r.etat === 'fait') envoyes++;
    if (r.etat === 'echec') await noterIncident(ctx.db, e.tenant_id, 'mail_refuse', `Avis ${avis} ${objet} non envoyé à ${a.email} : ${r.message}`);
  }
  return envoyes;
}

// ---------------------------------------------------------------- le traitement

interface Sortie {
  id: string;
  tenant_id: string;
  statut: string;
  genre: GenreSortie;
  /** La date de fin : J+45 de l'essai, ou la date d'effet de la résiliation. Tous les jalons se comptent depuis elle. */
  fin: string;
  /** La mise en production (l'essai seulement). */
  mep: string | null;
  cabinet: string;
  domaine: string | null;
}

export interface RapportEssais {
  /** Courriels réellement partis pendant cette passe (jamais ceux d'une passe précédente). */
  courriels: number;
  /** Contrats passés en `essai_non_converti` pendant cette passe. */
  suspendus: number;
  /** Contrats passés en `resilie` pendant cette passe, à leur date d'effet. */
  resilies: number;
  purges: number;
  /** Suppressions retenues : la raison est dans les incidents de la console. */
  retenues: number;
}

/** J+45 : le contrat passe en `essai_non_converti`, avec son événement, dans la même transaction. Rejoué, il ne trouve plus d'essai. */
async function suspendreEssai(ctx: Contexte, e: Sortie): Promise<boolean> {
  const r = await ctx.db.batch([
    ctx.db
      .prepare("UPDATE contrat SET statut = 'essai_non_converti', maj_le = ? WHERE id = ? AND tenant_id = ? AND statut = 'essai'")
      .bind(ctx.maintenant, e.id, e.tenant_id),
    requeteEvenement(
      ctx.db,
      {
        tenantId: e.tenant_id, type: EVENEMENT.ESSAI_NON_CONVERTI, acteur: null, cible: { type: 'contrat', id: e.id },
        detail: { date_mise_en_production: e.mep, date_fin_essai: e.fin, statut_avant: 'essai', statut_apres: 'essai_non_converti' },
      },
      true,
    ),
  ]);
  return lignesModifiees(r[0]) > 0;
}

/**
 * La date d'effet d'une résiliation : le contrat passe en `resilie`, avec son événement, dans la même transaction. Conditionnel à la date
 * d'effet posée sur le contrat (un préavis annulé l'a effacée : rien ne bouge) ; rejoué, il ne trouve plus de contrat en service.
 */
async function resilierContrat(ctx: Contexte, e: Sortie): Promise<boolean> {
  const r = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE contrat SET statut = 'resilie', maj_le = ?
          WHERE id = ? AND tenant_id = ? AND statut IN (${statutsEnSql(STATUTS_EN_SERVICE)}) AND resiliation_effet_le = ? AND resiliation_effet_le <= ?`,
      )
      .bind(ctx.maintenant, e.id, e.tenant_id, e.fin, ctx.jour),
    requeteEvenement(
      ctx.db,
      {
        tenantId: e.tenant_id, type: EVENEMENT.CONTRAT_RESILIE, acteur: null, cible: { type: 'contrat', id: e.id },
        detail: { effet_le: e.fin, statut_avant: e.statut, statut_apres: 'resilie' },
      },
      true,
    ),
  ]);
  return lignesModifiees(r[0]) > 0;
}

/**
 * Le jour de l'avis de suppression le plus ancien qui soit réellement parti (celui de l'ouverture, le rappel, ou l'avis tardif), ou null.
 * La suppression est irréversible : elle n'a lieu que si un associé a été prévenu au moins une semaine avant.
 */
async function premierAvis(db: Base, genre: GenreSortie, contratId: string): Promise<string | null> {
  const { prefixe, avisSuppression } = GENRES[genre];
  const r = await db
    .prepare(
      `SELECT MIN(substr(envoye_le, 1, 10)) AS jour FROM envoi_automatique
        WHERE envoye_le IS NOT NULL AND (${avisSuppression.map(() => 'cle LIKE ?').join(' OR ')})`,
    )
    .bind(...avisSuppression.map((a) => `${prefixe}:${contratId}:${a}:%`))
    .first<{ jour: string | null }>();
  return r?.jour ?? null;
}

export async function traiterEssais(ctx: Contexte): Promise<RapportEssais> {
  const rapport: RapportEssais = { courriels: 0, suspendus: 0, resilies: 0, purges: 0, retenues: 0 };
  const { results } = await ctx.db
    .prepare(
      `SELECT c.id, c.tenant_id, c.statut, c.date_mise_en_production AS mep, c.resiliation_effet_le AS effet, t.nom AS cabinet, t.domaine
         FROM contrat c JOIN tenant t ON t.id = c.tenant_id
        WHERE ((c.statut IN ('essai', 'essai_non_converti') AND c.date_mise_en_production IS NOT NULL)
            OR (c.statut IN (${statutsEnSql([...STATUTS_EN_SERVICE, 'resilie'])}) AND c.resiliation_effet_le IS NOT NULL))
          AND NOT EXISTS (SELECT 1 FROM envoi_automatique p WHERE p.cle = 'purge:' || c.id)
          AND NOT EXISTS (SELECT 1 FROM contrat x WHERE x.tenant_id = c.tenant_id AND x.id <> c.id AND x.statut IN (${statutsEnSql(STATUTS_EN_COURS)}))
        ORDER BY c.id`,
    )
    .all<{ id: string; tenant_id: string; statut: string; mep: string | null; effet: string | null; cabinet: string; domaine: string | null }>();

  for (const ligne of results) {
    const genre: GenreSortie = ligne.statut === 'essai' || ligne.statut === 'essai_non_converti' ? 'essai' : 'resiliation';
    const e: Sortie = {
      id: ligne.id, tenant_id: ligne.tenant_id, statut: ligne.statut, genre, cabinet: ligne.cabinet, domaine: ligne.domaine, mep: ligne.mep,
      fin: genre === 'essai' ? plusJours(ligne.mep as string, J_FIN) : (ligne.effet as string),
    };
    const j = (n: number): string => plusJours(e.fin, n);
    const g = GENRES[genre];
    let statut = e.statut;

    if (statut === 'essai') {
      if (ctx.jour >= e.fin) {
        if (await suspendreEssai(ctx, e)) rapport.suspendus++;
        statut = 'essai_non_converti';
      } else if (ctx.jour >= j(-JOURS_RAPPEL_AVANT_FIN)) {
        rapport.courriels += await aviser(ctx, e, 'J38', j(JOURS_SUPPRESSION_APRES_FIN));
        continue;
      } else continue;
    } else if (statut === 'actif' || statut === 'suspendu') {
      // Une résiliation enregistrée, pas encore à sa date d'effet : rien à faire, le contrat est en service.
      if (ctx.jour < e.fin) continue;
      if (await resilierContrat(ctx, e)) rapport.resilies++;
      else {
        // Le contrat n'a pas bougé : une autre passe l'a déjà clos, ou le préavis vient d'être annulé. On n'avise que d'un contrat réellement résilié.
        const apres = await ctx.db.prepare('SELECT statut FROM contrat WHERE id = ? AND tenant_id = ?').bind(e.id, e.tenant_id).first<{ statut: string }>();
        if (apres?.statut !== 'resilie') continue;
      }
      statut = 'resilie';
    }

    // essai_non_converti ou resilie : le cabinet est fermé ; il ne reste que les avis et, à la date de suppression, la suppression.
    if (ctx.jour < j(JOURS_SUPPRESSION_APRES_FIN)) {
      rapport.courriels += await aviser(ctx, e, ctx.jour >= j(JOURS_AVIS_APRES_FIN) ? g.rappel : g.ouverture, j(JOURS_SUPPRESSION_APRES_FIN));
      continue;
    }

    // Le jour de suppression et après. Si aucun avis n'est jamais parti (messagerie en panne tout ce temps), on prévient maintenant et on
    // supprime une semaine plus tard : une suppression irréversible ne tombe pas sur quelqu'un qui n'a rien reçu.
    let avis = await premierAvis(ctx.db, genre, e.id);
    if (!avis) {
      rapport.courriels += await aviser(ctx, e, 'TARD', plusJours(ctx.jour, JOURS_DE_PREAVIS));
      avis = await premierAvis(ctx.db, genre, e.id);
    }
    if (!avis || avis > plusJours(ctx.jour, -JOURS_DE_PREAVIS)) {
      rapport.retenues++;
      await unePremiereFois(ctx.db, e.tenant_id, `${g.prefixe}:${e.id}:retenue:${avis ?? 'sans-avis'}`, ctx.maintenant, () =>
        noterIncident(ctx.db, e.tenant_id, 'purge_bloquee', avis ? `Suppression du ${g.jour} reportée : avis du ${avis}, une semaine de préavis requise.` : `Suppression du ${g.jour} retenue : aucun avis n’a pu être envoyé.`),
      );
      continue;
    }
    const p = await purgerCabinet(ctx, e.id, e.tenant_id);
    if (p.etat === 'purge') rapport.purges++;
    else {
      rapport.retenues++;
      await unePremiereFois(ctx.db, e.tenant_id, `${g.prefixe}:${e.id}:bloquee:${ctx.jour}`, ctx.maintenant, () =>
        noterIncident(ctx.db, e.tenant_id, 'purge_bloquee', `Suppression du ${g.jour} non faite : ${p.raison}.`),
      );
    }
  }
  return rapport;
}
