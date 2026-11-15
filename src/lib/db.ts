// Accès à D1. Requêtes préparées uniquement : toute valeur passe par bind().
// Une fonction par intention. Montants en centimes, pourcentages en centièmes de point,
// dates en chaînes ISO 8601.

// Forme minimale de D1Database, pour ne pas dépendre d'un paquet de types.
export interface Requete {
  bind(...valeurs: unknown[]): Requete;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}
export interface Base {
  prepare(sql: string): Requete;
}

export type Role = 'editeur' | 'gestionnaire' | 'viewer';
export type Classe = 'actions' | 'obligations' | 'immobilier' | 'private_equity' | 'liquidites';

export interface Tenant {
  id: number;
  nom: string;
  hote: string;
  cree_le: string;
}

export interface Utilisateur {
  id: number;
  tenant_id: number;
  email: string;
  nom: string;
  role: Role;
  actif: number;
  cree_le: string;
}

export interface ViewerResume {
  id: number;
  utilisateur_id: number;
  nom: string;
  email: string;
  nom_famille: string;
  profil: string;
}

export interface Viewer {
  id: number;
  tenant_id: number;
  utilisateur_id: number;
  gestionnaire_id: number;
  gestionnaire_nom: string;
  nom: string;
  email: string;
  nom_famille: string;
  profil: string;
  horizon_le: string;
  entree_le: string;
}

export interface Enveloppe {
  id: number;
  viewer_id: number;
  nom: string;
  type: string;
  etablissement: string;
  ordre: number;
  total_cents: number;
}

export interface Ligne {
  id: number;
  enveloppe_id: number;
  libelle: string;
  classe: Classe;
  valeur_cents: number;
  ordre: number;
}

export interface Cible {
  id: number;
  viewer_id: number;
  classe: Classe;
  cible_bp: number;
  ordre: number;
}

export interface Point {
  mois: string;
  valeur_cents: number;
}

export interface Mouvement {
  id: number;
  viewer_id: number;
  enveloppe_id: number | null;
  date_le: string;
  libelle: string;
  type: 'apport' | 'retrait' | 'arbitrage';
  montant_cents: number;
  statut: 'en_cours' | 'execute';
}

export interface Document {
  id: number;
  viewer_id: number;
  titre: string;
  categorie: string;
  date_le: string;
  chemin: string;
}

export interface PageContenu {
  id: number;
  tenant_id: number;
  slug: string;
  titre: string;
  corps: string;
  maj_le: string;
}

export interface Note {
  id: number;
  tenant_id: number;
  viewer_id: number | null;
  titre: string;
  corps: string;
  publie_le: string;
  auteur_nom: string;
}

export function tenantParHote(db: Base, hote: string): Promise<Tenant | null> {
  return db
    .prepare('SELECT id, nom, hote, cree_le FROM tenants WHERE hote = ?')
    .bind(hote)
    .first<Tenant>();
}

export function utilisateurParEmail(db: Base, email: string): Promise<Utilisateur | null> {
  return db
    .prepare(
      'SELECT id, tenant_id, email, nom, role, actif, cree_le FROM utilisateurs WHERE email = ?',
    )
    .bind(email.trim().toLowerCase())
    .first<Utilisateur>();
}

export function utilisateurParId(db: Base, id: number): Promise<Utilisateur | null> {
  return db
    .prepare('SELECT id, tenant_id, email, nom, role, actif, cree_le FROM utilisateurs WHERE id = ?')
    .bind(id)
    .first<Utilisateur>();
}

export async function viewersDuTenant(db: Base, tenantId: number): Promise<ViewerResume[]> {
  const { results } = await db
    .prepare(
      `SELECT v.id, v.utilisateur_id, u.nom, u.email, v.nom_famille, v.profil
         FROM viewers v
         JOIN utilisateurs u ON u.id = v.utilisateur_id
        WHERE v.tenant_id = ?
        ORDER BY u.nom`,
    )
    .bind(tenantId)
    .all<ViewerResume>();
  return results;
}

