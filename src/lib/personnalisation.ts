// La personnalisation du site public et de l'espace d'un cabinet (22/11/2026) : quatre réglages SIMPLES et ENCADRÉS.
//
// Principe : le cabinet choisit parmi des options PRÉVUES. Jamais de CSS ni de HTML saisi, jamais une valeur transmise telle quelle :
//   - la couleur d'accent est un code #RRGGBB que le serveur valide, dont il CALCULE le contraste WCAG (refus d'une couleur illisible), puis dont
//     il dérive lui-même les jetons (--accent, --accent-clair, --sur-accent, --filet, --courbe-valeur) ;
//   - la police, la taille du texte et la forme des éléments sont des NOMS d'une liste fermée (trois, trois, deux) ; chacun correspond à un bloc
//     de src/styles/app.css, sélectionné par un attribut de <html> (data-cabinet-police, data-cabinet-taille, data-cabinet-forme).
// Valeur par défaut = le rendu d'aujourd'hui : un cabinet qui ne change rien ne voit aucune différence (aucun attribut n'est posé).
//
// Fichier PUR (aucune base) : les gabarits, l'écran des réglages (reglages.ts) et les tests s'y réfèrent.

import { THEMES, themeValide, type Theme } from './themes';

// ---------------------------------------------------------------- les listes fermées

export interface Option {
  id: string;
  libelle: string;
  description: string;
}

/**
 * Polices : trois paires construites avec les TROIS familles déjà embarquées par @fontsource (Newsreader, IBM Plex Sans, IBM Plex Mono) :
 * aucune dépendance ajoutée, aucun domaine externe appelé (la CSP à nonce reste intacte).
 */
export const POLICES: Option[] = [
  { id: 'classique', libelle: 'Classique', description: 'Titres et chiffres en Newsreader (empattement), texte en IBM Plex Sans : la paire actuelle.' },
  { id: 'moderne', libelle: 'Moderne', description: 'IBM Plex Sans partout, sans empattement, titres compris.' },
  { id: 'editoriale', libelle: 'Éditoriale', description: 'Newsreader partout, avec empattement, comme une revue : titres et texte courant.' },
];
export const POLICE_DEFAUT = 'classique';

/** Tailles du texte : trois crans appliqués à la taille de base (le rem). */
export const TAILLES: Option[] = [
  { id: 'standard', libelle: 'Standard', description: '16 px : la taille actuelle.' },
  { id: 'confortable', libelle: 'Confortable', description: '18 px : plus lisible, mise en page identique.' },
  { id: 'grand', libelle: 'Grand', description: '20 px : pour une lecture à distance ou une vue fatiguée.' },
];
export const TAILLE_DEFAUT = 'standard';

/** Forme des boutons, des champs et des cartes : un jeton de rayon (--rayon). */
export const FORMES: Option[] = [
  { id: 'anguleux', libelle: 'Anguleux', description: 'Angles droits : la forme actuelle.' },
  { id: 'arrondi', libelle: 'Arrondi', description: 'Angles légèrement arrondis.' },
];
export const FORME_DEFAUT = 'anguleux';

const connu = (liste: Option[], v: unknown, defaut: string): string => liste.find((o) => o.id === v)?.id ?? defaut;
export const policeValide = (v: unknown): string => connu(POLICES, v, POLICE_DEFAUT);
export const tailleValide = (v: unknown): string => connu(TAILLES, v, TAILLE_DEFAUT);
export const formeValide = (v: unknown): string => connu(FORMES, v, FORME_DEFAUT);
export const policeConnue = (v: unknown): string | null => POLICES.find((o) => o.id === v)?.id ?? null;
export const tailleConnue = (v: unknown): string | null => TAILLES.find((o) => o.id === v)?.id ?? null;
export const formeConnue = (v: unknown): string | null => FORMES.find((o) => o.id === v)?.id ?? null;

export interface Personnalisation {
  /** `#rrggbb` en minuscules, ou null : l'accent du thème. */
  accent: string | null;
  police: string;
  taille: string;
  forme: string;
}

export const PERSONNALISATION_DEFAUT: Personnalisation = { accent: null, police: POLICE_DEFAUT, taille: TAILLE_DEFAUT, forme: FORME_DEFAUT };

/** Un code #RRGGBB (six chiffres hexadécimaux, le dièse obligatoire), mis en minuscules ; null sinon. Aucune autre syntaxe de couleur n'est admise. */
export const normaliserHex = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(t) ? t.toLowerCase() : null;
};

