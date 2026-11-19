// Cours de marché (lot 06). Récupérés CÔTÉ SERVEUR, jamais depuis le navigateur, et rangés dans la table
// `cours`, qui est globale : elle n'appartient à aucun cabinet.
//
// Récupération paresseuse : `assurerCours` est appelée à l'ouverture de la vue Actus. Aucune tâche planifiée.
// - Un appel par symbole et par jour au plus : un symbole déjà récupéré aujourd'hui, ou déjà tenté aujourd'hui
//   sans succès, n'est pas rappelé (le succès se lit dans `cours.recupere_le`, l'échec dans `incident`).
// - Le fournisseur (Alpha Vantage) autorise 25 requêtes par jour avec une clé gratuite, tous cabinets confondus :
//   au-delà, on n'en récupère pas plus et la raison est écrite dans `incident`.
// - Tout échec écrit une ligne dans `incident` et n'interrompt rien : la vue affiche la dernière valeur connue,
//   avec sa date.
//
// Ni interprétation ni génération de texte : les chiffres sont stockés tels que le fournisseur les rend ; la
// variation est une différence de deux de ses valeurs, ou la sienne.

import type { Base } from './db';
import type { Env } from './mail';

export type TypeSymbole = 'cotation' | 'change' | 'matiere';

/** Un symbole suivi par un cabinet (réglage `symboles`, un tableau JSON de ces objets). */
export interface SymboleSuivi {
  /** Identifiant stable, clé de `cours.symbole`. */
  cle: string;
  libelle: string;
  /** cotation : titre ou fonds coté (GLOBAL_QUOTE). change : paire de devises (FX_DAILY). matiere : série de matière première (BRENT…). */
  type: TypeSymbole;
  /** cotation : le symbole du fournisseur. change : « EUR/USD ». matiere : la fonction du fournisseur. */
  source: string;
}

/**
 * Les cinq symboles par défaut. Le fournisseur ne sert pas les indices en clé gratuite : les trois indices sont
 * suivis par un fonds coté qui les réplique, et le libellé le dit. Le cabinet peut les remplacer (réglage `symboles`).
 */
export const SYMBOLES_DEFAUT: SymboleSuivi[] = [
  { cle: 'cac40', libelle: 'CAC 40 · fonds CAC.PAR', type: 'cotation', source: 'CAC.PAR' },
  { cle: 'sp500', libelle: 'S&P 500 · fonds SPY', type: 'cotation', source: 'SPY' },
  { cle: 'nasdaq100', libelle: 'Nasdaq 100 · fonds QQQ', type: 'cotation', source: 'QQQ' },
  { cle: 'eurusd', libelle: 'EUR/USD', type: 'change', source: 'EUR/USD' },
  { cle: 'brent', libelle: 'Brent', type: 'matiere', source: 'BRENT' },
];

const URL_DEFAUT = 'https://www.alphavantage.co/query';
const BUDGET_DEFAUT = 25;
const DELAI_MS = 6000;

export const jourUtc = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------- symboles suivis

/** Symboles du cabinet : réglage `symboles` s'il est lisible, sinon les cinq par défaut. */
export async function symbolesDe(db: Base, tenantId: string): Promise<SymboleSuivi[]> {
  const r = await db
    .prepare("SELECT valeur FROM reglage WHERE tenant_id = ? AND cle = 'symboles'")
    .bind(tenantId)
    .first<{ valeur: string }>();
  if (!r) return SYMBOLES_DEFAUT;
  try {
    const v: unknown = JSON.parse(r.valeur);
    if (!Array.isArray(v) || v.length > 50) return SYMBOLES_DEFAUT;
    const out: SymboleSuivi[] = [];
    for (const x of v as Record<string, unknown>[]) {
      if (
        typeof x?.cle !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/.test(x.cle) ||
        typeof x.libelle !== 'string' || x.libelle.length === 0 || x.libelle.length > 80 ||
        (x.type !== 'cotation' && x.type !== 'change' && x.type !== 'matiere') ||
        typeof x.source !== 'string' || !/^[A-Za-z0-9_./-]{1,40}$/.test(x.source)
      ) return SYMBOLES_DEFAUT;
      out.push({ cle: x.cle, libelle: x.libelle, type: x.type, source: x.source });
    }
    return out.length ? out : SYMBOLES_DEFAUT;
  } catch {
    return SYMBOLES_DEFAUT;
  }
}

