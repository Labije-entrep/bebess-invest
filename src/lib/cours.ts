// Cours de marché (lot 06). Récupérés CÔTÉ SERVEUR, jamais depuis le navigateur, et rangés dans la table
// `cours`, qui est globale : elle n'appartient à aucun cabinet.
//
// Deux chemins, un même code (`recupererManquants`) :
// - le traitement quotidien (src/lib/traitement.ts, travail « cours ») récupère CHAQUE NUIT l'union des symboles de tous les cabinets ;
// - `assurerCours`, appelée à l'ouverture de la vue Actus, est le filet : elle ne rappelle rien de ce qui a déjà été fait aujourd'hui.
// - Un appel par symbole et par jour au plus, qui rend plusieurs jours d'historique : tous les points reçus sont rangés (la table `cours`
//   est la source des courbes de l'écran Actus) : un symbole déjà récupéré aujourd'hui, ou déjà tenté aujourd'hui
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
  /** cotation : titre ou fonds coté (TIME_SERIES_DAILY). change : paire de devises (FX_DAILY). matiere : série de matière première (BRENT…). */
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
/** Pause entre deux appels successifs du traitement quotidien (le fournisseur limite aussi le débit). COURS_PAUSE_MS la remplace. */
const PAUSE_MS = 1300;
/** Nombre de séances gardées par appel : de quoi tracer 3 mois (64 séances) avec de la marge. */
export const SEANCES_GARDEES = 130;

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
  /** Variation en centièmes de point de pourcentage, calculée avec la séance précédente de la série. */
  variation_bp: number | null;
}

