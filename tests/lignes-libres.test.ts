// Facturation du 22/11/2026 : la ligne libre ponctuelle sur un bon brouillon, le bon ponctuel « prestation » et la migration 0018.
// Montants en centimes entiers, hors taxes, TVA à 20 %. Les bons ÉMIS sont posés par le code réel (emettreBon) : seul l'ordre des numéros compte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliquerMigration, baseNeuve, type BaseTest } from './support/d1.ts';
import { poserContrat, poserTenant, nouveauCompte, type Contrat } from './support/monde.ts';
import { environnement } from './support/serveur.ts';
import { traitementQuotidien } from '../src/lib/traitement';
import { annulerBon, bonComplet, emettreBon } from '../src/lib/facturation';
import { enregistrerPreavis } from '../src/lib/contrat';
import { eurosEnCentimes, poserRemise } from '../src/lib/remises';
import { creerBonPrestation, lireQuantite, modifierLigneLibre, poserLigneLibre, supprimerLigneLibre, validerLigneLibre } from '../src/lib/lignes-libres';
import { ligneLibreAgregee, montantLigneLibre, totauxDuBon, type LigneBon } from '../src/lib/tarif';

const EDITEUR = { id: 'u-editeur', role: 'editeur' as const };
const ASSOCIE = { id: 'u-associe', role: 'associe' as const };

let n = 0;
function cabinet(db: BaseTest, c: Partial<Contrat> = {}) {
  const id = `l${++n}`;
  poserTenant(db, id, `Cabinet ${id}`, `${id}.test`, null);
  db.exec("UPDATE tenant SET siren = ?, adresse_facturation = '1 rue du Test', contact_facturation = 'compta@test.fr' WHERE id = ?", String(300000000 + n), id);
  const contrat = poserContrat(db, id, { module_pilotage: 0, module_site: 0, acces_inclus: 3, ...c });
  for (let i = 0; i < 2; i++) nouveauCompte(db, id, 'associe', `associe${i}@${id}.test`);
  return { id, contrat };
}
const passe = (env: ReturnType<typeof environnement>, jour: string) =>
  traitementQuotidien(env, { maintenant: new Date(`${jour}T03:00:00Z`), mailer: () => ({ envoyer: async () => {} }) });
const bonsDe = (db: BaseTest, t: string) => db.tous<{ id: string; type: string; statut: string; total_ht: number; recurrent_ht: number; remise_montant: number; lignes_libres_ht: number; remise_ponctuelle_montant: number }>('SELECT * FROM bon_a_facturer WHERE tenant_id = ? ORDER BY periode_debut, type', t);

/** Un cabinet annuel dont le bon de la période est un brouillon (posé 30 jours avant l'anniversaire). */
async function brouillon(taux = 0) {
  const db = baseNeuve();
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-12-01', remise_commerciale_taux: taux, remise_motif: taux ? 'Lancement' : null });
  const env = environnement(db);
  await passe(env, '2026-11-19');
  const bon = bonsDe(db, c.id)[0];
  return { db, c, env, bon };
}
const LIGNE = { libelle: 'Mise en place du site', quantite: 3, prix_unitaire: 12345, motif: 'Devis 2026-14' };

// ------------------------------------------------------------------ le calcul pur

test('calcul : quantité × prix au centime, en entiers, additionné au total ; TVA 20 % exacte', () => {
  assert.equal(montantLigneLibre(3, 12345), 37035);
  assert.equal(montantLigneLibre(7, 10), 70, 'pas de flottant : 7 × 0,10 €');
  assert.deepEqual(ligneLibreAgregee([]), []);
  const libres = ligneLibreAgregee([{ quantite: 3, prix_unitaire: 12345 }, { quantite: 1, prix_unitaire: 5 }]);
  assert.equal(libres[0].montant, 37040);
  const socle: LigneBon = { code: 'socle', quantite: 1, prix_unitaire: 7900, mois: 12, montant: 94800 };
  // La remise en pourcentage (10 %) ne porte que sur le récurrent : 94 800 − 9 480 + 370,40 €.
  assert.deepEqual(totauxDuBon([socle, ...libres], 1000), { recurrent_ht: 94800, remise_ponctuelle_montant: 0, remise_montant: 9480, total_ht: 94800 - 9480 + 37040 });
  // Une remise ponctuelle sur les lignes libres ne dépasse pas leur montant et ne touche pas le récurrent.
  const t = totauxDuBon([socle, ...libres], 0, [{ code: 'libre', montant: 99999 }]);
  assert.deepEqual([t.remise_ponctuelle_montant, t.total_ht], [37040, 94800]);
});

