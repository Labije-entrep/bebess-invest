// Les remises ponctuelles d'un bon de commande et le crédit de prorata (21/11/2026). Le calcul est PUR et vit dans tarif.ts
// (retenirRemises, totauxDuBon, calculerCreditProrata) ; ici : l'écriture, les droits, l'idempotence et le journal.
//
// Deux sortes de remises ponctuelles, une seule table (`remise_ponctuelle`, migration 0017) :
//   - MANUELLE : l'éditeur la pose sur UNE ligne d'un bon BROUILLON (montant en euros HT, motif obligatoire, au plus le montant de la
//     ligne). Modifiable et supprimable tant que le bon est brouillon. Elle survit aux recalculs du brouillon par le traitement (poserBon
//     la relit dans la table et la réapplique) et se fige avec le bon émis.
//   - CRÉDIT DE PRORATA : un accès facturable facturé au-delà des accès inclus est supprimé ou suspendu en cours de période d'un contrat
//     ANNUEL. Le produit crée une remise ponctuelle sur la ligne « accès supplémentaires » du bon SUIVANT (prix × mois entiers non entamés,
//     arrondis à l'inférieur : tarif.ts, calculerCreditProrata). Ce n'est PAS un document comptable : aucun numéro, aucun remboursement.
//     Contrat mensuel : pas de crédit, le bon suivant ne compte simplement plus l'accès. Réactivé avant d'être consommé par un bon ÉMIS,
//     l'accès annule son crédit.
//
// Un arrêt complet (résiliation) n'écrit AUCUN crédit : ni la résiliation (contrat.ts), ni la sortie (essai.ts) n'appellent ce fichier, et
// un contrat dont la résiliation est enregistrée n'en reçoit plus (le bon suivant n'aura pas lieu). Un éventuel remboursement se traite
// par échanges contractuels, hors du produit.
//
// Toute lecture et toute écriture est bornée au locataire. Les montants sont en centimes entiers.

import type { Base, Requete } from './db';
import type { Contrat } from './contrat';
import { contratEnCours } from './contrat';
import { dateCourte } from './format';
import { EVENEMENT, requeteEvenement, type Acteur } from './journal';
import { calculerCreditProrata, periodeAu, plafondRemise, totauxDuBon, type CodeLigne, type LigneBon, type RemisePonctuelle } from './tarif';

const maintenant = (): string => new Date().toISOString();

export const CODES_LIGNE: CodeLigne[] = ['socle', 'pilotage', 'site', 'acces_sup', 'installation'];

export type CodeRemise = 'interdit' | 'introuvable' | 'pas_brouillon' | 'ligne_inconnue' | 'montant_invalide' | 'depasse_ligne' | 'motif_requis' | 'automatique';
export type ResultatRemise = { ok: true; id: string } | { ok: false; code: CodeRemise; plafond?: number };

export const MESSAGES_REMISE: Record<CodeRemise, string> = {
  interdit: 'Seul l’éditeur pose une remise ponctuelle.',
  introuvable: 'Remise ou bon introuvable.',
  pas_brouillon: 'Ce bon n’est plus un brouillon : il est figé, ses remises ne bougent plus.',
  ligne_inconnue: 'Ce bon n’a pas de ligne de ce type.',
  montant_invalide: 'Montant invalide : un montant en euros HT strictement positif.',
  depasse_ligne: 'Une remise ponctuelle ne peut pas dépasser le montant de sa ligne.',
  motif_requis: 'Une remise ponctuelle exige un motif.',
  automatique: 'Un crédit de prorata est calculé par le produit : il ne se modifie pas à la main (il s’annule si l’accès est réactivé).',
};

export interface RemiseLigne {
  id: string;
  bon_id: string | null;
  code_ligne: CodeLigne;
  montant: number;
  motif: string;
  origine: 'manuelle' | 'acces' | 'module';
  acces_id: string | null;
  etat: 'en_attente' | 'appliquee' | 'annulee';
  applicable_des: string | null;
  cree_le: string;
}

const COLONNES = 'id, bon_id, code_ligne, montant, motif, origine, acces_id, etat, applicable_des, cree_le';

