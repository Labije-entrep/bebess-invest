// Le bloc « Marchés » de l'écran Actus : séries de la table `cours`, fenêtres de période, performances, base 100 et géométrie des
// courbes (SVG rendu côté serveur, sans JavaScript). Tout est déterministe et pur, sauf `lireSeries` qui lit la base.
// Aucun texte n'est produit : les chiffres sont ceux du fournisseur, la performance est une différence de deux de ses valeurs.

import type { Base } from './db';
import type { SymboleSuivi } from './cours';

export interface Point {
  date: string;
  valeur: number;
}

export type Periode = '1s' | '1m' | '3m';
/** Séances par période, comme le prototype : 6, 22 et 64 séances (le point de départ compte, d'où une variation sur 5, 21 et 63 séances). */
export const PERIODES: Record<Periode, { n: number; court: string; long: string }> = {
  '1s': { n: 6, court: '1 semaine', long: 'sur 1 semaine' },
  '1m': { n: 22, court: '1 mois', long: 'sur 1 mois' },
  '3m': { n: 64, court: '3 mois', long: 'sur 3 mois' },
};
export const PERIODE_DEFAUT: Periode = '1m';
export const periodeDe = (s: string | null): Periode => (s === '1s' || s === '1m' || s === '3m' ? s : PERIODE_DEFAUT);

// ---------------------------------------------------------------- lecture

/** Les séances d'un symbole, de la plus ancienne à la plus récente, jusqu'à la date `jusquA` incluse. */
export async function lireSeries(db: Base, symboles: SymboleSuivi[], jusquA: string, limite = 130): Promise<Map<string, Point[]>> {
  const out = new Map<string, Point[]>();
  await Promise.all(
    symboles.map(async (s) => {
      const { results } = await db
        .prepare('SELECT date, valeur FROM cours WHERE symbole = ? AND date <= ? ORDER BY date DESC LIMIT ?')
        .bind(s.cle, jusquA, limite)
        .all<{ date: string; valeur: string }>();
      const pts = results
        .map((r) => ({ date: r.date, valeur: Number(r.valeur) }))
        .filter((p) => Number.isFinite(p.valeur))
        .reverse();
      out.set(s.cle, pts);
    }),
  );
  return out;
}

// ---------------------------------------------------------------- calculs purs

/** Les `n` dernières séances. */
export const fenetre = (pts: Point[], n: number): Point[] => pts.slice(-n);

/** Performance sur la fenêtre, en centièmes de point de pourcentage (+312 = +3,12 %) ; null s'il manque de quoi la calculer. */
export function performance(pts: Point[]): number | null {
  if (pts.length < 2 || pts[0].valeur === 0) return null;
  return Math.round((pts[pts.length - 1].valeur / pts[0].valeur - 1) * 10000);
}

/** Variation de la dernière séance par rapport à la précédente (de la série entière, pas de la fenêtre), en centièmes de point. */
export function variationJour(pts: Point[]): number | null {
  if (pts.length < 2 || pts[pts.length - 2].valeur === 0) return null;
  return Math.round((pts[pts.length - 1].valeur / pts[pts.length - 2].valeur - 1) * 10000);
}

/** La série rebasée : 100 à sa première séance. */
export function baseCent(pts: Point[]): Point[] {
  if (pts.length === 0 || pts[0].valeur === 0) return [];
  const base = pts[0].valeur;
  return pts.map((p) => ({ date: p.date, valeur: (p.valeur / base) * 100 }));
}

/** Devise d'affichage, déduite du symbole du fournisseur (pas de réglage de plus) : suffixe de place pour les cotations, devise cotée pour un change. */
export function deviseDe(s: Pick<SymboleSuivi, 'type' | 'source'>): string {
  if (s.type === 'change') return ({ USD: '$', EUR: '€', GBP: '£', JPY: '¥', CHF: 'CHF' } as Record<string, string>)[(s.source.split('/')[1] ?? '').toUpperCase()] ?? (s.source.split('/')[1] ?? '');
  if (s.type === 'matiere') return '$';
  const suffixe = (s.source.split('.')[1] ?? '').toUpperCase();
  if (['PA', 'PAR', 'DE', 'DEX', 'AMS', 'MIL', 'MAD', 'BRU', 'LIS'].includes(suffixe)) return '€';
  if (suffixe === 'LON') return '£';
  return '$';
}

// ---------------------------------------------------------------- géométrie

/** Index (0 à 4) → jeton de couleur de série, et motif de trait : la couleur ne porte jamais seule l'identité d'une courbe. */
export const jetonSerie = (i: number): string => `var(--serie-${(i % 5) + 1})`;
export const MOTIFS_TRAIT = [undefined, '7 4', '2 4', '10 3 2 3', '4 4'] as const;
export const motifTrait = (i: number): string | undefined => MOTIFS_TRAIT[i % 5];

export interface Mini {
  largeur: number;
  hauteur: number;
  /** Tracé de la ligne et de l'aire sous elle. */
  ligne: string;
  aire: string;
  fin: { x: number; y: number };
}

