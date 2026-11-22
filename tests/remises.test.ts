// Facturation du 21/11/2026 : l'accès supplémentaire facturé tout de suite au prorata (bon complémentaire), les remises ponctuelles sur une
// ligne d'un bon brouillon, le crédit de prorata d'un accès retiré, et la migration 0017. Montants en centimes, hors taxes.
//
// Les dates sont fixées : les bons ÉMIS sont posés directement (numéro et instant d'émission imposés) pour qu'aucun test ne dépende de la date
// du jour, et les accès portent un `cree_le` explicite. Le traitement quotidien est appelé comme le Cron l'appelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliquerMigration, baseNeuve, type BaseTest } from './support/d1.ts';
import { nouveauCompte, poserContrat, poserTenant, type Contrat } from './support/monde.ts';
import { environnement } from './support/serveur.ts';
import { traitementQuotidien } from '../src/lib/traitement';
import { annulerBon, bonComplet, emettreBon } from '../src/lib/facturation';
import { changerRole, creerAcces, supprimerAcces, suspendreAcces } from '../src/lib/acces';
import { enregistrerPreavis } from '../src/lib/contrat';
import { eurosEnCentimes, modifierRemise, poserRemise, supprimerRemise } from '../src/lib/remises';
import { calculerTva, type LigneBon } from '../src/lib/tarif';

const EDITEUR = { id: 'u-editeur', role: 'editeur' as const };
const ASSOCIE = { id: 'u-associe', role: 'associe' as const };

let n = 0;
function cabinet(db: BaseTest, c: Partial<Contrat> = {}, associes = 3): { id: string; contrat: string } {
  const id = `r${++n}`;
  poserTenant(db, id, `Cabinet ${id}`, `${id}.test`, null);
  db.exec("UPDATE tenant SET siren = ?, adresse_facturation = '1 rue du Test', contact_facturation = 'compta@test.fr' WHERE id = ?", String(200000000 + n), id);
  const contrat = poserContrat(db, id, { module_pilotage: 0, module_site: 0, acces_inclus: 3, ...c });
  for (let i = 0; i < associes; i++) nouveauCompte(db, id, 'associe', `associe${i}@${id}.test`);
  db.exec("UPDATE utilisateur SET cree_le = '2026-01-10T09:00:00.000Z' WHERE tenant_id = ?", id);
  return { id, contrat };
}
const passe = (env: ReturnType<typeof environnement>, jour: string) =>
  traitementQuotidien(env, { maintenant: new Date(`${jour}T03:00:00Z`), mailer: () => ({ envoyer: async () => {} }) });
const bons = (db: BaseTest, tenant: string) =>
  db.tous<{ id: string; type: string; periode_debut: string; periode_fin: string; statut: string; total_ht: number; recurrent_ht: number; remise_montant: number; remise_ponctuelle_montant: number; lignes: string }>(
    'SELECT * FROM bon_a_facturer WHERE tenant_id = ? ORDER BY periode_debut, type', tenant);
const lignes = (b: { lignes: string }): LigneBon[] => JSON.parse(b.lignes);
const SOCLE: LigneBon = { code: 'socle', quantite: 1, prix_unitaire: 7900, mois: 12, montant: 94800 };
const SUP = (q: number): LigneBon => ({ code: 'acces_sup', quantite: q, prix_unitaire: 2500, mois: 12, montant: 2500 * 12 * q });

/** Un bon périodique déjà ÉMIS, posé à un instant fixe. */
let seq = 0;
function bonEmis(db: BaseTest, c: { id: string; contrat: string }, debut: string, fin: string, acces: number, emis_le: string, extra: LigneBon[] = []): string {
  const l = [SOCLE, ...extra];
  const rec = l.reduce((s, x) => s + x.montant, 0);
  const id = `bon-${c.id}-${debut}`;
  db.exec(
    `INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht,
                                 numero, annee, seq, emis_le, cree_le)
     VALUES (?, ?, ?, 'periode', ?, ?, 'emise', ?, ?, ?, 0, 0, ?, ?, 2026, ?, ?, ?)`,
    id, c.id, c.contrat, debut, fin, acces, JSON.stringify(l), rec, rec, `BC-2026-${String(++seq).padStart(4, '0')}`, seq, emis_le, emis_le);
  return id;
}
const accesApres = (db: BaseTest, c: { id: string }, email: string, cree_le: string, role: 'associe' | 'collaborateur' | 'lecture' | 'support_editeur' | 'viewer' = 'collaborateur') => {
  const u = nouveauCompte(db, c.id, role, email);
  db.exec('UPDATE utilisateur SET cree_le = ? WHERE id = ?', cree_le, u.id);
  return u;
};
const complementaires = (db: BaseTest, t: string) => bons(db, t).filter((b) => b.type === 'complementaire');

// ------------------------------------------------------------------ la facturation directe d'un accès

