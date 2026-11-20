// 8. La signature du contrat et le bon d'installation (lot 19). Avant ce lot, RIEN n'écrivait jamais `statut = 'actif'` ni `debut_le` : aucun
// cabinet réel ne pouvait être facturé. Ces tests rejouent la chaîne complète sur une vraie base : création du cabinet, contrat, DPA, mise en
// production, signature, traitement quotidien, bon.
//
// Les montants sont en centimes, hors taxes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, type BaseTest } from './support/d1.ts';
import { nouveauCompte, poserContrat, poserTenant, type Contrat } from './support/monde.ts';
import { environnement } from './support/serveur.ts';
import { traitementQuotidien } from '../src/lib/traitement';
import { bonComplet, emettreBon } from '../src/lib/facturation';
import {
  contratEnCours, contratsActifs, creerContrat, GRILLE_STANDARD, MESSAGES_CONTRAT, poserDpa, poserMiseEnProduction, poserStatutFondateur, signerContrat,
} from '../src/lib/contrat';
import { appliquerContrat, MESSAGES_RETOUR } from '../src/lib/contrat-ecran';
import { creerCabinet } from '../src/lib/admin';
import { calculerBonInstallation } from '../src/lib/tarif';

const EDITEUR = { id: 'u-editeur', role: 'editeur' as const };

let n = 0;
/** Un cabinet en ESSAI : mise en production le 1er novembre 2026, fin d'essai le 16 décembre (45e jour). */
function enEssai(db: BaseTest, c: Partial<Contrat> = {}): { id: string } {
  const id = `s${++n}`;
  poserTenant(db, id, `Cabinet ${id}`, `${id}.test`, null);
  db.exec("UPDATE tenant SET siren = ?, adresse_facturation = '1 rue du Test, 75001 Paris', contact_facturation = 'compta@test.fr' WHERE id = ?", String(200000000 + n), id);
  nouveauCompte(db, id, 'associe', `associe@${id}.test`);
  poserContrat(db, id, { statut: 'essai', debut_le: null, date_mise_en_production: '2026-11-01', date_fin_essai: '2026-12-16', ...c });
  return { id };
}

const contrat = (db: BaseTest, id: string) =>
  db.un<{ statut: string; debut_le: string | null; date_signature: string | null; frais_installation: number; maj_le: string }>(
    'SELECT statut, debut_le, date_signature, frais_installation, maj_le FROM contrat WHERE tenant_id = ?', id)!;
const bons = (db: BaseTest, id: string, type?: string) =>
  db.tous<{ id: string; type: string; statut: string; periode_debut: string; periode_fin: string; total_ht: number; recurrent_ht: number; remise_taux: number; remise_montant: number; lignes: string; acces_facturables: number; numero: string | null }>(
    `SELECT * FROM bon_a_facturer WHERE tenant_id = ? ${type ? 'AND type = ?' : ''} ORDER BY periode_debut, type`, ...(type ? [id, type] : [id]));
const evenements = (db: BaseTest, id: string, type: string) =>
  db.tous<{ detail: string; acteur_id: string | null }>('SELECT detail, acteur_id FROM evenement WHERE tenant_id = ? AND type = ? ORDER BY cree_le', id, type);

const passe = (db: BaseTest, jour: string) =>
  traitementQuotidien(environnement(db), { maintenant: new Date(`${jour}T03:00:00Z`), mailer: () => ({ envoyer: async () => {} }) });

// ------------------------------------------------------------------ la signature

test('signature : un contrat en essai devient actif, avec sa date de signature et son début de service', async () => {
  const db = baseNeuve();
  const { id } = enEssai(db);
  assert.equal((await contratsActifs(db)).length, 0, 'avant : aucun contrat actif, donc rien à facturer');
  const r = await signerContrat(db, id, '2026-12-20', EDITEUR);
  assert.equal(r.ok, true);
  const c = contrat(db, id);
  assert.equal(c.statut, 'actif');
  assert.equal(c.date_signature, '2026-12-20');
  assert.equal(c.debut_le, '2026-12-20', 'signé après la fin d\'essai (avant que le traitement ne le clôse) : le début de service est la date de signature');
  assert.deepEqual((await contratsActifs(db)).map((x) => x.tenant_id), [id], 'contratsActifs le retient enfin');
  assert.equal((await contratEnCours(db, id))?.statut, 'actif');
});