/**
 * Ce que la base contient (clés `accent`, `police`, `taille_texte`, `forme_elements`) → une personnalisation SÛRE : une valeur absente, inconnue ou
 * mal formée retombe sur le défaut. Une page ne casse jamais à cause d'un réglage.
 */
export function lirePersonnalisation(lu: Record<string, string | null | undefined>): Personnalisation {
  return {
    accent: normaliserHex(lu.accent),
    police: policeValide(lu.police),
    taille: tailleValide(lu.taille_texte),
    forme: formeValide(lu.forme_elements),
  };
}

// ---------------------------------------------------------------- le contraste (WCAG 2.x)

type RVB = [number, number, number];

const versRvb = (hex: string): RVB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RVB;
const versHex = ([r, g, b]: RVB): string => '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');

/** Luminance relative d'une couleur #rrggbb (WCAG 2.x : sRGB linéarisé, 0 = noir, 1 = blanc). */
export function luminance(hex: string): number {
  const [r, g, b] = versRvb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG de deux couleurs #rrggbb, de 1 (identiques) à 21 (noir sur blanc). Symétrique. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Le seuil d'un texte, et celui d'un élément graphique (WCAG 1.4.3 et 1.4.11). */
export const SEUIL_TEXTE = 4.5;
export const SEUIL_GRAPHIQUE = 3;

const virgule = (n: number): string => (Math.floor(n * 10) / 10).toFixed(1).replace('.', ',');

// ---------------------------------------------------------------- l'accent d'un cabinet sur un thème

export interface JetonsAccent {
  accent: string;
  accentClair: string;
  /** Un jeton existant (`var(--fond)` ou `var(--texte)`) : aucune couleur nouvelle. */
  surAccent: string;
  filet: string;
  courbe: string;
}

export interface Mesures {
  /** Le texte d'accent (liens, étiquettes) sur le fond du thème, puis sur ses surfaces. */
  surFond: number;
  surMarine: number;
  /** Le texte posé sur un bouton plein. */
  surBouton: number;
}

export type EvaluationAccent =
  | { ok: true; jetons: JetonsAccent; mesures: Mesures }
  | { ok: false; raisons: string[]; mesures: Mesures };

const themeDe = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Mélange `a` vers `b` de `t` (0 à 1), canal par canal. */
const melanger = (a: string, b: string, t: number): string => {
  const [x, y] = [versRvb(a), versRvb(b)];
  return versHex(x.map((c, i) => c + (y[i] - c) * t) as RVB);
};

/**
 * Évalue une couleur d'accent sur un thème. Trois conditions, toutes calculées :
 *   1. l'accent, en TEXTE (liens, étiquettes), contraste ≥ 4,5:1 avec le fond ET avec les surfaces (--marine) du thème ;
 *   2. le texte posé sur un bouton plein (--sur-accent, pris parmi les jetons --fond et --texte du thème) contraste ≥ 4,5:1 avec l'accent ;
 *   3. l'accent, en élément graphique (bordure et aplat d'un bouton), contraste ≥ 3:1 avec le fond.
 * Rend les jetons dérivés (accent clair, filet, courbe) quand tout passe, sinon les raisons du refus, en français, chiffrées.
 */
export function evaluerAccent(accent: string, themeId: string): EvaluationAccent {
  const a = normaliserHex(accent);
  const t = themeDe(themeId);
  if (!a) return { ok: false, raisons: ['Un code couleur #RRGGBB est attendu (six chiffres hexadécimaux, par exemple #2a6f97).'], mesures: { surFond: 0, surMarine: 0, surBouton: 0 } };
  // Le texte du bouton : le jeton du thème qui contraste le plus avec l'accent.
  const candidats: [string, string][] = [['var(--fond)', t.fond], ['var(--texte)', t.texte]];
  const [surAccent, couleurSur] = candidats.reduce((m, c) => (contraste(c[1], a) > contraste(m[1], a) ? c : m));
  const mesures: Mesures = { surFond: contraste(a, t.fond), surMarine: contraste(a, t.marine), surBouton: contraste(couleurSur, a) };
  const raisons: string[] = [];
  if (mesures.surFond < SEUIL_TEXTE) raisons.push(`en texte sur le fond du thème « ${t.libelle} » : ${virgule(mesures.surFond)}:1, il faut au moins 4,5:1`);
  else if (mesures.surMarine < SEUIL_TEXTE) raisons.push(`en texte sur les surfaces du thème « ${t.libelle} » : ${virgule(mesures.surMarine)}:1, il faut au moins 4,5:1`);
  if (mesures.surBouton < SEUIL_TEXTE) raisons.push(`pour le texte d’un bouton plein : ${virgule(mesures.surBouton)}:1, il faut au moins 4,5:1`);
  if (mesures.surFond < SEUIL_GRAPHIQUE) raisons.push(`en bordure de bouton : ${virgule(mesures.surFond)}:1, il faut au moins 3:1`);
  if (raisons.length) return { ok: false, raisons, mesures };

  // L'accent « clair » (survol, texte d'information) : éclairci sur un thème sombre, assombri sur un thème clair, tant qu'il reste lisible.
  const vers = t.sombre ? '#ffffff' : '#000000';
  let accentClair = a;
  for (const k of [0.35, 0.25, 0.15, 0.05]) {
    const c = melanger(a, vers, k);
    if (contraste(c, t.fond) >= SEUIL_TEXTE && contraste(couleurSur, c) >= SEUIL_TEXTE) {
      accentClair = c;
      break;
    }
  }
  const [r, g, b] = versRvb(a);
  return { ok: true, mesures, jetons: { accent: a, accentClair, surAccent, filet: `rgba(${r}, ${g}, ${b}, ${t.sombre ? 0.26 : 0.32})`, courbe: accentClair } };
}

// ---------------------------------------------------------------- la couleur acceptable la plus proche

const hsl = (hex: string): [number, number, number] => {
  const [r, g, b] = versRvb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const depuisHsl = (h: number, s: number, l: number): string => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return versHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
};

/**
 * La couleur acceptable la plus proche : même teinte et même saturation, clarté déplacée du plus petit écart possible (d'abord dans le sens que
 * le thème favorise : plus claire sur un thème sombre, plus foncée sur un thème clair). Null si aucune ne convient (ne devrait pas arriver).
 */
export function couleurProche(accent: string, themeId: string): string | null {
  const a = normaliserHex(accent);
  if (!a) return null;
  const [h, s, l] = hsl(a);
  const sens = themeDe(themeId).sombre ? 1 : -1;
  for (let pas = 1; pas <= 100; pas++) {
    for (const d of [sens, -sens]) {
      const l2 = l + (d * pas) / 100;
      if (l2 < 0 || l2 > 1) continue;
      const c = depuisHsl(h, s, l2);
      if (evaluerAccent(c, themeId).ok) return c;
    }
  }
  return null;
}

/** Le message d'un refus : ce qui ne va pas, et la couleur proche acceptable quand il y en a une. */
export function messageRefusAccent(accent: string, themeId: string): string | null {
  const e = evaluerAccent(accent, themeId);
  if (e.ok) return null;
  const proche = normaliserHex(accent) ? couleurProche(accent, themeId) : null;
  return `Cette couleur est illisible : ${e.raisons.join(' ; ')}.${proche ? ` La couleur acceptable la plus proche est ${proche}.` : ''}`;
}

// ---------------------------------------------------------------- les attributs de <html>

/**
 * Les attributs que les QUATRE gabarits (site public, espace client, espace gestionnaire, connexion) posent sur <html>, à la suite de
 * `data-cabinet-theme`. Un réglage à sa valeur par défaut ne pose RIEN : le HTML d'un cabinet qui n'a rien changé est inchangé.
 * `avecAccent` est faux quand le client final a choisi son propre thème : le thème garde alors la priorité sur l'accent du cabinet.
 * Un accent illisible sur le thème EN VIGUEUR (le cabinet a changé de thème depuis) n'est pas posé : l'accent du thème reste.
 * Les valeurs du style sont des jetons recalculés par le serveur à partir du seul code #RRGGBB validé, jamais une saisie.
 */
export function attributsCabinet(p: Personnalisation | undefined, themeId: string, avecAccent = true): Record<string, string> {
  const sortie: Record<string, string> = {};
  if (!p) return sortie;
  if (p.police !== POLICE_DEFAUT) sortie['data-cabinet-police'] = policeValide(p.police);
  if (p.taille !== TAILLE_DEFAUT) sortie['data-cabinet-taille'] = tailleValide(p.taille);
  if (p.forme !== FORME_DEFAUT) sortie['data-cabinet-forme'] = formeValide(p.forme);
  if (p.accent && avecAccent) {
    const e = evaluerAccent(p.accent, themeValide(themeId));
    if (e.ok) {
      const j = e.jetons;
      sortie.style = `--accent:${j.accent};--accent-clair:${j.accentClair};--sur-accent:${j.surAccent};--filet:${j.filet};--courbe-valeur:${j.courbe}`;
    }
  }
  return sortie;
}