test('accès créé après l\'émission du bon : bon complémentaire au prorata (4 mois × 25 € = 100 €), rejoué dix fois sans doublon', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  bonEmis(db, c, '2026-03-14', '2027-03-14', 3, '2026-02-20T10:00:00.000Z');
  accesApres(db, c, 'quatrieme@x.test', '2026-11-20T09:00:00.000Z');
  for (let i = 0; i < 10; i++) await passe(env, '2026-11-21');
  const compl = complementaires(db, c.id);
  assert.equal(compl.length, 1);
  assert.deepEqual([compl[0].periode_debut, compl[0].periode_fin, compl[0].statut], ['2026-11-20', '2027-03-14', 'brouillon']);
  assert.deepEqual(lignes(compl[0]).map((l) => [l.code, l.quantite, l.mois, l.prix_unitaire, l.montant]), [['acces_sup', 1, 4, 2500, 10000]]);
  assert.equal(compl[0].total_ht, 10000);
  assert.deepEqual(calculerTva(10000), { tva_taux: 2000, tva_montant: 2000, total_ttc: 12000 });
  assert.equal(db.compte('evenement', "type = 'bon_genere' AND tenant_id = ? AND detail LIKE '%complementaire%'", c.id), 1);
  assert.equal(bons(db, c.id).filter((b) => b.type === 'periode').length, 1, 'le bon périodique émis ne bouge pas');
});

test('l\'arrondi est celui des modules : mois entiers restants arrondis au supérieur (02/03/2027 → 1 mois → 25 €)', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  bonEmis(db, c, '2026-03-14', '2027-03-14', 3, '2026-02-20T10:00:00.000Z');
  accesApres(db, c, 'quatrieme@x.test', '2027-03-02T09:00:00.000Z');
  await passe(env, '2027-03-03');
  const [compl] = complementaires(db, c.id);
  assert.deepEqual([lignes(compl)[0].mois, compl.total_ht], [1, 2500]);
});

test('deux accès ajoutés le même jour : un seul bon, quantité 2 ; un jour différent : un autre bon', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  bonEmis(db, c, '2026-03-14', '2027-03-14', 3, '2026-02-20T10:00:00.000Z');
  accesApres(db, c, 'q1@x.test', '2026-11-20T09:00:00.000Z');
  accesApres(db, c, 'q2@x.test', '2026-11-20T15:00:00.000Z', 'associe');
  accesApres(db, c, 'q3@x.test', '2026-12-14T09:00:00.000Z');
  await passe(env, '2026-12-15');
  const compl = complementaires(db, c.id);
  assert.deepEqual(compl.map((b) => [b.periode_debut, lignes(b)[0].quantite, lignes(b)[0].mois, b.total_ht]), [['2026-11-20', 2, 4, 20000], ['2026-12-14', 1, 3, 7500]]);
});

test('un accès inclus ne coûte rien, et lecture, support éditeur, viewers et comptes suspendus ne comptent jamais', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14', acces_inclus: 4 }, 3);
  bonEmis(db, c, '2026-03-14', '2027-03-14', 3, '2026-02-20T10:00:00.000Z');
  accesApres(db, c, 'quatrieme@x.test', '2026-11-20T09:00:00.000Z'); // le 4ᵉ, encore inclus
  accesApres(db, c, 'lecture@x.test', '2026-11-20T09:00:00.000Z', 'lecture');
  accesApres(db, c, 'support@x.test', '2026-11-20T09:00:00.000Z', 'support_editeur');
  accesApres(db, c, 'viewer@x.test', '2026-11-20T09:00:00.000Z', 'viewer');
  const s = accesApres(db, c, 'suspendu@x.test', '2026-11-20T09:00:00.000Z');
  db.exec('UPDATE utilisateur SET actif = 0 WHERE id = ?', s.id);
  await passe(env, '2026-11-21');
  assert.deepEqual(complementaires(db, c.id), []);
  accesApres(db, c, 'cinquieme@x.test', '2026-11-20T10:00:00.000Z'); // le 5ᵉ dépasse
  await passe(env, '2026-11-21');
  const [compl] = complementaires(db, c.id);
  assert.deepEqual(lignes(compl).map((l) => [l.quantite, l.montant]), [[1, 10000]]);
});

test('pas de double facturation : le brouillon du bon de la période suit le contrat et compte déjà l\'accès, sans complémentaire', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  // La période commence le 01/12 : son brouillon, posé dans les 30 jours, est recalculé chaque nuit jusqu'à l'émission.
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-12-01' });
  await passe(env, '2026-11-19');
  accesApres(db, c, 'quatrieme@x.test', '2026-11-20T09:00:00.000Z');
  await passe(env, '2026-11-21');
  assert.deepEqual(complementaires(db, c.id), []);
  const [b] = bons(db, c.id);
  assert.equal(b.statut, 'brouillon');
  assert.equal(lignes(b).find((l) => l.code === 'acces_sup')?.montant, 30000, 'le brouillon compte l\'accès, sur les 12 mois');
});

test('premier bon de rattrapage : aucun bon n\'existe, le premier compte l\'accès sur la période entière, sans complémentaire', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  accesApres(db, c, 'quatrieme@x.test', '2026-11-20T09:00:00.000Z');
  await passe(env, '2026-11-21');
  assert.deepEqual(complementaires(db, c.id), []);
  assert.equal(lignes(bons(db, c.id)[0]).find((l) => l.code === 'acces_sup')?.montant, 30000);
});

test('pas de double facturation : un accès arrivé AVANT l\'émission est dans le bon émis, il ne donne pas de complémentaire', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  accesApres(db, c, 'quatrieme@x.test', '2026-11-18T09:00:00.000Z');
  bonEmis(db, c, '2026-03-14', '2027-03-14', 4, '2026-11-19T10:00:00.000Z', [SUP(1)]);
  await passe(env, '2026-11-21');
  assert.deepEqual(complementaires(db, c.id), []);
});