test('signature AVANT la fin de l\'essai : la date anniversaire est le 45e jour, pas le jour de la signature', async () => {
  const db = baseNeuve();
  const { id } = enEssai(db);
  const r = await signerContrat(db, id, '2026-11-10', EDITEUR);
  assert.equal(r.ok, true);
  const c = contrat(db, id);
  assert.equal(c.date_signature, '2026-11-10', 'la date de signature est celle de la saisie');
  assert.equal(c.debut_le, '2026-12-16', 'le début de service est le 45e jour : les 36 jours d\'essai restants ne se facturent pas');
  // Le jour même de la fin d'essai : début = signature = fin d'essai.
  const meme = enEssai(db);
  await signerContrat(db, meme.id, '2026-12-16', EDITEUR);
  assert.equal(contrat(db, meme.id).debut_le, '2026-12-16');
});

test('signature : refusée sans DPA signé, refusée hors de l\'essai, refusée deux fois', async () => {
  const db = baseNeuve();
  // Sans DPA : un brouillon dont le DPA n'est pas posé.
  const sans = enEssai(db, { statut: 'brouillon', date_mise_en_production: null, date_fin_essai: null, dpa_signe_le: null });
  const r1 = await signerContrat(db, sans.id, '2026-11-10', EDITEUR);
  assert.deepEqual(r1, { ok: false, code: 'signature_sans_dpa' });
  assert.equal(contrat(db, sans.id).statut, 'brouillon');
  // Un brouillon avec DPA : il n'est pas en essai.
  const brouillon = enEssai(db, { statut: 'brouillon', date_mise_en_production: null, date_fin_essai: null });
  assert.deepEqual(await signerContrat(db, brouillon.id, '2026-11-10', EDITEUR), { ok: false, code: 'signature_hors_essai' });
  // Un contrat déjà actif, ou suspendu.
  for (const statut of ['actif', 'suspendu'] as const) {
    const c = enEssai(db, { statut, debut_le: '2026-03-14' });
    const avant = contrat(db, c.id);
    assert.deepEqual(await signerContrat(db, c.id, '2026-11-10', EDITEUR), { ok: false, code: 'signature_hors_essai' }, statut);
    assert.deepEqual(contrat(db, c.id), avant, `${statut} : rien n'est écrit`);
  }
  // Deux signatures de suite : la seconde est refusée et ne change rien.
  const deux = enEssai(db, { frais_installation: 120000 });
  assert.equal((await signerContrat(db, deux.id, '2026-11-10', EDITEUR)).ok, true);
  const apres = contrat(db, deux.id);
  assert.deepEqual(await signerContrat(db, deux.id, '2026-11-12', EDITEUR), { ok: false, code: 'signature_hors_essai' });
  assert.deepEqual(contrat(db, deux.id), apres);
  assert.equal(bons(db, deux.id, 'installation').length, 1, 'un seul bon d\'installation, même si l\'on signe deux fois');
  assert.equal(evenements(db, deux.id, 'contrat_signe').length, 1);
  // Sans contrat, ou avec une date qui n'en est pas une.
  poserTenant(db, 'vide', 'Cabinet vide', 'vide.test', null);
  assert.deepEqual(await signerContrat(db, 'vide', '2026-11-10', EDITEUR), { ok: false, code: 'aucun_contrat' });
  const mauvaise = enEssai(db);
  assert.deepEqual(await signerContrat(db, mauvaise.id, '10/11/2026', EDITEUR), { ok: false, code: 'date_invalide' });
  assert.deepEqual(await signerContrat(db, mauvaise.id, '2026-02-30', EDITEUR), { ok: false, code: 'date_invalide' });
  assert.equal(contrat(db, mauvaise.id).statut, 'essai');
  // Chaque refus a un message.
  for (const code of ['signature_sans_dpa', 'signature_hors_essai'] as const) assert.ok(MESSAGES_CONTRAT[code].length > 20, code);
});