/** Limitée au tenant : un viewer d'un autre tenant renvoie null. */
export function ficheDuViewer(db: Base, tenantId: number, viewerId: number): Promise<Viewer | null> {
  return db
    .prepare(
      `SELECT v.id, v.tenant_id, v.utilisateur_id, v.gestionnaire_id,
              g.nom AS gestionnaire_nom, u.nom, u.email,
              v.nom_famille, v.profil, v.horizon_le, v.entree_le
         FROM viewers v
         JOIN utilisateurs u ON u.id = v.utilisateur_id
         JOIN utilisateurs g ON g.id = v.gestionnaire_id
        WHERE v.tenant_id = ? AND v.id = ?`,
    )
    .bind(tenantId, viewerId)
    .first<Viewer>();
}

export async function enveloppesDuViewer(db: Base, viewerId: number): Promise<Enveloppe[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.viewer_id, e.nom, e.type, e.etablissement, e.ordre,
              COALESCE((SELECT SUM(l.valeur_cents) FROM lignes l WHERE l.enveloppe_id = e.id), 0)
                AS total_cents
         FROM enveloppes e
        WHERE e.viewer_id = ?
        ORDER BY e.ordre, e.id`,
    )
    .bind(viewerId)
    .all<Enveloppe>();
  return results;
}

export async function lignesDesEnveloppes(db: Base, enveloppeIds: number[]): Promise<Ligne[]> {
  if (enveloppeIds.length === 0) return [];
  // Seuls des "?" sont assemblés ici ; les valeurs passent par bind().
  const marques = enveloppeIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT id, enveloppe_id, libelle, classe, valeur_cents, ordre
         FROM lignes
        WHERE enveloppe_id IN (${marques})
        ORDER BY enveloppe_id, ordre, id`,
    )
    .bind(...enveloppeIds)
    .all<Ligne>();
  return results;
}

export async function ciblesDuViewer(db: Base, viewerId: number): Promise<Cible[]> {
  const { results } = await db
    .prepare(
      'SELECT id, viewer_id, classe, cible_bp, ordre FROM cibles WHERE viewer_id = ? ORDER BY ordre, id',
    )
    .bind(viewerId)
    .all<Cible>();
  return results;
}

export async function pointsDuViewer(db: Base, viewerId: number): Promise<Point[]> {
  const { results } = await db
    .prepare('SELECT mois, valeur_cents FROM points WHERE viewer_id = ? ORDER BY mois')
    .bind(viewerId)
    .all<Point>();
  return results;
}

export async function mouvementsDuViewer(db: Base, viewerId: number): Promise<Mouvement[]> {
  const { results } = await db
    .prepare(
      `SELECT id, viewer_id, enveloppe_id, date_le, libelle, type, montant_cents, statut
         FROM mouvements
        WHERE viewer_id = ?
        ORDER BY date_le DESC, id DESC`,
    )
    .bind(viewerId)
    .all<Mouvement>();
  return results;
}

export async function documentsDuViewer(db: Base, viewerId: number): Promise<Document[]> {
  const { results } = await db
    .prepare(
      `SELECT id, viewer_id, titre, categorie, date_le, chemin
         FROM documents
        WHERE viewer_id = ?
        ORDER BY date_le DESC, id DESC`,
    )
    .bind(viewerId)
    .all<Document>();
  return results;
}

export function pageContenu(db: Base, tenantId: number, slug: string): Promise<PageContenu | null> {
  return db
    .prepare('SELECT id, tenant_id, slug, titre, corps, maj_le FROM pages_contenu WHERE tenant_id = ? AND slug = ?')
    .bind(tenantId, slug)
    .first<PageContenu>();
}

/** Notes publiées du tenant : générales (sans viewer) et, si fourni, celles du viewer. */
export async function notesPubliees(
  db: Base,
  tenantId: number,
  viewerId: number | null = null,
): Promise<Note[]> {
  const { results } = await db
    .prepare(
      `SELECT n.id, n.tenant_id, n.viewer_id, n.titre, n.corps, n.publie_le, u.nom AS auteur_nom
         FROM notes n
         JOIN utilisateurs u ON u.id = n.auteur_id
        WHERE n.tenant_id = ?
          AND n.statut = 'publiee'
          AND (n.viewer_id IS NULL OR n.viewer_id = ?)
        ORDER BY n.publie_le DESC, n.id DESC`,
    )
    .bind(tenantId, viewerId)
    .all<Note>();
  return results;
}
