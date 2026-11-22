// Les lignes libres ponctuelles d'un bon de commande (22/11/2026) et le bon ponctuel « prestation ».
//
// Une ligne libre est une prestation demandée en cours de contrat (mise en place du site, etc.) : libellé (obligatoire, 120 caractères au plus),
// quantité entière (1 par défaut), prix unitaire en euros HT, motif ou référence facultatif. Elle ADDITIONNE (la remise ponctuelle retire) : elle entre
// dans le total HT, la TVA et le TTC, au centime exact, en entiers. Éditeur seulement, bon BROUILLON seulement ; figée avec le bon à l'émission
// (les déclencheurs de la migration 0018 la figent aussi côté base).
//
// Stockage À PART (table `ligne_libre`), comme les remises ponctuelles : le traitement quotidien recalcule `bon_a_facturer.lignes` et les relit ici
// (facturation.ts, poserBon), rien ne s'efface. La remise commerciale en pourcentage ne s'y applique pas (elle porte sur le récurrent seul) ; une remise
// ponctuelle peut les viser (code de ligne `libre`), sans dépasser leur montant total.
//
// Le journal reçoit des identifiants, une quantité et des montants : jamais le libellé ni le motif (textes libres).
//
// Le bon « prestation » est un bon sans période récurrente, pour un cabinet dont aucun brouillon n'est ouvert : même numérotation BC-AAAA-NNNN et même
// séquence que les autres bons, émission et annulation identiques. Il ne s'émet pas vide.

import type { Base } from './db';
import { contratEnCours } from './contrat';
import { EVENEMENT, requeteEvenement, type Acteur } from './journal';
import { enRemises, lignesLibresDuBon, lireBon, remisesDuBon, requeteTotaux, type BonLu } from './remises';
import { ligneLibreAgregee, TVA_TAUX, type LigneBon } from './tarif';

const maintenant = (): string => new Date().toISOString();

export const LIBELLE_MAX = 120;
export const MOTIF_MAX = 200;
export const QUANTITE_MAX = 9999;
export const PRIX_MAX = 99_999_999;

export type CodeLigneLibre =
  | 'interdit' | 'introuvable' | 'pas_brouillon' | 'libelle_requis' | 'libelle_trop_long' | 'quantite_invalide' | 'prix_invalide' | 'motif_trop_long' | 'contrat_absent';
export type ResultatLigneLibre = { ok: true; id: string } | { ok: false; code: CodeLigneLibre };

export const MESSAGES_LIGNE_LIBRE: Record<CodeLigneLibre, string> = {
  interdit: 'Seul l’éditeur ajoute une ligne libre.',
  introuvable: 'Ligne ou bon introuvable.',
  pas_brouillon: 'Ce bon n’est plus un brouillon : il est figé, ses lignes ne bougent plus.',
  libelle_requis: 'Le libellé de la ligne est obligatoire.',
  libelle_trop_long: `Le libellé est limité à ${LIBELLE_MAX} caractères.`,
  quantite_invalide: `La quantité est un nombre entier de 1 à ${QUANTITE_MAX}.`,
  prix_invalide: 'Le prix unitaire est un montant en euros HT strictement positif, avec deux décimales au plus.',
  motif_trop_long: `Le motif ou la référence est limité à ${MOTIF_MAX} caractères.`,
  contrat_absent: 'Ce cabinet n’a pas de contrat en cours : il n’y a rien à facturer.',
};

export interface SaisieLigneLibre {
  libelle: string;
  quantite: number;
  /** En centimes. */
  prix_unitaire: number;
  motif?: string;
}

const net = (t: string): string => t.trim().replace(/\s+/g, ' ');

/** Valide une saisie ; rend la saisie nettoyée ou le code du refus. Fonction pure. */
export function validerLigneLibre(s: SaisieLigneLibre): { ok: true; valeur: Required<SaisieLigneLibre> } | { ok: false; code: CodeLigneLibre } {
  const libelle = net(String(s.libelle ?? ''));
  if (libelle === '') return { ok: false, code: 'libelle_requis' };
  if (libelle.length > LIBELLE_MAX) return { ok: false, code: 'libelle_trop_long' };
  if (!Number.isInteger(s.quantite) || s.quantite < 1 || s.quantite > QUANTITE_MAX) return { ok: false, code: 'quantite_invalide' };
  if (!Number.isInteger(s.prix_unitaire) || s.prix_unitaire < 1 || s.prix_unitaire > PRIX_MAX) return { ok: false, code: 'prix_invalide' };
  const motif = net(String(s.motif ?? ''));
  if (motif.length > MOTIF_MAX) return { ok: false, code: 'motif_trop_long' };
  return { ok: true, valeur: { libelle, quantite: s.quantite, prix_unitaire: s.prix_unitaire, motif } };
}