test('signature : journalisée, avec l\'avant et l\'après, dans la même écriture que le changement de statut', async () => {
  const db = baseNeuve();
  const { id } = enEssai(db, { frais_installation: 120000 });
  await signerContrat(db, id, '2026-11-10', EDITEUR);
  const [e] = evenements(db, id, 'contrat_signe');
  assert.equal(e.acteur_id, EDITEUR.id);
  const d = JSON.parse(e.detail);
  assert.equal(d.statut_avant, 'essai');
  assert.equal(d.statut_apres, 'actif');
  assert.equal(d.date_signature, '2026-11-10');
  assert.equal(d.debut_le, '2026-12-16');
  assert.equal(d.avant_fin_essai, true);
  assert.equal(d.frais_installation, 120000);
  assert.equal(typeof d.bon_installation, 'string');
  // Un refus n'écrit aucun événement.
  const sansDpa = enEssai(db, { statut: 'brouillon', date_mise_en_production: null, date_fin_essai: null, dpa_signe_le: null });
  await signerContrat(db, sansDpa.id, '2026-11-10', EDITEUR);
  assert.equal(evenements(db, sansDpa.id, 'contrat_signe').length, 0);
});

test('la console : l\'action « signature » du formulaire signe, et dit si un bon d\'installation a été posé', async () => {
  const db = baseNeuve();
  const avecFrais = enEssai(db, { frais_installation: 120000 });
  const f = new FormData();
  f.set('action', 'signature');
  f.set('date_signature', '2026-11-10');
  const r = await appliquerContrat(db, avecFrais.id, f, EDITEUR);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'contrat_signe_installation');
  const sans = enEssai(db, { frais_installation: 0 });
  assert.equal((await appliquerContrat(db, sans.id, f, EDITEUR)).code, 'contrat_signe');
  // Le même formulaire une seconde fois : le refus du garde-fou, traduit par la fiche.
  const encore = await appliquerContrat(db, sans.id, f, EDITEUR);
  assert.equal(encore.ok, false);
  assert.equal(encore.code, 'signature_hors_essai');
  for (const code of ['contrat_signe', 'contrat_signe_installation', 'signature_hors_essai', 'signature_sans_dpa']) assert.ok(MESSAGES_RETOUR[code], code);
});

// ------------------------------------------------------------------ la chaîne complète

