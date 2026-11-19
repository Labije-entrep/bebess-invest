// Exports produits par le serveur, en CSV. Pas de générateur de classeur : le CSV suffit et le paquet
// du Worker reste léger. Séparateur « ; », UTF-8 avec BOM (Excel en français l'ouvre sans assistant),
// fins de ligne CRLF. Montants en centimes entiers, dates ISO 8601, comme en base.
//
// Toute requête ci-dessous est bornée au locataire : un seul paramètre, l'identifiant du locataire,
// ou, pour l'export d'un contact, le locataire ET le contact.

import type { Base } from './db';
import { EVENEMENT, journaliser, type Acteur } from './journal';

type Cellule = string | number | null | undefined;

// Une cellule texte qui commence par = + - @ ou une tabulation serait lue comme une formule par un tableur
// (injection CSV, depuis un nom de contact ou une note saisis par un tiers). On la préfixe d'une apostrophe.
// Les nombres ne sont jamais préfixés : un montant négatif reste un montant.
const FORMULE = /^[=+\-@\t\r]/;

function cellule(v: Cellule): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULE.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(colonnes: string[], lignes: Cellule[][]): string {
  return '﻿' + [colonnes, ...lignes].map((l) => l.map(cellule).join(';')).join('\r\n') + '\r\n';
}

/** Les colonnes sont celles de la requête, dans son ordre : un export ne décide pas du schéma. */
async function table(db: Base, sql: string, ...params: string[]): Promise<{ colonnes: string[]; lignes: Cellule[][] }> {
  const { results } = await db.prepare(sql).bind(...params).all<Record<string, Cellule>>();
  const colonnes = results.length > 0 ? Object.keys(results[0]) : colonnesDe(sql);
  return { colonnes, lignes: results.map((r) => colonnes.map((c) => r[c])) };
}

/** Table vide : les en-têtes se lisent dans le SELECT (alias ou nom de colonne), pour un fichier toujours exploitable. */
function colonnesDe(sql: string): string[] {
  const m = /^\s*SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(sql);
  if (!m) return [];
  const morceaux: string[] = [];
  let niveau = 0;
  let courant = '';
  for (const c of m[1]) {
    if (c === '(') niveau++;
    if (c === ')') niveau--;
    if (c === ',' && niveau === 0) { morceaux.push(courant); courant = ''; } else courant += c;
  }
  morceaux.push(courant);
  return morceaux.map((x) => x.trim().split(/\s+AS\s+/i).pop()!.trim().replace(/^\w+\./, ''));
}

// ---------------------------------------------------------------- le suivi : un fichier par jeu

const TYPES_DU_CONTACT =
  "(SELECT group_concat(ct.type, ',') FROM contact_type ct WHERE ct.contact_id = c.id AND ct.tenant_id = c.tenant_id)";

export const JEUX_SUIVI = {
  contacts: {
    nom: 'contacts',
    sql: `SELECT c.id, c.nom, c.prenom, c.email, c.tel, c.metier, c.structure, ${TYPES_DU_CONTACT} AS types,
                 c.responsable_id, c.binome_id, c.etape, c.convention, c.convention_le, c.apporteur_id,
                 c.relance, c.dernier_echange, c.type_echange, c.avoirs_cents, c.avoirs_le, c.notes,
                 c.viewer_id, c.archive, c.cree_le, c.maj_le
            FROM contact c WHERE c.tenant_id = ? ORDER BY c.nom, c.id`,
  },
  sujets: {
    nom: 'sujets',
    sql: `SELECT s.id, s.contact_id, c.nom AS contact_nom, s.texte, s.statut, s.echeance, s.origine, s.cree_le, s.fait_le, s.archive
            FROM sujet s JOIN contact c ON c.id = s.contact_id AND c.tenant_id = s.tenant_id
           WHERE s.tenant_id = ? ORDER BY s.cree_le, s.id`,
  },
  echanges: {
    nom: 'echanges',
    sql: `SELECT e.id, e.contact_id, c.nom AS contact_nom, e.date, e.type, e.note, e.cree_le
            FROM echange e JOIN contact c ON c.id = e.contact_id AND c.tenant_id = e.tenant_id
           WHERE e.tenant_id = ? ORDER BY e.date, e.id`,
  },
  actus: {
    nom: 'actus',
    sql: `SELECT id, date, titre, resume, a_dire, chiffres_json, faits_json, mots_cles, source, brut, note_marche_id, cree_le
            FROM actu WHERE tenant_id = ? ORDER BY date, id`,
  },
} as const;
export type JeuSuivi = keyof typeof JEUX_SUIVI;
export const estJeuSuivi = (v: string): v is JeuSuivi => Object.prototype.hasOwnProperty.call(JEUX_SUIVI, v);

