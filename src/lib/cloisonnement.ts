// Cloisonnement : le contrôle unique. Toute ressource lue ou écrite à partir d'un identifiant
// venu de l'extérieur (URL, formulaire, session) passe par ici : elle doit appartenir au tenant
// de l'utilisateur connecté. Requêtes préparées uniquement ; le SQL est choisi dans une table
// fermée, jamais construit à partir de la saisie.

import type { Base } from './db';

export type Ressource =
  | 'viewer' | 'enveloppe' | 'ligne' | 'cible' | 'point' | 'mouvement' | 'document' | 'note'
  | 'contact' | 'sujet' | 'echange' | 'membre' | 'document_interne' | 'actu';

// enveloppe, cible et point sont rattachées au portefeuille, qui porte le tenant.
const VIA_PORTEFEUILLE = (table: string) =>
  `SELECT 1 AS ok FROM ${table} t JOIN portefeuille p ON p.id = t.portefeuille_id WHERE t.id = ? AND p.tenant_id = ?`;

const VIA_VIEWER = (table: string) =>
  `SELECT 1 AS ok FROM ${table} t JOIN utilisateur u ON u.id = t.viewer_id WHERE t.id = ? AND u.tenant_id = ?`;

const REQUETES: Record<Ressource, string> = {
  viewer: `SELECT 1 AS ok FROM utilisateur WHERE id = ? AND tenant_id = ? AND role = 'viewer'`,
  enveloppe: VIA_PORTEFEUILLE('enveloppe'),
  cible: VIA_PORTEFEUILLE('cible'),
  point: VIA_PORTEFEUILLE('point'),
  mouvement: VIA_VIEWER('mouvement'),
  document: VIA_VIEWER('document'),
  ligne: `SELECT 1 AS ok FROM ligne l
            JOIN enveloppe e ON e.id = l.enveloppe_id
            JOIN portefeuille p ON p.id = e.portefeuille_id
           WHERE l.id = ? AND p.tenant_id = ?`,
  note: 'SELECT 1 AS ok FROM note_marche WHERE id = ? AND tenant_id = ?',
  // Module de suivi : ces tables portent directement le locataire.
  contact: 'SELECT 1 AS ok FROM contact WHERE id = ? AND tenant_id = ?',
  sujet: 'SELECT 1 AS ok FROM sujet WHERE id = ? AND tenant_id = ?',
  echange: 'SELECT 1 AS ok FROM echange WHERE id = ? AND tenant_id = ?',
  membre: 'SELECT 1 AS ok FROM membre WHERE id = ? AND tenant_id = ?',
  // Bibliothèque interne du cabinet (lot 06), distincte de `document` (pièces des viewers).
  document_interne: 'SELECT 1 AS ok FROM document_interne WHERE id = ? AND tenant_id = ?',
  // Fiche d'actu (lot 06) : la passerelle (lot 07) en fait une note de marché.
  actu: 'SELECT 1 AS ok FROM actu WHERE id = ? AND tenant_id = ?',
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