test('validation : libellé obligatoire et 120 caractères au plus, quantité entière, prix strictement positif, motif borné', () => {
  const v = (o: object) => validerLigneLibre({ ...LIGNE, ...o });
  assert.equal(v({}).ok, true);
  assert.deepEqual(v({ libelle: '   ' }), { ok: false, code: 'libelle_requis' });
  assert.equal(v({ libelle: 'x'.repeat(120) }).ok, true);
  assert.deepEqual(v({ libelle: 'x'.repeat(121) }), { ok: false, code: 'libelle_trop_long' });
  assert.deepEqual(v({ quantite: 0 }), { ok: false, code: 'quantite_invalide' });
  assert.deepEqual(v({ quantite: 1.5 }), { ok: false, code: 'quantite_invalide' });
  assert.deepEqual(v({ prix_unitaire: 0 }), { ok: false, code: 'prix_invalide' });
  assert.deepEqual(v({ prix_unitaire: -5 }), { ok: false, code: 'prix_invalide' });
  assert.deepEqual(v({ motif: 'm'.repeat(201) }), { ok: false, code: 'motif_trop_long' });
  assert.equal(lireQuantite(''), 1);
  assert.equal(lireQuantite('4'), 4);
  assert.equal(lireQuantite('1,5'), null);
  assert.equal(lireQuantite('abc'), null);
  assert.equal(eurosEnCentimes('123,45'), 12345);
  assert.equal(eurosEnCentimes('12,345'), null);
});

// ------------------------------------------------------------------ sur un brouillon

test('ligne libre : posée sur un brouillon, elle entre dans le total, la TVA et le TTC ; la remise en % ne s\'y applique pas', async () => {
  const { db, c, bon } = await brouillon(1000);
  const avant = bonsDe(db, c.id)[0];
  const r = await poserLigneLibre(db, c.id, bon.id, LIGNE, EDITEUR);
  assert.equal(r.ok, true);
  const apres = bonsDe(db, c.id)[0];
  assert.equal(apres.lignes_libres_ht, 37035);
  assert.equal(apres.remise_montant, avant.remise_montant, 'la remise en pourcentage porte sur le récurrent seul');
  assert.equal(apres.total_ht, avant.total_ht + 37035);
  const complet = (await bonComplet(db, bon.id))!;
  assert.deepEqual(complet.lignes_libres.map((l) => [l.libelle, l.quantite, l.prix_unitaire, l.montant, l.motif]), [['Mise en place du site', 3, 12345, 37035, 'Devis 2026-14']]);
  assert.equal(complet.lignes.some((l) => l.code === 'libre'), false, 'les lignes du bon restent celles du contrat');
  assert.equal(complet.tva_montant, Math.floor((complet.total_ht * 2000 + 5000) / 10000));
  assert.equal(complet.total_ttc, complet.total_ht + complet.tva_montant);
  // Un centime : 1 × 0,01 €, TVA 0,00 € ; trois lignes : somme exacte.
  assert.equal((await poserLigneLibre(db, c.id, bon.id, { libelle: 'Centime', quantite: 1, prix_unitaire: 1 }, EDITEUR)).ok, true);
  assert.equal(bonsDe(db, c.id)[0].lignes_libres_ht, 37036);
});

test('ligne libre : modifiable et supprimable tant que le bon est brouillon ; journalisée sans le libellé ni le motif', async () => {
  const { db, c, bon } = await brouillon();
  const avant = bonsDe(db, c.id)[0].total_ht;
  const { id } = (await poserLigneLibre(db, c.id, bon.id, LIGNE, EDITEUR)) as { id: string };
  assert.equal((await modifierLigneLibre(db, c.id, id, { ...LIGNE, quantite: 1, prix_unitaire: 5000 }, EDITEUR)).ok, true);
  assert.equal(bonsDe(db, c.id)[0].total_ht, avant + 5000);
  assert.equal((await supprimerLigneLibre(db, c.id, id, EDITEUR)).ok, true);
  assert.equal(bonsDe(db, c.id)[0].total_ht, avant);
  assert.equal(bonsDe(db, c.id)[0].lignes_libres_ht, 0);
  for (const t of ['ligne_libre_posee', 'ligne_libre_modifiee', 'ligne_libre_supprimee']) assert.equal(db.compte('evenement', 'type = ? AND tenant_id = ?', t, c.id), 1, t);
  const journal = db.tous<{ detail: string }>("SELECT detail FROM evenement WHERE type LIKE 'ligne_libre_%'").map((e) => e.detail).join(' ');
  assert.doesNotMatch(journal, /Mise en place|Devis/, 'ni libellé ni motif dans le journal');
});