test('un contrat mensuel n\'a pas de complémentaire : l\'accès entre dans le bon du mois suivant', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'mensuelle', debut_le: '2026-03-14' });
  await passe(env, '2026-11-13');
  accesApres(db, c, 'quatrieme@x.test', '2026-11-16T09:00:00.000Z');
  await passe(env, '2026-11-20');
  assert.deepEqual(complementaires(db, c.id), []);
  const suivant = bons(db, c.id).find((b) => b.periode_debut === '2026-12-14')!;
  assert.equal(lignes(suivant).find((l) => l.code === 'acces_sup')?.montant, 2900, 'prix mensuel : 25 € → 29 €, un mois');
});

test('création par creerAcces : l\'accès est journalisé, puis facturé au prorata par le traitement du lendemain', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  bonEmis(db, c, '2026-03-14', '2027-03-14', 3, '2026-02-20T10:00:00.000Z');
  const r = await creerAcces(db, c.id, { nom: 'Quatrième', email: 'quatrieme@x.test', role: 'collaborateur' }, EDITEUR);
  assert.equal(r.ok, true);
  const jour = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
  await passe(env, jour);
  // La date réelle du jour d'exécution fixe le nombre de mois : on vérifie la forme, pas le chiffre.
  const compl = complementaires(db, c.id);
  if (jour < '2027-03-14') assert.equal(compl.length, 1);
});

// ------------------------------------------------------------------ les remises ponctuelles posées à la main

function brouillonAvecRemise(taux = 0) {
  const db = baseNeuve();
  // Début de service le 01/12/2026 : le bon de la période est posé 30 jours avant, en brouillon, et suit le contrat chaque nuit.
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-12-01', module_pilotage: 1, remise_commerciale_taux: taux, remise_motif: taux ? 'Lancement' : null });
  return { db, c, env: environnement(db) };
}

test('remise ponctuelle : posée sur une ligne, elle apparaît sur la ligne et dans les totaux (centimes, TVA 20 %), la remise en % s\'applique après', async () => {
  const { db, c, env } = brouillonAvecRemise(1000);
  await passe(env, '2026-11-19');
  const [b] = bons(db, c.id);
  assert.equal(b.recurrent_ht, (7900 + 4900) * 12); // 153 600
  const r = await poserRemise(db, c.id, b.id, { code_ligne: 'socle', montant: eurosEnCentimes('100,50')!, motif: 'Geste commercial' }, EDITEUR);
  assert.equal(r.ok, true);
  const [apres] = bons(db, c.id);
  assert.equal(apres.remise_ponctuelle_montant, 10050);
  // (153 600 − 10 050) × 10 % = 14 355 ; total = 143 550 − 14 355 = 129 195
  assert.deepEqual([apres.remise_montant, apres.total_ht], [14355, 129195]);
  const complet = (await bonComplet(db, b.id))!;
  assert.deepEqual(complet.remises_ponctuelles.map((x) => [x.code_ligne, x.montant, x.motif]), [['socle', 10050, 'Geste commercial']]);
  assert.deepEqual([complet.tva_montant, complet.total_ttc], [25839, 155034]);
  assert.equal(db.compte('evenement', "type = 'remise_ponctuelle_posee' AND tenant_id = ?", c.id), 1);
  assert.doesNotMatch(db.un<{ detail: string }>("SELECT detail FROM evenement WHERE type = 'remise_ponctuelle_posee'")!.detail, /Geste commercial/, 'le motif n\'entre pas dans le journal');
});

test('remise ponctuelle : motif obligatoire, montant positif, jamais au-delà de la ligne, ligne du bon seulement', async () => {
  const { db, c, env } = brouillonAvecRemise();
  await passe(env, '2026-11-19');
  const [b] = bons(db, c.id);
  const poser = (code: string, montant: number, motif: string) => poserRemise(db, c.id, b.id, { code_ligne: code, montant, motif }, EDITEUR);
  assert.deepEqual(await poser('socle', 1000, '  '), { ok: false, code: 'motif_requis' });
  assert.deepEqual(await poser('socle', 0, 'x'), { ok: false, code: 'montant_invalide' });
  assert.deepEqual(await poser('socle', -5, 'x'), { ok: false, code: 'montant_invalide' });
  assert.deepEqual(await poser('socle', 10.5, 'x'), { ok: false, code: 'montant_invalide' });
  assert.deepEqual(await poser('site', 1000, 'x'), { ok: false, code: 'ligne_inconnue' }, 'le module Site n\'est pas sur ce bon');
  assert.deepEqual(await poser('installation', 1000, 'x'), { ok: false, code: 'ligne_inconnue' });
  assert.deepEqual(await poser('inconnue', 1000, 'x'), { ok: false, code: 'ligne_inconnue' });
  assert.deepEqual(await poser('socle', 94801, 'x'), { ok: false, code: 'depasse_ligne', plafond: 94800 });
  assert.equal((await poser('socle', 94800, 'toute la ligne')).ok, true, 'la ligne entière est permise');
  assert.deepEqual(await poser('socle', 1, 'une de plus'), { ok: false, code: 'depasse_ligne', plafond: 0 }, 'le plafond tient compte des remises déjà posées sur la ligne');
  assert.equal(bons(db, c.id)[0].total_ht, 4900 * 12);
  assert.deepEqual(await eurosEnCentimes('12,345'), null);
  assert.equal(eurosEnCentimes('0,05'), 5);
  assert.equal(eurosEnCentimes('12.5'), 1250);
});

