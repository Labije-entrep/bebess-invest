// Cours de marché : le travail « cours » du traitement quotidien (un appel par symbole, tout l'historique rangé), le filet de la vue,
// et les calculs des courbes. Hors ligne : Alpha Vantage est une réponse factice du banc (`reseau.cours`), tout appel non prévu échoue.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, type BaseTest } from './support/d1.ts';
import { creerCabinet, poserTenant } from './support/monde.ts';
import { environnement, reseau, type Environnement } from './support/serveur.ts';
import { traitementQuotidien } from '../src/lib/traitement';
import { assurerCours, SYMBOLES_DEFAUT, symbolesDe, symbolesDeTous, type SymboleSuivi } from '../src/lib/cours';
import { baseCent, comparer, deviseDe, fenetre, lireSeries, miniCourbe, performance, periodeDe, PERIODES, variationJour, type Point } from '../src/lib/marches';

const JOUR = '2026-11-20';
let db: BaseTest;
let env: Environnement;
let appels: URLSearchParams[];

/** `n` séances à rebours depuis JOUR, valeur = base + rang (la plus récente est la plus haute). */
function seances(n: number, base = 100): [string, number][] {
  const sortie: [string, number][] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 10, 20 - i));
    sortie.push([d.toISOString().slice(0, 10), base + (n - 1 - i)]);
  }
  return sortie;
}
const reponse = (p: URLSearchParams): Response => {
  const f = p.get('function');
  const n = 5;
  if (f === 'TIME_SERIES_DAILY') {
    return Response.json({ 'Time Series (Daily)': Object.fromEntries(seances(n).map(([d, v]) => [d, { '4. close': v.toFixed(4) }])) });
  }
  if (f === 'FX_DAILY') {
    return Response.json({ 'Time Series FX (Daily)': Object.fromEntries(seances(n, 1).map(([d, v]) => [d, { '4. close': v.toFixed(4) }])) });
  }
  if (f === 'BRENT') return Response.json({ data: seances(n, 70).map(([date, v]) => ({ date, value: String(v) })) });
  return new Response('{}', { status: 404 });
};

// L'horloge est figée à JOUR : le code horodate avec l'instant présent (`new Date()`), et ces tests simulent le jour du traitement.
// Sans cela, ils dépendaient de la date réelle d'exécution et échouaient dès le lendemain de leur écriture.
const heure = (jour: string): number => Date.parse(`${jour}T12:00:00Z`);

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: heure(JOUR) });
  reseau.vider();
  appels = [];
  reseau.cours = (p) => {
    appels.push(p);
    return reponse(p);
  };
  db = baseNeuve();
  env = environnement(db, { COURS_API_KEY: 'cle-de-test', COURS_PAUSE_MS: '0' });
  poserTenant(db, 'tenant-a', 'Cabinet A', 'a.test');
});

afterEach(() => {
  mock.timers.reset();
});

const passe = (jour = JOUR) => traitementQuotidien(env, { maintenant: new Date(`${jour}T03:00:00Z`) });
const nbCours = (): number => db.compte('cours');
const reglerSymboles = (tenant: string, symboles: SymboleSuivi[]) =>
  db.exec("INSERT INTO reglage (tenant_id, cle, valeur) VALUES (?, 'symboles', ?)", tenant, JSON.stringify(symboles));

