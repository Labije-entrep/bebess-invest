// Calculs de l'espace viewer. Déterministe, entiers pour l'argent (centimes) et les parts
// (centièmes de point). Seules les coordonnées du graphique sont décimales.

import type { Base, Cible, Enveloppe, Ligne, Point } from './db';
import { dateLongue, euros, moisAn, pourcent } from './format';

/** Une ligne par page vue, jamais purgée. */
export async function journaliser(db: Base, viewerId: string, chemin: string): Promise<void> {
  await db
    .prepare('INSERT INTO consultation (id, viewer_id, vue_le, page) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), viewerId, new Date().toISOString(), chemin)
    .run();
}

/** Valeur signée : "+1 200 €", "−300 €", "0,00 €". */
export function signe(cents: number): string {
  return cents > 0 ? `+${euros(cents)}` : euros(cents);
}
export function signeBp(bp: number): string {
  return bp > 0 ? `+${pourcent(bp)}` : pourcent(bp);
}
export function teinte(n: number | null): string {
  if (n === null || n === 0) return '';
  return n > 0 ? 'pos' : 'neg';
}

/** "2026-11-15T09:30:00Z" -> "15 novembre 2026 à 09h30" ; sans heure : la date seule. */
export function arrete(iso: string): string {
  return iso.length > 10 ? `${dateLongue(iso)} à ${iso.slice(11, 16).replace(':', 'h')}` : dateLongue(iso);
}

export function plusRecent(valeurs: string[]): string | null {
  return valeurs.length ? valeurs.reduce((a, b) => (a > b ? a : b)) : null;
}

export function partBp(montant: number, total: number): number {
  return total > 0 ? Math.round((montant * 10000) / total) : 0;
}

// ---------- Chiffres clés ----------

export interface Indicateurs {
  totalCents: number;
  /** Performance de l'année civile, pondérée par le temps (centièmes de point). */
  perfBp: number | null;
  /** Performance depuis le premier point, même méthode. */
  perfOrigineBp: number | null;
  annee: string | null;
  pvCents: number;
  versementsCents: number | null;
}

/**
 * Enchaînement des rendements mensuels entre points[depuis] et points[jusqua] :
 * r = (valeur − valeur précédente − flux) / valeur précédente, flux = variation des
 * versements cumulés. Un mois dont la valeur précédente est nulle est ignoré.
 * Renvoie des centièmes de point, ou null s'il n'y a aucun mois calculable.
 */
export function performanceEnchainee(points: Point[], depuis: number, jusqua: number): number | null {
  let produit = 1;
  let mois = 0;
  for (let i = depuis + 1; i <= jusqua; i++) {
    const avant = points[i - 1].valeur_cents;
    if (avant === 0) continue;
    const flux = points[i].versements_cumules_cents - points[i - 1].versements_cumules_cents;
    produit *= 1 + (points[i].valeur_cents - avant - flux) / avant;
    mois++;
  }
  return mois === 0 ? null : Math.round((produit - 1) * 10000);
}

export function indicateurs(points: Point[], enveloppes: Enveloppe[], lignes: Ligne[]): Indicateurs {
  const dernier = points.length ? points[points.length - 1] : null;
  const totalEnv = enveloppes.reduce((s, e) => s + e.valorisation_cents, 0);
  const totalCents = enveloppes.length ? totalEnv : (dernier?.valeur_cents ?? 0);
  const pvCents = lignes.reduce((s, l) => s + (l.pv_cents ?? 0), 0);

  let perfBp: number | null = null;
  let perfOrigineBp: number | null = null;
  let versementsCents: number | null = null;
  let annee: string | null = null;
  if (dernier) {
    annee = dernier.date.slice(0, 4);
    const debut = `${annee}-01-01`;
    const fin = points.length - 1;
    // Base de l'année : dernier point avant le 1er janvier ; à défaut, le tout premier point.
    let base = 0;
    points.forEach((p, i) => { if (p.date < debut) base = i; });
    if (base < fin) {
      versementsCents = dernier.versements_cumules_cents - points[base].versements_cumules_cents;
      perfBp = performanceEnchainee(points, base, fin);
    }
    perfOrigineBp = performanceEnchainee(points, 0, fin);
  }
  return { totalCents, perfBp, perfOrigineBp, annee, pvCents, versementsCents };
}

// ---------- Répartition ----------

export interface Classe {
  classe: string;
  montant: number;
  partBp: number;
  cibleBp: number | null;
  ecartBp: number | null;
  couleur: string;
}

const COULEURS = ['#B9862B', '#4E9BD6', '#C9684E', '#3FA98A', '#9B7BD4'];

export function repartition(lignes: Ligne[], cibles: Cible[]): Classe[] {
  const total = lignes.reduce((s, l) => s + l.valorisation_cents, 0);
  const montants = new Map<string, number>();
  for (const l of lignes) montants.set(l.classe, (montants.get(l.classe) ?? 0) + l.valorisation_cents);

  // Ordre : celui des cibles, puis les classes détenues sans cible, par montant décroissant.
  const ordre = cibles.map((c) => c.classe);
  const autres = [...montants.keys()].filter((c) => !ordre.includes(c));
  autres.sort((a, b) => (montants.get(b) ?? 0) - (montants.get(a) ?? 0));

  return [...ordre, ...autres].map((classe, i) => {
    const montant = montants.get(classe) ?? 0;
    const part = partBp(montant, total);
    const cible = cibles.find((c) => c.classe === classe)?.cible_bp ?? null;
    return {
      classe,
      montant,
      partBp: part,
      cibleBp: cible,
      ecartBp: cible === null ? null : part - cible,
      couleur: COULEURS[i % COULEURS.length],
    };
  });
}

// ---------- Courbe ----------

// Nombre de jours depuis une origine fixe (algorithme civil), sans objet Date.
function jours(iso: string): number {
  const [a, m, j] = iso.slice(0, 10).split('-').map(Number);
  const y = m <= 2 ? a - 1 : a;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + j - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
}

/** Pas de grille "rond" (en centimes) tel que 4 pas couvrent le maximum. */
function pasPropre(maxCents: number): number {
  const brut = Math.max(maxCents, 400) / 4;
  const p = 10 ** Math.floor(Math.log10(brut));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= brut) return Math.ceil(k * p);
  return Math.ceil(10 * p);
}

