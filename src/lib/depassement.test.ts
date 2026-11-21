// Tests de depassement.ts et des ajouts de tarif.ts du lot 13 (TVA, motif de la remise). Les montants sont en centimes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateAnniversaire, phraseCreationAcces, phraseDepassement, type ContratDepassement } from './depassement.ts';
import { calculerTva, motifRemise, tauxEnTexte } from './tarif.ts';

const ANNUEL: ContratDepassement = { periodicite: 'annuelle', debut_le: '2026-03-14', date_fin_essai: null, acces_inclus: 3, prix_acces_sup: 2500 };

test('la confirmation dit d\'abord le dépassement, puis son effet, avec la date anniversaire', () => {
  assert.deepEqual(phraseCreationAcces(ANNUEL, 4, '2026-11-20'), {
    constat: 'Vous dépassez les 3 accès inclus dans votre contrat : 4 accès facturables.',
    effet: "Ce 4ᵉ accès est offert jusqu'au 14/03/2027, puis facturé 25 € HT par mois.",
  });
  const p = phraseCreationAcces(ANNUEL, 4, '2026-11-20')!;
  assert.doesNotMatch(p.constat + p.effet, /gratuit/);
});

test('la date est la prochaine date anniversaire, jamais une date passée', () => {
  assert.equal(dateAnniversaire(ANNUEL, '2026-11-20'), '2027-03-14');
  assert.equal(dateAnniversaire(ANNUEL, '2027-03-14'), '2028-03-14');
  assert.equal(dateAnniversaire({ ...ANNUEL, periodicite: 'mensuelle' }, '2026-11-20'), '2026-12-14');
});

test('un contrat en essai, sans début, donne la fin de son essai ; sans aucune date, pas de phrase', () => {
  const essai = { ...ANNUEL, debut_le: null, date_fin_essai: '2027-01-05' };
  assert.equal(dateAnniversaire(essai, '2026-11-20'), '2027-01-05');
  assert.equal(phraseCreationAcces({ ...essai, date_fin_essai: null }, 4, '2026-11-20'), null);
});

test('un contrat mensuel paie ses accès au prix mensuel (25 € → 29 €) ; le constat suit les accès inclus et le décompte', () => {
  assert.match(phraseCreationAcces({ ...ANNUEL, periodicite: 'mensuelle' }, 4, '2026-11-20')?.effet ?? '', /facturé 29 € HT par mois\.$/);
  assert.equal(phraseCreationAcces({ ...ANNUEL, acces_inclus: 5 }, 6, '2026-11-20')?.constat, 'Vous dépassez les 5 accès inclus dans votre contrat : 6 accès facturables.');
  assert.match(phraseCreationAcces({ ...ANNUEL, acces_inclus: 5 }, 7, '2026-11-20')?.effet ?? '', /^Ce 7ᵉ accès est offert/);
});

test('la phrase de la page n’existe que si les accès facturables dépassent les inclus', () => {
  assert.equal(phraseDepassement(ANNUEL, 3, '2026-11-20'), null);
  assert.equal(phraseDepassement(ANNUEL, 0, '2026-11-20'), null);
  assert.match(phraseDepassement(ANNUEL, 4, '2026-11-20') ?? '', /^1 accès facturable dépasse les 3 inclus\./);
  assert.match(phraseDepassement(ANNUEL, 6, '2026-11-20') ?? '', /^3 accès facturables dépassent les 3 inclus\./);
});

test('TVA : 20 % au centime, le demi-centime monte', () => {
  assert.deepEqual(calculerTva(160200), { tva_taux: 2000, tva_montant: 32040, total_ttc: 192240 });
  assert.deepEqual(calculerTva(1, 2000), { tva_taux: 2000, tva_montant: 0, total_ttc: 1 });
  assert.equal(calculerTva(3, 2000).tva_montant, 1); // 0,6 centime
  assert.equal(calculerTva(0).total_ttc, 0);
});

test('le motif de la remise est écrit en clair, avec le motif du contrat pour la part commerciale', () => {
  assert.equal(motifRemise({ parrainages_valides: 0, remise_commerciale_taux: 0, motif_commercial: 'ignoré' }), null);
  assert.equal(motifRemise({ parrainages_valides: 1, remise_commerciale_taux: 0, motif_commercial: null }), 'Parrainage : 1 parrainage validé, 25 %');
  assert.equal(
    motifRemise({ parrainages_valides: 0, remise_commerciale_taux: 1000, motif_commercial: ' Accord de lancement ' }),
    'Remise commerciale de 10 % : Accord de lancement',
  );
  assert.equal(
    motifRemise({ parrainages_valides: 2, remise_commerciale_taux: 1000, motif_commercial: 'Lancement' }),
    'Parrainage : 2 parrainages validés, 50 % ; remise commerciale de 10 % : Lancement ; remise plafonnée à 50 %',
  );
  assert.equal(tauxEnTexte(1250), '12,5 %');
});
