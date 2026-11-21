// Site public : modèles de contenu, lecture et écriture des pages et des notes.
// Requêtes préparées uniquement. Dates en chaînes ISO. Aucun calcul sur objet Date
// hormis l'horodatage d'enregistrement.

import { pageContenu, type Base, type NoteMarche } from './db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Contenu = Record<string, any>;

export interface Champ {
  nom: string;
  libelle: string;
  long?: boolean;
}

export type Bloc =
  | { type: 'champ'; nom: string; libelle: string; long?: boolean }
  | { type: 'groupe'; nom: string; libelle: string; champs: Champ[] }
  | { type: 'chaines'; nom: string; libelle: string; n: number }
  | { type: 'liste'; nom: string; libelle: string; champs: Champ[]; n?: number };

export interface Modele {
  cle: string;
  libelle: string;
  route: string;
  blocs: Bloc[];
}

const champ = (nom: string, libelle: string, long = false): Bloc => ({ type: 'champ', nom, libelle, long });

export const MODELES: Modele[] = [
  {
    cle: 'accueil',
    libelle: 'Accueil',
    route: '/',
    blocs: [
      champ('eyebrow', 'Étiquette au-dessus du titre'),
      champ('titre', 'Titre'),
      champ('mot_accent', 'Mot du titre mis en accent'),
      champ('intro', 'Introduction (un seul paragraphe)', true),
      champ('cta_primaire', 'Bouton principal (vers /contact)'),
      champ('cta_secondaire', 'Bouton secondaire (vers /approche)'),
      { type: 'chaines', nom: 'preuves', libelle: 'Preuves', n: 4 },
      {
        type: 'liste',
        nom: 'missions',
        libelle: 'Mission',
        n: 3,
        champs: [
          { nom: 'etiquette', libelle: 'Étiquette' },
          { nom: 'titre', libelle: 'Titre' },
          { nom: 'texte', libelle: 'Texte', long: true },
        ],
      },
      {
        type: 'groupe',
        nom: 'positionnement',
        libelle: 'Positionnement',
        champs: [
          { nom: 'eyebrow', libelle: 'Étiquette' },
          { nom: 'titre', libelle: 'Titre' },
          { nom: 'p1', libelle: 'Paragraphe 1', long: true },
          { nom: 'p2', libelle: 'Paragraphe 2', long: true },
        ],
      },
      {
        type: 'groupe',
        nom: 'citation',
        libelle: 'Citation',
        champs: [
          { nom: 'texte', libelle: 'Texte', long: true },
          { nom: 'source', libelle: 'Source' },
        ],
      },
      {
        type: 'liste',
        nom: 'faq',
        libelle: 'Question',
        champs: [
          { nom: 'question', libelle: 'Question' },
          { nom: 'reponse', libelle: 'Réponse', long: true },
        ],
      },
      {
        type: 'groupe',
        nom: 'final',
        libelle: 'Appel final',
        champs: [
          { nom: 'eyebrow', libelle: 'Étiquette' },
          { nom: 'titre', libelle: 'Titre' },
          { nom: 'texte', libelle: 'Texte', long: true },
          { nom: 'cta', libelle: 'Bouton (vers /contact)' },
        ],
      },
    ],
  },
  {
    cle: 'approche',
    libelle: 'Approche',
    route: '/approche',
    blocs: [
      champ('eyebrow', 'Étiquette au-dessus du titre'),
      champ('titre', 'Titre'),
      champ('intro', 'Introduction', true),
      {
        type: 'liste',
        nom: 'piliers',
        libelle: 'Pilier',
        champs: [
          { nom: 'titre', libelle: 'Titre' },
          { nom: 'texte', libelle: 'Texte', long: true },
        ],
      },
      {
        type: 'groupe',
        nom: 'final',
        libelle: 'Appel final',
        champs: [
          { nom: 'titre', libelle: 'Titre' },
          { nom: 'texte', libelle: 'Texte', long: true },
          { nom: 'cta', libelle: 'Bouton (vers /contact)' },
        ],
      },
    ],
  },
  {
    cle: 'parcours',
    libelle: 'Parcours',
    route: '/parcours',
    blocs: [
      champ('eyebrow', 'Étiquette au-dessus du titre'),
      champ('titre', 'Titre'),
      champ('intro', 'Introduction', true),
      {
        type: 'liste',
        nom: 'etapes',
        libelle: 'Étape',
        champs: [
          { nom: 'titre', libelle: 'Titre' },
          { nom: 'texte', libelle: 'Texte', long: true },
        ],
      },
    ],
  },
  {
    cle: 'contact',
    libelle: 'Contact',
    route: '/contact',
    blocs: [
      champ('eyebrow', 'Étiquette au-dessus du titre'),
      champ('titre', 'Titre'),
      champ('intro', 'Introduction', true),
      champ('destinataire', 'Adresse de réception des messages du formulaire'),
      {
        type: 'groupe',
        nom: 'coordonnees',
        libelle: 'Coordonnées',
        champs: [
          { nom: 'adresse', libelle: 'Adresse', long: true },
          { nom: 'telephone', libelle: 'Téléphone' },
          { nom: 'horaires', libelle: 'Horaires', long: true },
        ],
      },
      {
        type: 'groupe',
        nom: 'confirmation',
        libelle: 'Page de confirmation',
        champs: [
          { nom: 'titre', libelle: 'Titre' },
          { nom: 'texte', libelle: 'Texte', long: true },
        ],
      },
    ],
  },
  {
    cle: 'notes',
    libelle: 'Notes de marché (page de liste)',
    route: '/notes',
    blocs: [
      champ('eyebrow', 'Étiquette au-dessus du titre'),
      champ('titre', 'Titre'),
      champ('intro', 'Introduction', true),
      champ('vide', "Message quand aucune note n'est publiée"),
    ],
  },
  {
    cle: 'mentions',
    libelle: 'Mentions légales',
    route: '/mentions-legales',
    blocs: [
      champ('eyebrow', 'Étiquette au-dessus du titre'),
      champ('titre', 'Titre'),
      {
        type: 'liste',
        nom: 'sections',
        libelle: 'Section',
        champs: [
          { nom: 'titre', libelle: 'Titre' },
          { nom: 'texte', libelle: 'Texte (paragraphes séparés par une ligne vide)', long: true },
        ],
      },
    ],
  },
];