export interface Serie {
  nom: string;
  couleur: string;
  tirets: boolean;
  d: string;
  fin: { x: number; yNom: number; yValeur: number; valeur: string };
}
export interface Courbe {
  largeur: number;
  hauteur: number;
  gauche: number;
  droite: number;
  bas: number;
  grille: { y: number; libelle: string }[];
  reperes: { x: number; libelle: string; ancre: 'start' | 'middle' | 'end' }[];
  series: Serie[];
}

const N = (x: number) => x.toFixed(2);

export function courbe(points: Point[]): Courbe | null {
  if (points.length < 2) return null;
  const W = 720, H = 300, G = 72, D = 130, T = 16, B = 32;
  const pw = W - G - D;
  const ph = H - T - B;
  const j0 = jours(points[0].date);
  const j1 = jours(points[points.length - 1].date);
  if (j1 <= j0) return null;

  const maxCents = Math.max(...points.map((p) => Math.max(p.valeur_cents, p.versements_cumules_cents)));
  const pas = pasPropre(maxCents);
  const haut = pas * 4;

  const x = (iso: string) => G + ((jours(iso) - j0) / (j1 - j0)) * pw;
  const y = (cents: number) => T + ph - (cents / haut) * ph;

  const grille = [1, 2, 3, 4].map((i) => ({ y: y(pas * i), libelle: euros(pas * i) }));

  const idx = [0, Math.round((points.length - 1) / 3), Math.round(((points.length - 1) * 2) / 3), points.length - 1];
  const reperes = idx.map((i, k) => ({
    x: x(points[i].date),
    libelle: moisAn(points[i].date),
    ancre: (k === 0 ? 'start' : k === 3 ? 'end' : 'middle') as 'start' | 'middle' | 'end',
  }));

  const dernier = points[points.length - 1];
  const defs = [
    { nom: 'Valorisation', couleur: '#DCBF88', tirets: false, val: (p: Point) => p.valeur_cents },
    { nom: 'Versements cumulés', couleur: '#7C8AA0', tirets: true, val: (p: Point) => p.versements_cumules_cents },
  ];
  const series: Serie[] = defs.map((s) => ({
    nom: s.nom,
    couleur: s.couleur,
    tirets: s.tirets,
    d: points.map((p, i) => `${i === 0 ? 'M' : 'L'}${N(x(p.date))} ${N(y(s.val(p)))}`).join(' '),
    fin: { x: x(dernier.date), yNom: 0, yValeur: y(s.val(dernier)), valeur: euros(s.val(dernier)) },
  }));

  // Étiquettes de fin : au moins 30 px d'écart pour qu'elles ne se chevauchent pas.
  const [a, b] = series;
  const ecart = Math.abs(a.fin.yValeur - b.fin.yValeur);
  if (ecart < 30) {
    const delta = (30 - ecart) / 2;
    const hautS = a.fin.yValeur <= b.fin.yValeur ? a : b;
    const basS = hautS === a ? b : a;
    hautS.fin.yValeur -= delta;
    basS.fin.yValeur += delta;
  }
  for (const s of series) {
    s.fin.yValeur = Math.min(Math.max(s.fin.yValeur, T + 16), T + ph);
    s.fin.yNom = s.fin.yValeur - 14;
  }

  return { largeur: W, hauteur: H, gauche: G, droite: W - D, bas: T + ph, grille, reperes, series };
}