/** Mini-courbe d'une carte. `null` s'il y a moins de deux séances. */
export function miniCourbe(pts: Point[], largeur = 300, hauteur = 70): Mini | null {
  if (pts.length < 2) return null;
  const haut = 6, bas = 6;
  const vals = pts.map((p) => p.valeur);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const x = (i: number) => (i * largeur) / (pts.length - 1);
  const y = (v: number) => haut + ((hi - v) * (hauteur - haut - bas)) / (hi - lo);
  const ligne = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valeur).toFixed(1)}`).join(' ');
  return {
    largeur, hauteur, ligne,
    aire: `${ligne} L${largeur},${hauteur} L0,${hauteur} Z`,
    fin: { x: x(pts.length - 1), y: y(vals[vals.length - 1]) },
  };
}

export interface SerieComparee {
  cle: string;
  libelle: string;
  d: string;
  fin: { x: number; y: number; valeur: number };
  /** Ordonnée de l'étiquette de fin, écartée de celles des voisines pour qu'elles ne se recouvrent pas. */
  y_etiquette: number;
  /** Dernière valeur rebasée, pour la légende lisible sans la couleur. */
  derniere: number;
  perf: number | null;
}
export interface Comparaison {
  largeur: number;
  hauteur: number;
  gauche: number;
  droite: number;
  bas: number;
  haut: number;
  grille: { y: number; valeur: number }[];
  reperes: { x: number; date: string; ancre: 'start' | 'middle' | 'end' }[];
  series: SerieComparee[];
  /** Première date du graphique : la base 100. */
  base_le: string;
  /** Repères d'actus tombant dans la fenêtre. */
  actus: { x: number; date: string; titre: string }[];
}

/**
 * Courbes rebasées sur 100 à la première séance de la fenêtre de CHAQUE série, sur une même échelle de dates.
 * Il faut deux séances au moins par série ; une série plus courte est ignorée. `null` si aucune ne reste.
 */
export function comparer(
  entrees: { cle: string; libelle: string; pts: Point[] }[], actus: { date: string; titre: string }[] = [],
): Comparaison | null {
  const retenues = entrees.filter((e) => e.pts.length >= 2);
  if (retenues.length === 0) return null;
  const dates = [...new Set(retenues.flatMap((e) => e.pts.map((p) => p.date)))].sort();
  const largeur = 1000, hauteur = 280, gauche = 56, droite = 150, haut = 18, bas = 246;
  const rebasees = retenues.map((e) => ({ e, pts: baseCent(e.pts) }));
  const tous = rebasees.flatMap((r) => r.pts.map((p) => p.valeur));
  let lo = Math.min(100, ...tous), hi = Math.max(100, ...tous);
  const marge = (hi - lo) * 0.08 || 1;
  lo -= marge; hi += marge;
  const x = (d: string) => gauche + (dates.indexOf(d) * (largeur - gauche - droite)) / Math.max(1, dates.length - 1);
  const y = (v: number) => haut + ((hi - v) * (bas - haut)) / (hi - lo);
  const series = rebasees.map(({ e, pts }): SerieComparee => {
    const dernier = pts[pts.length - 1];
    return {
      cle: e.cle, libelle: e.libelle,
      d: pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.valeur).toFixed(1)}`).join(' '),
      fin: { x: x(dernier.date), y: y(dernier.valeur), valeur: dernier.valeur },
      derniere: dernier.valeur,
      perf: performance(e.pts),
      y_etiquette: 0,
    };
  });
  // Étiquettes de fin : au moins 14 unités d'écart, dans l'ordre vertical des courbes.
  const parY = [...series].sort((a, b) => a.fin.y - b.fin.y);
  parY.forEach((s, i) => { s.y_etiquette = i === 0 ? s.fin.y : Math.max(s.fin.y, parY[i - 1].y_etiquette + 14); });
  const valeursGrille = [lo + marge, 100, hi - marge].filter((v, i, a) => a.findIndex((w) => Math.abs(w - v) < (hi - lo) * 0.06) === i);
  const milieu = dates[Math.floor((dates.length - 1) / 2)];
  const reperes = [
    { x: x(dates[0]), date: dates[0], ancre: 'start' as const },
    ...(dates.length > 2 ? [{ x: x(milieu), date: milieu, ancre: 'middle' as const }] : []),
    { x: x(dates[dates.length - 1]), date: dates[dates.length - 1], ancre: 'end' as const },
  ];
  const reperesActus = actus
    .filter((a) => a.date >= dates[0] && a.date <= dates[dates.length - 1])
    .map((a) => {
      const i = dates.findIndex((d) => d >= a.date);
      return { x: x(dates[i < 0 ? dates.length - 1 : i]), date: a.date, titre: a.titre };
    });
  return {
    largeur, hauteur, gauche, droite: largeur - droite, bas, haut,
    grille: valeursGrille.map((v) => ({ y: y(v), valeur: v })),
    reperes, series, base_le: dates[0], actus: reperesActus,
  };
}
