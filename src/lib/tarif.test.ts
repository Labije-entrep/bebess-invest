// Tests de tarif.ts. `npm test` (node:test, sans dépendance). Les montants sont en centimes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ajouterMois, calculerBon, calculerComplementaire, calculerInstallation, compterAccesFacturables, dateEffetPreavis, moisArrondisAuSuperieur, periodeAu, periodesDebutant,
  prixMensuel, prochainAnniversaire, tauxParrainage, tauxRemise, type EntreeBon,
} from './tarif.ts';

const BASE: EntreeBon = {
  periodicite: 'mensuelle',
  prix_socle: 7900, prix_pilotage: 4900, prix_site: 3900, prix_acces_sup: 2500,
  acces_inclus: 2, acces_facturables: 2,
  module_pilotage: 0, module_site: 0,
  parrainages_valides: 0, remise_commerciale_taux: 0,
};

test('mensuel : × 1,15 arrondi à l’euro, ligne par ligne', () => {
  assert.deepEqual([7900, 4900, 3900, 2500].map(prixMensuel), [9100, 5600, 4500, 2900]);
});

test('contrôle : socle + Pilotage au mois = 147 €', () => {
  const b = calculerBon({ ...BASE, module_pilotage: 1 });
  assert.equal(b.recurrent_ht, 14700);
  assert.equal(b.total_ht, 14700);
  assert.deepEqual(b.lignes.map((l) => l.code), ['socle', 'pilotage']);
});

test('le coefficient ne s’applique jamais au total : le total est la somme des lignes arrondies', () => {
  // 79 + 49 + 39 + 2 × 25 = 217 € ; 217 × 1,15 = 249,55 € ; ligne par ligne : 91 + 56 + 45 + 2 × 29 = 250 €.
  const b = calculerBon({ ...BASE, module_pilotage: 1, module_site: 1, acces_facturables: 4 });
  assert.equal(b.recurrent_ht, 25000);
  assert.notEqual(b.recurrent_ht, Math.round(21700 * 1.15));
});

test('annuel : le prix du contrat × 12, sans majoration', () => {
  const b = calculerBon({ ...BASE, periodicite: 'annuelle', module_pilotage: 1 });
  assert.equal(b.recurrent_ht, (7900 + 4900) * 12);
});

test('accès supplémentaires : seulement au-delà des accès inclus, jamais en négatif', () => {
  assert.equal(calculerBon({ ...BASE, acces_facturables: 1 }).lignes.length, 1);
  assert.equal(calculerBon({ ...BASE, acces_facturables: 2 }).lignes.length, 1);
  const b = calculerBon({ ...BASE, acces_facturables: 5 });
  assert.equal(b.lignes[1].quantite, 3);
  assert.equal(b.lignes[1].montant, 3 * 2900);
});

test('accès facturables : associé et collaborateur actifs, rien d’autre', () => {
  const n = compterAccesFacturables([
    { role: 'associe', actif: 1 }, { role: 'collaborateur', actif: 1 },
    { role: 'associe', actif: 0 },
    { role: 'lecture', actif: 1 }, { role: 'support_editeur', actif: 1 }, { role: 'editeur', actif: 1 },
    { role: 'viewer', actif: 1 }, { role: 'viewer', actif: 1 },
  ]);
  assert.equal(n, 2);
});

test('remises : parrainage plafonné à 50 %, total plafonné à 50 %', () => {
  assert.equal(tauxParrainage(0), 0);
  assert.equal(tauxParrainage(1), 2500);
  assert.equal(tauxParrainage(2), 5000);
  assert.equal(tauxParrainage(7), 5000);
  assert.equal(tauxRemise(2500, 2000), 4500);
  assert.equal(tauxRemise(5000, 3000), 5000);
  assert.equal(tauxRemise(2500, 5000), 5000);
});

test('remise : assiette = le récurrent seul, jamais les frais d’installation', () => {
  const b = calculerBon({ ...BASE, parrainages_valides: 1, remise_commerciale_taux: 2500, frais_installation: 50000 });
  assert.equal(b.recurrent_ht, 9100);
  assert.equal(b.remise_taux, 5000);
  assert.equal(b.remise_montant, 4550);
  assert.equal(b.frais_installation_ht, 50000);
  assert.equal(b.total_ht, 9100 - 4550 + 50000);
});

test('prorata : anniversaire au 14/03/2027, Pilotage à 49 €', () => {
  const mod = [{ code: 'pilotage' as const, prix: 4900 }];
  const a = calculerComplementaire({ periodicite: 'annuelle', modules: mod, activation: '2026-11-20', anniversaire: '2027-03-14', remise_taux: 0 });
  assert.equal(a?.mois, 4);
  assert.equal(a?.total_ht, 19600); // 196 €
  const b = calculerComplementaire({ periodicite: 'annuelle', modules: mod, activation: '2027-03-02', anniversaire: '2027-03-14', remise_taux: 0 });
  assert.equal(b?.mois, 1);
  assert.equal(b?.total_ht, 4900); // 49 €
});

