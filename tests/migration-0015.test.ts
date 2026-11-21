// La migration 0015 rejouée sur l'ancien schéma (0014) : un bon FACT- déjà émis, un bon annulé avec son avoir, un brouillon.
// Rien ne se perd, les clés étrangères restent saines, la séquence continue (BC-… à la suite de FACT-…), l'avoir disparaît.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliquerMigration, baseNeuve } from './support/d1.ts';
import { poserContrat, poserTenant } from './support/monde.ts';
import { emettreBon } from '../src/lib/facturation';

const EDITEUR = { id: 'u-editeur', role: 'editeur' as const };

test('migration 0015 : bons FACT- conservés, avoir supprimé, BC- accepté, séquence continue', async () => {
  const db = baseNeuve('0014');
  poserTenant(db, 'ta', 'Cabinet A', 'a.test', null);
  const contrat = poserContrat(db, 'ta', { module_pilotage: 0, module_site: 0 });
  const bon = (id: string, debut: string, fin: string) =>
    db.exec(
      `INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, cree_le)
       VALUES (?, 'ta', ?, ?, ?, 2, '[]', 1000, 0, 0, 1000, '2026-11-19')`, id, contrat, debut, fin);
  bon('b-emis', '2025-03-14', '2026-03-14');
  bon('b-annule', '2024-03-14', '2025-03-14');
  bon('b-brouillon', '2026-03-14', '2027-03-14');
  const annee = new Date().getUTCFullYear();
  db.exec("UPDATE bon_a_facturer SET statut='emise', annee=?, seq=1, numero=?, emis_le='2026-11-19T10:00:00.000Z' WHERE id='b-emis'", annee, `FACT-${annee}-0001`);
  db.exec("UPDATE bon_a_facturer SET statut='emise', annee=?, seq=2, numero=?, emis_le='2026-11-19T10:00:00.000Z' WHERE id='b-annule'", annee, `FACT-${annee}-0002`);
  db.exec("UPDATE bon_a_facturer SET statut='annulee', annule_le='2026-11-20T10:00:00.000Z' WHERE id='b-annule'");
  db.exec("INSERT INTO avoir (id, tenant_id, bon_id, numero, annee, seq, montant_ht, emis_le) VALUES ('av1','ta','b-annule',?,?,1,1000,'2026-11-20T10:00:00.000Z')", `AVOIR-${annee}-0001`, annee);
  const avant = db.tous('SELECT * FROM bon_a_facturer ORDER BY id');

  appliquerMigration(db, '0015');

  assert.deepEqual(db.tous('SELECT * FROM bon_a_facturer ORDER BY id'), avant, 'aucune ligne perdue ni modifiée');
  assert.equal(db.un("SELECT name FROM sqlite_master WHERE name = 'avoir'"), null, 'table avoir supprimée');
  assert.deepEqual(db.tous('PRAGMA foreign_key_check'), [], 'clés étrangères saines');
  for (const t of ['bon_pas_de_suppression', 'bon_numero_definitif', 'bon_emis_fige', 'bon_statut_sens']) {
    assert.ok(db.un("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name = ?", t), `déclencheur ${t} recréé`);
  }
  assert.ok(db.un("SELECT 1 FROM sqlite_master WHERE name = 'idx_bon_sequence'"), 'index (annee, seq) recréé');

  // Le numéro d'un bon émis ne change pas ; le nouveau est BC-, à la suite de la séquence existante.
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET numero = 'BC-2026-0099' WHERE id = 'b-emis'"), /numéro d'un bon émis ne change pas/);
  assert.equal((await emettreBon(db, 'ta', 'b-brouillon', EDITEUR, { malgreIdentiteIncomplete: true })).ok, true);
  assert.equal(db.un<{ numero: string }>("SELECT numero FROM bon_a_facturer WHERE id = 'b-brouillon'")!.numero, `BC-${annee}-0003`);
  // Ni un préfixe quelconque, ni un doublon de séquence.
  assert.throws(() => db.exec("INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, numero, cree_le) VALUES ('x','ta',?, '2020-01-01','2021-01-01',0,'[]',0,0,0,0,'XX-2026-0001','2026-01-01')", contrat), /CHECK/);
});
