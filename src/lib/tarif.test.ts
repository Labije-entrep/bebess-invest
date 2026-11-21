// Tests de tarif.ts. `npm test` (node:test, sans dépendance). Les montants sont en centimes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ajouterMois, calculerBon, calculerComplementaire, calculerCreditProrata, compterAccesFacturables, dateEffetPreavis, moisArrondisAuSuperieur, moisEntiersRestants,
  periodeAu, periodesDebutant, plafondRemise, retenirRemises, totauxDuBon, prixMensuel, prochainAnniversaire, tauxParrainage, tauxRemise, type EntreeBon,
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

// ------------------------------------------------------------------ 21/11/2026 : prorata d'un accès, remises ponctuelles, crédit

test('prorata d\'un accès supplémentaire : mêmes mois que le module (arrondis au supérieur), au prix prix_acces_sup', () => {
  const brut = (activation: string, quantite = 1) =>
    calculerComplementaire({ periodicite: 'annuelle', modules: [], acces_sup: { quantite, prix: 2500 }, activation, anniversaire: '2027-03-14', remise_taux: 0 });
  assert.deepEqual(brut('2026-11-20')?.lignes, [{ code: 'acces_sup', quantite: 1, prix_unitaire: 2500, mois: 4, montant: 10000 }]);
  assert.equal(brut('2027-03-02')?.total_ht, 2500);
  assert.equal(brut('2026-11-20', 2)?.total_ht, 20000);
  assert.equal(brut('2027-03-14'), null, 'plus rien à courir');
  assert.equal(calculerComplementaire({ periodicite: 'mensuelle', modules: [], acces_sup: { quantite: 1, prix: 2500 }, activation: '2026-11-20', anniversaire: '2026-12-14', remise_taux: 0 }), null);
  // Un module et un accès le même jour : un seul bon, la remise en % sur le tout.
  const les_deux = calculerComplementaire({ periodicite: 'annuelle', modules: [{ code: 'pilotage', prix: 4900 }], acces_sup: { quantite: 1, prix: 2500 }, activation: '2026-11-20', anniversaire: '2027-03-14', remise_taux: 1000 });
  assert.deepEqual([les_deux?.recurrent_ht, les_deux?.remise_montant, les_deux?.total_ht], [29600, 2960, 26640]);
});

test('mois entiers restants arrondis à l\'inférieur (le crédit) ; le crédit de prorata : prix × mois non entamés, jamais en mensuel', () => {
  assert.equal(moisEntiersRestants('2026-11-20', '2027-03-14'), 3);
  assert.equal(moisEntiersRestants('2026-11-14', '2027-03-14'), 4, 'quatre mois pleins');
  assert.equal(moisEntiersRestants('2027-03-02', '2027-03-14'), 0);
  assert.equal(moisEntiersRestants('2027-03-14', '2027-03-14'), 0);
  assert.deepEqual(calculerCreditProrata({ periodicite: 'annuelle', prix_acces_sup: 2500, jour: '2026-11-20', anniversaire: '2027-03-14' }), { mois: 3, montant: 7500 });
  assert.equal(calculerCreditProrata({ periodicite: 'annuelle', prix_acces_sup: 2500, jour: '2027-03-02', anniversaire: '2027-03-14' }), null, 'aucun mois entier : pas de crédit');
  assert.equal(calculerCreditProrata({ periodicite: 'mensuelle', prix_acces_sup: 2500, jour: '2026-11-20', anniversaire: '2026-12-14' }), null);
});

test('remises ponctuelles : retenues dans la limite de leur ligne, dans l\'ordre ; le surplus d\'un crédit se replie sur le récurrent', () => {
  const lignes = [
    { code: 'socle' as const, quantite: 1, prix_unitaire: 7900, mois: 12, montant: 94800 },
    { code: 'pilotage' as const, quantite: 1, prix_unitaire: 4900, mois: 12, montant: 58800 },
  ];
  assert.deepEqual(retenirRemises(lignes, [{ code: 'socle', montant: 100000 }, { code: 'socle', montant: 5 }, { code: 'site', montant: 500 }]), [94800, 0, 0]);
  assert.deepEqual(retenirRemises(lignes, [{ code: 'acces_sup', montant: 7500, repli: true }]), [7500], 'pas de ligne d\'accès : imputé sur le récurrent');
  assert.equal(plafondRemise(lignes, [{ code: 'socle', montant: 800 }], 'socle'), 94000);
});

test('totaux d\'un bon : remises ponctuelles d\'abord, remise en % sur le reste, au centime sans flottant, jamais négatif', () => {
  const lignes = [
    { code: 'socle' as const, quantite: 1, prix_unitaire: 7900, mois: 12, montant: 94800 },
    { code: 'acces_sup' as const, quantite: 1, prix_unitaire: 2500, mois: 12, montant: 30000 },
  ];
  assert.deepEqual(totauxDuBon(lignes, 0), { recurrent_ht: 124800, remise_ponctuelle_montant: 0, remise_montant: 0, total_ht: 124800 });
  // (124 800 − 3 333) × 12,5 % = 15 183,375 → 15 183 ; total 106 284
  assert.deepEqual(totauxDuBon(lignes, 1250, [{ code: 'acces_sup', montant: 3333 }]), { recurrent_ht: 124800, remise_ponctuelle_montant: 3333, remise_montant: 15183, total_ht: 106284 });
  assert.equal(totauxDuBon(lignes, 5000, [{ code: 'socle', montant: 94800 }, { code: 'acces_sup', montant: 30000 }]).total_ht, 0);
  // Bon d'installation : une ligne, sans remise en pourcentage.
  const inst = [{ code: 'installation' as const, quantite: 1, prix_unitaire: 90000, mois: 1, montant: 90000 }];
  assert.deepEqual(totauxDuBon(inst, 0, [{ code: 'installation', montant: 10000 }]), { recurrent_ht: 0, remise_ponctuelle_montant: 10000, remise_montant: 0, total_ht: 80000 });
});
