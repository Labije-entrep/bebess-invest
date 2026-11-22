// Les fixtures du banc : des cabinets complets, des comptes, des sessions, des contrats. Écrites en SQL direct : ce que les tests
// vérifient, c'est le code du dépôt qui lit et écrit ensuite, pas la façon de poser le décor.
import { createHash, randomBytes } from 'node:crypto';
import { requetesListesDefaut } from '../../src/lib/listes-defaut';
import type { BaseTest } from './d1.ts';

export type Cle = 'A' | 'B' | 'C';
export const HOTES: Record<Cle, string> = { A: 'cabinet-a.test', B: 'cabinet-b.test', C: 'cabinet-c.test' };
// Des SIREN valides au sens de la base (neuf chiffres) et distincts : un par cabinet.
export const SIREN: Record<Cle, string> = { A: '732829320', B: '552081317', C: '356000000' };
const MAINTENANT = '2026-06-01T08:00:00.000Z';

export type RoleU = 'associe' | 'collaborateur' | 'lecture' | 'viewer' | 'editeur' | 'support_editeur';

export interface Compte {
  id: string;
  email: string;
  role: RoleU;
  tenant: string;
}

export interface Donnees {
  membre: string;
  contact: string;
  /** Un contact rattaché au viewer du cabinet. */
  contactViewer: string;
  sujet: string;
  echange: string;
  viewer: string;
  portefeuille: string;
  portefeuille2: string;
  /** Le portefeuille du second viewer du cabinet. */
  portefeuille3: string;
  enveloppe: string;
  ligne: string;
  cible: string;
  point: string;
  point2: string;
  mouvement: string;
  document: string;
  cleDocument: string;
  /** Le viewer d'un AUTRE dossier du même cabinet, avec son document : pour le cloisonnement entre clients d'un même cabinet. */
  viewer2: string;
  document2: string;
  note: string;
  actu: string;
  documentInterne: string;
  pageContenu: string;
}

export interface Cabinet {
  cle: Cle;
  id: string;
  nom: string;
  hote: string;
  associe: Compte;
  collaborateur: Compte;
  lecture: Compte;
  viewerCompte: Compte;
  viewer2Compte: Compte;
  donnees: Donnees;
}

export const sha256 = (t: string): string => createHash('sha256').update(t).digest('hex');

export function nouveauCompte(db: BaseTest, tenant: string, role: RoleU, email: string, extra: { actif?: number; statut?: string } = {}): Compte {
  const id = `u-${tenant}-${email.split('@')[0]}`;
  db.exec(
    'INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, tenant, email, `Nom ${email.split('@')[0]}`, role, extra.actif ?? 1, MAINTENANT, extra.statut ?? (role === 'viewer' ? 'publie' : 'brouillon'),
  );
  return { id, email, role, tenant };
}

/** Une session valide pour ce compte : renvoie le cookie à présenter (`bbs=<secret>`). */
export function ouvrirSession(db: BaseTest, compte: Compte | string, dureeMs = 3_600_000): string {
  const id = typeof compte === 'string' ? compte : compte.id;
  const secret = randomBytes(32).toString('hex');
  db.exec('INSERT INTO session (id, utilisateur_id, expire_le, cree_le) VALUES (?, ?, ?, ?)', sha256(secret), id, new Date(Date.now() + dureeMs).toISOString(), MAINTENANT);
  return `bbs=${secret}`;
}

export interface OptionsCabinet {
  siren?: string | null;
  /** Le contrat posé ; null : aucun contrat. */
  contrat?: Partial<Contrat> | null;
}

export interface Contrat {
  id: string;
  statut: string;
  periodicite: string;
  debut_le: string | null;
  date_mise_en_production: string | null;
  date_fin_essai: string | null;
  prix_socle: number;
  prix_pilotage: number;
  prix_site: number;
  prix_acces_sup: number;
  module_pilotage: number;
  module_site: number;
  acces_inclus: number;
  frais_installation: number;
  remise_commerciale_taux: number;
  remise_motif: string | null;
  dpa_signe_le: string | null;
  tarif_gele_jusqu_au: string | null;
}

/** Les prix du catalogue : 79 / 49 / 39 / 25 €, exprimés au mois, en centimes. */
export const PRIX = { prix_socle: 7900, prix_pilotage: 4900, prix_site: 3900, prix_acces_sup: 2500 };