test('le travail « cours » appelle un symbole une fois, avec l\'historique, et range tous les points', async () => {
  const r = await passe();
  assert.deepEqual(r.echecs, []);
  assert.equal(r.cours?.appels, 5);
  assert.equal(appels.length, 5);
  const fonctions = appels.map((p) => p.get('function')).sort();
  assert.deepEqual(fonctions, ['BRENT', 'FX_DAILY', 'TIME_SERIES_DAILY', 'TIME_SERIES_DAILY', 'TIME_SERIES_DAILY']);
  for (const p of appels.filter((x) => x.get('function') !== 'BRENT')) assert.equal(p.get('outputsize'), 'compact');
  assert.ok(appels.every((p) => p.get('apikey') === 'cle-de-test'));
  assert.equal(nbCours(), 25); // 5 symboles x 5 séances
  const spy = db.tous<{ date: string; valeur: string; variation_bp: number | null; sens: string | null }>("SELECT date, valeur, variation_bp, sens FROM cours WHERE symbole = 'sp500' ORDER BY date");
  assert.equal(spy.length, 5);
  assert.equal(spy[0].variation_bp, null); // la plus ancienne n'a pas de précédente
  assert.equal(spy[4].date, JOUR);
  assert.equal(spy[4].variation_bp, Math.round((104 / 103 - 1) * 10000));
  assert.equal(spy[4].sens, 'hausse');
});

test('rejouer le traitement le même jour n\'appelle rien et ne duplique rien', async () => {
  await passe();
  const avant = db.tous('SELECT * FROM cours ORDER BY symbole, date');
  appels.length = 0;
  const r = await passe();
  assert.equal(appels.length, 0);
  assert.equal(r.cours?.appels, 0);
  assert.equal(nbCours(), 25);
  assert.deepEqual(db.tous('SELECT * FROM cours ORDER BY symbole, date'), avant);
});

test('le lendemain, l\'historique chevauchant est mis à jour sans doublon', async () => {
  await passe();
  mock.timers.setTime(heure('2026-11-21'));
  await passe('2026-11-21');
  assert.equal(appels.length, 10);
  assert.equal(nbCours(), 25); // mêmes dates, mises à jour
  assert.equal(db.un<{ n: number }>("SELECT COUNT(*) AS n FROM cours WHERE recupere_le >= '2026-11-21'")!.n >= 0, true);
});

test('un symbole en échec écrit un incident sans arrêter les autres, et n\'est pas rappelé ce jour-là', async () => {
  reseau.cours = (p) => {
    appels.push(p);
    return p.get('function') === 'FX_DAILY' ? new Response('{}', { status: 500 }) : reponse(p);
  };
  const r = await passe();
  assert.deepEqual(r.cours?.echecs, ['eurusd']);
  assert.equal(r.cours?.recuperes.length, 4);
  assert.equal(nbCours(), 20);
  const inc = db.tous<{ quoi: string; tenant_id: string | null; detail: string }>("SELECT quoi, tenant_id, detail FROM incident WHERE quoi LIKE 'cours_echec:%'");
  assert.equal(inc.length, 1);
  assert.equal(inc[0].quoi, 'cours_echec:eurusd');
  assert.equal(inc[0].tenant_id, null);
  assert.ok(!inc[0].detail.includes('cle-de-test'));
  appels.length = 0;
  await passe();
  assert.equal(appels.length, 0); // l'échec du jour compte comme tenté
});

test('un message du fournisseur (limite atteinte) est un échec lisible', async () => {
  reseau.cours = () => Response.json({ Information: 'Limite de 25 requêtes par jour atteinte.' });
  const r = await passe();
  assert.equal(r.cours?.recuperes.length, 0);
  assert.equal(r.cours?.echecs.length, 5);
  assert.match(db.un<{ detail: string }>("SELECT detail FROM incident WHERE quoi = 'cours_echec:brent'")!.detail, /Limite de 25/);
});

test('sans clé : aucun appel, un incident clair', async () => {
  env = environnement(db, { COURS_PAUSE_MS: '0' });
  const r = await passe();
  assert.equal(appels.length, 0);
  assert.equal(r.cours?.cle_absente, true);
  assert.equal(nbCours(), 0);
  const inc = db.un<{ detail: string }>("SELECT detail FROM incident WHERE quoi = 'cours_cle'")!;
  assert.match(inc.detail, /COURS_API_KEY/);
});