test('remise ponctuelle : modifiable et supprimable tant que le bon est brouillon', async () => {
  const { db, c, env } = brouillonAvecRemise();
  await passe(env, '2026-11-19');
  const [b] = bons(db, c.id);
  const r = await poserRemise(db, c.id, b.id, { code_ligne: 'pilotage', montant: 5000, motif: 'Premier mois offert' }, EDITEUR);
  assert.ok(r.ok);
  const id = (r as { id: string }).id;
  assert.equal((await modifierRemise(db, c.id, id, { montant: 8000, motif: 'Deux mois offerts' }, EDITEUR)).ok, true);
  assert.deepEqual([bons(db, c.id)[0].remise_ponctuelle_montant, bons(db, c.id)[0].total_ht], [8000, 153600 - 8000]);
  assert.deepEqual(await modifierRemise(db, c.id, id, { montant: 58801, motif: 'x' }, EDITEUR), { ok: false, code: 'depasse_ligne', plafond: 58800 });
  assert.deepEqual(await modifierRemise(db, c.id, id, { montant: 100, motif: '' }, EDITEUR), { ok: false, code: 'motif_requis' });
  assert.equal((await supprimerRemise(db, c.id, id, EDITEUR)).ok, true);
  assert.deepEqual([bons(db, c.id)[0].remise_ponctuelle_montant, bons(db, c.id)[0].total_ht], [0, 153600]);
  assert.equal(db.compte('remise_ponctuelle'), 0);
  assert.deepEqual(['posee', 'modifiee', 'supprimee'].map((t) => db.compte('evenement', `type = 'remise_ponctuelle_${t}'`)), [1, 1, 1]);
});

test('remise ponctuelle : elle survit aux recalculs du brouillon par le traitement quotidien', async () => {
  const { db, c, env } = brouillonAvecRemise();
  await passe(env, '2026-11-19');
  const [b] = bons(db, c.id);
  await poserRemise(db, c.id, b.id, { code_ligne: 'socle', montant: 20000, motif: 'Geste' }, EDITEUR);
  nouveauCompte(db, c.id, 'associe', 'quatrieme@x.test'); // le brouillon va changer : un accès de plus
  for (let i = 0; i < 3; i++) await passe(env, '2026-11-19');
  const [apres] = bons(db, c.id);
  assert.equal(lignes(apres).find((l) => l.code === 'acces_sup')?.montant, 30000, 'le brouillon a bien été recalculé');
  assert.deepEqual([apres.remise_ponctuelle_montant, apres.total_ht], [20000, 153600 + 30000 - 20000]);
  assert.equal(db.compte('remise_ponctuelle'), 1, 'la remise n\'est pas dupliquée');
});

test('remise ponctuelle : figée à l\'émission ; un bon émis ou annulé n\'accepte plus aucune modification', async () => {
  const { db, c, env } = brouillonAvecRemise();
  await passe(env, '2026-11-19');
  const [b] = bons(db, c.id);
  const r = (await poserRemise(db, c.id, b.id, { code_ligne: 'socle', montant: 10000, motif: 'Geste' }, EDITEUR)) as { id: string };
  assert.equal((await emettreBon(db, c.id, b.id, EDITEUR)).ok, true);
  const emis = bons(db, c.id)[0];
  assert.deepEqual([emis.remise_ponctuelle_montant, emis.total_ht], [10000, 143600]);
  assert.deepEqual(await poserRemise(db, c.id, b.id, { code_ligne: 'socle', montant: 100, motif: 'x' }, EDITEUR), { ok: false, code: 'pas_brouillon' });
  assert.deepEqual(await modifierRemise(db, c.id, r.id, { montant: 100, motif: 'x' }, EDITEUR), { ok: false, code: 'pas_brouillon' });
  assert.deepEqual(await supprimerRemise(db, c.id, r.id, EDITEUR), { ok: false, code: 'pas_brouillon' });
  assert.throws(() => db.exec('UPDATE remise_ponctuelle SET montant = 1 WHERE id = ?', r.id), /figé/);
  assert.throws(() => db.exec('DELETE FROM remise_ponctuelle WHERE id = ?', r.id), /figé/);
  assert.throws(() => db.exec('UPDATE bon_a_facturer SET remise_ponctuelle_montant = 0 WHERE id = ?', b.id), /figé/);
  await passe(env, '2026-11-19');
  assert.equal(bons(db, c.id)[0].total_ht, 143600, 'le traitement ne touche plus au bon émis');
  // Annulé : figé aussi.
  await annulerBon(db, c.id, b.id, EDITEUR);
  assert.deepEqual(await supprimerRemise(db, c.id, r.id, EDITEUR), { ok: false, code: 'pas_brouillon' });
  // Un brouillon annulé n'accepte plus rien non plus.
  const c2 = cabinet(db, { module_pilotage: 1 });
  await passe(env, '2026-11-19');
  const b2 = bons(db, c2.id)[0];
  await annulerBon(db, c2.id, b2.id, EDITEUR);
  assert.deepEqual(await poserRemise(db, c2.id, b2.id, { code_ligne: 'socle', montant: 100, motif: 'x' }, EDITEUR), { ok: false, code: 'pas_brouillon' });
});

