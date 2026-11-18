// Listes de référence d'un cabinet (table liste_valeur). Toute écriture qui pose une valeur
// de liste passe par valeurValide : une valeur absente ou inactive est refusée.

import type { Base } from './db';
import type { Liste } from './listes-defaut';

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