export async function exportSuivi(db: Base, tenantId: string, jeu: JeuSuivi): Promise<string> {
  const t = await table(db, JEUX_SUIVI[jeu].sql, tenantId);
  return csv(t.colonnes, t.lignes);
}

// ---------------------------------------------------------------- un contact seul (accès RGPD)

/**
 * Tout ce que le cabinet détient sur UN contact, dans un seul fichier : sa fiche, ses notes, ses sujets, ses
 * échanges. Colonnes : section, id, date, type, statut, echeance, texte. Les lignes « contact » donnent un champ
 * par ligne (type = nom du champ, texte = valeur). Locataire ET contact sont contrôlés dans chaque requête.
 * Renvoie null si le contact n'est pas du locataire.
 */
export async function exportContact(db: Base, tenantId: string, contactId: string): Promise<{ nom: string; csv: string } | null> {
  const c = await db
    .prepare(
      `SELECT c.id, c.nom, c.prenom, c.email, c.tel, c.metier, c.structure, ${TYPES_DU_CONTACT} AS types,
              c.etape, c.convention, c.convention_le, c.relance, c.dernier_echange, c.type_echange,
              c.avoirs_cents, c.avoirs_le, c.notes, c.archive, c.cree_le, c.maj_le
         FROM contact c WHERE c.id = ? AND c.tenant_id = ?`,
    )
    .bind(contactId, tenantId)
    .first<Record<string, Cellule>>();
  if (!c) return null;

  const [sujets, echanges] = await Promise.all([
    db.prepare('SELECT id, texte, statut, echeance, origine, cree_le, fait_le FROM sujet WHERE contact_id = ? AND tenant_id = ? ORDER BY cree_le, id')
      .bind(contactId, tenantId).all<Record<string, Cellule>>(),
    db.prepare('SELECT id, date, type, note, cree_le FROM echange WHERE contact_id = ? AND tenant_id = ? ORDER BY date, id')
      .bind(contactId, tenantId).all<Record<string, Cellule>>(),
  ]);

  const lignes: Cellule[][] = [];
  for (const [champ, valeur] of Object.entries(c)) {
    if (champ === 'notes' || valeur === null) continue;
    lignes.push(['contact', c.id, null, champ, null, null, valeur]);
  }
  if (c.notes) lignes.push(['notes', c.id, null, null, null, null, c.notes]);
  for (const s of sujets.results) lignes.push(['sujet', s.id, s.cree_le, s.origine, s.statut, s.echeance, s.texte]);
  for (const e of echanges.results) lignes.push(['echange', e.id, e.date, e.type, null, null, e.note]);
  return { nom: String(c.nom), csv: csv(['section', 'id', 'date', 'type', 'statut', 'echeance', 'texte'], lignes) };
}

// ---------------------------------------------------------------- le locataire entier

