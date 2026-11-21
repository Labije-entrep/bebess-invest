// Retours de recette du 21/11/2026 : performance du mois visible côté gestionnaire (tableau de bord et onglet Historique),
// et alerte quand le dernier point d'historique ne dit pas la même chose que les enveloppes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve } from './support/d1.ts';
import { creerCabinet } from './support/monde.ts';
import { divergencePointEnveloppes, perfDernierPoint, perfForte, perfParPoint, viewersResumes } from '../src/lib/gestion';
import type { Point } from '../src/lib/db';

const E = (euros: number): number => Math.round(euros * 100);
let n = 0;
const pt = (date: string, valeur: number, verse: number, pf = 'pf'): Point => ({
  id: `r${++n}`, portefeuille_id: pf, date, valeur_cents: E(valeur), versements_cumules_cents: E(verse),
});

// ------------------------------------------------------------------ performance du dernier point

test('perf du mois : dernier point contre le précédent, versements neutralisés, tiret sans point antérieur', () => {
  assert.equal(perfDernierPoint([]), null, 'aucun point');
  assert.equal(perfDernierPoint([pt('2026-10-31', 1000, 1000)]), null, 'un seul point : rien à comparer');
  assert.equal(perfDernierPoint([pt('2026-10-31', 100000, 100000), pt('2026-11-30', 102000, 100000)]), 200, '+2,00 %');
  // 100 000 → 160 000 avec 50 000 versés : le gain réel est 10 000, soit +10,00 %.
  assert.equal(perfDernierPoint([pt('2026-10-31', 100000, 100000), pt('2026-11-30', 160000, 150000)]), 1000);
  assert.equal(perfDernierPoint([pt('2026-10-31', 0, 0), pt('2026-11-30', 1000, 1000)]), null, 'point précédent nul : jamais de valeur inventée');
});

test('perf par point : chaque point contre le précédent du même portefeuille ; le premier est un tiret', () => {
  const pts = [
    pt('2026-09-30', 100000, 100000, 'A'), pt('2026-10-31', 101000, 100000, 'A'), pt('2026-11-30', 150000, 100000, 'A'),
    pt('2026-10-15', 50000, 50000, 'B'),
  ];
  const m = perfParPoint(pts);
  assert.equal(m.get(pts[0].id), null, 'premier point du portefeuille A');
  assert.equal(m.get(pts[1].id), 100);
  assert.equal(m.get(pts[2].id), 4851, '+48,51 % : variation forte');
  assert.equal(m.get(pts[3].id), null, 'premier point du portefeuille B : pas comparé à celui de A');
  assert.equal(perfForte(4851), true);
  assert.equal(perfForte(2000), false, 'le seuil est strictement supérieur à 20 %');
  assert.equal(perfForte(-2001), true);
  assert.equal(perfForte(null), false);
  // Un seul point au total.
  assert.deepEqual([...perfParPoint([pts[0]]).values()], [null]);
});

// ------------------------------------------------------------------ divergence point / enveloppes

test('divergence : null sans point, sans enveloppe ou quand tout concorde ; sinon l\'écart du dernier point', () => {
  const points = [pt('2026-10-31', 1500, 1000), pt('2026-11-21', 1550, 1000)];
  assert.equal(divergencePointEnveloppes([], 1, E(1500)), null, 'sans point : rien à comparer');
  assert.equal(divergencePointEnveloppes(points, 0, 0), null, 'sans enveloppe : parcours « premier arrêté », pas une divergence');
  assert.equal(divergencePointEnveloppes(points, 1, E(1550)), null, 'concordance');
  assert.deepEqual(divergencePointEnveloppes(points, 1, E(1500)), {
    date: '2026-11-21', pointCents: E(1550), enveloppesCents: E(1500), ecartCents: E(50),
  }, 'le cas de la recette : point à 155 000 €, enveloppes à 150 000 €');
  assert.equal(divergencePointEnveloppes([points[0]], 2, E(1700))!.ecartCents, E(-200), 'un seul point, écart négatif');
});

// ------------------------------------------------------------------ sur la base

test('tableau de bord : perf du mois, divergence et absence d\'enveloppe, cabinet par cabinet', async () => {
  const db = baseNeuve();
  const a = creerCabinet(db, 'A');
  const b = creerCabinet(db, 'B');
  const d = a.donnees;
  let r = await viewersResumes(db as never, a.id);
  const v1 = r.find((x) => x.id === d.viewer)!;
  const v2 = r.find((x) => x.id === d.viewer2)!;
  assert.equal(v1.perfBp, 204, '4 900 000 → 5 000 000 centimes : +2,04 %');
  assert.equal(v1.divergence, null, 'point et enveloppe à 50 000 €');
  assert.equal(v1.nbEnveloppes, 1);
  assert.equal(v2.perfBp, null, 'aucun point : tiret');
  assert.equal(v2.nbEnveloppes, 0);
  assert.equal(v2.divergence, null);
  assert.equal(v2.dernierPoint, null);

  // Le gestionnaire saisit un point dans l'onglet Historique : les enveloppes ne bougent pas.
  db.exec("INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES ('nouveau', ?, '2026-06-30', 5200000, 4000000)", d.portefeuille);
  r = await viewersResumes(db as never, a.id);
  const v1b = r.find((x) => x.id === d.viewer)!;
  assert.equal(v1b.perfBp, 400, '5 000 000 → 5 200 000 : +4,00 %');
  assert.equal(v1b.encours, 5_000_000, 'l\'encours suit toujours les enveloppes');
  assert.deepEqual(v1b.divergence, { date: '2026-06-30', pointCents: 5_200_000, enveloppesCents: 5_000_000, ecartCents: 200_000 });

  // Un second portefeuille actif sans point ni enveloppe ne change ni la perf ni la divergence ; archivé ou non.
  db.exec('UPDATE portefeuille SET archive = 1 WHERE id = ?', d.portefeuille2);
  assert.equal((await viewersResumes(db as never, a.id)).find((x) => x.id === d.viewer)!.perfBp, 400);

  // Cloisonnement : les résumés d'un cabinet ne contiennent aucun viewer d'un autre.
  const rb = await viewersResumes(db as never, b.id);
  assert.ok(rb.every((x) => x.id !== d.viewer && x.id !== d.viewer2));
  assert.equal(rb.find((x) => x.id === b.donnees.viewer)!.perfBp, 204);
});