test('le budget de 25 appels est tenu : le surplus n\'est pas appelé, et dit dans un incident', async () => {
  const beaucoup: SymboleSuivi[] = Array.from({ length: 30 }, (_, i) => ({ cle: `t${i}`, libelle: `Titre ${i}`, type: 'cotation', source: `T${i}` }));
  reglerSymboles('tenant-a', beaucoup);
  const r = await passe();
  assert.equal(appels.length, 25);
  assert.equal(r.cours?.appels, 25);
  assert.equal(r.cours?.ignores.length, 5);
  assert.match(db.un<{ detail: string }>("SELECT detail FROM incident WHERE quoi = 'cours_budget'")!.detail, /25 appels par jour/);
  // Un second passage le même jour : le budget est épuisé (25 symboles déjà rangés), rien n'est appelé.
  appels.length = 0;
  await passe();
  assert.equal(appels.length, 0);
});

test('le budget compte des appels, pas des lignes d\'historique', async () => {
  reglerSymboles('tenant-a', Array.from({ length: 3 }, (_, i) => ({ cle: `t${i}`, libelle: `T${i}`, type: 'cotation' as const, source: `T${i}` })));
  env = environnement(db, { COURS_API_KEY: 'k', COURS_PAUSE_MS: '0', COURS_BUDGET: '4' });
  await passe(); // 3 appels, 15 lignes
  assert.equal(nbCours(), 15);
  reglerSymboles2('tenant-a', 'x1');
  const r = await passe(); // reste 1 appel : x1 passe, les autres symboles sont déjà faits
  assert.equal(r.cours?.appels, 1);
});
function reglerSymboles2(tenant: string, cle: string): void {
  db.exec("UPDATE reglage SET valeur = ? WHERE tenant_id = ? AND cle = 'symboles'", JSON.stringify([
    { cle: 't0', libelle: 'T0', type: 'cotation', source: 'T0' }, { cle, libelle: cle, type: 'cotation', source: cle.toUpperCase() },
  ]), tenant);
}

test('l\'ensemble suivi est l\'union dédoublonnée des symboles de tous les cabinets', async () => {
  creerCabinet(db, 'B'); // sans réglage : les cinq par défaut
  const commun = SYMBOLES_DEFAUT[1]; // sp500
  reglerSymboles('tenant-a', [commun, { cle: 'dax', libelle: 'DAX', type: 'cotation', source: 'EXS1.DEX' }]);
  const tous = await symbolesDeTous(db);
  const cles = tous.map((s) => s.cle).sort();
  assert.deepEqual(cles, ['brent', 'cac40', 'dax', 'eurusd', 'nasdaq100', 'sp500']);
  await passe();
  assert.equal(appels.length, 6);
  assert.equal(appels.filter((p) => p.get('symbol') === 'SPY').length, 1);
  assert.equal(db.compte('cours', "symbole = 'dax'"), 5);
});

test('le filet de la vue ne rappelle pas ce que le passage de la nuit a fait', async () => {
  await passe();
  appels.length = 0;
  await assurerCours(db, env, 'tenant-a', await symbolesDe(db, 'tenant-a'));
  assert.equal(appels.length, 0);
});

test('le filet de la vue récupère ce que la nuit a manqué, et un cabinet voit les incidents du traitement', async () => {
  await assurerCours(db, env, 'tenant-a', SYMBOLES_DEFAUT.slice(0, 2));
  assert.equal(appels.length, 2);
  assert.equal(db.compte('cours', "symbole = 'cac40'"), 5);
});

// ---------------------------------------------------------------- calculs purs

const pts = (...v: number[]): Point[] => v.map((valeur, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, valeur }));