/** Les remises ponctuelles portées par un bon (ordre de pose : c'est aussi l'ordre dans lequel elles sont retenues sur une même ligne). */
export async function remisesDuBon(db: Base, tenantId: string, bonId: string): Promise<RemiseLigne[]> {
  const { results } = await db
    .prepare(`SELECT ${COLONNES} FROM remise_ponctuelle WHERE tenant_id = ? AND bon_id = ? AND etat = 'appliquee' ORDER BY cree_le, id`)
    .bind(tenantId, bonId)
    .all<RemiseLigne>();
  return results;
}

/** Les crédits de prorata que le contrat attend de pouvoir poser (aucun bon ne les porte encore). */
export async function creditsEnAttente(db: Base, tenantId: string, contratId: string, debutBon: string): Promise<RemiseLigne[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLONNES} FROM remise_ponctuelle
        WHERE tenant_id = ? AND contrat_id = ? AND etat = 'en_attente' AND origine <> 'manuelle' AND applicable_des <= ?
        ORDER BY applicable_des, cree_le, id`,
    )
    .bind(tenantId, contratId, debutBon)
    .all<RemiseLigne>();
  return results;
}

/** « 12,50 », « 12.5 », « 12 » → 1250 centimes, sans passer par un flottant. Null si ce n'est pas un montant en euros (au plus deux décimales). */
export function eurosEnCentimes(texte: string): number | null {
  const m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(texte.trim().replace(/[\s\u00a0]/g, ''));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0) : null;
}

/** Les lignes de la table, en entrée du calcul pur : seul un crédit de prorata a un repli sur le reste du récurrent. */
export const enRemises = (rows: Pick<RemiseLigne, 'code_ligne' | 'montant' | 'origine'>[]): RemisePonctuelle[] =>
  rows.map((r) => ({ code: r.code_ligne, montant: r.montant, repli: r.origine !== 'manuelle' }));

// ---------------------------------------------------------------- les remises posées à la main

interface BonLu {
  id: string;
  contrat_id: string;
  statut: string;
  lignes: LigneBon[];
  remise_taux: number;
}

async function lireBon(db: Base, tenantId: string, bonId: string): Promise<BonLu | null> {
  const b = await db
    .prepare('SELECT id, contrat_id, statut, lignes, remise_taux FROM bon_a_facturer WHERE id = ? AND tenant_id = ?')
    .bind(bonId, tenantId)
    .first<{ id: string; contrat_id: string; statut: string; lignes: string; remise_taux: number }>();
  return b ? { ...b, lignes: JSON.parse(b.lignes) as LigneBon[] } : null;
}

/** La requête qui remet les totaux du bon d'aplomb à partir de ses lignes et de la liste FINALE de ses remises. Gardée par le statut. */
function requeteTotaux(db: Base, bon: BonLu, finales: RemisePonctuelle[]): Requete {
  const t = totauxDuBon(bon.lignes, bon.remise_taux, finales);
  return db
    .prepare("UPDATE bon_a_facturer SET remise_ponctuelle_montant = ?, remise_montant = ?, total_ht = ? WHERE id = ? AND statut = 'brouillon'")
    .bind(t.remise_ponctuelle_montant, t.remise_montant, t.total_ht, bon.id);
}

const motifNet = (m: string): string => m.trim().replace(/\s+/g, ' ').slice(0, 200);
const centimesValides = (n: number): boolean => Number.isInteger(n) && n > 0 && n <= 1_000_000_000;

/**
 * Pose une remise ponctuelle sur une ligne d'un bon BROUILLON. Éditeur seulement. Refusée : sans motif, à zéro ou négative, sur une ligne
 * que le bon n'a pas, au-delà de ce qu'il reste à remiser sur la ligne. La remise, les nouveaux totaux du bon et l'événement partent
 * dans la même transaction.
 */
export async function poserRemise(
  db: Base,
  tenantId: string,
  bonId: string,
  saisie: { code_ligne: string; montant: number; motif: string },
  acteur: Acteur,
): Promise<ResultatRemise> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const bon = await lireBon(db, tenantId, bonId);
  if (!bon) return { ok: false, code: 'introuvable' };
  if (bon.statut !== 'brouillon') return { ok: false, code: 'pas_brouillon' };
  const code = saisie.code_ligne as CodeLigne;
  if (!CODES_LIGNE.includes(code) || !bon.lignes.some((l) => l.code === code)) return { ok: false, code: 'ligne_inconnue' };
  const motif = motifNet(saisie.motif);
  if (!motif) return { ok: false, code: 'motif_requis' };
  if (!centimesValides(saisie.montant)) return { ok: false, code: 'montant_invalide' };
  const existantes = await remisesDuBon(db, tenantId, bonId);
  const plafond = plafondRemise(bon.lignes, enRemises(existantes), code);
  if (saisie.montant > plafond) return { ok: false, code: 'depasse_ligne', plafond };

  const id = crypto.randomUUID();
  const now = maintenant();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO remise_ponctuelle (id, tenant_id, contrat_id, bon_id, code_ligne, montant, motif, origine, etat, cree_le, maj_le)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'manuelle', 'appliquee', ?, ?)`,
        )
        .bind(id, tenantId, bon.contrat_id, bonId, code, saisie.montant, motif, now, now),
      requeteTotaux(db, bon, [...enRemises(existantes), { code, montant: saisie.montant }]),
      requeteEvenement(
        db,
        { tenantId, type: EVENEMENT.REMISE_PONCTUELLE_POSEE, acteur, cible: { type: 'contrat', id: bon.contrat_id }, detail: { remise_id: id, bon_id: bonId, code_ligne: code, montant: saisie.montant } },
        true,
      ),
    ]);
  } catch {
    return { ok: false, code: 'pas_brouillon' };
  }
  return { ok: true, id };
}

