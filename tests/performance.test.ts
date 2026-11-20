// 6. Performance : chaînage pondéré par le temps, consolidation de plusieurs portefeuilles aux dates décalées, et le cas des versements
// cumulés laissés vides (autrefois +65 % au lieu de +2,5 %). Les montants sont en centimes, les performances en centièmes de point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve } from './support/d1.ts';
import { creerCabinet } from './support/monde.ts';
import { indicateurs, performanceEnchainee, pointsConsolides } from '../src/lib/espace';
import { apercuPoint, perfDuMois, traiter } from '../src/lib/gestion';
import { enveloppesDuViewer, lignesDesEnveloppes, pointsDuViewer, type Point } from '../src/lib/db';

const E = (euros: number): number => Math.round(euros * 100);
let n = 0;
const pt = (date: string, valeur: number, verse: number, portefeuille = 'pf'): Point => ({
  id: `p${++n}`, portefeuille_id: portefeuille, date, valeur_cents: E(valeur), versements_cumules_cents: E(verse),
});

// ------------------------------------------------------------------ le chaînage

test('chaînage : les rendements mensuels se multiplient, les versements ne sont pas de la performance', () => {
  // Mois 2 : 100 000 € de versement (flux = variation des versements cumulés), +10 % sur la valeur de départ. Mois 3 : +10 % sur 210 000 €.
  // Chaîné : 1,1 × 1,1 = +21,00 %. Un « gain sur capital de départ » dirait (231 000 − 100 000 − 100 000) / 100 000 = +31 % : il crédite
  // au capital de départ ce que l'argent versé en cours de route a rapporté.
  const points = [pt('2026-01-31', 100000, 100000), pt('2026-02-28', 210000, 200000), pt('2026-03-31', 231000, 200000)];
  assert.equal(performanceEnchainee(points, 0, 2), 2100);
  assert.equal(performanceEnchainee(points, 0, 1), 1000, 'un seul mois : +10,00 %');
  assert.equal(performanceEnchainee(points, 1, 2), 1000, 'à partir du 28/02 : +10,00 %');
  // Un retrait est un flux négatif : il ne compte ni en gain ni en perte.
  const retrait = [pt('2026-01-31', 100000, 100000), pt('2026-02-28', 60000, 50000)];
  assert.equal(performanceEnchainee(retrait, 0, 1), 1000, '100 000 → 60 000 avec 50 000 retirés : +10,00 %');
});

test('chaînage : un mois dont la valeur précédente est nulle est ignoré ; aucun mois calculable → null', () => {
  const depart = [pt('2026-01-31', 0, 0), pt('2026-02-28', 100000, 100000), pt('2026-03-31', 102000, 100000)];
  assert.equal(performanceEnchainee(depart, 0, 2), 200, 'le premier mois (départ à zéro) est sauté, le second compte : +2,00 %');
  assert.equal(performanceEnchainee(depart, 0, 1), null, 'le seul mois possible part de zéro');
  assert.equal(performanceEnchainee([pt('2026-01-31', 100, 100)], 0, 0), null);
  assert.equal(performanceEnchainee([], 0, -1), null);
});

test('chaînage : la perte d\'un mois se compose (−50 % puis +100 % ne revient pas à zéro… si, à zéro : 0,5 × 2 = 1)', () => {
  const points = [pt('2026-01-31', 1000, 1000), pt('2026-02-28', 500, 1000), pt('2026-03-31', 1000, 1000)];
  assert.equal(performanceEnchainee(points, 0, 2), 0);
  assert.equal(performanceEnchainee(points, 0, 1), -5000);
});

test('indicateurs : l\'année civile part du dernier point d\'avant le 1er janvier, l\'origine du premier point', () => {
  const points = [
    pt('2025-11-30', 100000, 100000), pt('2025-12-31', 110000, 100000), // +10 % en 2025
    pt('2026-01-31', 111100, 100000), pt('2026-02-28', 112211, 100000), // +1 % et +1 % en 2026
  ];
  const ind = indicateurs(points, [], []);
  assert.equal(ind.annee, '2026');
  assert.equal(ind.perfBp, 201, '1,01 × 1,01 = +2,01 % sur 2026, sans les 10 % de 2025');
  assert.equal(ind.perfOrigineBp, 1221, 'depuis le premier point : 1,1 × 1,01 × 1,01 = +12,21 %');
  assert.equal(ind.versementsCents, 0, 'aucun versement en 2026');
  assert.equal(ind.totalCents, E(112211), 'sans enveloppe, le total est la dernière valeur');
  // Sans point avant le 1er janvier, la base est le tout premier point.
  const neuf = indicateurs([pt('2026-02-28', 1000, 1000), pt('2026-03-31', 1020, 1000)], [], []);
  assert.equal(neuf.perfBp, 200);
  assert.equal(neuf.perfOrigineBp, 200);
  // Un seul point : pas de performance.
  const seul = indicateurs([pt('2026-03-31', 1000, 1000)], [], []);
  assert.equal(seul.perfBp, null);
  assert.equal(seul.perfOrigineBp, null);
  assert.equal(indicateurs([], [], []).totalCents, 0);
});