test('ligne libre : refus sans rien écrire (libellé, quantité, prix) ; éditeur seulement ; cloisonnée par cabinet', async () => {
  const { db, c, bon } = await brouillon();
  const autre = cabinet(db, {});
  const total = bonsDe(db, c.id)[0].total_ht;
  assert.deepEqual(await poserLigneLibre(db, c.id, bon.id, { ...LIGNE, libelle: '' }, EDITEUR), { ok: false, code: 'libelle_requis' });
  assert.deepEqual(await poserLigneLibre(db, c.id, bon.id, { ...LIGNE, quantite: 0 }, EDITEUR), { ok: false, code: 'quantite_invalide' });
  assert.deepEqual(await poserLigneLibre(db, c.id, bon.id, LIGNE, ASSOCIE), { ok: false, code: 'interdit' });
  assert.deepEqual(await poserLigneLibre(db, autre.id, bon.id, LIGNE, EDITEUR), { ok: false, code: 'introuvable' });
  const { id } = (await poserLigneLibre(db, c.id, bon.id, LIGNE, EDITEUR)) as { id: string };
  assert.deepEqual(await modifierLigneLibre(db, autre.id, id, LIGNE, EDITEUR), { ok: false, code: 'introuvable' });
  assert.deepEqual(await supprimerLigneLibre(db, autre.id, id, EDITEUR), { ok: false, code: 'introuvable' });
  assert.deepEqual(await supprimerLigneLibre(db, c.id, id, ASSOCIE), { ok: false, code: 'interdit' });
  assert.equal(db.compte('ligne_libre'), 1);
  assert.equal(bonsDe(db, c.id)[0].total_ht, total + 37035);
});

test('ligne libre : elle survit aux recalculs du brouillon par le traitement quotidien', async () => {
  const { db, c, env, bon } = await brouillon(1000);
  await poserLigneLibre(db, c.id, bon.id, LIGNE, EDITEUR);
  const posee = bonsDe(db, c.id)[0];
  // Un accès de plus : le traitement recalcule le brouillon (accès supplémentaire), les lignes libres restent.
  for (let i = 0; i < 2; i++) nouveauCompte(db, c.id, 'associe', `autre${i}@${c.id}.test`);
  await passe(env, '2026-11-20');
  const [apres] = bonsDe(db, c.id);
  assert.notEqual(apres.recurrent_ht, posee.recurrent_ht, 'le brouillon a bien été recalculé');
  assert.equal(apres.lignes_libres_ht, 37035);
  assert.equal(db.compte('ligne_libre'), 1);
  const t = totauxDuBon(JSON.parse(db.un<{ lignes: string }>('SELECT lignes FROM bon_a_facturer WHERE id = ?', bon.id)!.lignes), 1000);
  assert.equal(apres.total_ht, t.total_ht + 37035, 'total = récurrent remisé + lignes libres');
  const avant = apres.total_ht;
  await passe(env, '2026-11-20');
  assert.equal(bonsDe(db, c.id)[0].total_ht, avant, 'rejoué, rien ne bouge');
});

test('ligne libre : figée à l\'émission ; un bon émis ou annulé n\'accepte plus rien, la base non plus', async () => {
  const { db, c, bon } = await brouillon();
  const { id } = (await poserLigneLibre(db, c.id, bon.id, LIGNE, EDITEUR)) as { id: string };
  const total = bonsDe(db, c.id)[0].total_ht;
  assert.equal((await emettreBon(db, c.id, bon.id, EDITEUR)).ok, true);
  assert.deepEqual(await poserLigneLibre(db, c.id, bon.id, LIGNE, EDITEUR), { ok: false, code: 'pas_brouillon' });
  assert.deepEqual(await modifierLigneLibre(db, c.id, id, LIGNE, EDITEUR), { ok: false, code: 'pas_brouillon' });
  assert.deepEqual(await supprimerLigneLibre(db, c.id, id, EDITEUR), { ok: false, code: 'pas_brouillon' });
  assert.throws(() => db.exec('UPDATE ligne_libre SET prix_unitaire = 1 WHERE id = ?', id), /figé/);
  assert.throws(() => db.exec('DELETE FROM ligne_libre WHERE id = ?', id), /figé/);
  assert.throws(() => db.exec("INSERT INTO ligne_libre (id, tenant_id, contrat_id, bon_id, libelle, quantite, prix_unitaire, cree_le, maj_le) SELECT 'x', tenant_id, contrat_id, id, 'x', 1, 1, 'a', 'a' FROM bon_a_facturer WHERE id = ?", bon.id), /figé/);
  assert.throws(() => db.exec('UPDATE bon_a_facturer SET lignes_libres_ht = 0 WHERE id = ?', bon.id), /figé/);
  assert.equal(bonsDe(db, c.id)[0].total_ht, total);
  await annulerBon(db, c.id, bon.id, EDITEUR);
  assert.deepEqual(await supprimerLigneLibre(db, c.id, id, EDITEUR), { ok: false, code: 'pas_brouillon' });
  assert.equal((await bonComplet(db, bon.id))!.lignes_libres.length, 1, 'la ligne reste lisible sur le bon annulé');
});