async function lireRemise(db: Base, tenantId: string, id: string) {
  return db
    .prepare(`SELECT ${COLONNES}, contrat_id FROM remise_ponctuelle WHERE id = ? AND tenant_id = ?`)
    .bind(id, tenantId)
    .first<RemiseLigne & { contrat_id: string }>();
}

/** Modifie le montant et le motif d'une remise MANUELLE d'un bon brouillon. Mêmes refus que `poserRemise`. */
export async function modifierRemise(db: Base, tenantId: string, remiseId: string, saisie: { montant: number; motif: string }, acteur: Acteur): Promise<ResultatRemise> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const r = await lireRemise(db, tenantId, remiseId);
  if (!r || !r.bon_id) return { ok: false, code: 'introuvable' };
  if (r.origine !== 'manuelle') return { ok: false, code: 'automatique' };
  const bon = await lireBon(db, tenantId, r.bon_id);
  if (!bon) return { ok: false, code: 'introuvable' };
  if (bon.statut !== 'brouillon') return { ok: false, code: 'pas_brouillon' };
  const motif = motifNet(saisie.motif);
  if (!motif) return { ok: false, code: 'motif_requis' };
  if (!centimesValides(saisie.montant)) return { ok: false, code: 'montant_invalide' };
  const autres = (await remisesDuBon(db, tenantId, bon.id)).filter((x) => x.id !== remiseId);
  const plafond = plafondRemise(bon.lignes, enRemises(autres), r.code_ligne);
  if (saisie.montant > plafond) return { ok: false, code: 'depasse_ligne', plafond };
  try {
    await db.batch([
      db.prepare("UPDATE remise_ponctuelle SET montant = ?, motif = ?, maj_le = ? WHERE id = ? AND tenant_id = ? AND origine = 'manuelle'").bind(saisie.montant, motif, maintenant(), remiseId, tenantId),
      requeteTotaux(db, bon, [...enRemises(autres), { code: r.code_ligne, montant: saisie.montant }]),
      requeteEvenement(
        db,
        { tenantId, type: EVENEMENT.REMISE_PONCTUELLE_MODIFIEE, acteur, cible: { type: 'contrat', id: bon.contrat_id }, detail: { remise_id: remiseId, bon_id: bon.id, code_ligne: r.code_ligne, montant: saisie.montant } },
        true,
      ),
    ]);
  } catch {
    return { ok: false, code: 'pas_brouillon' };
  }
  return { ok: true, id: remiseId };
}