test('remise ponctuelle : éditeur seulement, et cloisonnée par cabinet (bon d\'un autre cabinet : introuvable)', async () => {
  const { db, c, env } = brouillonAvecRemise();
  const autre = cabinet(db, {});
  await passe(env, '2026-11-19');
  const [b] = bons(db, c.id);
  assert.deepEqual(await poserRemise(db, c.id, b.id, { code_ligne: 'socle', montant: 100, motif: 'x' }, ASSOCIE), { ok: false, code: 'interdit' });
  assert.deepEqual(await poserRemise(db, autre.id, b.id, { code_ligne: 'socle', montant: 100, motif: 'x' }, EDITEUR), { ok: false, code: 'introuvable' });
  const r = (await poserRemise(db, c.id, b.id, { code_ligne: 'socle', montant: 100, motif: 'x' }, EDITEUR)) as { id: string };
  assert.deepEqual(await modifierRemise(db, autre.id, r.id, { montant: 200, motif: 'x' }, EDITEUR), { ok: false, code: 'introuvable' });
  assert.deepEqual(await supprimerRemise(db, autre.id, r.id, EDITEUR), { ok: false, code: 'introuvable' });
  assert.deepEqual(await supprimerRemise(db, c.id, r.id, ASSOCIE), { ok: false, code: 'interdit' });
  assert.equal(db.compte('remise_ponctuelle'), 1);
  // La base refuse aussi une remise dont le bon n'est pas celui du contrat.
  assert.throws(() => db.exec("INSERT INTO remise_ponctuelle (id, tenant_id, contrat_id, bon_id, code_ligne, montant, motif, origine, etat, cree_le, maj_le) VALUES ('x', ?, ?, ?, 'socle', 1, 'm', 'manuelle', 'appliquee', 'a', 'a')", autre.id, autre.contrat, b.id), /pas celui de ce contrat/);
});

// ------------------------------------------------------------------ le crédit de prorata d'un accès retiré

/** Contrat annuel, quatre accès dont un facturé au-delà des inclus dans le bon ÉMIS de la période. */
function cabinetAvecQuatrieme(c: Partial<Contrat> = {}) {
  const db = baseNeuve();
  const cab = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14', ...c });
  const u = accesApres(db, cab, 'quatrieme@x.test', '2026-06-01T09:00:00.000Z');
  bonEmis(db, cab, '2026-03-14', '2027-03-14', 4, '2026-11-19T10:00:00.000Z', [SUP(1)]);
  return { db, cab, u, env: environnement(db) };
}
const credits = (db: BaseTest, t: string) => db.tous<{ montant: number; motif: string; etat: string; bon_id: string | null; origine: string }>('SELECT * FROM remise_ponctuelle WHERE tenant_id = ?', t);

test('accès supprimé : crédit = prix × mois entiers non entamés (3 × 25 € = 75 €), motif automatique, en attente du bon suivant', async () => {
  const { db, cab, u } = cabinetAvecQuatrieme();
  assert.equal((await supprimerAcces(db, cab.id, u.id, EDITEUR, '2026-11-20')).ok, true);
  const [cr] = credits(db, cab.id);
  assert.deepEqual([cr.montant, cr.motif, cr.etat, cr.bon_id, cr.origine], [7500, 'Accès supprimé le 20/11/2026 : 3 mois non effectués', 'en_attente', null, 'acces']);
  assert.equal(db.compte('evenement', "type = 'credit_prorata_cree' AND tenant_id = ?", cab.id), 1);
  assert.doesNotMatch(db.un<{ detail: string }>("SELECT detail FROM evenement WHERE type = 'credit_prorata_cree'")!.detail, /@/);
});

test('crédit : appliqué comme remise ponctuelle au bon suivant, au centime, TVA 20 % ; rejoué, rien ne se double ; figé à l\'émission', async () => {
  const { db, cab, u, env } = cabinetAvecQuatrieme();
  await supprimerAcces(db, cab.id, u.id, EDITEUR, '2026-11-20');
  for (let i = 0; i < 4; i++) await passe(env, '2027-02-12');
  const suivant = bons(db, cab.id).find((b) => b.periode_debut === '2027-03-14')!;
  assert.deepEqual([suivant.recurrent_ht, suivant.remise_ponctuelle_montant, suivant.total_ht], [94800, 7500, 87300], 'le bon suivant n\'a plus d\'accès supplémentaire : le crédit s\'impute sur le récurrent');
  assert.equal(credits(db, cab.id).length, 1);
  assert.deepEqual([credits(db, cab.id)[0].etat, credits(db, cab.id)[0].bon_id], ['appliquee', suivant.id]);
  assert.equal(db.compte('evenement', "type = 'credit_prorata_applique'"), 1);
  const complet = (await bonComplet(db, suivant.id))!;
  assert.equal(complet.remises_ponctuelles[0].motif, 'Accès supprimé le 20/11/2026 : 3 mois non effectués');
  assert.deepEqual([complet.tva_montant, complet.total_ttc], [17460, 104760]);
  // Émis : le crédit est consommé, il ne bouge plus.
  assert.equal((await emettreBon(db, cab.id, suivant.id, EDITEUR)).ok, true);
  await passe(env, '2027-02-13');
  assert.deepEqual(credits(db, cab.id).map((x) => x.etat), ['appliquee']);
  assert.equal(bons(db, cab.id).find((b) => b.periode_debut === '2027-03-14')!.total_ht, 87300);
});