/** « 3 », « 03 », vide → entier (vide : 1, la quantité par défaut). Null si ce n'est pas un entier. */
export function lireQuantite(texte: string): number | null {
  const t = texte.trim();
  if (t === '') return 1;
  return /^\d{1,5}$/.test(t) ? Number(t) : null;
}

/** Les totaux du bon recalculés avec UNE autre liste de lignes libres (et ses remises, sans celles de `libre` si plus rien ne les porte). */
async function totauxAvec(db: Base, tenantId: string, bon: BonLu, libres: { quantite: number; prix_unitaire: number }[]) {
  const sansLibre: LigneBon[] = bon.lignes.filter((l) => l.code !== 'libre');
  const futur: BonLu = { ...bon, lignes: [...sansLibre, ...ligneLibreAgregee(libres)] };
  const remises = (await remisesDuBon(db, tenantId, bon.id)).filter((r) => libres.length > 0 || r.code_ligne !== 'libre');
  return { requete: requeteTotaux(db, futur, enRemises(remises)), plusDeLibre: libres.length === 0 };
}

async function bonBrouillon(db: Base, tenantId: string, bonId: string, acteur: Acteur): Promise<BonLu | { ok: false; code: CodeLigneLibre }> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const bon = await lireBon(db, tenantId, bonId);
  if (!bon) return { ok: false, code: 'introuvable' };
  if (bon.statut !== 'brouillon') return { ok: false, code: 'pas_brouillon' };
  return bon;
}

const estRefus = (x: BonLu | { ok: false; code: CodeLigneLibre }): x is { ok: false; code: CodeLigneLibre } => 'ok' in x;