// ------------------------------------------------------------------ la consolidation

test('consolidation : deux portefeuilles aux dates décalées s\'additionnent, le dernier connu se reporte, avant le premier point c\'est zéro', () => {
  const A = [pt('2026-01-31', 100000, 100000, 'A'), pt('2026-02-28', 102000, 100000, 'A'), pt('2026-03-31', 104040, 100000, 'A')];
  const B = [pt('2026-02-15', 50000, 50000, 'B'), pt('2026-03-31', 51000, 50000, 'B')];
  const c = pointsConsolides([...B, ...A]); // l'ordre d'entrée ne compte pas
  assert.deepEqual(c.map((p) => [p.date, p.valeur_cents, p.versements_cumules_cents]), [
    ['2026-01-31', E(100000), E(100000)], // B n'existe pas encore : zéro
    ['2026-02-15', E(150000), E(150000)], // A reporté (100 000), B ouvre avec 50 000 versés
    ['2026-02-28', E(152000), E(150000)], // B reporté
    ['2026-03-31', E(155040), E(150000)],
  ]);
  assert.ok(c.every((p) => p.portefeuille_id === 'tout'));
  // L'ouverture de B est un VERSEMENT, pas une performance : sur les totaux, +2,0 % puis +2,0 %, chaînés avec le mois intermédiaire.
  assert.equal(performanceEnchainee(c, 0, 3), 336, '1,0 × 1,01333… × 1,02 = +3,36 %');
  // Un seul portefeuille : les points sont rendus tels quels.
  assert.equal(pointsConsolides(A), A);
  assert.deepEqual(pointsConsolides([]), []);
});

test('consolidation : un portefeuille qui n\'a plus de point garde sa dernière valeur et ses versements (il ne disparaît pas)', () => {
  const A = [pt('2026-01-31', 1000, 1000, 'A'), pt('2026-02-28', 1010, 1000, 'A'), pt('2026-03-31', 1020, 1000, 'A')];
  const B = [pt('2026-01-31', 500, 500, 'B')];
  const c = pointsConsolides([...A, ...B]);
  assert.deepEqual(c.map((p) => p.valeur_cents), [E(1500), E(1510), E(1520)]);
  assert.deepEqual(c.map((p) => p.versements_cumules_cents), [E(1500), E(1500), E(1500)]);
});

test('consolidation sur la base : les portefeuilles archivés sortent de « Tout » et des totaux, le choix d\'un autre cabinet n\'y entre pas', async () => {
  const db = baseNeuve();
  const a = creerCabinet(db, 'A');
  const b = creerCabinet(db, 'B');
  const d = a.donnees;
  // Le second portefeuille de A s'ouvre quinze jours plus tard.
  db.exec("INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES ('x1', ?, '2026-05-15', 1000000, 1000000)", d.portefeuille2);
  db.exec("INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES ('x2', ?, '2026-05-31', 1020000, 1000000)", d.portefeuille2);
  const tous = await pointsDuViewer(db, a.id, d.viewer);
  const conso = pointsConsolides(tous);
  assert.deepEqual(conso.map((p) => p.date), ['2026-04-30', '2026-05-15', '2026-05-31']);
  assert.equal(conso[2].valeur_cents, 5_000_000 + 1_020_000);
  assert.equal(conso[2].versements_cumules_cents, 4_000_000 + 1_000_000);
  // Archivé : hors de « Tout ».
  db.exec('UPDATE portefeuille SET archive = 1 WHERE id = ?', d.portefeuille2);
  assert.equal((await pointsDuViewer(db, a.id, d.viewer)).length, 2);
  assert.equal((await pointsDuViewer(db, a.id, d.viewer, null, true)).length, 4, 'le gestionnaire, lui, les voit tous');
  // Le portefeuille d'un autre cabinet, demandé par son identifiant : rien.
  assert.deepEqual(await pointsDuViewer(db, a.id, d.viewer, b.donnees.portefeuille), []);
  assert.deepEqual(await enveloppesDuViewer(db, a.id, d.viewer, b.donnees.portefeuille), []);
  assert.deepEqual(await lignesDesEnveloppes(db, []), []);
});

