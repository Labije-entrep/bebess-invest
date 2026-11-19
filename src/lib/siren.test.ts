// Tests de siren.ts : neuf chiffres, clé de Luhn. `npm test` (node:test, sans dépendance).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afficherSiren, erreurSiren, luhn, normaliserSiren, sirenValide } from './siren.ts';

test('des SIREN réels sont justes, avec ou sans espaces', () => {
  for (const s of ['443061841', '552081317', '732829320', '443 061 841', '552.081.317']) assert.equal(sirenValide(s), true, s);
});

test('une clé de contrôle fausse est refusée', () => {
  assert.equal(erreurSiren('443061842'), 'cle');
  assert.equal(erreurSiren('123456789'), 'cle');
  assert.equal(sirenValide('552081318'), false);
});

test('ni huit, ni dix chiffres, ni une lettre, ni du vide', () => {
  for (const s of ['44306184', '4430618411', '44306184A', 'abcdefghi', '', '   ']) assert.equal(erreurSiren(s), 'format', JSON.stringify(s));
});

test('Luhn : la somme doit être un multiple de dix', () => {
  assert.equal(luhn('79927398713'), true); // l'exemple classique de la norme
  assert.equal(luhn('79927398710'), false);
});

test('normaliser et afficher', () => {
  assert.equal(normaliserSiren(' 443 061 841 '), '443061841');
  assert.equal(afficherSiren('443061841'), '443 061 841');
});