export function modeleParCle(cle: string): Modele | undefined {
  return MODELES.find((m) => m.cle === cle);
}

// ---- Lecture défensive : un contenu partiel ou mal formé ne casse jamais une page.

export function chaine(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
export function liste(v: unknown): Contenu[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
}
export function chaines(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [];
}
/**
 * Les retours à la ligne d'un texte saisi : `\r\n` (un `<textarea>` l'envoie ainsi) et `\r` seul deviennent `\n`. C'est ce que tout texte reçoit à
 * l'ENREGISTREMENT (enregistrerPage, enregistrerNote, lireFormulaire) : ce qui est en base ne porte plus qu'un seul type de saut de ligne.
 */
export const normaliserSauts = (texte: string): string => texte.replace(/\r\n?/g, '\n');
/** Le même passage, sur toutes les chaînes d'un contenu (objets et listes imbriqués). */
function normaliserContenu(v: unknown): unknown {
  if (typeof v === 'string') return normaliserSauts(v);
  if (Array.isArray(v)) return v.map(normaliserContenu);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normaliserContenu(x)]));
  return v;
}
/**
 * Les paragraphes d'un texte, séparés par une ligne vide. Normalise aussi à la lecture : les lignes déjà en base ont été enregistrées avec
 * `\r\n`, et ne se réécrivent pas toutes seules.
 */
export function paragraphes(texte: string): string[] {
  return normaliserSauts(texte).split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
}

export interface PageLue {
  c: Contenu | null;
  titre: string | null;
  description: string;
  maj_le: string | null;
}

/** Une clé absente, vide ou illisible donne c = null : la page affiche un état vide. */
export async function chargerPage(
  db: Base,
  tenantId: string | undefined,
  cle: string,
  langue: string = 'fr',
): Promise<PageLue> {
  const vide: PageLue = { c: null, titre: null, description: '', maj_le: null };
  if (!tenantId) return vide;
  const p = await pageContenu(db, tenantId, cle, langue);
  if (!p) return vide;
  try {
    const o = JSON.parse(p.contenu_json);
    if (o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0) {
      return { c: o, titre: p.titre, description: chaine(o.description), maj_le: p.maj_le };
    }
  } catch {
    // JSON illisible : traité comme absent.
  }
  return vide;
}

