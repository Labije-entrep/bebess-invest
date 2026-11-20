// Migration 0014 (le bon d'installation) : la table `bon_a_facturer` est reconstruite. On l'éprouve sur une base qui a déjà ses lignes,
// c'est-à-dire telle qu'elle est en production : les bons, les numéros, les avoirs et les gardes de la base traversent la migration intacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliquer, baseNeuve, enrober } from './support/d1.ts';
import { poserContrat, poserTenant } from './support/monde.ts';

const COLONNES = 'id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, numero, annee, seq, emis_le, annule_le, cree_le, tva_taux, remise_motif, facture_cle';

function peupler(db: ReturnType<typeof baseNeuve>): void {
  poserTenant(db, 't1', 'Cabinet 1', 't1.test', '732829320');
  poserContrat(db, 't1');
  const bon = (id: string, type: string, debut: string, fin: string, statut: string, extra = '') =>
    db.exec(
      `INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht, remise_taux,
         remise_montant, total_ht, cree_le, tva_taux, remise_motif, facture_cle ${extra ? ', numero, annee, seq, emis_le' : ''})
       VALUES (?, 't1', 'c-t1', ?, ?, ?, ?, 2, '[{"code":"socle"}]', 94800, 2500, 23700, 71100, '2026-03-01', 2000, 'Réseau', ?${extra ? ", 'FACT-2026-0001', 2026, 1, '2026-03-20T10:00:00.000Z'" : ''})`,
      id, type, debut, fin, statut, statut === 'emise' ? 'factures/t1/b1.pdf' : null);
  bon('b1', 'periode', '2026-03-14', '2027-03-14', 'emise', 'numero');
  bon('b2', 'complementaire', '2026-11-20', '2027-03-14', 'brouillon');
  bon('b3', 'periode', '2027-03-14', '2028-03-14', 'brouillon');
  db.exec("INSERT INTO avoir (id, tenant_id, bon_id, numero, annee, seq, montant_ht, emis_le) VALUES ('a1', 't1', 'b1', 'AVOIR-2026-0001', 2026, 1, 71100, '2026-04-01')");
}

test('0014 : les bons, leurs numéros, l\'avoir et toutes les gardes traversent la reconstruction de la table', () => {
  const brut = baseNeuve('0013').brut;
  const db = enrober(brut);
  peupler(db);
  const avant = JSON.stringify(db.tous(`SELECT ${COLONNES} FROM bon_a_facturer ORDER BY id`));
  const schemaAvant = db.tous<{ name: string }>("SELECT name FROM sqlite_master WHERE tbl_name = 'bon_a_facturer' AND type IN ('index', 'trigger') ORDER BY name").map((r) => r.name);

  appliquer(brut, '0014_bon_installation.sql');

  assert.equal(JSON.stringify(db.tous(`SELECT ${COLONNES} FROM bon_a_facturer ORDER BY id`)), avant, 'aucune ligne n\'a changé');
  assert.deepEqual(db.tous('PRAGMA foreign_key_check'), [], 'l\'avoir désigne toujours son bon');
  assert.equal(db.compte('avoir'), 1);
  assert.equal(db.compte('sqlite_master', "name = 'bon_copie'"), 0, 'la table de copie a disparu');
  const apres = db.tous<{ name: string }>("SELECT name FROM sqlite_master WHERE tbl_name = 'bon_a_facturer' AND type IN ('index', 'trigger') ORDER BY name").map((r) => r.name);
  assert.deepEqual(apres, [...schemaAvant, 'idx_bon_installation'].sort(), 'les mêmes index et déclencheurs, plus celui des installations');

  // Les gardes de la base jouent toujours.
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET numero = 'FACT-2026-0999' WHERE id = 'b1'"), /numéro d'un bon émis ne change pas/);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET total_ht = 1 WHERE id = 'b1'"), /figé/);
  assert.throws(() => db.exec("DELETE FROM bon_a_facturer WHERE id = 'b3'"), /ne s'efface pas/);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET statut = 'brouillon' WHERE id = 'b1'"), /transition de statut interdite/);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET remise_taux = 6000 WHERE id = 'b3'"), /CHECK/);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET periode_fin = periode_debut WHERE id = 'b3'"), /CHECK/, 'seule l\'installation a une période d\'un jour');
  assert.throws(() => db.exec("UPDATE avoir SET montant_ht = 1"), /ne se modifie pas/);
  assert.throws(() => db.exec("DELETE FROM bon_a_facturer WHERE id = 'b1'"), /ne s'efface pas/);
  // Un second bon de la même période : toujours refusé.
  assert.throws(() => db.exec("INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, cree_le) VALUES ('x', 't1', 'c-t1', '2027-03-14', '2028-03-14', 0, '[]', 1, 0, 0, 1, 'now')"), /UNIQUE/);

  // Ce que la migration ajoute : le type 'installation', un seul par contrat.
  const installation = (id: string, debut: string) =>
    db.exec(`INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, cree_le)
             VALUES (?, 't1', 'c-t1', 'installation', ?, ?, 0, '[]', 0, 0, 0, 120000, 'now')`, id, debut, debut);
  installation('i1', '2026-11-01');
  assert.throws(() => installation('i2', '2026-11-05'), /UNIQUE/, 'un seul bon d\'installation par contrat');
  assert.equal(db.compte('bon_a_facturer', "type = 'installation'"), 1);
  // La numérotation continue après la migration : l'index de séquence est intact.
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET statut = 'emise', annee = 2026, seq = 1, numero = 'FACT-2026-0002', emis_le = 'x' WHERE id = 'i1'"), /UNIQUE/);
});

test('0013 sans 0014 : le type « installation » est refusé par la base ; avec 0014, il est admis', () => {
  const brut = baseNeuve('0013').brut;
  const db = enrober(brut);
  poserTenant(db, 't1', 'Cabinet 1', 't1.test');
  poserContrat(db, 't1');
  const poser = () =>
    db.exec(`INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, cree_le)
             VALUES ('i', 't1', 'c-t1', 'installation', '2026-11-01', '2026-11-01', 0, '[]', 0, 0, 0, 120000, 'now')`);
  assert.throws(poser, /CHECK/);
  appliquer(brut, '0014_bon_installation.sql');
  poser();
  assert.equal(db.compte('bon_a_facturer'), 1);
});