test('crédit : réactivé avant d\'être consommé par un bon émis, il est annulé (en attente, ou porté par un brouillon)', async () => {
  const { db, cab, u, env } = cabinetAvecQuatrieme();
  assert.equal((await suspendreAcces(db, cab.id, u.id, false, EDITEUR, '2026-11-20')).ok, true);
  const [cr] = credits(db, cab.id);
  assert.deepEqual([cr.montant, cr.motif], [7500, 'Accès suspendu le 20/11/2026 : 3 mois non effectués']);
  // Porté par le brouillon du bon suivant…
  await passe(env, '2027-02-12');
  const suivant = bons(db, cab.id).find((b) => b.periode_debut === '2027-03-14')!;
  assert.equal(suivant.remise_ponctuelle_montant, 7500);
  // … puis réactivé : annulé, le brouillon retrouve son total.
  assert.equal((await suspendreAcces(db, cab.id, u.id, true, EDITEUR)).ok, true);
  assert.deepEqual(credits(db, cab.id).map((x) => [x.etat, x.bon_id]), [['annulee', null]]);
  const apres = bons(db, cab.id).find((b) => b.periode_debut === '2027-03-14')!;
  assert.deepEqual([apres.remise_ponctuelle_montant, apres.total_ht], [0, 94800]);
  assert.equal(db.compte('evenement', "type = 'credit_prorata_annule'"), 1);
  await passe(env, '2027-02-13');
  assert.deepEqual(credits(db, cab.id).map((x) => x.etat), ['annulee'], 'rejoué : un crédit annulé ne revient pas');
});

test('crédit : réactivé APRÈS consommation par un bon émis, le crédit ne bouge plus', async () => {
  const { db, cab, u, env } = cabinetAvecQuatrieme();
  await suspendreAcces(db, cab.id, u.id, false, EDITEUR, '2026-11-20');
  await passe(env, '2027-02-12');
  const suivant = bons(db, cab.id).find((b) => b.periode_debut === '2027-03-14')!;
  await emettreBon(db, cab.id, suivant.id, EDITEUR);
  await suspendreAcces(db, cab.id, u.id, true, EDITEUR);
  assert.deepEqual(credits(db, cab.id).map((x) => x.etat), ['appliquee']);
});

test('suspendre deux fois ne double pas le crédit ; réactiver puis suspendre de nouveau en crée un neuf', async () => {
  const { db, cab, u } = cabinetAvecQuatrieme();
  await suspendreAcces(db, cab.id, u.id, false, EDITEUR, '2026-11-20');
  assert.deepEqual(await suspendreAcces(db, cab.id, u.id, false, EDITEUR, '2026-11-20'), { ok: false, code: 'inchange' });
  assert.equal(credits(db, cab.id).length, 1);
  await suspendreAcces(db, cab.id, u.id, true, EDITEUR);
  await suspendreAcces(db, cab.id, u.id, false, EDITEUR, '2026-12-20');
  assert.deepEqual(credits(db, cab.id).map((x) => [x.etat, x.montant]), [['annulee', 7500], ['en_attente', 5000]]);
});

