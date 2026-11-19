// Listes de référence d'un cabinet (table liste_valeur). Toute écriture qui pose une valeur
// de liste passe par valeurValide : une valeur absente ou inactive est refusée.

import type { Base } from './db';
import type { Liste } from './listes-defaut';
import type { Marqueurs } from './marqueurs';

export interface ValeurListe {
  cle: string;
  libelle: string;
  ordre: number;
}

/** Valeurs actives d'une liste, dans l'ordre d'affichage. */
export async function valeursDe(db: Base, tenantId: string, liste: Liste): Promise<ValeurListe[]> {
  const { results } = await db
    .prepare(
      `SELECT cle, libelle, ordre FROM liste_valeur
        WHERE tenant_id = ? AND liste = ? AND actif = 1
        ORDER BY ordre, cle`,
    )
    .bind(tenantId, liste)
    .all<ValeurListe>();
  return results;
}

/**
 * Clés marquées terminales, par liste, actives ou non : un statut retiré de la liste proposée continue de
 * clore les sujets qui le portent. Une liste absente du résultat n'a aucune valeur terminale : rien n'y est clos.
 */
export async function terminauxDe(db: Base, tenantId: string): Promise<Record<string, string[]>> {
  const { results } = await db
    .prepare('SELECT liste, cle FROM liste_valeur WHERE tenant_id = ? AND terminal = 1 ORDER BY liste, ordre, cle')
    .bind(tenantId)
    .all<{ liste: string; cle: string }>();
  const out: Record<string, string[]> = {};
  for (const r of results) (out[r.liste] ??= []).push(r.cle);
  return out;
}

/**
 * Libellé de chaque valeur d'une liste, ACTIVES OU NON : une valeur désactivée disparaît des choix mais reste lisible sur
 * les enregistrements qui la portent. Une clé inconnue de la table s'affiche telle quelle (`lire`).
 */
export async function libellesDe(db: Base, tenantId: string, liste: Liste): Promise<{ lire(cle: string): string; actif(cle: string): boolean }> {
  const { results } = await db
    .prepare('SELECT cle, libelle, actif FROM liste_valeur WHERE tenant_id = ? AND liste = ?')
    .bind(tenantId, liste)
    .all<{ cle: string; libelle: string; actif: number }>();
  const m = new Map(results.map((r) => [r.cle, r]));
  return { lire: (cle) => m.get(cle)?.libelle ?? cle, actif: (cle) => m.get(cle)?.actif === 1 };
}

/**
 * Marqueurs posés sur des valeurs ACTIVES : liste → marqueur → clés. Une valeur désactivée ne porte plus son rôle ;
 * un marqueur que plus aucune valeur active ne porte est absent du résultat, et c'est à l'écran de le dire.
 */
export async function marqueursDe(db: Base, tenantId: string): Promise<Marqueurs> {
  const { results } = await db
    .prepare('SELECT liste, cle, marqueur FROM liste_valeur WHERE tenant_id = ? AND actif = 1 AND marqueur IS NOT NULL ORDER BY liste, ordre, cle')
    .bind(tenantId)
    .all<{ liste: string; cle: string; marqueur: string }>();
  const out: Marqueurs = {};
  for (const r of results) ((out[r.liste] ??= {})[r.marqueur] ??= []).push(r.cle);
  return out;
}

/** La clé de la (première) valeur active qui porte ce marqueur, ou null : on ne devine pas une autre valeur. */
export async function cleMarquee(db: Base, tenantId: string, liste: Liste, marqueur: string): Promise<string | null> {
  const r = await db
    .prepare('SELECT cle FROM liste_valeur WHERE tenant_id = ? AND liste = ? AND actif = 1 AND marqueur = ? ORDER BY ordre, cle LIMIT 1')
    .bind(tenantId, liste, marqueur)
    .first<{ cle: string }>();
  return r?.cle ?? null;
}

export async function clesMarqueesDe(db: Base, tenantId: string, liste: Liste, marqueur: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT cle FROM liste_valeur WHERE tenant_id = ? AND liste = ? AND actif = 1 AND marqueur = ? ORDER BY ordre, cle')
    .bind(tenantId, liste, marqueur)
    .all<{ cle: string }>();
  return results.map((r) => r.cle);
}

export async function valeurValide(db: Base, tenantId: string, liste: Liste, cle: string): Promise<boolean> {
  if (!cle) return false;
  const r = await db
    .prepare('SELECT 1 AS ok FROM liste_valeur WHERE tenant_id = ? AND liste = ? AND cle = ? AND actif = 1')
    .bind(tenantId, liste, cle)
    .first();
  return r !== null;
}

/** Message d'erreur listant les valeurs admises, ou null si la valeur est valide. */
export async function refusValeur(
  db: Base,
  tenantId: string,
  liste: Liste,
  cle: string,
): Promise<string | null> {
  if (await valeurValide(db, tenantId, liste, cle)) return null;
  const admises = (await valeursDe(db, tenantId, liste)).map((v) => v.cle).join(', ');
  return `Valeur « ${cle} » refusée pour ${liste}. Valeurs admises : ${admises || 'aucune'}.`;
}

/**
 * Validateur chargé une seule fois, pour une écriture qui contrôle beaucoup de valeurs
 * (lignes d'un formulaire, import CSV). Même règle que valeurValide.
 */
export async function validateurDe(
  db: Base,
  tenantId: string,
  liste: Liste,
): Promise<{ valide(cle: string): boolean; message: string; options: [string, string][] }> {
  const valeurs = await valeursDe(db, tenantId, liste);
  const cles = new Set(valeurs.map((v) => v.cle));
  return {
    valide: (cle) => cles.has(cle),
    message: `Valeur refusée pour ${liste}. Valeurs admises : ${valeurs.map((v) => v.cle).join(', ') || 'aucune'}.`,
    options: valeurs.map((v) => [v.cle, v.libelle]),
  };
}