// ------------------------------------------------------------------ les versements laissés vides

function formulaire(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

/** Un viewer dont le portefeuille a un point au 30/04 : 80 000 € de valeur, 50 000 € de versements cumulés. */
async function viewerAvecPoint() {
  const db = baseNeuve();
  const a = creerCabinet(db, 'A');
  db.exec('DELETE FROM point WHERE portefeuille_id = ?', a.donnees.portefeuille);
  db.exec("INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES ('avant', ?, '2026-04-30', 8000000, 5000000)", a.donnees.portefeuille);
  return { db, a };
}
const lire = (db: ReturnType<typeof baseNeuve>, date: string) => {
  const r = db.un<{ valeur_cents: number; versements_cumules_cents: number }>('SELECT valeur_cents, versements_cumules_cents FROM point WHERE date = ?', date);
  return r && { ...r };
};

test('versements vides : « inchangé depuis le point précédent » — +2,5 % et non +65 %', async () => {
  const { db, a } = await viewerAvecPoint();
  const f = formulaire({ pf: a.donnees.portefeuille, date: '2026-05-31', valeur: '82000,00', verse: '', confirmer: '1' });
  const r = await traiter(db, a.id, a.donnees.viewer, 'point', f);
  assert.deepEqual(r.erreurs, {});
  assert.deepEqual(lire(db, '2026-05-31'), { valeur_cents: 8_200_000, versements_cumules_cents: 5_000_000 }, 'les 50 000 € cumulés sont repris, pas remis à zéro');

  const points = await pointsDuViewer(db, a.id, a.donnees.viewer);
  assert.equal(performanceEnchainee(points, 0, 1), 250, 'le mois vaut +2,50 %');
  assert.equal(indicateurs(points, [], []).perfBp, 250);
  // Ce que donnerait un « vide = zéro » : 50 000 € de versements qui disparaissent, comptés comme un gain de 65 %.
  const faux = [points[0], { ...points[1], versements_cumules_cents: 0 }];
  assert.equal(performanceEnchainee(faux, 0, 1), 6500, 'le défaut d\'autrefois');
  assert.notEqual(performanceEnchainee(points, 0, 1), performanceEnchainee(faux, 0, 1));
});

test('versements vides : l\'aperçu montre la même performance avant toute écriture, et rien n\'est écrit sans confirmation', async () => {
  const { db, a } = await viewerAvecPoint();
  const f = formulaire({ pf: a.donnees.portefeuille, date: '2026-05-31', valeur: '82000,00', verse: '' });
  const r = await traiter(db, a.id, a.donnees.viewer, 'point', f);
  assert.deepEqual(r.erreurs, {});
  assert.equal(r.apercu?.perfBp, 250);
  assert.equal(r.apercu?.verseCents, 5_000_000);
  assert.equal(r.apercu?.forte, false);
  assert.equal(r.apercu?.remplace, false);
  assert.equal(lire(db, '2026-05-31'), null, 'rien n\'est écrit tant que la performance n\'est pas confirmée');
  // +65 % : au-delà de ±20 %, l'écran le signale.
  const gros = await apercuPoint(db, a.donnees.portefeuille, '2026-05-31', 8_200_000, 0);
  assert.equal(gros.perfBp, 6500);
  assert.equal(gros.forte, true);
});

test('versements vides : zéro seulement s\'il n\'existe aucun point antérieur ; une valeur saisie l\'emporte', async () => {
  const { db, a } = await viewerAvecPoint();
  // Avant le premier point : rien à reprendre, donc zéro.
  const avant = await traiter(db, a.id, a.donnees.viewer, 'point', formulaire({ pf: a.donnees.portefeuille, date: '2026-03-31', valeur: '70000,00', verse: '', confirmer: '1' }));
  assert.deepEqual(avant.erreurs, {});
  assert.equal(lire(db, '2026-03-31')?.versements_cumules_cents, 0);
  // Saisi : c'est cette valeur.
  await traiter(db, a.id, a.donnees.viewer, 'point', formulaire({ pf: a.donnees.portefeuille, date: '2026-05-31', valeur: '82000,00', verse: '55000,00', confirmer: '1' }));
  assert.equal(lire(db, '2026-05-31')?.versements_cumules_cents, 5_500_000);
  // Un montant illisible est refusé, rien n'est écrit.
  const mauvais = await traiter(db, a.id, a.donnees.viewer, 'point', formulaire({ pf: a.donnees.portefeuille, date: '2026-06-30', valeur: '82000,00', verse: 'beaucoup', confirmer: '1' }));
  assert.ok(mauvais.erreurs.verse);
  assert.equal(lire(db, '2026-06-30'), null);
});

test('versements vides dans un import CSV : chaque ligne reprend le cumul de la précédente, dans l\'ordre des dates', async () => {
  const { db, a } = await viewerAvecPoint();
  const csv = 'date;valeur_eur;versements_cumules_eur\n2026-06-30;83500,00;\n2026-05-31;82000,00;\n2026-07-31;84000,00;52000,00\n2026-08-31;85000,00;';
  const f = formulaire({ pf: a.donnees.portefeuille });
  f.set('fichier', new File([csv], 'points.csv', { type: 'text/csv' }));
  const r = await traiter(db, a.id, a.donnees.viewer, 'points_import', f);
  assert.deepEqual(r.erreurs, {});
  const points = await pointsDuViewer(db, a.id, a.donnees.viewer);
  assert.deepEqual(points.map((p) => [p.date, p.versements_cumules_cents]), [
    ['2026-04-30', 5_000_000], ['2026-05-31', 5_000_000], ['2026-06-30', 5_000_000], ['2026-07-31', 5_200_000], ['2026-08-31', 5_200_000],
  ]);
  // avril → juin : 1,025 × 1,01829… = +4,375 % (437,5 centièmes de point ; le flottant tombe d'un côté ou de l'autre du demi) — et non +90 %.
  assert.ok(Math.abs((performanceEnchainee(points, 0, 2) ?? 0) - 437.5) <= 1);
});

test('nouvel arrêté : versements vides repris du point précédent, la performance montrée doit être celle qui est confirmée', async () => {
  const { db, a } = await viewerAvecPoint();
  const d = a.donnees;
  const base = { pf: d.portefeuille, date: '2026-05-31', e0_id: d.enveloppe, l0_id: d.ligne, l0_valo: '82000,00', e0_perf: '', valeur: '82000,00', valeur_init: '', verse: '' };
  // Sans confirmation : un aperçu, rien d'écrit.
  const apercu = await traiter(db, a.id, d.viewer, 'arrete', formulaire(base));
  assert.equal(apercu.apercu?.perfBp, 250);
  assert.equal(lire(db, '2026-05-31'), null);
  // Confirmé avec une performance qui n'est pas celle qui a été montrée : refusé, rien n'est écrit.
  const tordu = await traiter(db, a.id, d.viewer, 'arrete', formulaire({ ...base, confirmer: '1', perf_vue: '6500' }));
  assert.equal(tordu.apercu?.perfBp, 250);
  assert.equal(lire(db, '2026-05-31'), null);
  // Confirmé avec la bonne : écrit, versements repris.
  const ok = await traiter(db, a.id, d.viewer, 'arrete', formulaire({ ...base, confirmer: '1', perf_vue: '250' }));
  assert.deepEqual(ok.erreurs, {});
  assert.deepEqual(lire(db, '2026-05-31'), { valeur_cents: 8_200_000, versements_cumules_cents: 5_000_000 });
  assert.equal(db.un<{ valorisation_cents: number }>('SELECT valorisation_cents FROM ligne WHERE id = ?', d.ligne)?.valorisation_cents, 8_200_000);
});

// ------------------------------------------------------------------ deux calculs, une formule

test('la performance du mois de l\'aperçu et le chaînage donnent le même nombre, sur 3 000 cas tirés au hasard', () => {
  // Générateur congruentiel : le même tirage à chaque exécution.
  let graine = 20261119;
  const alea = (max: number): number => {
    graine = (graine * 1664525 + 1013904223) % 4294967296;
    return Math.floor((graine / 4294967296) * max);
  };
  const ecarts: string[] = [];
  for (let i = 0; i < 3000; i++) {
    const avant = 1 + alea(50_000_000);
    const versAvant = alea(avant * 2);
    const flux = alea(10_000_000) - 3_000_000;
    const apres = Math.max(0, avant + flux + alea(4_000_000) - 2_000_000);
    const prec = { date: '2026-01-31', valeurCents: avant, verseCents: versAvant };
    const a = perfDuMois(prec, apres, versAvant + flux);
    const b = performanceEnchainee(
      [{ id: 'a', portefeuille_id: 'p', date: '2026-01-31', valeur_cents: avant, versements_cumules_cents: versAvant },
        { id: 'b', portefeuille_id: 'p', date: '2026-02-28', valeur_cents: apres, versements_cumules_cents: versAvant + flux }], 0, 1);
    if (a !== b) ecarts.push(`${avant}/${versAvant} → ${apres}/${versAvant + flux} : aperçu ${a}, chaînage ${b}`);
  }
  assert.deepEqual(ecarts, [], 'l\'écran annonce une performance, les indicateurs en calculent une autre');
});