/** Supprime une remise MANUELLE d'un bon brouillon (une remise d'un bon émis ou annulé reste, figée avec lui). */
export async function supprimerRemise(db: Base, tenantId: string, remiseId: string, acteur: Acteur): Promise<ResultatRemise> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const r = await lireRemise(db, tenantId, remiseId);
  if (!r || !r.bon_id) return { ok: false, code: 'introuvable' };
  if (r.origine !== 'manuelle') return { ok: false, code: 'automatique' };
  const bon = await lireBon(db, tenantId, r.bon_id);
  if (!bon) return { ok: false, code: 'introuvable' };
  if (bon.statut !== 'brouillon') return { ok: false, code: 'pas_brouillon' };
  const autres = (await remisesDuBon(db, tenantId, bon.id)).filter((x) => x.id !== remiseId);
  try {
    await db.batch([
      db.prepare("DELETE FROM remise_ponctuelle WHERE id = ? AND tenant_id = ? AND origine = 'manuelle'").bind(remiseId, tenantId),
      requeteTotaux(db, bon, enRemises(autres)),
      requeteEvenement(
        db,
        { tenantId, type: EVENEMENT.REMISE_PONCTUELLE_SUPPRIMEE, acteur, cible: { type: 'contrat', id: bon.contrat_id }, detail: { remise_id: remiseId, bon_id: bon.id, code_ligne: r.code_ligne, montant: r.montant } },
        true,
      ),
    ]);
  } catch {
    return { ok: false, code: 'pas_brouillon' };
  }
  return { ok: true, id: remiseId };
}

// ---------------------------------------------------------------- le crédit de prorata d'un accès retiré

export type CauseRetrait = 'supprime' | 'suspendu' | 'role';

/** « Accès supprimé le 20/11/2026 : 3 mois non effectués ». Le motif est écrit par un gabarit fixe, jamais par un modèle. */
export const motifCredit = (cause: CauseRetrait, jour: string, mois: number, vers?: string): string => {
  const quoi = cause === 'supprime' ? 'supprimé' : cause === 'suspendu' ? 'suspendu' : vers === 'lecture' ? 'passé en lecture' : 'sorti du périmètre facturable';
  return `Accès ${quoi} le ${dateCourte(jour)} : ${mois} mois non effectué${mois > 1 ? 's' : ''}`;
};

/** Ce que les bons ÉMIS d'une période ont facturé en accès supplémentaires (bon périodique et bons complémentaires). */
async function accesSupFactures(db: Base, tenantId: string, contratId: string, debut: string, fin: string): Promise<number> {
  const { results } = await db
    .prepare("SELECT lignes FROM bon_a_facturer WHERE tenant_id = ? AND contrat_id = ? AND statut = 'emise' AND type <> 'installation' AND periode_debut >= ? AND periode_debut < ?")
    .bind(tenantId, contratId, debut, fin)
    .all<{ lignes: string }>();
  return results.reduce((s, b) => s + (JSON.parse(b.lignes) as LigneBon[]).filter((l) => l.code === 'acces_sup').reduce((q, l) => q + l.quantite, 0), 0);
}

/**
 * Les requêtes à joindre au `batch` qui SUPPRIME, SUSPEND ou fait SORTIR du périmètre facturable (passage en lecture…) un accès : le crédit de prorata, s'il est dû. `facturablesAvant` est le nombre
 * d'accès facturables AVANT le retrait. Un crédit n'est dû que si TOUT cela est vrai :
 *   - le contrat est actif, annuel, avec une période en cours, et aucune résiliation n'y est enregistrée (arrêt complet : pas de crédit) ;
 *   - l'accès retiré faisait partie de ceux qui dépassaient les accès inclus (`facturablesAvant > acces_inclus`) ;
 *   - un bon ÉMIS de la période a réellement facturé un accès supplémentaire que ce crédit ne couvre pas encore (un accès qui n'a été
 *     compté que dans un brouillon n'a rien coûté : le brouillon se recalcule sans lui) ;
 *   - il reste au moins un mois entier avant la date anniversaire.
 * Retourne [] sinon. Le crédit est `en_attente` : le traitement quotidien le pose sur le prochain bon périodique.
 */