export function poserContrat(db: BaseTest, tenant: string, c: Partial<Contrat> = {}): string {
  const v: Contrat = {
    id: `c-${tenant}`, statut: 'actif', periodicite: 'annuelle', debut_le: '2026-03-14', date_mise_en_production: null, date_fin_essai: null,
    ...PRIX, module_pilotage: 0, module_site: 0, acces_inclus: 2, frais_installation: 0, remise_commerciale_taux: 0, remise_motif: null,
    dpa_signe_le: '2026-01-01', tarif_gele_jusqu_au: null, ...c,
  };
  db.exec(
    `INSERT INTO contrat (id, tenant_id, statut, periodicite, debut_le, date_mise_en_production, date_fin_essai, prix_socle, prix_pilotage, prix_site,
       prix_acces_sup, module_pilotage, module_site, acces_inclus, frais_installation, remise_commerciale_taux, remise_motif, dpa_signe_le,
       tarif_gele_jusqu_au, cree_le, maj_le)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    v.id, tenant, v.statut, v.periodicite, v.debut_le, v.date_mise_en_production, v.date_fin_essai, v.prix_socle, v.prix_pilotage, v.prix_site,
    v.prix_acces_sup, v.module_pilotage, v.module_site, v.acces_inclus, v.frais_installation, v.remise_commerciale_taux, v.remise_motif, v.dpa_signe_le,
    v.tarif_gele_jusqu_au, MAINTENANT, MAINTENANT,
  );
  return v.id;
}

/** Un locataire nu : sa ligne et ses listes de référence (celles que le code pose à la création d'un cabinet), rien d'autre. */
export function poserTenant(db: BaseTest, id: string, nom: string, hote: string | null, siren: string | null = null): void {
  db.exec('INSERT INTO tenant (id, nom, domaine, cree_le, siren) VALUES (?, ?, ?, ?, ?)', id, nom, hote, MAINTENANT, siren);
  db.brut.exec('BEGIN');
  for (const r of requetesListesDefaut(db, id)) (r as unknown as { executer(): void }).executer();
  db.brut.exec('COMMIT');
}

/** Un cabinet complet : le locataire, ses comptes, et un exemplaire de CHAQUE ressource que le cloisonnement doit protéger. */
export function creerCabinet(db: BaseTest, cle: Cle, o: OptionsCabinet = {}): Cabinet {
  const id = `tenant-${cle.toLowerCase()}`;
  const nom = `Cabinet ${cle}`;
  poserTenant(db, id, nom, HOTES[cle], o.siren === undefined ? SIREN[cle] : o.siren);
  const k = cle.toLowerCase();
  const associe = nouveauCompte(db, id, 'associe', `associe-${k}@cabinet-${k}.test`);
  const collaborateur = nouveauCompte(db, id, 'collaborateur', `collab-${k}@cabinet-${k}.test`);
  const lecture = nouveauCompte(db, id, 'lecture', `lecture-${k}@cabinet-${k}.test`);
  const viewerCompte = nouveauCompte(db, id, 'viewer', `client-${k}@cabinet-${k}.test`);
  const viewer2Compte = nouveauCompte(db, id, 'viewer', `client2-${k}@cabinet-${k}.test`);

  const d: Donnees = {
    membre: `m-${k}`, contact: `ct-${k}`, contactViewer: `ct-v-${k}`, sujet: `su-${k}`, echange: `ec-${k}`, viewer: viewerCompte.id,
    portefeuille: `pf-${k}`, portefeuille2: `pf2-${k}`, portefeuille3: `pf3-${k}`, enveloppe: `en-${k}`, ligne: `li-${k}`, cible: `ci-${k}`,
    point: `pt-${k}`, point2: `pt2-${k}`, mouvement: `mv-${k}`, document: `dc-${k}`, cleDocument: `${id}/documents/rapport-${k}.pdf`,
    viewer2: viewer2Compte.id, document2: `dc2-${k}`, note: `no-${k}`, actu: `ac-${k}`, documentInterne: `di-${k}`, pageContenu: `pc-${k}`,
  };
  db.exec('INSERT INTO membre (id, tenant_id, nom, initiale, couleur, cree_le) VALUES (?, ?, ?, ?, ?, ?)', d.membre, id, `Membre ${cle}`, cle, 'serie-1', MAINTENANT);
  db.exec('INSERT INTO contact (id, tenant_id, nom, etape, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)', d.contact, id, `Contact ${cle}`, 'contact', MAINTENANT, MAINTENANT);
  db.exec('INSERT INTO contact_type (tenant_id, contact_id, type) VALUES (?, ?, ?)', id, d.contact, 'prospect');
  db.exec('INSERT INTO contact (id, tenant_id, nom, viewer_id, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)', d.contactViewer, id, `Client ${cle}`, d.viewer, MAINTENANT, MAINTENANT);
  db.exec('INSERT INTO sujet (id, tenant_id, contact_id, texte, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?)', d.sujet, id, d.contact, `Sujet ${cle}`, 'afaire', MAINTENANT);
  db.exec('INSERT INTO echange (id, tenant_id, contact_id, date, type, note, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', d.echange, id, d.contact, '2026-05-01', 'tel', `Note ${cle}`, MAINTENANT);

  db.exec('INSERT INTO portefeuille (id, tenant_id, viewer_id, libelle, type, ordre, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', d.portefeuille, id, d.viewer, 'Patrimoine', 'personne', 0, MAINTENANT);
  db.exec('INSERT INTO portefeuille (id, tenant_id, viewer_id, libelle, type, ordre, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', d.portefeuille2, id, d.viewer, 'Holding', 'personne', 1, MAINTENANT);
  db.exec('INSERT INTO portefeuille (id, tenant_id, viewer_id, libelle, type, ordre, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', d.portefeuille3, id, d.viewer2, 'Patrimoine', 'personne', 0, MAINTENANT);
  db.exec('INSERT INTO enveloppe (id, portefeuille_id, libelle, valorisation_cents, arrete_le) VALUES (?, ?, ?, ?, ?)', d.enveloppe, d.portefeuille, 'Assurance-vie', 5_000_000, '2026-05-31');
  db.exec('INSERT INTO ligne (id, enveloppe_id, libelle, classe, valorisation_cents, arrete_le) VALUES (?, ?, ?, ?, ?, ?)', d.ligne, d.enveloppe, 'Fonds euros', 'liquidites', 5_000_000, '2026-05-31');
  db.exec('INSERT INTO cible (id, portefeuille_id, classe, cible_bp) VALUES (?, ?, ?, ?)', d.cible, d.portefeuille, 'liquidites', 10000);
  db.exec('INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES (?, ?, ?, ?, ?)', d.point, d.portefeuille, '2026-04-30', 4_900_000, 4_000_000);
  db.exec('INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES (?, ?, ?, ?, ?)', d.point2, d.portefeuille, '2026-05-31', 5_000_000, 4_000_000);
  db.exec('INSERT INTO mouvement (id, viewer_id, date, libelle, montant_cents, statut) VALUES (?, ?, ?, ?, ?, ?)', d.mouvement, d.viewer, '2026-05-15', `Versement ${cle}`, 100_000, 'execute');
  db.exec('INSERT INTO document (id, viewer_id, titre, categorie, date, cle_fichier, envoye_le) VALUES (?, ?, ?, ?, ?, ?, ?)', d.document, d.viewer, `Rapport ${cle}`, 'reglementaire', '2026-05-31', d.cleDocument, MAINTENANT);
  db.exec('INSERT INTO document (id, viewer_id, titre, categorie, date, cle_fichier, envoye_le) VALUES (?, ?, ?, ?, ?, ?, ?)', d.document2, d.viewer2, `Rapport 2 ${cle}`, 'reglementaire', '2026-05-31', `${id}/documents/rapport2-${k}.pdf`, MAINTENANT);
  db.exec('INSERT INTO note_marche (id, tenant_id, slug, langue, titre, corps_md, date, publiee) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', d.note, id, `note-${k}`, 'fr', `Note ${cle}`, `Corps ${cle}`, '2026-05-01', 1);
  db.exec('INSERT INTO page_contenu (id, tenant_id, cle, langue, titre, contenu_json, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', d.pageContenu, id, 'accueil', 'fr', `Accueil ${cle}`, JSON.stringify({ accroche: `Accroche ${cle}` }), MAINTENANT);
  db.exec('INSERT INTO actu (id, tenant_id, date, titre, resume, cree_le) VALUES (?, ?, ?, ?, ?, ?)', d.actu, id, '2026-05-02', `Actu ${cle}`, `Résumé ${cle}`, MAINTENANT);
  db.exec('INSERT INTO document_interne (id, tenant_id, titre, categorie, ajoute_le) VALUES (?, ?, ?, ?, ?)', d.documentInterne, id, `Doc interne ${cle}`, 'autre', MAINTENANT);

  if (o.contrat !== null) poserContrat(db, id, o.contrat ?? {});
  return { cle, id, nom, hote: HOTES[cle], associe, collaborateur, lecture, viewerCompte, viewer2Compte, donnees: d };
}

/** Les trois cabinets A, B et C, sous contrat actif avec les deux modules (aucun écran n'est fermé par un drapeau). */
export function troisCabinets(db: BaseTest): Record<Cle, Cabinet> {
  const contrat = { module_pilotage: 1, module_site: 1 };
  return { A: creerCabinet(db, 'A', { contrat }), B: creerCabinet(db, 'B', { contrat }), C: creerCabinet(db, 'C', { contrat }) };
}

/** Le cabinet de l'éditeur : son compte `editeur` est hébergé chez lui, sans contrat. */
export function cabinetEditeur(db: BaseTest): { id: string; hote: string; editeur: Compte } {
  const id = 'tenant-editeur';
  poserTenant(db, id, 'Labije Cab', 'editeur.test');
  return { id, hote: 'editeur.test', editeur: nouveauCompte(db, id, 'editeur', 'editeur@editeur.test') };
}

/** Pose les objets R2 des documents d'un cabinet : un PDF par rapport. */
export function poserFichiers(bucket: { put(c: string, v: ArrayBuffer, o?: unknown): Promise<unknown> }, c: Cabinet): Promise<unknown[]> {
  const pdf = new TextEncoder().encode(`%PDF-1.4 ${c.cle}`).buffer as ArrayBuffer;
  return Promise.all([
    bucket.put(c.donnees.cleDocument, pdf, { httpMetadata: { contentType: 'application/pdf' } }),
    bucket.put(`${c.id}/documents/rapport2-${c.cle.toLowerCase()}.pdf`, pdf, { httpMetadata: { contentType: 'application/pdf' } }),
  ]);
}