const nombre = (s: unknown): number | null => {
  const n = typeof s === 'string' ? Number(s.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
};
const enBp = (v: number | null, precedent: number | null): number | null =>
  v === null || precedent === null || precedent === 0 ? null : Math.round(((v - precedent) / Math.abs(precedent)) * 10000);

/** Corps JSON du fournisseur → les séances les plus récentes (la plus récente d'abord), ou lève l'erreur écrite dans `incident`. */
export function lire(s: SymboleSuivi, corps: Record<string, unknown>): Releve[] {
  const motif = ['Error Message', 'Information', 'Note'].map((k) => corps[k]).find((x) => typeof x === 'string');
  if (typeof motif === 'string') throw new Error(`Fournisseur : ${motif.slice(0, 300)}`);

  let points: { date: string; valeur: string }[];
  if (s.type === 'cotation') {
    const serie = corps['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined;
    points = Object.entries(serie ?? {}).map(([date, o]) => ({ date, valeur: o?.['4. close'] ?? '' }));
  } else if (s.type === 'change') {
    const serie = corps['Time Series FX (Daily)'] as Record<string, Record<string, string>> | undefined;
    points = Object.entries(serie ?? {}).map(([date, o]) => ({ date, valeur: o?.['4. close'] ?? '' }));
  } else {
    const data = corps.data as { date?: string; value?: string }[] | undefined;
    points = (Array.isArray(data) ? data : []).map((o) => ({ date: o?.date ?? '', valeur: o?.value ?? '' }));
  }
  points = points
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && nombre(p.valeur) !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, SEANCES_GARDEES + 1); // une de plus : la plus ancienne ne sert qu'à calculer la variation de la suivante
  if (points.length === 0) throw new Error('Fournisseur : aucune valeur pour ce symbole.');
  return points.slice(0, SEANCES_GARDEES).map((p, i) => ({
    date: p.date,
    valeur: p.valeur.trim(),
    variation_bp: enBp(nombre(p.valeur), points[i + 1] ? nombre(points[i + 1].valeur) : null),
  }));
}

function adresse(s: SymboleSuivi, cle: string, base: string): string {
  const p = new URLSearchParams();
  if (s.type === 'cotation') {
    p.set('function', 'TIME_SERIES_DAILY');
    p.set('symbol', s.source);
    p.set('outputsize', 'compact');
  } else if (s.type === 'change') {
    const [de, vers] = s.source.split('/');
    p.set('function', 'FX_DAILY');
    p.set('from_symbol', de ?? '');
    p.set('to_symbol', vers ?? '');
    p.set('outputsize', 'compact');
  } else {
    p.set('function', s.source);
    p.set('interval', 'daily');
  }
  p.set('apikey', cle);
  return `${base}?${p.toString()}`;
}

async function appeler(s: SymboleSuivi, cle: string, base: string): Promise<Releve[]> {
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

async function incident(db: Base, id: string, tenantId: string | null, quoi: string, detail: string): Promise<void> {
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

export interface RapportCours {
  /** Symboles dont les séances ont été rangées par ce passage, avec le nombre de séances. */
  recuperes: { cle: string; seances: number }[];
  /** Symboles en échec (une ligne dans incident chacun). */
  echecs: string[];
  /** Symboles non appelés : déjà faits ou tentés aujourd'hui, ou budget épuisé. */
  ignores: string[];
  /** Appels envoyés au fournisseur par ce passage. */
  appels: number;
  cle_absente: boolean;
}

/**
 * Récupère, parmi `symboles`, ceux dont le cours du jour manque : pas encore récupérés aujourd'hui, pas encore tentés aujourd'hui.
 * Ne lève jamais. Sans clé d'API, rien n'est appelé : une ligne dans `incident`, et la vue le dit.
 * `tenantId` : le cabinet à qui rattacher les incidents ; null pour le traitement quotidien (incidents sans cabinet).
 * `sequentiel` : un appel après l'autre avec une pause (le traitement de nuit) ; sinon tous ensemble (la vue, qui attend).
 */
export async function recupererManquants(
  db: Base, env: Env, tenantId: string | null, symboles: SymboleSuivi[], options: { sequentiel?: boolean; jour?: string } = {},
): Promise<RapportCours> {
  const rapport: RapportCours = { recuperes: [], echecs: [], ignores: [], appels: 0, cle_absente: false };
  try {
    const jour = options.jour ?? jourUtc();
    const ids = symboles.map((s) => s.cle);
    if (ids.length === 0) return rapport;
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
    rapport.ignores = symboles.filter((s) => dejaVus.has(s.cle)).map((s) => s.cle);
    if (manquants.length === 0) return rapport;

    const cle = env.COURS_API_KEY?.trim();
    if (!cle) {
      rapport.cle_absente = true;
      await incident(db, tenantId === null ? 'cle:traitement' : `cle:${tenantId}:${jour}`, tenantId, 'cours_cle', "Clé d'API des cours absente (COURS_API_KEY) : aucun cours récupéré.");
      return rapport;
    }

    // Budget du fournisseur, tous cabinets confondus : un appel par symbole, donc symboles récupérés aujourd'hui + échecs du jour.
    const budget = Number(env.COURS_BUDGET) > 0 ? Number(env.COURS_BUDGET) : BUDGET_DEFAUT;
    const utilises =
      (await nombreDe(db, 'SELECT COUNT(DISTINCT symbole) AS n FROM cours WHERE recupere_le >= ?', jour)) +
      (await nombreDe(db, "SELECT COUNT(*) AS n FROM incident WHERE quoi LIKE 'cours_echec:%' AND cree_le >= ?", jour));
    const restant = Math.max(0, budget - utilises);
    const aAppeler = manquants.slice(0, restant);
    const laisses = manquants.slice(aAppeler.length);
    rapport.ignores.push(...laisses.map((s) => s.cle));
    if (laisses.length > 0) {
      await incident(db, `budget:${tenantId ?? 'traitement'}:${jour}`, tenantId, 'cours_budget',
        `Budget du fournisseur : ${budget} appels par jour, ${utilises} déjà faits aujourd'hui. Non récupérés : ${laisses.map((s) => s.cle).join(', ')}.`);
    }

    const base = env.COURS_API_URL?.trim() || URL_DEFAUT;
    const un = (s: SymboleSuivi): Promise<void> => {
      const k = `${s.cle}:${jour}`;
      let p = enVol.get(k);
      if (!p) {
        rapport.appels++;
        p = recuperer(db, tenantId, s, cle, base, jour)
          .then((n) => {
            if (n === null) rapport.echecs.push(s.cle);
            else rapport.recuperes.push({ cle: s.cle, seances: n });
          })
          .finally(() => enVol.delete(k));
        enVol.set(k, p);
      }
      return p;
    };
    if (options.sequentiel) {
      const pause = env.COURS_PAUSE_MS !== undefined && env.COURS_PAUSE_MS !== '' ? Math.max(0, Number(env.COURS_PAUSE_MS) || 0) : PAUSE_MS;
      for (let i = 0; i < aAppeler.length; i++) {
        if (i > 0 && pause > 0) await new Promise((r) => setTimeout(r, pause));
        await un(aAppeler[i]);
      }
    } else {
      await Promise.all(aAppeler.map(un));
    }
  } catch (e) {
    console.error('cours', e instanceof Error ? e.message : e);
  }
  return rapport;
}

/** Le filet de la vue Actus : récupère ce que le passage de la nuit n'a pas fait. Ne lève jamais. */
export async function assurerCours(db: Base, env: Env, tenantId: string, symboles: SymboleSuivi[]): Promise<void> {
  await recupererManquants(db, env, tenantId, symboles);
}

/**
 * L'union dédoublonnée (par identifiant) des symboles de TOUS les cabinets : ce que le traitement quotidien doit suivre.
 * Un cabinet sans réglage suit les symboles par défaut. La table `cours` est globale, un symbole commun n'est appelé qu'une fois.
 */
export async function symbolesDeTous(db: Base): Promise<SymboleSuivi[]> {
  const { results } = await db.prepare('SELECT id FROM tenant ORDER BY id').all<{ id: string }>();
  const vus = new Map<string, SymboleSuivi>();
  for (const t of results) for (const s of await symbolesDe(db, t.id)) if (!vus.has(s.cle)) vus.set(s.cle, s);
  return [...vus.values()];
}

/** Le travail « cours » du traitement quotidien. */
export async function recupererCoursQuotidien(db: Base, env: Env, jour: string): Promise<RapportCours> {
  return recupererManquants(db, env, null, await symbolesDeTous(db), { sequentiel: true, jour });
}

/** Écrit toutes les séances reçues dans une transaction. Renvoie leur nombre, ou null en cas d'échec (incident écrit). */
async function recuperer(db: Base, tenantId: string | null, s: SymboleSuivi, cle: string, base: string, jour: string): Promise<number | null> {
  try {
    const releves = await appeler(s, cle, base);
    const maintenant = new Date().toISOString();
    await db.batch(
      releves.map((r) =>
        db
          .prepare(
            `INSERT INTO cours (symbole, date, valeur, variation_bp, sens, recupere_le) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(symbole, date) DO UPDATE SET valeur = excluded.valeur, variation_bp = excluded.variation_bp,
               sens = excluded.sens, recupere_le = excluded.recupere_le`,
          )
          .bind(s.cle, r.date, r.valeur, r.variation_bp, sensDe(r.variation_bp), maintenant),
      ),
    );
    return releves.length;
  } catch (e) {
    const message = (e instanceof Error ? e.message : 'erreur').split(cle).join('***');
    await incident(db, `echec:${s.cle}:${jour}`, tenantId, `cours_echec:${s.cle}`, `${s.libelle} : ${message}`);
    return null;
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
    .prepare("SELECT quoi, detail FROM incident WHERE (tenant_id = ? OR tenant_id IS NULL) AND quoi LIKE 'cours%' AND cree_le >= ? ORDER BY cree_le, id")
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
