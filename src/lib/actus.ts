// Actus (lot 06) : une fiche par jour, unique par cabinet et par date (UNIQUE (tenant_id, date)).
//
// Le bloc Chiffres vient de la table `cours` : il est figé dans `chiffres_json` à la première écriture de la
// fiche, avec la date de chaque séance, puis ne bouge plus (relire une actu de la semaine dernière ne doit pas
// en changer les chiffres). Tout le reste est saisi à la main ; le texte d'origine collé est gardé tel quel.
// Aucune génération de texte ici.

import type { Base } from './db';
import { derniersCours, type CoursLu, type SymboleSuivi } from './cours';
import { slugifier, slugPris } from './site';

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
  /** La note de marché née de cette fiche est publiée : les chiffres ne bougent plus. */
  note_publiee: boolean;
}

interface Ligne {
  id: string; date: string; titre: string; resume: string | null; a_dire: string | null;
  chiffres_json: string | null; faits_json: string | null; mots_cles: string | null;
  source: string | null; brut: string | null; note_marche_id: string | null; note_publiee: number;
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
      `SELECT a.id, a.date, a.titre, a.resume, a.a_dire, a.chiffres_json, a.faits_json, a.mots_cles, a.source, a.brut,
              a.note_marche_id,
              COALESCE((SELECT n.publiee FROM note_marche n WHERE n.id = a.note_marche_id AND n.tenant_id = a.tenant_id), 0) AS note_publiee
         FROM actu a WHERE a.tenant_id = ? AND a.date = ?`,
    )
    .bind(tenantId, date)
    .first<Ligne>();
  if (!l) return null;
  return {
    id: l.id, date: l.date, titre: l.titre, resume: l.resume, a_dire: l.a_dire,
    chiffres: tableau<CoursLu>(l.chiffres_json), faits: tableau<string>(l.faits_json),
    mots_cles: l.mots_cles, source: l.source, brut: l.brut, note_marche_id: l.note_marche_id,
    note_publiee: l.note_publiee === 1,
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

/**
 * « Reprendre les cours du jour » : remplace le bloc Chiffres par la dernière valeur connue de chaque symbole à la
 * date de la fiche. Seul ce bloc change : les textes saisis ne sont pas touchés. Refusé une fois la note publiée
 * (la condition est dans la requête elle-même, pas seulement dans la lecture qui précède).
 */
export async function rafraichirChiffres(db: Base, tenantId: string, date: string, symboles: SymboleSuivi[]): Promise<'ok' | 'absente' | 'publiee'> {
  const a = await actuDuJour(db, tenantId, date);
  if (!a) return 'absente';
  if (a.note_publiee) return 'publiee';
  const chiffres = await derniersCours(db, symboles, date);
  await db
    .prepare(
      `UPDATE actu SET chiffres_json = ?
        WHERE tenant_id = ? AND date = ?
          AND NOT EXISTS (SELECT 1 FROM note_marche n WHERE n.id = actu.note_marche_id AND n.tenant_id = actu.tenant_id AND n.publiee = 1)`,
    )
    .bind(JSON.stringify(chiffres), tenantId, date)
    .run();
  return 'ok';
}

/**
 * Passerelle (lot 07) : crée la note de marché de cette fiche, NON publiée. Le titre et le champ « à dire aux
 * clients » sont copiés par la base elle-même (INSERT … SELECT) : le texte n'est ni relu, ni reformulé, ni même
 * passé par le code. La publication reste un second geste, dans l'écran des notes.
 * Un second appel ne crée rien : il renvoie la note déjà rangée dans `actu.note_marche_id`.
 */
export async function creerNoteDepuisActu(
  db: Base,
  tenantId: string,
  actuId: string,
): Promise<{ id: string; cree: boolean } | { refus: 'absente' | 'vide' }> {
  const a = await db
    .prepare('SELECT id, date, titre, a_dire, note_marche_id FROM actu WHERE id = ? AND tenant_id = ?')
    .bind(actuId, tenantId)
    .first<{ id: string; date: string; titre: string; a_dire: string | null; note_marche_id: string | null }>();
  if (!a) return { refus: 'absente' };
  if (a.note_marche_id) return { id: a.note_marche_id, cree: false };
  if (!a.a_dire || a.a_dire.trim() === '') return { refus: 'vide' };

  // Adresse : le titre ; à défaut, ou si elle est prise, avec la date, puis un numéro.
  const base = slugifier(a.titre) || `note-${a.date}`;
  let slug = base;
  for (let n = 1; await slugPris(db, tenantId, slug, ''); n++) slug = n === 1 ? `${base}-${a.date}` : `${base}-${a.date}-${n}`;

  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO note_marche (id, tenant_id, slug, langue, titre, chapeau, corps_md, date, publiee)
         SELECT ?, a.tenant_id, ?, 'fr', a.titre, NULL, a.a_dire, a.date, 0
           FROM actu a WHERE a.id = ? AND a.tenant_id = ? AND a.note_marche_id IS NULL AND a.a_dire IS NOT NULL`,
      )
      .bind(id, slug, actuId, tenantId),
    db
      .prepare(
        `UPDATE actu SET note_marche_id = ?
          WHERE id = ? AND tenant_id = ? AND note_marche_id IS NULL
            AND EXISTS (SELECT 1 FROM note_marche WHERE id = ? AND tenant_id = ?)`,
      )
      .bind(id, actuId, tenantId, id, tenantId),
  ]);
  const apres = await db
    .prepare('SELECT note_marche_id FROM actu WHERE id = ? AND tenant_id = ?')
    .bind(actuId, tenantId)
    .first<{ note_marche_id: string | null }>();
  return { id: apres?.note_marche_id ?? id, cree: apres?.note_marche_id === id };
}