// Toutes les tables qui portent des données du cabinet, chacune bornée au locataire (un seul « ? »).
// Exclues : session et jeton_connexion (secrets d'accès), cours (global, sans locataire), et ce qui est à l'éditeur et non au
// cabinet : suspension (son motif commercial, l'identifiant de l'éditeur qui l'a posée), contrat et evenement (prix, remises et
// leur motif, journal). Cet export est REMIS au cabinet : il ne contient rien que l'éditeur tienne pour lui. Ces tables restent
// lisibles dans la console (/admin).
const TABLES_LOCATAIRE: [string, string][] = [
  ['tenant', 'SELECT id, nom, domaine, cree_le FROM tenant WHERE id = ?'],
  ['domaine', 'SELECT hote, tenant_id, principal, valide_le, statut, detail, declare_le, verifie_le FROM domaine WHERE tenant_id = ?'],
  ['reglage', 'SELECT tenant_id, cle, valeur FROM reglage WHERE tenant_id = ?'],
  ['liste_valeur', 'SELECT tenant_id, liste, cle, libelle, ordre, actif, terminal, marqueur FROM liste_valeur WHERE tenant_id = ?'],
  ['membre', 'SELECT id, tenant_id, nom, initiale, couleur, actif, cree_le FROM membre WHERE tenant_id = ?'],
  // Les accès du cabinet : jamais le compte de support de l'éditeur. Le statut du dossier n'a de sens que pour un viewer.
  [
    'utilisateur',
    `SELECT id, tenant_id, email, nom, role, actif,
            CASE WHEN role = 'viewer' THEN statut END AS statut, CASE WHEN role = 'viewer' THEN publie_le END AS publie_le, cree_le
       FROM utilisateur WHERE tenant_id = ? AND role <> 'support_editeur'`,
  ],
  ['fiche', 'SELECT f.* FROM fiche f JOIN utilisateur u ON u.id = f.utilisateur_id WHERE u.tenant_id = ?'],
  ['portefeuille', 'SELECT id, tenant_id, viewer_id, libelle, type, ordre, archive, cree_le FROM portefeuille WHERE tenant_id = ?'],
  ['enveloppe', 'SELECT e.* FROM enveloppe e JOIN portefeuille p ON p.id = e.portefeuille_id WHERE p.tenant_id = ?'],
  [
    'ligne',
    `SELECT l.* FROM ligne l JOIN enveloppe e ON e.id = l.enveloppe_id
       JOIN portefeuille p ON p.id = e.portefeuille_id WHERE p.tenant_id = ?`,
  ],
  ['cible', 'SELECT c.* FROM cible c JOIN portefeuille p ON p.id = c.portefeuille_id WHERE p.tenant_id = ?'],
  ['point', 'SELECT t.* FROM point t JOIN portefeuille p ON p.id = t.portefeuille_id WHERE p.tenant_id = ?'],
  ['mouvement', 'SELECT m.* FROM mouvement m JOIN utilisateur u ON u.id = m.viewer_id WHERE u.tenant_id = ?'],
  ['document', 'SELECT d.* FROM document d JOIN utilisateur u ON u.id = d.viewer_id WHERE u.tenant_id = ?'],
  ['consultation', 'SELECT c.* FROM consultation c JOIN utilisateur u ON u.id = c.viewer_id WHERE u.tenant_id = ?'],
  ['contact', 'SELECT * FROM contact WHERE tenant_id = ?'],
  ['contact_type', 'SELECT tenant_id, contact_id, type FROM contact_type WHERE tenant_id = ?'],
  ['sujet', 'SELECT * FROM sujet WHERE tenant_id = ?'],
  ['echange', 'SELECT * FROM echange WHERE tenant_id = ?'],
  ['actu', 'SELECT * FROM actu WHERE tenant_id = ?'],
  ['document_interne', 'SELECT * FROM document_interne WHERE tenant_id = ?'],
  ['page_contenu', 'SELECT * FROM page_contenu WHERE tenant_id = ?'],
  ['note_marche', 'SELECT * FROM note_marche WHERE tenant_id = ?'],
  ['version_locataire', 'SELECT tenant_id, version FROM version_locataire WHERE tenant_id = ?'],
  ['incident', 'SELECT * FROM incident WHERE tenant_id = ?'],
];