export async function requetesCreditRetrait(
  db: Base,
  tenantId: string,
  accesId: string,
  cause: CauseRetrait,
  facturablesAvant: number,
  acteur: Acteur | null,
  jour: string,
  vers?: string,
): Promise<Requete[]> {
  const c: Contrat | null = await contratEnCours(db, tenantId);
  if (!c || c.statut !== 'actif' || c.periodicite !== 'annuelle' || !c.debut_le || c.resiliation_effet_le !== null) return [];
  if (facturablesAvant <= c.acces_inclus) return [];
  const periode = periodeAu(c.debut_le, 'annuelle', jour);
  if (!periode) return [];
  const credit = calculerCreditProrata({ periodicite: c.periodicite, prix_acces_sup: c.prix_acces_sup, jour, anniversaire: periode.fin });
  if (!credit) return [];
  const factures = await accesSupFactures(db, tenantId, c.id, periode.debut, periode.fin);
  const deja = await db
    .prepare("SELECT COUNT(*) AS n FROM remise_ponctuelle WHERE tenant_id = ? AND contrat_id = ? AND origine = 'acces' AND etat <> 'annulee' AND applicable_des = ?")
    .bind(tenantId, c.id, periode.fin)
    .first<{ n: number }>();
  if ((deja?.n ?? 0) >= factures) return [];
  const id = crypto.randomUUID();
  const now = maintenant();
  return [
    db
      .prepare(
        `INSERT INTO remise_ponctuelle (id, tenant_id, contrat_id, bon_id, code_ligne, montant, motif, origine, acces_id, etat, applicable_des, cree_le, maj_le)
         VALUES (?, ?, ?, NULL, 'acces_sup', ?, ?, 'acces', ?, 'en_attente', ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(id, tenantId, c.id, credit.montant, motifCredit(cause, jour, credit.mois, vers), accesId, periode.fin, now, now),
    requeteEvenement(
      db,
      { tenantId, type: EVENEMENT.CREDIT_PRORATA_CREE, acteur, cible: { type: 'contrat', id: c.id }, detail: { remise_id: id, acces_id: accesId, cause, mois: credit.mois, montant: credit.montant } },
      true,
    ),
  ];
}

/**
 * L'accès est RÉACTIVÉ : son crédit de prorata est annulé tant qu'aucun bon ÉMIS ne l'a consommé (en attente, ou porté par un brouillon).
 * Les totaux du brouillon sont remis d'aplomb tout de suite. Rien à faire si le crédit est déjà consommé : il ne bouge plus (la
 * réactivation est alors facturée par le bon complémentaire du traitement quotidien).
 */
export async function annulerCreditsReactivation(db: Base, tenantId: string, accesId: string, acteur: Acteur | null): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.bon_id, r.contrat_id FROM remise_ponctuelle r LEFT JOIN bon_a_facturer b ON b.id = r.bon_id
        WHERE r.tenant_id = ? AND r.acces_id = ? AND r.origine = 'acces' AND r.etat IN ('en_attente','appliquee')
          AND (r.bon_id IS NULL OR b.statut = 'brouillon')`,
    )
    .bind(tenantId, accesId)
    .all<{ id: string; bon_id: string | null; contrat_id: string }>();
  let annules = 0;
  for (const r of results) {
    const res = await db.batch([
      db.prepare("UPDATE remise_ponctuelle SET etat = 'annulee', bon_id = NULL, maj_le = ? WHERE id = ? AND tenant_id = ? AND etat IN ('en_attente','appliquee')").bind(maintenant(), r.id, tenantId),
      requeteEvenement(db, { tenantId, type: EVENEMENT.CREDIT_PRORATA_ANNULE, acteur, cible: { type: 'contrat', id: r.contrat_id }, detail: { remise_id: r.id, acces_id: accesId, motif: 'acces_reactive' } }, true),
    ]);
    annules += (res[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0;
    if (r.bon_id) await recalculerTotaux(db, tenantId, r.bon_id);
  }
  return annules;
}

/** Remet d'aplomb les totaux d'un bon BROUILLON à partir de ses lignes et de ses remises. Sans effet sur un bon émis ou annulé. */
export async function recalculerTotaux(db: Base, tenantId: string, bonId: string): Promise<void> {
  const bon = await lireBon(db, tenantId, bonId);
  if (!bon || bon.statut !== 'brouillon') return;
  await requeteTotaux(db, bon, enRemises(await remisesDuBon(db, tenantId, bonId))).run();
}