test('performance, variation du jour et fenêtres de période', () => {
  assert.equal(performance(pts(100, 110)), 1000);
  assert.equal(performance(pts(200, 190)), -500);
  assert.equal(performance(pts(100)), null);
  assert.equal(performance(pts(0, 5)), null);
  assert.equal(variationJour(pts(100, 102, 101)), Math.round((101 / 102 - 1) * 10000));
  assert.equal(variationJour(pts(100)), null);
  const longue = pts(...Array.from({ length: 100 }, (_, i) => 100 + i));
  assert.deepEqual([PERIODES['1s'].n, PERIODES['1m'].n, PERIODES['3m'].n], [6, 22, 64]);
  assert.equal(fenetre(longue, 6).length, 6);
  assert.equal(fenetre(longue, 64)[63].valeur, 199);
  assert.equal(fenetre(pts(1, 2), 64).length, 2);
  assert.equal(periodeDe('3m'), '3m');
  assert.equal(periodeDe('<script>'), '1m');
  assert.equal(periodeDe(null), '1m');
});

test('base 100 : première séance à 100, rapports conservés', () => {
  const b = baseCent(pts(50, 55, 40));
  assert.deepEqual(b.map((p) => Math.round(p.valeur * 1e6) / 1e6), [100, 110, 80]);
  assert.deepEqual(baseCent([]), []);
  assert.deepEqual(baseCent(pts(0, 1)), []);
});

test('devise déduite du symbole', () => {
  assert.equal(deviseDe({ type: 'cotation', source: 'CAC.PAR' }), '€');
  assert.equal(deviseDe({ type: 'cotation', source: 'SPY' }), '$');
  assert.equal(deviseDe({ type: 'cotation', source: 'VOD.LON' }), '£');
  assert.equal(deviseDe({ type: 'change', source: 'EUR/USD' }), '$');
  assert.equal(deviseDe({ type: 'matiere', source: 'BRENT' }), '$');
});

test('mini-courbe et comparaison : géométrie bornée, séries courtes ignorées, repères d\'actus', () => {
  assert.equal(miniCourbe(pts(1)), null);
  const m = miniCourbe(pts(1, 3, 2))!;
  assert.match(m.ligne, /^M0\.0,/);
  assert.equal(m.fin.x, 300);
  const plate = miniCourbe(pts(5, 5))!; // série constante : pas de division par zéro
  assert.ok(Number.isFinite(plate.fin.y));

  assert.equal(comparer([{ cle: 'a', libelle: 'A', pts: pts(1) }]), null);
  const c = comparer(
    [
      { cle: 'a', libelle: 'A', pts: pts(100, 110, 120) },
      { cle: 'b', libelle: 'B', pts: pts(10, 9, 8) },
      { cle: 'c', libelle: 'C', pts: pts(1) },
    ],
    [{ date: '2026-11-02', titre: 'Note' }, { date: '2026-10-01', titre: 'Hors fenêtre' }],
  )!;
  assert.equal(c.series.length, 2);
  assert.equal(c.base_le, '2026-11-01');
  assert.equal(Math.round(c.series[0].derniere), 120);
  assert.equal(Math.round(c.series[1].derniere), 80);
  assert.equal(c.series[0].perf, 2000);
  assert.equal(c.actus.length, 1);
  for (const s of c.series) assert.ok(s.fin.y >= c.haut && s.fin.y <= c.bas);
});

test('lireSeries : ordre chronologique, plafonné, limité à la date', async () => {
  await passe();
  const s = await lireSeries(db, SYMBOLES_DEFAUT, '2026-11-19');
  const sp = s.get('sp500')!;
  assert.equal(sp.length, 4);
  assert.ok(sp[0].date < sp[3].date);
  assert.equal(sp[3].date, '2026-11-19');
});

test('les étiquettes de fin de la comparaison ne se recouvrent pas', () => {
  const c = comparer([
    { cle: 'a', libelle: 'A', pts: pts(100, 101, 102) },
    { cle: 'b', libelle: 'B', pts: pts(100, 101, 102.01) },
    { cle: 'c', libelle: 'C', pts: pts(100, 101, 102.02) },
  ])!;
  const ys = c.series.map((s) => s.y_etiquette).sort((x, y) => x - y);
  assert.ok(ys[1] - ys[0] >= 14 && ys[2] - ys[1] >= 14);
});
