// Accès à D1. Requêtes préparées uniquement : toute valeur passe par bind().
// Une fonction par intention. Montants en centimes, pourcentages en centièmes de point,
// dates en chaînes ISO 8601. Les identifiants sont des chaînes.

import { themeValide } from './themes';

// Forme minimale de D1Database, pour ne pas dépendre d'un paquet de types.
export interface Requete {
  bind(...valeurs: unknown[]): Requete;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Base {
  prepare(sql: string): Requete;
  /** Exécute les requêtes dans une seule transaction : tout ou rien (D1). */
  batch(requetes: Requete[]): Promise<unknown[]>;
}

export type Role = 'editeur' | 'gestionnaire' | 'viewer';

export interface Tenant {
  id: string;
  /** Nom affiché : le réglage `nom_affiche` du cabinet s'il existe, sinon le nom du locataire. */
  nom: string;
  domaine: string | null;
  cree_le: string;
  /** Thème du cabinet (réglage `theme`), toujours un nom connu de src/lib/themes.ts. */
  theme: string;
  /** Date de la suspension en cours (lot 10), ou null. Elle ne bloque que les gestionnaires : voir HORS_SUSPENSION (auth.ts). */
  suspendu_le: string | null;
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

export interface Portefeuille {
  id: string;
  tenant_id: string;
  viewer_id: string;
  libelle: string;
  type: string;
  ordre: number;
  /** 1 = archivé : hors du viewer, de « Tout » et des totaux ; en lecture seule pour le gestionnaire. */
  archive: number;
  cree_le: string;
}

export const COLONNES_PORTEFEUILLE = 'id, tenant_id, viewer_id, libelle, type, ordre, archive, cree_le';

/**
 * Filtre sur les portefeuilles d'un viewer, toujours bornés au locataire. Sans portefeuilleId :
 * tous ses portefeuilles. Avec : celui-là seulement, et seulement s'il est bien à ce viewer
 * et à ce locataire. Les « ? » sont à lier dans l'ordre de `valeurs`.
 */
export function dansPortefeuilles(
  tenantId: string,
  viewerId: string,
  portefeuilleId?: string | null,
  archives = false,
): { sql: string; valeurs: string[] } {
  // Les portefeuilles archivés sont exclus, sauf demande expresse (écrans du gestionnaire).
  const tous = `(SELECT id FROM portefeuille WHERE viewer_id = ? AND tenant_id = ?${archives ? '' : ' AND archive = 0'})`;
  return portefeuilleId
    ? { sql: `portefeuille_id = ? AND portefeuille_id IN ${tous}`, valeurs: [portefeuilleId, viewerId, tenantId] }
    : { sql: `portefeuille_id IN ${tous}`, valeurs: [viewerId, tenantId] };
}

/** Portefeuilles actifs du viewer ; avec `archives`, tous (écrans du gestionnaire). */
export async function portefeuillesDuViewer(db: Base, tenantId: string, viewerId: string, archives = false): Promise<Portefeuille[]> {
  const { results } = await db
    .prepare(`SELECT ${COLONNES_PORTEFEUILLE} FROM portefeuille WHERE tenant_id = ? AND viewer_id = ?${archives ? '' : ' AND archive = 0'} ORDER BY ordre, id`)
    .bind(tenantId, viewerId)
    .all<Portefeuille>();
  return results;
}

export interface Enveloppe {
  id: string;
  portefeuille_id: string;
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
  portefeuille_id: string;
  classe: string;
  cible_bp: number;
  rang: number;
}

export interface Point {
  id: string;
  portefeuille_id: string;
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
  /** Portefeuille visé par le rapport. null = il vaut pour tout le dossier du viewer. */
  portefeuille_id: string | null;
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

/**
 * Le port et la casse sont ignorés : "Localhost:4321" et "localhost" donnent le même tenant.
 * Un hôte désigne un cabinet par `tenant.domaine` (l'hôte d'origine) ou par une ligne de `domaine` VALIDÉE : un nom d'hôte
 * déclaré mais pas encore validé n'ouvre rien. Les deux sont uniques entre cabinets (contrôlé à la déclaration) ; en cas
 * d'égalité malgré tout, l'hôte d'origine l'emporte.
 */
export async function tenantParHote(db: Base, hote: string): Promise<Tenant | null> {
  const sansPort = hote.trim().toLowerCase().replace(/:\d+$/, '');
  // Une seule requête par page : le nom affiché, le thème et la suspension du cabinet viennent avec le locataire.
  const t = await db
    .prepare(
      `SELECT t.id,
              COALESCE(NULLIF(TRIM((SELECT valeur FROM reglage WHERE tenant_id = t.id AND cle = 'nom_affiche')), ''), t.nom) AS nom,
              t.domaine, t.cree_le,
              (SELECT valeur FROM reglage WHERE tenant_id = t.id AND cle = 'theme') AS theme,
              (SELECT debut_le FROM suspension WHERE tenant_id = t.id AND fin_le IS NULL) AS suspendu_le
         FROM tenant t
        WHERE t.domaine = ? OR t.id IN (SELECT tenant_id FROM domaine WHERE hote = ? AND valide_le IS NOT NULL)
        ORDER BY (t.domaine = ?) DESC
        LIMIT 1`,
    )
    .bind(sansPort, sansPort, sansPort)
    .first<Omit<Tenant, 'theme'> & { theme: string | null }>();
  return t ? { ...t, theme: themeValide(t.theme) } : null;
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

/** Enveloppes de tous les portefeuilles du viewer, ou d'un seul si portefeuilleId est donné. */
export async function enveloppesDuViewer(
  db: Base,
  tenantId: string,
  viewerId: string,
  portefeuilleId?: string | null,
  archives = false,
): Promise<Enveloppe[]> {
  const f = dansPortefeuilles(tenantId, viewerId, portefeuilleId, archives);
  const { results } = await db
    .prepare(
      `SELECT id, portefeuille_id, libelle, etablissement, ouverte_en, valorisation_cents,
              perf_bp, arrete_le, rang
         FROM enveloppe
        WHERE ${f.sql}
        ORDER BY portefeuille_id, rang, id`,
    )
    .bind(...f.valeurs)
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

export async function ciblesDuViewer(
  db: Base,
  tenantId: string,
  viewerId: string,
  portefeuilleId?: string | null,
  archives = false,
): Promise<Cible[]> {
  const f = dansPortefeuilles(tenantId, viewerId, portefeuilleId, archives);
  const { results } = await db
    .prepare(`SELECT id, portefeuille_id, classe, cible_bp, rang FROM cible
        WHERE ${f.sql} ORDER BY portefeuille_id, rang, id`)
    .bind(...f.valeurs)
    .all<Cible>();
  return results;
}

/**
 * Points de tous les portefeuilles du viewer (ou d'un seul), du plus ancien au plus récent.
 * Sur plusieurs portefeuilles, un même jour peut apparaître plusieurs fois : c'est
 * `pointsConsolides` (espace.ts) qui en fait une courbe unique.
 */
export async function pointsDuViewer(
  db: Base,
  tenantId: string,
  viewerId: string,
  portefeuilleId?: string | null,
  archives = false,
): Promise<Point[]> {
  const f = dansPortefeuilles(tenantId, viewerId, portefeuilleId, archives);
  const { results } = await db
    .prepare(
      `SELECT id, portefeuille_id, date, valeur_cents, versements_cumules_cents
         FROM point
        WHERE ${f.sql}
        ORDER BY date, portefeuille_id`,
    )
    .bind(...f.valeurs)
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
      `SELECT id, viewer_id, titre, categorie, date, cle_fichier, envoye_le, portefeuille_id
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