const LISEZMOI = [
  'Export complet du cabinet : un fichier CSV par table.',
  'CSV : séparateur point-virgule, UTF-8, fins de ligne CRLF. Montants en centimes entiers, pourcentages en centièmes de point, dates ISO 8601.',
  'Les cellules de texte qui commencent par = + - @ sont précédées d’une apostrophe, pour ne pas être lues comme des formules par un tableur.',
  'Non inclus : les sessions et jetons de connexion (secrets), les cours de marché (communs à tous les cabinets), les éléments propres à l’éditeur (contrat, suspension, journal) et le contenu des fichiers PDF et logos,',
  'dont la table document donne la liste (cle_fichier). Les fichiers se téléchargent depuis l’espace gestionnaire, rapport par rapport.',
].join('\r\n');

/**
 * L'export complet. Il est journalisé AVANT d'être produit (`export_complet`, avec qui l'a demandé) : sans événement, pas d'export.
 * `acteur` est obligatoire, pour qu'aucun appelant ne puisse l'oublier.
 */
export async function exportLocataire(db: Base, tenantId: string, acteur: Acteur): Promise<Uint8Array> {
  await journaliser(db, { tenantId, type: EVENEMENT.EXPORT_COMPLET, acteur, cible: { type: 'cabinet', id: tenantId } });
  const fichiers: { nom: string; octets: Uint8Array }[] = [];
  const enc = new TextEncoder();
  fichiers.push({ nom: 'LISEZMOI.txt', octets: enc.encode(LISEZMOI + '\r\n') });
  for (const [nom, sql] of TABLES_LOCATAIRE) {
    const t = await table(db, sql, tenantId);
    fichiers.push({ nom: `${nom}.csv`, octets: enc.encode(csv(t.colonnes, t.lignes)) });
  }
  return zip(fichiers);
}

// ---------------------------------------------------------------- ZIP (sans compression : le CSV est petit, le code aussi)

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(o: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < o.length; i++) c = TABLE_CRC[(c ^ o[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(fichiers: { nom: string; octets: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const morceaux: Uint8Array[] = [];
  const centrale: Uint8Array[] = [];
  let decalage = 0;
  const maintenant = new Date();
  const heure = (maintenant.getUTCHours() << 11) | (maintenant.getUTCMinutes() << 5) | (maintenant.getUTCSeconds() >> 1);
  const jour = ((maintenant.getUTCFullYear() - 1980) << 9) | ((maintenant.getUTCMonth() + 1) << 5) | maintenant.getUTCDate();

  for (const f of fichiers) {
    const nom = enc.encode(f.nom);
    const crc = crc32(f.octets);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // noms en UTF-8
    local.setUint16(10, heure, true);
    local.setUint16(12, jour, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.octets.length, true);
    local.setUint32(22, f.octets.length, true);
    local.setUint16(26, nom.length, true);
    morceaux.push(new Uint8Array(local.buffer), nom, f.octets);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(12, heure, true);
    dir.setUint16(14, jour, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, f.octets.length, true);
    dir.setUint32(24, f.octets.length, true);
    dir.setUint16(28, nom.length, true);
    dir.setUint32(42, decalage, true);
    centrale.push(new Uint8Array(dir.buffer), nom);
    decalage += 30 + nom.length + f.octets.length;
  }
  const tailleCentrale = centrale.reduce((s, m) => s + m.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, fichiers.length, true);
  fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, tailleCentrale, true);
  fin.setUint32(16, decalage, true);

  const tout = [...morceaux, ...centrale, new Uint8Array(fin.buffer)];
  const sortie = new Uint8Array(tout.reduce((s, m) => s + m.length, 0));
  let p = 0;
  for (const m of tout) { sortie.set(m, p); p += m.length; }
  return sortie;
}

/** Nom de fichier sûr, accents retirés. */
export const nomFichier = (base: string, ext: string): string =>
  `${base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export'}.${ext}`;
