// Incidents (lot 10) : ce qui a échoué, par cabinet, avec sa date. Une ligne de la table `incident` : `quoi` est un
// code (« mail_refuse », « import_echec », « cours_echec:<symbole> »…) ; le TYPE est ce qui précède le premier « : ».
// Les écritures ne lèvent jamais : noter un incident ne doit jamais faire échouer ce qu'il décrit.

import type { Base } from './db';

export const LIBELLES_INCIDENT: Record<string, string> = {
  mail_refuse: 'Mail refusé',
  import_echec: 'Import en échec',
  cours_echec: 'Cours indisponible',
  cours_cle: 'Cours : clé d’API absente',
  cours_budget: 'Cours : budget du jour épuisé',
  domaine_echec: 'Domaine : appel Cloudflare en échec',
  // Lot 12 : ce que le traitement quotidien dit à l'éditeur. Jamais un courriel : la console, et elle seule.
  bon_a_emettre: 'Bon à facturer à émettre',
  remise_a_revoir: 'Remise commerciale à revoir',
  purge_bloquee: 'Suppression en attente (J+75 de l’essai, J+30 d’une résiliation)',
  bon_apres_resiliation: 'Facture émise pour une période résiliée : avoir à faire',
  bon_preavis_annule: 'Bon annulé par un préavis annulé : période à facturer à la main',
  traitement_echec: 'Traitement quotidien en échec',
};

/** Le type d'un incident : le code sans son suffixe (« cours_echec:CAC » → « cours_echec »). */
export const typeIncident = (quoi: string): string => quoi.split(':')[0];
export const libelleIncident = (type: string): string => LIBELLES_INCIDENT[type] ?? type;

// Même découpage en SQL, pour filtrer et regrouper sans rien lire en mémoire.
const TYPE_SQL = "(CASE WHEN instr(i.quoi, ':') > 0 THEN substr(i.quoi, 1, instr(i.quoi, ':') - 1) ELSE i.quoi END)";

/** Écrit un incident. `tenantId` null : un incident qui ne dépend d'aucun cabinet. Ne lève jamais. */
export async function noterIncident(db: Base, tenantId: string | null, quoi: string, detail: string): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO incident (id, tenant_id, quoi, detail, cree_le) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), tenantId, quoi, detail.slice(0, 500), new Date().toISOString())
      .run();
  } catch (e) {
    console.error('incident non écrit', quoi, e instanceof Error ? e.message : e);
  }
}

export interface LigneIncident {
  id: string;
  tenant_id: string | null;
  cabinet: string | null;
  quoi: string;
  type: string;
  detail: string | null;
  cree_le: string;
}

/** Valeur du filtre « cabinet » pour les incidents qui n'en ont pas. */
export const SANS_CABINET = 'aucun';

export const LIMITE_INCIDENTS = 200;

/**
 * Les incidents, du plus récent au plus ancien. Filtres facultatifs : un cabinet (son identifiant, ou SANS_CABINET), un
 * type. Les valeurs passent par bind() ; le SQL n'est jamais construit à partir de la saisie.
 */
export async function incidents(
  db: Base,
  f: { tenantId?: string; type?: string },
  limite = LIMITE_INCIDENTS,
): Promise<LigneIncident[]> {
  const cond: string[] = [];
  const valeurs: unknown[] = [];
  if (f.tenantId === SANS_CABINET) cond.push('i.tenant_id IS NULL');
  else if (f.tenantId) { cond.push('i.tenant_id = ?'); valeurs.push(f.tenantId); }
  if (f.type) { cond.push(`${TYPE_SQL} = ?`); valeurs.push(f.type); }
  const { results } = await db
    .prepare(
      `SELECT i.id, i.tenant_id, t.nom AS cabinet, i.quoi, ${TYPE_SQL} AS type, i.detail, i.cree_le
         FROM incident i LEFT JOIN tenant t ON t.id = i.tenant_id
        ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
        ORDER BY i.cree_le DESC, i.id DESC
        LIMIT ?`,
    )
    .bind(...valeurs, limite)
    .all<LigneIncident>();
  return results;
}

/** Les types présents en base, pour le filtre. */
export async function typesPresents(db: Base): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT DISTINCT ${TYPE_SQL} AS type FROM incident i ORDER BY type`)
    .bind()
    .all<{ type: string }>();
  return results.map((r) => r.type);
}