/** Ajoute une ligne libre à un bon BROUILLON : la ligne, les nouveaux totaux et l'événement partent dans la même transaction. */
export async function poserLigneLibre(db: Base, tenantId: string, bonId: string, saisie: SaisieLigneLibre, acteur: Acteur): Promise<ResultatLigneLibre> {
  const bon = await bonBrouillon(db, tenantId, bonId, acteur);
  if (estRefus(bon)) return bon;
  const v = validerLigneLibre(saisie);
  if (!v.ok) return v;
  const existantes = await lignesLibresDuBon(db, tenantId, bonId);
  const { requete } = await totauxAvec(db, tenantId, bon, [...existantes, v.valeur]);
  const id = crypto.randomUUID();
  const now = maintenant();
  try {
    await db.batch([
      db
        .prepare('INSERT INTO ligne_libre (id, tenant_id, contrat_id, bon_id, libelle, quantite, prix_unitaire, motif, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, tenantId, bon.contrat_id, bonId, v.valeur.libelle, v.valeur.quantite, v.valeur.prix_unitaire, v.valeur.motif || null, now, now),
      requete,
      requeteEvenement(
        db,
        { tenantId, type: EVENEMENT.LIGNE_LIBRE_POSEE, acteur, cible: { type: 'contrat', id: bon.contrat_id }, detail: { ligne_id: id, bon_id: bonId, quantite: v.valeur.quantite, prix_unitaire: v.valeur.prix_unitaire } },
        true,
      ),
    ]);
  } catch {
    return { ok: false, code: 'pas_brouillon' };
  }
  return { ok: true, id };
}

async function ligneDuLocataire(db: Base, tenantId: string, id: string) {
  return db
    .prepare('SELECT id, bon_id, quantite, prix_unitaire FROM ligne_libre WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<{ id: string; bon_id: string; quantite: number; prix_unitaire: number }>();
}

/** Modifie une ligne libre d'un bon brouillon. */
export async function modifierLigneLibre(db: Base, tenantId: string, ligneId: string, saisie: SaisieLigneLibre, acteur: Acteur): Promise<ResultatLigneLibre> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const l = await ligneDuLocataire(db, tenantId, ligneId);
  if (!l) return { ok: false, code: 'introuvable' };
  const bon = await bonBrouillon(db, tenantId, l.bon_id, acteur);
  if (estRefus(bon)) return bon;
  const v = validerLigneLibre(saisie);
  if (!v.ok) return v;
  const autres = (await lignesLibresDuBon(db, tenantId, bon.id)).filter((x) => x.id !== ligneId);
  const { requete } = await totauxAvec(db, tenantId, bon, [...autres, v.valeur]);
  try {
    await db.batch([
      db
        .prepare('UPDATE ligne_libre SET libelle = ?, quantite = ?, prix_unitaire = ?, motif = ?, maj_le = ? WHERE id = ? AND tenant_id = ?')
        .bind(v.valeur.libelle, v.valeur.quantite, v.valeur.prix_unitaire, v.valeur.motif || null, maintenant(), ligneId, tenantId),
      requete,
      requeteEvenement(
        db,
        { tenantId, type: EVENEMENT.LIGNE_LIBRE_MODIFIEE, acteur, cible: { type: 'contrat', id: bon.contrat_id }, detail: { ligne_id: ligneId, bon_id: bon.id, quantite: v.valeur.quantite, prix_unitaire: v.valeur.prix_unitaire } },
        true,
      ),
    ]);
  } catch {
    return { ok: false, code: 'pas_brouillon' };
  }
  return { ok: true, id: ligneId };
}

/** Supprime une ligne libre d'un bon brouillon. Si c'était la dernière, les remises ponctuelles qui la visaient partent avec elle. */
export async function supprimerLigneLibre(db: Base, tenantId: string, ligneId: string, acteur: Acteur): Promise<ResultatLigneLibre> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const l = await ligneDuLocataire(db, tenantId, ligneId);
  if (!l) return { ok: false, code: 'introuvable' };
  const bon = await bonBrouillon(db, tenantId, l.bon_id, acteur);
  if (estRefus(bon)) return bon;
  const autres = (await lignesLibresDuBon(db, tenantId, bon.id)).filter((x) => x.id !== ligneId);
  const { requete, plusDeLibre } = await totauxAvec(db, tenantId, bon, autres);
  try {
    await db.batch([
      db.prepare('DELETE FROM ligne_libre WHERE id = ? AND tenant_id = ?').bind(ligneId, tenantId),
      // Une remise qui visait les lignes libres n'a plus de ligne à remiser : elle s'efface avec la dernière.
      ...(plusDeLibre ? [db.prepare("DELETE FROM remise_ponctuelle WHERE bon_id = ? AND tenant_id = ? AND code_ligne = 'libre'").bind(bon.id, tenantId)] : []),
      requete,
      requeteEvenement(
        db,
        { tenantId, type: EVENEMENT.LIGNE_LIBRE_SUPPRIMEE, acteur, cible: { type: 'contrat', id: bon.contrat_id }, detail: { ligne_id: ligneId, bon_id: bon.id, quantite: l.quantite, prix_unitaire: l.prix_unitaire } },
        true,
      ),
    ]);
  } catch {
    return { ok: false, code: 'pas_brouillon' };
  }
  return { ok: true, id: ligneId };
}

/**
 * Crée un bon ponctuel « prestation » (brouillon, sans période récurrente) pour le contrat en cours du cabinet : il date du jour, ne porte aucune
 * ligne de récurrent, et reçoit ses lignes libres ensuite. Éditeur seulement. Plusieurs bons prestation peuvent coexister, même le même jour.
 */
export async function creerBonPrestation(db: Base, tenantId: string, acteur: Acteur, jour: string = maintenant().slice(0, 10)): Promise<{ ok: true; id: string } | { ok: false; code: CodeLigneLibre }> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const c = await contratEnCours(db, tenantId);
  if (!c) return { ok: false, code: 'contrat_absent' };
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht,
                                     remise_taux, remise_montant, remise_motif, tva_taux, total_ht, cree_le)
         VALUES (?, ?, ?, 'prestation', ?, ?, 'brouillon', 0, '[]', 0, 0, 0, NULL, ?, 0, ?)`,
      )
      .bind(id, tenantId, c.id, jour, jour, TVA_TAUX, maintenant()),
    requeteEvenement(
      db,
      {
        tenantId, type: EVENEMENT.BON_GENERE, acteur, cible: { type: 'contrat', id: c.id },
        detail: { bon_id: id, type: 'prestation', periode_debut: jour, periode_fin: jour, acces_facturables: 0, remise_taux: 0, total_ht: 0 },
      },
      true,
    ),
  ]);
  return { ok: true, id };
}
