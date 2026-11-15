// Cloisonnement : le contrôle unique. Toute ressource lue ou écrite à partir d'un identifiant
// venu de l'extérieur (URL, formulaire, session) passe par ici : elle doit appartenir au tenant
// de l'utilisateur connecté. Requêtes préparées uniquement ; le SQL est choisi dans une table
// fermée, jamais construit à partir de la saisie.

import type { Base } from './db';

export type Ressource =
  | 'viewer' | 'enveloppe' | 'ligne' | 'cible' | 'point' | 'mouvement' | 'document' | 'note';

const VIA_VIEWER = (table: string) =>
  `SELECT 1 AS ok FROM ${table} t JOIN utilisateur u ON u.id = t.viewer_id WHERE t.id = ? AND u.tenant_id = ?`;

const REQUETES: Record<Ressource, string> = {
  viewer: `SELECT 1 AS ok FROM utilisateur WHERE id = ? AND tenant_id = ? AND role = 'viewer'`,
  enveloppe: VIA_VIEWER('enveloppe'),
  cible: VIA_VIEWER('cible'),
  point: VIA_VIEWER('point'),
  mouvement: VIA_VIEWER('mouvement'),
  document: VIA_VIEWER('document'),
  ligne: `SELECT 1 AS ok FROM ligne l
            JOIN enveloppe e ON e.id = l.enveloppe_id
            JOIN utilisateur u ON u.id = e.viewer_id
           WHERE l.id = ? AND u.tenant_id = ?`,
  note: 'SELECT 1 AS ok FROM note_marche WHERE id = ? AND tenant_id = ?',
};

export class AccesRefuse extends Error {
  constructor() {
    super('Ressource hors du tenant');
  }
}

/** Vrai si la ressource existe ET appartient au tenant. Inconnue ou étrangère : faux, sans distinction. */
export async function appartient(db: Base, tenantId: string, ressource: Ressource, id: string): Promise<boolean> {
  if (!tenantId || !id) return false;
  const ligne = await db.prepare(REQUETES[ressource]).bind(id, tenantId).first<{ ok: number }>();
  return ligne !== null;
}

/** Comme appartient, mais lève AccesRefuse. */
export async function exiger(db: Base, tenantId: string, ressource: Ressource, id: string): Promise<void> {
  if (!(await appartient(db, tenantId, ressource, id))) throw new AccesRefuse();
}