// ---------------------------------------------------------------- fournisseur

interface Releve {
  /** Date de la séance, AAAA-MM-JJ. */
  date: string;
  /** Valeur telle que rendue par le fournisseur. */
  valeur: string;
  /** Variation en centièmes de point de pourcentage. */
  variation_bp: number | null;
}

const nombre = (s: unknown): number | null => {
  const n = typeof s === 'string' ? Number(s.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
};
const enBp = (v: number | null, precedent: number | null): number | null =>
  v === null || precedent === null || precedent === 0 ? null : Math.round(((v - precedent) / Math.abs(precedent)) * 10000);

/** Corps JSON du fournisseur → relevé, ou lève l'erreur qui sera écrite dans `incident`. */
function lire(s: SymboleSuivi, corps: Record<string, unknown>): Releve {
  const motif = ['Error Message', 'Information', 'Note'].map((k) => corps[k]).find((x) => typeof x === 'string');
  if (typeof motif === 'string') throw new Error(`Fournisseur : ${motif.slice(0, 300)}`);

  if (s.type === 'cotation') {
    const q = corps['Global Quote'] as Record<string, string> | undefined;
    const valeur = q?.['05. price'];
    const date = q?.['07. latest trading day'];
    if (!q || !valeur || nombre(valeur) === null || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Fournisseur : aucune cotation pour ce symbole.');
    }
    const pct = nombre((q['10. change percent'] ?? '').replace('%', ''));
    return { date, valeur: valeur.trim(), variation_bp: pct === null ? null : Math.round(pct * 100) };
  }

  // Séries : le plus récent et le précédent, dont l'écart donne la variation.
  let points: { date: string; valeur: string }[];
  if (s.type === 'change') {
    const serie = corps['Time Series FX (Daily)'] as Record<string, Record<string, string>> | undefined;
    points = Object.entries(serie ?? {}).map(([date, o]) => ({ date, valeur: o?.['4. close'] ?? '' }));
  } else {
    const data = corps.data as { date?: string; value?: string }[] | undefined;
    points = (Array.isArray(data) ? data : []).map((o) => ({ date: o?.date ?? '', valeur: o?.value ?? '' }));
  }
  points = points
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && nombre(p.valeur) !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (points.length === 0) throw new Error('Fournisseur : aucune valeur pour ce symbole.');
  return {
    date: points[0].date,
    valeur: points[0].valeur.trim(),
    variation_bp: enBp(nombre(points[0].valeur), points[1] ? nombre(points[1].valeur) : null),
  };
}

function adresse(s: SymboleSuivi, cle: string, base: string): string {
  const p = new URLSearchParams();
  if (s.type === 'cotation') {
    p.set('function', 'GLOBAL_QUOTE');
    p.set('symbol', s.source);
  } else if (s.type === 'change') {
    const [de, vers] = s.source.split('/');
    p.set('function', 'FX_DAILY');
    p.set('from_symbol', de ?? '');
    p.set('to_symbol', vers ?? '');
  } else {
    p.set('function', s.source);
    p.set('interval', 'daily');
  }
  p.set('apikey', cle);
  return `${base}?${p.toString()}`;
}

async function appeler(s: SymboleSuivi, cle: string, base: string): Promise<Releve> {
  let r: Response;
  try {
    r = await fetch(adresse(s, cle, base), { signal: AbortSignal.timeout(DELAI_MS), headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new Error(`Appel impossible : ${e instanceof Error ? e.name : 'erreur réseau'}.`);
  }
  if (!r.ok) throw new Error(`Fournisseur : réponse HTTP ${r.status}.`);
  let corps: Record<string, unknown>;
  try {
    corps = (await r.json()) as Record<string, unknown>;
  } catch {
    throw new Error('Fournisseur : réponse illisible.');
  }
  return lire(s, corps);
}

// ---------------------------------------------------------------- récupération paresseuse

const enVol = new Map<string, Promise<void>>();

async function incident(db: Base, id: string, tenantId: string, quoi: string, detail: string): Promise<void> {
  try {
    // Id déterministe : au plus une ligne par cause et par jour, même si la vue s'ouvre dix fois.
    await db
      .prepare('INSERT OR IGNORE INTO incident (id, tenant_id, quoi, detail, cree_le) VALUES (?, ?, ?, ?, ?)')
      .bind(id, tenantId, quoi, detail, new Date().toISOString())
      .run();
  } catch (e) {
    console.error('incident non écrit', quoi, e instanceof Error ? e.message : e);
  }
}

async function nombreDe(db: Base, sql: string, ...valeurs: unknown[]): Promise<number> {
  const r = await db.prepare(sql).bind(...valeurs).first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Récupère, parmi `symboles`, ceux dont le cours du jour manque : pas encore récupérés aujourd'hui, pas encore
 * tentés aujourd'hui. Ne lève jamais. Sans clé d'API, rien n'est appelé : une ligne dans `incident`, et la vue le dit.
 */
export async function assurerCours(db: Base, env: Env, tenantId: string, symboles: SymboleSuivi[]): Promise<void> {
  try {
    const jour = jourUtc();
    const ids = symboles.map((s) => s.cle);
    if (ids.length === 0) return;
    const marques = ids.map(() => '?').join(', ');

    const faits = await db
      .prepare(`SELECT DISTINCT symbole FROM cours WHERE recupere_le >= ? AND symbole IN (${marques})`)
      .bind(jour, ...ids)
      .all<{ symbole: string }>();
    const tentes = await db
      .prepare(`SELECT quoi FROM incident WHERE id IN (${marques})`)
      .bind(...ids.map((c) => `echec:${c}:${jour}`))
      .all<{ quoi: string }>();
    const dejaVus = new Set([...faits.results.map((r) => r.symbole), ...tentes.results.map((r) => r.quoi.slice('cours_echec:'.length))]);
    const manquants = symboles.filter((s) => !dejaVus.has(s.cle));
    if (manquants.length === 0) return;

    const cle = env.COURS_API_KEY?.trim();
    if (!cle) {
      await incident(db, `cle:${tenantId}:${jour}`, tenantId, 'cours_cle', "Clé d'API des cours absente (COURS_API_KEY) : aucun cours récupéré.");
      return;
    }

    // Budget du fournisseur, tous cabinets confondus : appels déjà faits aujourd'hui = cours écrits + échecs.
    const budget = Number(env.COURS_BUDGET) > 0 ? Number(env.COURS_BUDGET) : BUDGET_DEFAUT;
    const utilises =
      (await nombreDe(db, 'SELECT COUNT(*) AS n FROM cours WHERE recupere_le >= ?', jour)) +
      (await nombreDe(db, "SELECT COUNT(*) AS n FROM incident WHERE quoi LIKE 'cours_echec:%' AND cree_le >= ?", jour));
    const restant = Math.max(0, budget - utilises);
    const aAppeler = manquants.slice(0, restant);
    const laisses = manquants.slice(aAppeler.length);
    if (laisses.length > 0) {
      await incident(db, `budget:${tenantId}:${jour}`, tenantId, 'cours_budget',
        `Budget du fournisseur : ${budget} appels par jour, ${utilises} déjà faits aujourd'hui. Non récupérés : ${laisses.map((s) => s.cle).join(', ')}.`);
    }

    const base = env.COURS_API_URL?.trim() || URL_DEFAUT;
    await Promise.all(
      aAppeler.map((s) => {
        const k = `${s.cle}:${jour}`;
        let p = enVol.get(k);
        if (!p) {
          p = recuperer(db, tenantId, s, cle, base, jour).finally(() => enVol.delete(k));
          enVol.set(k, p);
        }
        return p;
      }),
    );
  } catch (e) {
    console.error('cours', e instanceof Error ? e.message : e);
  }
}

async function recuperer(db: Base, tenantId: string, s: SymboleSuivi, cle: string, base: string, jour: string): Promise<void> {
  try {
    const r = await appeler(s, cle, base);
    await db
      .prepare(
        `INSERT INTO cours (symbole, date, valeur, variation_bp, sens, recupere_le) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbole, date) DO UPDATE SET valeur = excluded.valeur, variation_bp = excluded.variation_bp,
           sens = excluded.sens, recupere_le = excluded.recupere_le`,
      )
      .bind(s.cle, r.date, r.valeur, r.variation_bp, sensDe(r.variation_bp), new Date().toISOString())
      .run();
  } catch (e) {
    const message = (e instanceof Error ? e.message : 'erreur').split(cle).join('***');
    await incident(db, `echec:${s.cle}:${jour}`, tenantId, `cours_echec:${s.cle}`, `${s.libelle} : ${message}`);
  }
}

// ---------------------------------------------------------------- lecture

export type Sens = 'hausse' | 'baisse' | 'stable';
const sensDe = (bp: number | null): Sens | null => (bp === null ? null : bp > 0 ? 'hausse' : bp < 0 ? 'baisse' : 'stable');

export interface CoursLu {
  cle: string;
  libelle: string;
  valeur: string;
  date: string;
  variation_bp: number | null;
  sens: Sens | null;
  recupere_le: string;
}

/** Dernière valeur connue de chaque symbole à la date `jusquA` (incluse), avec la date de sa séance. Un symbole sans cours est absent. */
export async function derniersCours(db: Base, symboles: SymboleSuivi[], jusquA: string): Promise<CoursLu[]> {
  const lignes = await Promise.all(
    symboles.map((s) =>
      db
        .prepare('SELECT date, valeur, variation_bp, sens, recupere_le FROM cours WHERE symbole = ? AND date <= ? ORDER BY date DESC LIMIT 1')
        .bind(s.cle, jusquA)
        .first<Omit<CoursLu, 'cle' | 'libelle'>>()
        .then((r) => (r ? { cle: s.cle, libelle: s.libelle, ...r } : null)),
    ),
  );
  return lignes.filter((x): x is CoursLu => x !== null);
}

/** Incidents de cours du jour pour ce cabinet : de quoi dire à l'écran ce qui n'a pas pu être récupéré. */
export async function incidentsCours(db: Base, tenantId: string, jour: string): Promise<{ quoi: string; detail: string | null }[]> {
  const { results } = await db
    .prepare("SELECT quoi, detail FROM incident WHERE tenant_id = ? AND quoi LIKE 'cours%' AND cree_le >= ? ORDER BY cree_le, id")
    .bind(tenantId, jour)
    .all<{ quoi: string; detail: string | null }>();
  return results;
}

// ---------------------------------------------------------------- mise en forme

/**
 * Un indice représenté par un fonds coté (libellé « … · fonds SPY ») : le prix du fonds, 80 € sous le titre
 * « CAC 40 », n'apprend rien et déroute. Pour ces symboles on n'affiche que la variation et la date de séance.
 * Les autres (indices cotés en points, changes, matières) gardent valeur et variation.
 */
export const variationSeule = (s: Pick<SymboleSuivi, 'type' | 'libelle'>): boolean => s.type === 'cotation' && /\bfonds\b/i.test(s.libelle);

const NOMBRE = (d: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const POURCENT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });

/** « 512.3400 » → « 512,34 » ; deux décimales au moins, quatre au plus (les devises en gardent quatre). */
export function formaterValeur(brut: string): string {
  const n = Number(brut);
  if (!Number.isFinite(n)) return brut;
  const utiles = (brut.split('.')[1] ?? '').replace(/0+$/, '').length;
  return NOMBRE(Math.min(4, Math.max(2, utiles))).format(n);
}

export const formaterVariation = (bp: number | null): string => (bp === null ? '—' : `${POURCENT.format(bp / 100)} %`);
export const SYMBOLE_SENS: Record<Sens, string> = { hausse: '▲', baisse: '▼', stable: '=' };
