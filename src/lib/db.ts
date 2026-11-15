// Accès à D1. Requêtes préparées uniquement : toute valeur passe par bind().
// Une fonction par intention. Montants en centimes, pourcentages en centièmes de point,
// dates en chaînes ISO 8601. Les identifiants sont des chaînes.

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

export interface Tenant {
  id: string;
  nom: string;
  domaine: string | null;
  cree_le: string;
}

export interface Utilisateur {
  id: string;
  tenant_id: string;
  email: string;
  nom: string;
  role: Role;
  actif: number;
  cree_le: string;
}

export interface Fiche {
  utilisateur_id: string;
  mandat_ref: string | null;
  profil_risque: string | null;
  profil_note: number | null;
  horizon: string | null;
  perte_max_cents: number | null;
  liquidite_cents: number | null;
  regle_reequilibrage: string | null;
  allocation_signee_le: string | null;
  allocation_motif: string | null;
  prochain_point: string | null;
}

export interface Enveloppe {
  id: string;
  viewer_id: string;
  libelle: string;
  etablissement: string | null;
  ouverte_en: string | null;
  valorisation_cents: number;
  perf_bp: number | null;
  arrete_le: string;
  rang: number;
}

export interface Ligne {
  id: string;
  enveloppe_id: string;
  libelle: string;
  classe: string;
  valorisation_cents: number;
  pv_cents: number | null;
  frais_bp: number | null;
  arrete_le: string;
  rang: number;
}

export interface Cible {
  id: string;
  viewer_id: string;
  classe: string;
  cible_bp: number;
  rang: number;
}

export interface Point {
  id: string;
  viewer_id: string;
  date: string;
  valeur_cents: number;
  versements_cumules_cents: number;
}

export interface Mouvement {
  id: string;
  viewer_id: string;
  date: string;
  libelle: string;
  enveloppe: string | null;
  montant_cents: number | null;
  statut: string;
  en_cours: number;
  etape: number;
  detail: string | null;
}

export interface Document {
  id: string;
  viewer_id: string;
  titre: string;
  categorie: string;
  date: string;
  cle_fichier: string | null;
  envoye_le: string | null;
}

export interface PageContenu {
  id: string;
  tenant_id: string;
  cle: string;
  langue: string;
  titre: string | null;
  contenu_json: string;
  maj_le: string;
}

export interface NoteMarche {
  id: string;
  tenant_id: string;
  slug: string;
  langue: string;
  titre: string;
  chapeau: string | null;
  corps_md: string;
  date: string;
  publiee: number;
}

const COLONNES_UTILISATEUR = 'id, tenant_id, email, nom, role, actif, cree_le';

/** Le port et la casse sont ignorés : "Localhost:4321" et "localhost" donnent le même tenant. */
export function tenantParHote(db: Base, hote: string): Promise<Tenant | null> {
  const sansPort = hote.trim().toLowerCase().replace(/:\d+$/, '');
  return db
    .prepare('SELECT id, nom, domaine, cree_le FROM tenant WHERE domaine = ?')
    .bind(sansPort)
    .first<Tenant>();
}

export function utilisateurParEmail(db: Base, email: string): Promise<Utilisateur | null> {
  return db
    .prepare(`SELECT ${COLONNES_UTILISATEUR} FROM utilisateur WHERE email = ?`)
    .bind(email.trim().toLowerCase())
    .first<Utilisateur>();
}

export function utilisateurParId(db: Base, id: string): Promise<Utilisateur | null> {
  return db
    .prepare(`SELECT ${COLONNES_UTILISATEUR} FROM utilisateur WHERE id = ?`)
    .bind(id)
    .first<Utilisateur>();
}