export async function enregistrerPage(
  db: Base,
  tenantId: string,
  cle: string,
  titre: string | null,
  contenu: Contenu,
): Promise<void> {
  const json = JSON.stringify(normaliserContenu(contenu));
  const maintenant = new Date().toISOString();
  const existante = await pageContenu(db, tenantId, cle);
  if (existante) {
    await db
      .prepare('UPDATE page_contenu SET titre = ?, contenu_json = ?, maj_le = ? WHERE id = ? AND tenant_id = ?')
      .bind(titre, json, maintenant, existante.id, tenantId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO page_contenu (id, tenant_id, cle, langue, titre, contenu_json, maj_le)
         VALUES (?, ?, ?, 'fr', ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), tenantId, cle, titre, json, maintenant)
      .run();
  }
}

// ---- Formulaire de saisie, piloté par le modèle.

export type Rang =
  | { entete: string }
  | { nom: string; libelle: string; long: boolean; valeur: string };

/** Les rangs du formulaire : un champ par entrée du modèle, jamais de JSON brut. */
export function aplatir(m: Modele, titre: string | null, c: Contenu): Rang[] {
  const rangs: Rang[] = [
    { entete: 'Référencement' },
    { nom: 'meta_titre', libelle: 'Titre de la page (balise title)', long: false, valeur: titre ?? '' },
    { nom: 'meta_description', libelle: 'Description (balise meta)', long: true, valeur: chaine(c.description) },
  ];
  for (const b of m.blocs) {
    if (b.type === 'champ') {
      rangs.push({ nom: b.nom, libelle: b.libelle, long: !!b.long, valeur: chaine(c[b.nom]) });
    } else if (b.type === 'groupe') {
      rangs.push({ entete: b.libelle });
      const g: Contenu = c[b.nom] && typeof c[b.nom] === 'object' ? c[b.nom] : {};
      for (const ch of b.champs) {
        rangs.push({ nom: `${b.nom}.${ch.nom}`, libelle: ch.libelle, long: !!ch.long, valeur: chaine(g[ch.nom]) });
      }
    } else if (b.type === 'chaines') {
      rangs.push({ entete: b.libelle });
      const a: unknown[] = Array.isArray(c[b.nom]) ? c[b.nom] : [];
      for (let i = 0; i < b.n; i++) {
        rangs.push({ nom: `${b.nom}.${i}`, libelle: `${b.libelle} ${i + 1}`, long: false, valeur: chaine(a[i]) });
      }
    } else {
      const a = liste(c[b.nom]);
      const n = b.n ?? Math.max(a.length + 2, 3);
      for (let i = 0; i < n; i++) {
        rangs.push({ entete: `${b.libelle} ${i + 1}` });
        for (const ch of b.champs) {
          rangs.push({
            nom: `${b.nom}.${i}.${ch.nom}`,
            libelle: ch.libelle,
            long: !!ch.long,
            valeur: chaine(a[i]?.[ch.nom]),
          });
        }
      }
    }
  }
  return rangs;
}

/** Reconstruit l'objet du modèle depuis le formulaire. Les lignes vides des listes libres sont écartées. */
export function lireFormulaire(m: Modele, f: FormData): { titre: string | null; contenu: Contenu } {
  const g = (nom: string) => normaliserSauts(String(f.get(nom) ?? '')).trim();
  const contenu: Contenu = {};
  const description = g('meta_description');
  if (description) contenu.description = description;
  for (const b of m.blocs) {
    if (b.type === 'champ') {
      contenu[b.nom] = g(b.nom);
    } else if (b.type === 'groupe') {
      contenu[b.nom] = Object.fromEntries(b.champs.map((ch) => [ch.nom, g(`${b.nom}.${ch.nom}`)]));
    } else if (b.type === 'chaines') {
      contenu[b.nom] = Array.from({ length: b.n }, (_, i) => g(`${b.nom}.${i}`));
    } else {
      const lignes: Contenu[] = [];
      for (let i = 0; b.n === undefined ? f.has(`${b.nom}.${i}.${b.champs[0].nom}`) : i < b.n; i++) {
        const ligne = Object.fromEntries(b.champs.map((ch) => [ch.nom, g(`${b.nom}.${i}.${ch.nom}`)]));
        if (b.n !== undefined || Object.values(ligne).some((v) => v !== '')) lignes.push(ligne);
      }
      contenu[b.nom] = lignes;
    }
  }
  return { titre: g('meta_titre') || null, contenu };
}