test('ligne libre : une remise ponctuelle peut la viser, sans dépasser son montant ; la dernière ligne supprimée emporte la remise', async () => {
  const { db, c, bon } = await brouillon();
  const { id } = (await poserLigneLibre(db, c.id, bon.id, { libelle: 'Formation', quantite: 2, prix_unitaire: 10000 }, EDITEUR)) as { id: string };
  assert.deepEqual(await poserRemise(db, c.id, bon.id, { code_ligne: 'libre', montant: 20001, motif: 'Trop' }, EDITEUR), { ok: false, code: 'depasse_ligne', plafond: 20000 });
  assert.equal((await poserRemise(db, c.id, bon.id, { code_ligne: 'libre', montant: 5000, motif: 'Geste' }, EDITEUR)).ok, true);
  const t = bonsDe(db, c.id)[0];
  assert.equal(t.remise_ponctuelle_montant, 5000);
  const complet = (await bonComplet(db, bon.id))!;
  assert.deepEqual(complet.remises_ponctuelles.map((x) => [x.code_ligne, x.montant]), [['libre', 5000]]);
  assert.equal(complet.total_ht, complet.recurrent_ht + 20000 - 5000 - complet.remise_montant);
  // Sans ligne libre, on ne peut pas viser « libre ».
  await supprimerLigneLibre(db, c.id, id, EDITEUR);
  assert.equal(db.compte('remise_ponctuelle', "code_ligne = 'libre'"), 0);
  assert.deepEqual(await poserRemise(db, c.id, bon.id, { code_ligne: 'libre', montant: 100, motif: 'x' }, EDITEUR), { ok: false, code: 'ligne_inconnue' });
});

// ------------------------------------------------------------------ le bon prestation

test('bon prestation : créé pour un cabinet sans brouillon, numéroté BC- dans la séquence commune, jamais vide', async () => {
  const db = baseNeuve();
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' }); // aucun bon ouvert
  assert.equal(bonsDe(db, c.id).length, 0);
  const r = await creerBonPrestation(db, c.id, EDITEUR, '2026-11-22');
  assert.equal(r.ok, true);
  const bonId = (r as { id: string }).id;
  assert.deepEqual(await emettreBon(db, c.id, bonId, EDITEUR, { malgreIdentiteIncomplete: true }), { ok: false, code: 'prestation_vide' });
  assert.equal(db.un<{ numero: string | null }>('SELECT numero FROM bon_a_facturer WHERE id = ?', bonId)!.numero, null, 'un refus ne consomme aucun numéro');
  await poserLigneLibre(db, c.id, bonId, { libelle: 'Mise en place du site', quantite: 1, prix_unitaire: 150000 }, EDITEUR);
  const complet = (await bonComplet(db, bonId))!;
  assert.deepEqual([complet.type, complet.total_ht, complet.tva_montant, complet.total_ttc, complet.lignes.length], ['prestation', 150000, 30000, 180000, 0]);
  const e = await emettreBon(db, c.id, bonId, EDITEUR);
  assert.equal(e.ok, true);
  const numero = db.un<{ numero: string; annee: number; seq: number }>('SELECT numero, annee, seq FROM bon_a_facturer WHERE id = ?', bonId)!;
  assert.match(numero.numero, /^BC-\d{4}-0001$/);
  // Un autre bon (autre type, autre cabinet) reçoit le numéro suivant de la MÊME séquence annuelle.
  const c2 = cabinet(db, {});
  const b2 = (await creerBonPrestation(db, c2.id, EDITEUR, '2026-11-22')) as { id: string };
  await poserLigneLibre(db, c2.id, b2.id, { libelle: 'Autre', quantite: 2, prix_unitaire: 100 }, EDITEUR);
  await emettreBon(db, c2.id, b2.id, EDITEUR, { malgreIdentiteIncomplete: true });
  assert.equal(db.un<{ seq: number }>('SELECT seq FROM bon_a_facturer WHERE id = ?', b2.id)!.seq, numero.seq + 1);
});

