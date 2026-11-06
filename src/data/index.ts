/* Chargement des contenus YAML au moment du build.
   Les contenus anglais ne comportent que les champs a traduire : tout
   champ absent reprend la valeur francaise (telephone, numero ORIAS,
   adresse e-mail...), ce qui evite de maintenir deux fois la meme
   information. */
import yaml from 'js-yaml';
import type { Langue } from '../i18n/config';

export const MARQUEUR = 'A COMPLETER';

/* Retire le prefixe de marquage. A utiliser partout ou le texte ne peut
   pas etre mis en valeur visuellement : balise <title>, meta description,
   donnees structurees, options d'un <select>. */
export const nettoyer = (v: string) =>
  typeof v === 'string' && v.startsWith(MARQUEUR)
    ? v.slice(MARQUEUR.length).replace(/^\s*:\s*/, '')
    : v;

const fichiers = import.meta.glob('./*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

import siteYaml from './site.yaml?raw';

const lire = (chemin: string) => yaml.load(fichiers[chemin] ?? '') ?? {};

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/* Fusion profonde : la base francaise, surchargee par la langue demandee. */
function fusionner<T>(base: T, surcharge: unknown): T {
  if (!estObjet(surcharge)) return (surcharge ?? base) as T;
  if (!estObjet(base)) return surcharge as T;
  const sortie: Record<string, unknown> = { ...base };
  for (const [cle, valeur] of Object.entries(surcharge)) {
    sortie[cle] = cle in base ? fusionner((base as Record<string, unknown>)[cle], valeur) : valeur;
  }
  return sortie as T;
}

export interface Cabinet {
  nom: string; baseline: string; accroche: string; accrocheAccent: string; resume: string;
  dirigeant: { nom: string; titre: string; accroche: string; faits: string[]; portrait: string; portraitAlt: string };
  contact: {
    email: string; telephone: string; adresse: string; codePostalVille: string; ville: string;
    linkedin: string; delaiReponse: string; endpointFormulaire: string; lienRendezVous: string;
  };
  legal: Record<string, string>;
  preuves: { titre: string; texte: string }[];
  missions: { etiquette: string; titre: string; texte: string }[];
  methode: { titre: string; texte: string }[];
  honoraires: { etiquette: string; montant: string; texte: string }[];
  clienteles: { etiquette: string; titre: string; texte: string }[];
  jalons: { annee: string; titre: string; lieu: string; texte: string }[];
  convictions: { rang: string; titre: string; texte: string }[];
  faq: { question: string; reponse: string }[];
  objetsContact: string[];
}

export interface Seo { titre: string; description: string }
export type ClePage = 'accueil' | 'approche' | 'parcours' | 'notes' | 'contact' | 'mentions';

export interface Site {
  langueParDefaut: Langue;
  langues: Record<Langue, { publie: boolean }>;
}

export const site = yaml.load(siteYaml) as Site;

const cabinetFr = lire('./fr/cabinet.yaml') as Cabinet;
const seoFr = lire('./fr/seo.yaml') as Record<ClePage, Seo>;

export const getCabinet = (langue: Langue): Cabinet =>
  langue === 'fr' ? cabinetFr : fusionner(cabinetFr, lire(`./${langue}/cabinet.yaml`));

export const getSeo = (langue: Langue): Record<ClePage, Seo> =>
  langue === 'fr' ? seoFr : fusionner(seoFr, lire(`./${langue}/seo.yaml`));

/* Une langue n'apparait dans le selecteur et dans le sitemap
   que si elle est declaree publiee dans site.yaml. */
export const languePubliee = (langue: Langue) => site.langues[langue]?.publie === true;
