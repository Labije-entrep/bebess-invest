// Actus (lot 06) : une fiche par jour, unique par cabinet et par date (UNIQUE (tenant_id, date)).
//
// Le bloc Chiffres vient de la table `cours` : il est figé dans `chiffres_json` à la première écriture de la
// fiche, avec la date de chaque séance, puis ne bouge plus (relire une actu de la semaine dernière ne doit pas
// en changer les chiffres). Tout le reste est saisi à la main ; le texte d'origine collé est gardé tel quel.
// Aucune génération de texte ici.

import type { Base } from './db';
import { derniersCours, type CoursLu, type SymboleSuivi } from './cours';

export interface Actu {
  id: string;
  date: string;
  titre: string;
  resume: string | null;
  a_dire: string | null;
  chiffres: CoursLu[];
  faits: string[];
  mots_cles: string | null;
  source: string | null;
  brut: string | null;
  note_marche_id: string | null;
}

interface Ligne {
  id: string; date: string; titre: string; resume: string | null; a_dire: string | null;
  chiffres_json: string | null; faits_json: string | null; mots_cles: string | null;
  source: string | null; brut: string | null; note_marche_id: string | null;
}

function tableau<T>(json: string | null): T[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export async function actuDuJour(db: Base, tenantId: string, date: string): Promise<Actu | null> {
  const l = await db
    .prepare(
      `SELECT id, date, titre, resume, a_dire, chiffres_json, faits_json, mots_cles, source, brut, note_marche_id
         FROM actu WHERE tenant_id = ? AND date = ?`,
    )
    .bind(tenantId, date)
    .first<Ligne>();
  if (!l) return null;
  return {
    id: l.id, date: l.date, titre: l.titre, resume: l.resume, a_dire: l.a_dire,
    chiffres: tableau<CoursLu>(l.chiffres_json), faits: tableau<string>(l.faits_json),
    mots_cles: l.mots_cles, source: l.source, brut: l.brut, note_marche_id: l.note_marche_id,
  };
}

export async function actusRecentes(db: Base, tenantId: string, limite = 60): Promise<{ date: string; titre: string }[]> {
  const { results } = await db
    .prepare('SELECT date, titre FROM actu WHERE tenant_id = ? ORDER BY date DESC LIMIT ?')
    .bind(tenantId, limite)
    .all<{ date: string; titre: string }>();
  return results;
}

export interface SaisieActu {
  titre: string;
  resume: string | null;
  a_dire: string | null;
  faits: string[];
  mots_cles: string | null;
  source: string | null;
  brut: string | null;
}

/**
 * Crée la fiche du jour ou met à jour ses champs saisis. À la création, le bloc Chiffres est figé depuis
 * `cours` (dernière valeur connue de chaque symbole à cette date, avec sa date) ; à la mise à jour il n'est pas touché.
 */
export async function enregistrerActu(db: Base, tenantId: string, date: string, v: SaisieActu, symboles: SymboleSuivi[]): Promise<void> {
  const chiffres = await derniersCours(db, symboles, date);
  await db
    .prepare(
      `INSERT INTO actu (id, tenant_id, date, titre, resume, a_dire, chiffres_json, faits_json, mots_cles, source, brut, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, date) DO UPDATE SET
         titre = excluded.titre, resume = excluded.resume, a_dire = excluded.a_dire, faits_json = excluded.faits_json,
         mots_cles = excluded.mots_cles, source = excluded.source, brut = excluded.brut`,
    )
    .bind(
      crypto.randomUUID(), tenantId, date, v.titre, v.resume, v.a_dire, JSON.stringify(chiffres), JSON.stringify(v.faits),
      v.mots_cles, v.source, v.brut, new Date().toISOString(),
    )
    .run();
}