test('bon prestation : plusieurs le même jour, éditeur seulement, contrat nécessaire, cloisonné ; il ne gêne ni le bon périodique ni le préavis', async () => {
  const db = baseNeuve();
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-12-01' });
  const sans = 'sans-contrat';
  poserTenant(db, sans, 'Sans contrat', 'sans.test', null);
  assert.deepEqual(await creerBonPrestation(db, c.id, ASSOCIE, '2026-11-22'), { ok: false, code: 'interdit' });
  assert.deepEqual(await creerBonPrestation(db, sans, EDITEUR, '2026-11-22'), { ok: false, code: 'contrat_absent' });
  const a = (await creerBonPrestation(db, c.id, EDITEUR, '2026-11-22')) as { id: string };
  const b = (await creerBonPrestation(db, c.id, EDITEUR, '2026-11-22')) as { id: string };
  assert.notEqual(a.id, b.id);
  assert.deepEqual(await poserLigneLibre(db, sans, a.id, LIGNE, EDITEUR), { ok: false, code: 'introuvable' });
  // Le traitement pose quand même le bon périodique (le bon prestation n'est pas « un bon de période »).
  await passe(environnement(db), '2026-11-19');
  assert.deepEqual(bonsDe(db, c.id).map((x) => x.type).sort(), ['periode', 'prestation', 'prestation']);
  // Un préavis (effet = anniversaire) n'annule pas un bon de prestation daté après la date d'effet.
  const futur = (await creerBonPrestation(db, c.id, EDITEUR, '2027-12-02')) as { id: string };
  assert.equal((await enregistrerPreavis(db, c.id, '2026-11-01', EDITEUR, '2026-11-20')).ok, true);
  assert.equal(db.un<{ statut: string }>('SELECT statut FROM bon_a_facturer WHERE id = ?', futur.id)!.statut, 'brouillon');
  // La base refuse un bon prestation qui porterait du récurrent ou un second bon périodique sur la même période.
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET recurrent_ht = 5 WHERE id = ?", a.id), /CHECK/);
  const periodique = bonsDe(db, c.id).find((x) => x.type === 'periode')!;
  assert.throws(
    () => db.exec("INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, cree_le) SELECT 'dup', tenant_id, contrat_id, 'periode', periode_debut, periode_fin, 0, '[]', 0, 0, 0, 0, 'a' FROM bon_a_facturer WHERE id = ?", periodique.id),
    /UNIQUE/,
  );
});

// ------------------------------------------------------------------ la migration 0018