test('prorata : la remise s’applique, un contrat mensuel n’en a pas, rien à courir = pas de bon', () => {
  const mod = [{ code: 'pilotage' as const, prix: 4900 }];
  const r = calculerComplementaire({ periodicite: 'annuelle', modules: mod, activation: '2026-11-20', anniversaire: '2027-03-14', remise_taux: 2500 });
  assert.equal(r?.total_ht, 19600 - 4900);
  assert.equal(calculerComplementaire({ periodicite: 'mensuelle', modules: mod, activation: '2026-11-20', anniversaire: '2026-12-14', remise_taux: 0 }), null);
  assert.equal(calculerComplementaire({ periodicite: 'annuelle', modules: mod, activation: '2027-03-14', anniversaire: '2027-03-14', remise_taux: 0 }), null);
});

test('mois entiers arrondis au supérieur : bornes', () => {
  assert.equal(moisArrondisAuSuperieur('2026-11-14', '2027-03-14'), 4); // exactement 4 mois : pas de mois de plus
  assert.equal(moisArrondisAuSuperieur('2026-11-14', '2027-03-15'), 5);
  assert.equal(moisArrondisAuSuperieur('2027-01-31', '2027-02-28'), 1); // fin de mois : 31 janvier + 1 mois = 28 février
  assert.equal(moisArrondisAuSuperieur('2027-03-14', '2027-03-14'), 0);
  assert.equal(moisArrondisAuSuperieur('2027-03-15', '2027-03-14'), 0);
});

test('ajouterMois : fin de mois, passage d’année', () => {
  assert.equal(ajouterMois('2027-01-31', 1), '2027-02-28');
  assert.equal(ajouterMois('2028-01-31', 1), '2028-02-29');
  assert.equal(ajouterMois('2026-11-20', 4), '2027-03-20');
  assert.equal(ajouterMois('2026-03-14', 12), '2027-03-14');
});

test('périodes : début à la date anniversaire, bornes comprises', () => {
  assert.deepEqual(periodesDebutant('2026-03-14', 'annuelle', '2027-02-12', '2027-03-14'), [{ debut: '2027-03-14', fin: '2028-03-14' }]);
  assert.deepEqual(periodesDebutant('2026-03-14', 'annuelle', '2027-02-12', '2027-03-13'), []);
  assert.deepEqual(periodesDebutant('2026-01-31', 'mensuelle', '2026-02-20', '2026-03-31'), [
    { debut: '2026-02-28', fin: '2026-03-31' },
    { debut: '2026-03-31', fin: '2026-04-30' },
  ]);
  assert.deepEqual(periodeAu('2026-03-14', 'annuelle', '2026-11-20'), { debut: '2026-03-14', fin: '2027-03-14' });
  assert.deepEqual(periodeAu('2026-03-14', 'annuelle', '2027-03-14'), { debut: '2027-03-14', fin: '2028-03-14' });
  assert.equal(periodeAu('2026-03-14', 'annuelle', '2026-03-13'), null);
});

test('résiliation : préavis à 40 jours de l’anniversaire = effet à cet anniversaire ; à 20 jours = reconduction de douze mois', () => {
  // Début au 14/03/2026 : anniversaires au 14/03/2027, 14/03/2028.
  assert.deepEqual(dateEffetPreavis('2026-03-14', '2027-02-02'), { prochain: '2027-03-14', effet: '2027-03-14', reconduit: false }); // 40 jours
  assert.deepEqual(dateEffetPreavis('2026-03-14', '2027-02-22'), { prochain: '2027-03-14', effet: '2028-03-14', reconduit: true }); // 20 jours
});

test('résiliation : 30 jours pile suffisent, 29 non ; jamais avant le premier anniversaire', () => {
  assert.equal(dateEffetPreavis('2026-03-14', '2027-02-12').effet, '2027-03-14'); // 30 jours
  assert.equal(dateEffetPreavis('2026-03-14', '2027-02-13').effet, '2028-03-14'); // 29 jours
  assert.deepEqual(dateEffetPreavis('2026-03-14', '2026-04-01'), { prochain: '2027-03-14', effet: '2027-03-14', reconduit: false });
  assert.equal(prochainAnniversaire('2026-03-14', '2027-03-14'), '2028-03-14');
});

test('bon d\'installation : une ligne, les frais, aucun récurrent, aucune remise ; rien sans frais', () => {
  assert.deepEqual(calculerInstallation(120000), {
    lignes: [{ code: 'installation', quantite: 1, prix_unitaire: 120000, mois: 1, montant: 120000 }],
    recurrent_ht: 0, remise_taux: 0, remise_montant: 0, total_ht: 120000,
  });
  for (const frais of [0, -100, 1200.5, Number.NaN]) assert.equal(calculerInstallation(frais), null, String(frais));
});