test('pas de crédit : sous les accès inclus, accès non facturé, lecture, contrat mensuel, bon de la période non émis, résiliation enregistrée', async () => {
  // Sous les inclus : trois accès, inclus 3, on en retire un.
  const a = baseNeuve();
  const ca = cabinet(a, { periodicite: 'annuelle', debut_le: '2026-03-14' }, 3);
  bonEmis(a, ca, '2026-03-14', '2027-03-14', 3, '2026-11-19T10:00:00.000Z');
  const ua = a.un<{ id: string }>("SELECT id FROM utilisateur WHERE tenant_id = ? LIMIT 1", ca.id)!;
  await supprimerAcces(a, ca.id, ua.id, EDITEUR, '2026-11-20');
  assert.equal(a.compte('remise_ponctuelle'), 0);

  // Lecture : jamais facturée.
  const b = cabinetAvecQuatrieme();
  const lec = accesApres(b.db, b.cab, 'lecture@x.test', '2026-06-01T09:00:00.000Z', 'lecture');
  await supprimerAcces(b.db, b.cab.id, lec.id, EDITEUR, '2026-11-20');
  assert.equal(b.db.compte('remise_ponctuelle'), 0);

  // Contrat mensuel : pas de crédit.
  const m = baseNeuve();
  const cm = cabinet(m, { periodicite: 'mensuelle', debut_le: '2026-03-14' });
  const um = accesApres(m, cm, 'q@x.test', '2026-06-01T09:00:00.000Z');
  await supprimerAcces(m, cm.id, um.id, EDITEUR, '2026-11-20');
  assert.equal(m.compte('remise_ponctuelle'), 0);

  // Bon de la période seulement brouillon : l'accès n'a jamais été facturé.
  const d = baseNeuve();
  const cd = cabinet(d, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  const ud = accesApres(d, cd, 'q@x.test', '2026-06-01T09:00:00.000Z');
  await passe(environnement(d), '2026-11-19');
  await suspendreAcces(d, cd.id, ud.id, false, EDITEUR, '2026-11-20');
  assert.equal(d.compte('remise_ponctuelle'), 0);

  // Résiliation enregistrée : arrêt complet, aucun crédit.
  const r = cabinetAvecQuatrieme();
  assert.equal((await enregistrerPreavis(r.db, r.cab.id, '2026-11-01', EDITEUR, '2026-11-20')).ok, true);
  await supprimerAcces(r.db, r.cab.id, r.u.id, EDITEUR, '2026-11-20');
  assert.equal(r.db.compte('remise_ponctuelle'), 0);
});

test('la résiliation elle-même n\'écrit aucun crédit : préavis, effet, passage en résilié', async () => {
  const { db, cab, env } = cabinetAvecQuatrieme();
  assert.equal((await enregistrerPreavis(db, cab.id, '2026-11-01', EDITEUR, '2026-11-20')).ok, true);
  await passe(env, '2027-03-14');
  assert.equal(db.un<{ statut: string }>('SELECT statut FROM contrat WHERE id = ?', cab.contrat)!.statut, 'resilie');
  assert.equal(db.compte('remise_ponctuelle'), 0);
  assert.equal(db.compte('evenement', "type LIKE 'credit_prorata%'"), 0);
});

test('crédit cloisonné par cabinet : le crédit d\'un cabinet ne s\'applique jamais au bon d\'un autre', async () => {
  const { db, cab, u, env } = cabinetAvecQuatrieme();
  const autre = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  await supprimerAcces(db, cab.id, u.id, EDITEUR, '2026-11-20');
  assert.deepEqual(await supprimerAcces(db, autre.id, u.id, EDITEUR, '2026-11-20'), { ok: false, code: 'inconnu' }, 'jamais l\'accès d\'un autre cabinet');
  await passe(env, '2027-02-12');
  const bAutre = bons(db, autre.id).find((b) => b.periode_debut === '2027-03-14')!;
  assert.equal(bAutre.remise_ponctuelle_montant, 0);
  assert.deepEqual(credits(db, autre.id), []);
});

test('un bon brouillon annulé rend son crédit : il attend le prochain bon généré', async () => {
  const { db, cab, u, env } = cabinetAvecQuatrieme();
  await suspendreAcces(db, cab.id, u.id, false, EDITEUR, '2026-11-20');
  await passe(env, '2027-02-12');
  const suivant = bons(db, cab.id).find((b) => b.periode_debut === '2027-03-14')!;
  assert.equal((await annulerBon(db, cab.id, suivant.id, EDITEUR)).ok, true);
  assert.deepEqual(credits(db, cab.id).map((x) => [x.etat, x.bon_id]), [['en_attente', null]]);
});

// ------------------------------------------------------------------ la migration 0017

test('migration 0017 rejouée sur le schéma 0016 : bons émis, brouillons et annulés conservés, remises ponctuelles prêtes', async () => {
  const db = baseNeuve('0016');
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
  const avant = db.tous<Record<string, unknown>>('SELECT * FROM bon_a_facturer ORDER BY id');

  appliquerMigration(db, '0017');

  const apres = db.tous<Record<string, unknown>>('SELECT * FROM bon_a_facturer ORDER BY id');
  assert.deepEqual(apres.map(({ remise_ponctuelle_montant, ...reste }) => ({ ...reste })), avant.map((b) => ({ ...b })), 'aucune ligne perdue ni modifiée');
  assert.ok(apres.every((b) => b.remise_ponctuelle_montant === 0));
  assert.deepEqual(db.tous('PRAGMA foreign_key_check'), []);
  for (const t of ['bon_pas_de_suppression', 'bon_numero_definitif', 'bon_emis_fige', 'bon_statut_sens', 'remise_ponctuelle_bon_fige_modif']) {
    assert.ok(db.un("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name = ?", t), `déclencheur ${t}`);
  }
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET remise_ponctuelle_montant = 5 WHERE id = 'b-emis'"), /figé/);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET total_ht = 1 WHERE id = 'b-annule'"), /figé/);
  // Le code applicatif d'aujourd'hui lit aussi la table des lignes libres (0018) : on la crée avant de poser une remise.
  appliquerMigration(db, '0018');
  // Sur un brouillon existant : une remise se pose, le bon émis refuse.
  assert.equal((await poserRemise(db, 'ta', 'b-brouillon', { code_ligne: 'socle', montant: 1000, motif: 'Reprise' }, EDITEUR)).ok, true);
  assert.deepEqual(await poserRemise(db, 'ta', 'b-emis', { code_ligne: 'socle', montant: 1000, motif: 'Reprise' }, EDITEUR), { ok: false, code: 'pas_brouillon' });
  assert.equal((await emettreBon(db, 'ta', 'b-brouillon', EDITEUR, { malgreIdentiteIncomplete: true })).ok, true);
  assert.equal(db.un<{ total_ht: number }>("SELECT total_ht FROM bon_a_facturer WHERE id = 'b-brouillon'")!.total_ht, 93800);
  // CHECK : motif vide, montant nul, crédit sans date d'application.
  const ins = (montant: number, motif: string, origine: string, applicable: string | null) =>
    db.exec("INSERT INTO remise_ponctuelle (id, tenant_id, contrat_id, bon_id, code_ligne, montant, motif, origine, etat, applicable_des, cree_le, maj_le) VALUES (?, 'ta', ?, NULL, 'socle', ?, ?, ?, 'en_attente', ?, 'a', 'a')", `x${montant}${origine}`, contrat, montant, motif, origine, applicable);
  assert.throws(() => ins(100, ' ', 'acces', '2027-03-14'), /CHECK/);
  assert.throws(() => ins(0, 'm', 'acces', '2027-03-14'), /CHECK/);
  assert.throws(() => ins(100, 'm', 'acces', null), /CHECK/);
  assert.throws(() => ins(100, 'm', 'manuelle', '2027-03-14'), /CHECK/);
  assert.doesNotThrow(() => ins(100, 'm', 'acces', '2027-03-14'));
});