// ---- Notes de marché.

const COLONNES_NOTE = 'id, tenant_id, slug, langue, titre, chapeau, corps_md, date, publiee';

export function slugifier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Brouillons compris, de la plus récente à la plus ancienne. */
export async function toutesLesNotes(db: Base, tenantId: string): Promise<NoteMarche[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLONNES_NOTE} FROM note_marche
        WHERE tenant_id = ? AND langue = 'fr'
        ORDER BY date DESC, id DESC`,
    )
    .bind(tenantId)
    .all<NoteMarche>();
  return results;
}

export function noteParId(db: Base, tenantId: string, id: string): Promise<NoteMarche | null> {
  return db
    .prepare(`SELECT ${COLONNES_NOTE} FROM note_marche WHERE tenant_id = ? AND id = ?`)
    .bind(tenantId, id)
    .first<NoteMarche>();
}

export function notePubliee(
  db: Base,
  tenantId: string,
  slug: string,
  langue: string = 'fr',
): Promise<NoteMarche | null> {
  return db
    .prepare(
      `SELECT ${COLONNES_NOTE} FROM note_marche
        WHERE tenant_id = ? AND slug = ? AND langue = ? AND publiee = 1`,
    )
    .bind(tenantId, slug, langue)
    .first<NoteMarche>();
}

export async function slugPris(db: Base, tenantId: string, slug: string, sauf: string): Promise<boolean> {
  const r = await db
    .prepare(`SELECT id FROM note_marche WHERE tenant_id = ? AND slug = ? AND langue = 'fr' AND id != ?`)
    .bind(tenantId, slug, sauf)
    .first<{ id: string }>();
  return r !== null;
}

/** Les trois gestes de l'écran d'une note : enregistrer sans changer l'état, publier, repasser en brouillon. */
export type ActionNote = 'enregistrer' | 'publier' | 'brouillon';
export const ACTIONS_NOTE: ActionNote[] = ['enregistrer', 'publier', 'brouillon'];

/** L'état de la note après l'action : `enregistrer` garde l'état courant (brouillon pour une nouvelle note), les deux autres le posent. */
export const publieeApres = (action: ActionNote, courante: boolean): boolean => (action === 'publier' ? true : action === 'brouillon' ? false : courante);

/** L'état en clair, sur la liste et sur la fiche. */
export const libelleEtatNote = (publiee: boolean | number): string => (publiee ? 'Publié' : 'Brouillon');

export interface SaisieNote {
  slug: string;
  titre: string;
  chapeau: string | null;
  corps_md: string;
  date: string;
  publiee: boolean;
}

/** Crée la note si id est null, sinon la met à jour. Renvoie l'identifiant. */
export async function enregistrerNote(
  db: Base,
  tenantId: string,
  id: string | null,
  saisie: SaisieNote,
): Promise<string> {
  const n = { ...saisie, chapeau: saisie.chapeau === null ? null : normaliserSauts(saisie.chapeau), corps_md: normaliserSauts(saisie.corps_md) };
  if (id) {
    await db
      .prepare(
        `UPDATE note_marche SET slug = ?, titre = ?, chapeau = ?, corps_md = ?, date = ?, publiee = ?
          WHERE id = ? AND tenant_id = ?`,
      )
      .bind(n.slug, n.titre, n.chapeau, n.corps_md, n.date, n.publiee ? 1 : 0, id, tenantId)
      .run();
    return id;
  }
  const nouveau = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO note_marche (id, tenant_id, slug, langue, titre, chapeau, corps_md, date, publiee)
       VALUES (?, ?, ?, 'fr', ?, ?, ?, ?, ?)`,
    )
    .bind(nouveau, tenantId, n.slug, n.titre, n.chapeau, n.corps_md, n.date, n.publiee ? 1 : 0)
    .run();
  return nouveau;
}