test('un cabinet créé, mis en production, signé : le traitement quotidien produit un bon POUR LUI, avec ses quatre identifiants de facturation', async () => {
  const db = baseNeuve();
  const f = new FormData();
  f.set('nom', 'Cabinet Recette Alpha');
  f.set('hote', 'cabinet3.localhost');
  f.set('gestionnaire_nom', 'Marc Gestionnaire');
  f.set('gestionnaire_email', 'marc@alpha.test');
  f.set('siren', '732 829 320');
  f.set('adresse_facturation', '12 rue de la Paix\n75002 Paris');
  f.set('contact_facturation', 'Julie Compta <compta@alpha.test>');
  const cree = await creerCabinet(db, f, EDITEUR);
  assert.ok(!('erreurs' in cree), 'le cabinet se crée');
  const id = (cree as { id: string }).id;

  assert.equal((await creerContrat(db, id, { periodicite: 'annuelle', acces_inclus: 3, frais_installation: 0, ...GRILLE_STANDARD }, EDITEUR)).ok, true);
  assert.equal((await poserDpa(db, id, '2026-11-01', EDITEUR)).ok, true);
  assert.equal((await poserMiseEnProduction(db, id, '2026-11-01', EDITEUR)).ok, true);
  assert.equal(contrat(db, id).statut, 'essai');
  assert.equal((await signerContrat(db, id, '2026-11-10', EDITEUR)).ok, true);

  // Le 20 novembre : la date anniversaire (16 décembre) est dans les 30 jours.
  const rapport = await passe(db, '2026-11-20');
  assert.ok(JSON.stringify(rapport).includes('"crees":1'), 'le traitement crée un bon');
  const [bon] = bons(db, id);
  assert.ok(bon, 'un bon existe POUR CE CABINET');
  assert.equal(bon.type, 'periode');
  assert.equal(bon.periode_debut, '2026-12-16', 'la première période commence le 45e jour de l\'essai');
  assert.equal(bon.periode_fin, '2027-12-16');
  assert.equal(bon.total_ht, 7900 * 12, 'socle seul, un accès, aucune remise');

  const complet = await bonComplet(db, bon.id);
  assert.ok(complet);
  assert.equal(complet.identite.raison_sociale, 'Cabinet Recette Alpha');
  assert.equal(complet.identite.siren, '732829320');
  assert.equal(complet.identite.adresse_facturation, '12 rue de la Paix\n75002 Paris');
  assert.equal(complet.identite.contact_facturation, 'Julie Compta <compta@alpha.test>');
  assert.deepEqual(complet.manque, [], 'les quatre identifiants sont là : rien ne manque');

  // Rejoué : rien ne se duplique.
  await passe(db, '2026-11-20');
  assert.equal(bons(db, id).length, 1);
});

// ------------------------------------------------------------------ le bon d'installation

test('un contrat à 1 200 € de frais produit un bon d\'installation, et un seul, à la signature', async () => {
  const db = baseNeuve();
  const { id } = enEssai(db, { frais_installation: 120000, remise_commerciale_taux: 2500, remise_motif: 'Réseau' });
  db.exec("UPDATE contrat SET remise_revue_le = '2027-06-01' WHERE tenant_id = ?", id);
  const r = await signerContrat(db, id, '2026-11-10', EDITEUR);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.installation && r.installation.total_ht, 120000);

  const [b, ...autres] = bons(db, id, 'installation');
  assert.equal(autres.length, 0);
  assert.equal(b.statut, 'brouillon');
  assert.equal(b.total_ht, 120000);
  assert.equal(b.recurrent_ht, 0, 'aucun récurrent');
  assert.equal(b.remise_taux, 0, 'la remise ne s\'applique pas aux frais d\'installation, même avec une remise commerciale de 25 %');
  assert.equal(b.remise_montant, 0);
  assert.equal(b.acces_facturables, 0);
  assert.equal(b.periode_debut, '2026-11-10', 'la période est le jour de signature');
  assert.equal(b.periode_fin, '2026-11-10');
  assert.deepEqual(JSON.parse(b.lignes), [{ code: 'installation', quantite: 1, prix_unitaire: 120000, mois: 1, montant: 120000 }]);

  // L'éditeur en est prévenu (incident), et le journal garde la génération.
  assert.equal(db.compte('incident', "tenant_id = ? AND quoi = 'bon_a_emettre'", id), 1);
  const generes = evenements(db, id, 'bon_genere').map((e) => JSON.parse(e.detail));
  assert.equal(generes.filter((d) => d.type === 'installation').length, 1);

  // Le traitement quotidien, rejoué, n'en pose pas un second ; le bon périodique, lui, ne porte jamais les frais.
  await passe(db, '2026-11-20');
  await passe(db, '2026-11-20');
  await passe(db, '2026-11-21');
  assert.equal(bons(db, id, 'installation').length, 1, 'un seul bon d\'installation par contrat');
  const [periodique] = bons(db, id, 'periode');
  assert.equal(periodique.recurrent_ht, 7900 * 12);
  assert.equal(periodique.total_ht, 7900 * 12 - 7900 * 3, 'le récurrent moins la remise, sans les frais');
});