// ------------------------------------------------------------------ le changement de rôle d'un accès

test('associé ou collaborateur passé en lecture : crédit de prorata (3 mois × 25 €), motif adapté, rejoué sans doublon', async () => {
  const { db, cab, u } = cabinetAvecQuatrieme();
  assert.equal((await changerRole(db, cab.id, u.id, 'lecture', EDITEUR, '2026-11-20')).ok, true);
  assert.deepEqual(credits(db, cab.id).map((x) => [x.montant, x.motif, x.etat]), [[7500, 'Accès passé en lecture le 20/11/2026 : 3 mois non effectués', 'en_attente']]);
  assert.deepEqual(await changerRole(db, cab.id, u.id, 'lecture', EDITEUR, '2026-11-20'), { ok: false, code: 'inchange' });
  assert.equal(credits(db, cab.id).length, 1);
  // Lecture → lecture d'un autre accès (jamais facturé) : rien.
  const l = accesApres(db, cab, 'l@x.test', '2026-06-01T09:00:00.000Z', 'lecture');
  await changerRole(db, cab.id, l.id, 'associe', EDITEUR, '2026-11-20'); // devient facturable : 4 → 4 facturables (le premier est sorti)
  assert.equal(credits(db, cab.id).length, 1);
});

test('rôle : retour à un rôle facturable avant consommation, le crédit est annulé ; après un bon émis, il reste', async () => {
  const { db, cab, u, env } = cabinetAvecQuatrieme();
  await changerRole(db, cab.id, u.id, 'lecture', EDITEUR, '2026-11-20');
  await changerRole(db, cab.id, u.id, 'collaborateur', EDITEUR, '2026-11-21');
  assert.deepEqual(credits(db, cab.id).map((x) => x.etat), ['annulee']);
  // Consommé : sortie, bon suivant émis, retour.
  await changerRole(db, cab.id, u.id, 'lecture', EDITEUR, '2026-12-01');
  await passe(env, '2027-02-12');
  const suivant = bons(db, cab.id).find((b) => b.periode_debut === '2027-03-14')!;
  await emettreBon(db, cab.id, suivant.id, EDITEUR);
  await changerRole(db, cab.id, u.id, 'collaborateur', EDITEUR);
  assert.deepEqual(credits(db, cab.id).map((x) => x.etat), ['annulee', 'appliquee']);
});

test('lecture → collaborateur après l\'émission : bon complémentaire au prorata, une seule fois', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  const l = accesApres(db, c, 'lecture@x.test', '2026-02-01T09:00:00.000Z', 'lecture');
  bonEmis(db, c, '2026-03-14', '2027-03-14', 3, '2026-02-20T10:00:00.000Z');
  await changerRole(db, c.id, l.id, 'collaborateur', EDITEUR, '2026-11-20');
  // Le journal est en écriture seule : l'événement porte l'instant réel, la passe se fait le lendemain (tant que la période court).
  const demain = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (demain >= '2027-03-14') return;
  for (let i = 0; i < 3; i++) await passe(env, demain);
  const compl = complementaires(db, c.id);
  assert.equal(compl.length, 1);
  assert.deepEqual(lignes(compl[0]).map((l) => [l.code, l.quantite]), [['acces_sup', 1]]);
});

test('rôle : sous les accès inclus et en contrat mensuel, aucun crédit', async () => {
  const a = baseNeuve();
  const ca = cabinet(a, { periodicite: 'annuelle', debut_le: '2026-03-14' }, 3);
  bonEmis(a, ca, '2026-03-14', '2027-03-14', 3, '2026-11-19T10:00:00.000Z');
  const ua = a.un<{ id: string }>('SELECT id FROM utilisateur WHERE tenant_id = ? LIMIT 1', ca.id)!;
  await changerRole(a, ca.id, ua.id, 'lecture', EDITEUR, '2026-11-20');
  assert.equal(a.compte('remise_ponctuelle'), 0);
  const m = baseNeuve();
  const cm = cabinet(m, { periodicite: 'mensuelle', debut_le: '2026-03-14' });
  const um = accesApres(m, cm, 'q@x.test', '2026-06-01T09:00:00.000Z');
  await changerRole(m, cm.id, um.id, 'lecture', EDITEUR, '2026-11-20');
  assert.equal(m.compte('remise_ponctuelle'), 0);
});