test('migration 0018 rejouée sur le schéma 0017 : bons émis, annulés, brouillons et remises conservés, invariants gardés', async () => {
  const db = baseNeuve('0017');
  poserTenant(db, 'ta', 'Cabinet A', 'a.test', null);
  const contrat = poserContrat(db, 'ta', { module_pilotage: 0, module_site: 0 });
  const bon = (id: string, debut: string, fin: string) =>
    db.exec(
      `INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, cree_le)
       VALUES (?, 'ta', ?, ?, ?, 2, '[{"code":"socle","quantite":1,"prix_unitaire":7900,"mois":12,"montant":94800}]', 94800, 0, 0, 94800, '2026-11-19')`, id, contrat, debut, fin);
  bon('b-emis', '2025-03-14', '2026-03-14');
  bon('b-annule', '2024-03-14', '2025-03-14');
  bon('b-brouillon', '2026-03-14', '2027-03-14');
  db.exec("UPDATE bon_a_facturer SET statut='emise', annee=2025, seq=1, numero='FACT-2025-0001', emis_le='2025-03-01T10:00:00.000Z' WHERE id='b-emis'");
  db.exec("UPDATE bon_a_facturer SET statut='emise', annee=2025, seq=2, numero='BC-2025-0002', emis_le='2025-03-02T10:00:00.000Z' WHERE id='b-annule'");
  db.exec("UPDATE bon_a_facturer SET statut='annulee', annule_le='2025-03-03T10:00:00.000Z' WHERE id='b-annule'");
  db.exec("INSERT INTO remise_ponctuelle (id, tenant_id, contrat_id, bon_id, code_ligne, montant, motif, origine, etat, cree_le, maj_le) VALUES ('r1', 'ta', ?, 'b-brouillon', 'socle', 1000, 'Reprise', 'manuelle', 'appliquee', 'a', 'a')", contrat);
  db.exec("UPDATE bon_a_facturer SET remise_ponctuelle_montant = 1000, total_ht = 93800 WHERE id = 'b-brouillon'");
  const bons0 = db.tous<Record<string, unknown>>('SELECT * FROM bon_a_facturer ORDER BY id');
  const remises0 = db.tous<Record<string, unknown>>('SELECT * FROM remise_ponctuelle ORDER BY id');

  appliquerMigration(db, '0018');

  const apres = db.tous<Record<string, unknown>>('SELECT * FROM bon_a_facturer ORDER BY id');
  assert.deepEqual(apres.map(({ lignes_libres_ht, ...reste }) => reste), bons0.map((b) => ({ ...b })), 'aucun bon perdu ni modifié');
  assert.ok(apres.every((b) => b.lignes_libres_ht === 0));
  assert.deepEqual(db.tous('SELECT * FROM remise_ponctuelle ORDER BY id').map((r) => ({ ...r })), remises0.map((r) => ({ ...r })), 'remises ponctuelles intactes');
  assert.deepEqual(db.tous('PRAGMA foreign_key_check'), []);
  for (const t of ['bon_pas_de_suppression', 'bon_numero_definitif', 'bon_emis_fige', 'bon_statut_sens', 'remise_ponctuelle_bon_fige_modif', 'ligne_libre_bon_fige_ajout']) {
    assert.ok(db.un("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name = ?", t), `déclencheur ${t}`);
  }
  for (const i of ['idx_bon_sequence', 'idx_bon_numero', 'idx_bon_installation', 'idx_bon_periode', 'idx_ligne_libre_bon']) assert.ok(db.un("SELECT 1 FROM sqlite_master WHERE name = ?", i), `index ${i}`);
  // Invariants : l'index unique (annee, seq), le bon émis figé, le numéro définitif, le bon qui ne s'efface pas.
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET statut='emise', annee=2025, seq=1, numero='BC-2025-0009', emis_le='x' WHERE id='b-brouillon'"), /UNIQUE/);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET total_ht = 1 WHERE id = 'b-emis'"), /figé/);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET numero = 'BC-2025-0099' WHERE id = 'b-emis'"), /numéro/);
  assert.throws(() => db.exec("DELETE FROM bon_a_facturer WHERE id = 'b-brouillon'"), /ne s'efface pas/);
  // Les nouveautés : une ligne libre sur le brouillon, la remise « libre », un bon prestation, la clé (contrat, période) gardée.
  assert.equal((await poserLigneLibre(db, 'ta', 'b-brouillon', LIGNE, EDITEUR)).ok, true);
  assert.deepEqual(await poserLigneLibre(db, 'ta', 'b-emis', LIGNE, EDITEUR), { ok: false, code: 'pas_brouillon' });
  assert.equal((await poserRemise(db, 'ta', 'b-brouillon', { code_ligne: 'libre', montant: 100, motif: 'x' }, EDITEUR)).ok, true);
  const p = (await creerBonPrestation(db, 'ta', EDITEUR, '2026-11-22')) as { id: string };
  await poserLigneLibre(db, 'ta', p.id, LIGNE, EDITEUR);
  assert.equal((await emettreBon(db, 'ta', p.id, EDITEUR, { malgreIdentiteIncomplete: true })).ok, true);
  assert.equal(db.un<{ seq: number; annee: number }>('SELECT seq, annee FROM bon_a_facturer WHERE id = ?', p.id)!.seq >= 1, true);
  assert.throws(() => bon('b-doublon', '2026-03-14', '2027-03-14'), /UNIQUE/);
  assert.throws(() => db.exec("INSERT INTO ligne_libre (id, tenant_id, contrat_id, bon_id, libelle, quantite, prix_unitaire, cree_le, maj_le) VALUES ('z', 'ta', ?, 'b-brouillon', ' ', 1, 1, 'a', 'a')", contrat), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO ligne_libre (id, tenant_id, contrat_id, bon_id, libelle, quantite, prix_unitaire, cree_le, maj_le) VALUES ('z', 'ta', ?, 'b-brouillon', 'x', 0, 1, 'a', 'a')", contrat), /CHECK/);
});