test('un contrat à frais nuls (cabinet fondateur) ne produit aucun bon d\'installation : pas de bon à zéro euro', async () => {
  const db = baseNeuve();
  const { id } = enEssai(db, { frais_installation: 120000 });
  // Le statut fondateur ramène les frais à zéro.
  assert.equal((await poserStatutFondateur(db, id, '2026-11-10', EDITEUR)).ok, true);
  assert.equal(contrat(db, id).frais_installation, 0);
  assert.equal((await signerContrat(db, id, '2026-11-10', EDITEUR)).ok, true);
  assert.equal(bons(db, id, 'installation').length, 0);
  assert.equal(db.compte('bon_a_facturer', 'tenant_id = ?', id), 0, 'aucun bon du tout à la signature');
  assert.equal(db.compte('incident', "tenant_id = ? AND quoi = 'bon_a_emettre'", id), 0);
  const r = await signerContrat(db, enEssai(db, { frais_installation: 0 }).id, '2026-11-10', EDITEUR);
  assert.equal(r.ok && r.installation, undefined);
});

test('un bon d\'installation s\'émet et se numérote comme les autres ; il porte sa TVA et son libellé', async () => {
  const db = baseNeuve();
  const { id } = enEssai(db, { frais_installation: 120000 });
  await signerContrat(db, id, '2026-11-10', EDITEUR);
  const [b] = bons(db, id, 'installation');
  const emis = await emettreBon(db, id, b.id, EDITEUR);
  assert.equal(emis.ok, true);
  assert.match(emis.ok ? emis.bon.numero ?? '' : '', /^FACT-\d{4}-\d{4}$/);
  const complet = await bonComplet(db, b.id);
  assert.equal(complet?.type, 'installation');
  assert.equal(complet?.lignes[0].libelle, 'Frais d’installation');
  assert.equal(complet?.total_ht, 120000);
  assert.equal(complet?.tva_montant, 24000);
  assert.equal(complet?.total_ttc, 144000, '1 200 € HT + 20 % de TVA');
  assert.deepEqual(complet?.manque, []);
});

test('la base : un seul bon d\'installation par contrat, et la période d\'un bon périodique reste strictement positive', () => {
  const db = baseNeuve();
  const { id } = enEssai(db, { statut: 'actif', debut_le: '2026-03-14' });
  const cid = `c-${id}`;
  const poser = (bid: string, type: string, debut: string, fin: string) =>
    db.exec(
      `INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, 'brouillon', 0, '[]', 0, 0, 0, 100, '2026-11-10')`, bid, id, cid, type, debut, fin);
  poser('i1', 'installation', '2026-11-10', '2026-11-10');
  assert.throws(() => poser('i2', 'installation', '2026-11-11', '2026-11-11'), /UNIQUE/i, 'un second bon d\'installation pour le même contrat est refusé par la base');
  assert.throws(() => poser('p1', 'periode', '2026-12-01', '2026-12-01'), /CHECK/i, 'un bon périodique dont la fin n\'est pas après le début est refusé');
  assert.throws(() => poser('x1', 'inconnu', '2026-12-02', '2026-12-03'), /CHECK/i, 'un type inconnu est refusé');
  poser('p2', 'periode', '2026-12-04', '2027-12-04');
});

test('calculerBonInstallation : une ligne, pas de récurrent, pas de remise', () => {
  const b = calculerBonInstallation(120000);
  assert.deepEqual(b.lignes, [{ code: 'installation', quantite: 1, prix_unitaire: 120000, mois: 1, montant: 120000 }]);
  assert.equal(b.recurrent_ht, 0);
  assert.equal(b.remise_taux, 0);
  assert.equal(b.remise_montant, 0);
  assert.equal(b.total_ht, 120000);
});

// ------------------------------------------------------------------ la grille proposée à l'ouverture

test('la grille standard proposée à l\'ouverture d\'un contrat : 7900, 4900, 3900, 2500 centimes', () => {
  assert.deepEqual(GRILLE_STANDARD, { prix_socle: 7900, prix_pilotage: 4900, prix_site: 3900, prix_acces_sup: 2500 });
});