/** Les viewers actifs du tenant, triés par nom. */
export async function viewersDuTenant(db: Base, tenantId: string): Promise<Utilisateur[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLONNES_UTILISATEUR} FROM utilisateur
        WHERE tenant_id = ? AND role = 'viewer' AND actif = 1
        ORDER BY nom`,
    )
    .bind(tenantId)
    .all<Utilisateur>();
  return results;
}

/** Limitée au tenant : la fiche d'un viewer d'un autre tenant renvoie null. */
export function ficheDuViewer(db: Base, tenantId: string, viewerId: string): Promise<Fiche | null> {
  return db
    .prepare(
      `SELECT f.utilisateur_id, f.mandat_ref, f.profil_risque, f.profil_note, f.horizon,
              f.perte_max_cents, f.liquidite_cents, f.regle_reequilibrage,
              f.allocation_signee_le, f.allocation_motif, f.prochain_point
         FROM fiche f
         JOIN utilisateur u ON u.id = f.utilisateur_id
        WHERE u.tenant_id = ? AND f.utilisateur_id = ?`,
    )
    .bind(tenantId, viewerId)
    .first<Fiche>();
}

export async function enveloppesDuViewer(db: Base, viewerId: string): Promise<Enveloppe[]> {
  const { results } = await db
    .prepare(
      `SELECT id, viewer_id, libelle, etablissement, ouverte_en, valorisation_cents,
              perf_bp, arrete_le, rang
         FROM enveloppe
        WHERE viewer_id = ?
        ORDER BY rang, id`,
    )
    .bind(viewerId)
    .all<Enveloppe>();
  return results;
}

export async function lignesDesEnveloppes(db: Base, enveloppeIds: string[]): Promise<Ligne[]> {
  if (enveloppeIds.length === 0) return [];
  // Seuls des "?" sont assemblés ici ; les valeurs passent par bind().
  const marques = enveloppeIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT id, enveloppe_id, libelle, classe, valorisation_cents, pv_cents, frais_bp,
              arrete_le, rang
         FROM ligne
        WHERE enveloppe_id IN (${marques})
        ORDER BY enveloppe_id, rang, id`,
    )
    .bind(...enveloppeIds)
    .all<Ligne>();
  return results;
}

export async function ciblesDuViewer(db: Base, viewerId: string): Promise<Cible[]> {
  const { results } = await db
    .prepare('SELECT id, viewer_id, classe, cible_bp, rang FROM cible WHERE viewer_id = ? ORDER BY rang, id')
    .bind(viewerId)
    .all<Cible>();
  return results;
}

/** Courbe mensuelle, du plus ancien au plus récent. */
export async function pointsDuViewer(db: Base, viewerId: string): Promise<Point[]> {
  const { results } = await db
    .prepare(
      `SELECT id, viewer_id, date, valeur_cents, versements_cumules_cents
         FROM point
        WHERE viewer_id = ?
        ORDER BY date`,
    )
    .bind(viewerId)
    .all<Point>();
  return results;
}

/** Du plus récent au plus ancien. */
export async function mouvementsDuViewer(db: Base, viewerId: string): Promise<Mouvement[]> {
  const { results } = await db
    .prepare(
      `SELECT id, viewer_id, date, libelle, enveloppe, montant_cents, statut, en_cours, etape, detail
         FROM mouvement
        WHERE viewer_id = ?
        ORDER BY date DESC, id DESC`,
    )
    .bind(viewerId)
    .all<Mouvement>();
  return results;
}

export async function documentsDuViewer(db: Base, viewerId: string): Promise<Document[]> {
  const { results } = await db
    .prepare(
      `SELECT id, viewer_id, titre, categorie, date, cle_fichier, envoye_le
         FROM document
        WHERE viewer_id = ?
        ORDER BY date DESC, id DESC`,
    )
    .bind(viewerId)
    .all<Document>();
  return results;
}

export function pageContenu(
  db: Base,
  tenantId: string,
  cle: string,
  langue: string = 'fr',
): Promise<PageContenu | null> {
  return db
    .prepare(
      `SELECT id, tenant_id, cle, langue, titre, contenu_json, maj_le
         FROM page_contenu
        WHERE tenant_id = ? AND cle = ? AND langue = ?`,
    )
    .bind(tenantId, cle, langue)
    .first<PageContenu>();
}

/** Notes de marché publiées, de la plus récente à la plus ancienne. */
export async function notesPubliees(
  db: Base,
  tenantId: string,
  langue: string = 'fr',
): Promise<NoteMarche[]> {
  const { results } = await db
    .prepare(
      `SELECT id, tenant_id, slug, langue, titre, chapeau, corps_md, date, publiee
         FROM note_marche
        WHERE tenant_id = ? AND langue = ? AND publiee = 1
        ORDER BY date DESC, id DESC`,
    )
    .bind(tenantId, langue)
    .all<NoteMarche>();
  return results;
}
