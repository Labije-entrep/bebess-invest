// 3. Calcul et facturation, la chaîne complète sur une vraie base : accès facturables → lignes → mensuel arrondi ligne par ligne
// (socle + Pilotage = 147 €) → prorata d'un module activé en cours de période (196 € et 49 €) → remise plafonnée à 50 % → numérotation
// sans trou sous écritures concurrentes. Le traitement quotidien est appelé comme le Cron l'appelle (traitementQuotidien).
//
// Les montants sont en centimes, hors taxes.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, type BaseTest } from './support/d1.ts';
import { cabinetEditeur, nouveauCompte, ouvrirSession, poserContrat, poserTenant, type Contrat } from './support/monde.ts';
import { dernier, envoyer, environnement, reseau } from './support/serveur.ts';
import { traitementQuotidien } from '../src/lib/traitement';
import { accesFacturables, annulerBon, bonComplet, bonsParStatut, emettreBon } from '../src/lib/facturation';
import { basculerModule, modifierFormule, poserMiseEnProduction, poserStatutFondateur } from '../src/lib/contrat';
import type { LigneBon } from '../src/lib/tarif';

const EDITEUR = { id: 'u-editeur', role: 'editeur' as const };

interface Cab {
  id: string;
  contrat: string;
}
let n = 0;
/** Un cabinet réduit au nécessaire de la facturation : locataire, contrat, et deux associés (les deux accès inclus). */
function cabinet(db: BaseTest, c: Partial<Contrat> = {}, o: { associes?: number; identite?: boolean } = {}): Cab {
  const id = `t${++n}`;
  poserTenant(db, id, `Cabinet ${id}`, `${id}.test`, null);
  if (o.identite !== false) {
    db.exec("UPDATE tenant SET siren = ?, adresse_facturation = '1 rue du Test, 75001 Paris', contact_facturation = 'compta@test.fr' WHERE id = ?", String(100000000 + n), id);
  }
  const contrat = poserContrat(db, id, { module_pilotage: 0, module_site: 0, ...c });
  for (let i = 0; i < (o.associes ?? 2); i++) nouveauCompte(db, id, 'associe', `associe${i}@${id}.test`);
  return { id, contrat };
}

const passe = (env: ReturnType<typeof environnement>, jour: string) =>
  traitementQuotidien(env, { maintenant: new Date(`${jour}T03:00:00Z`), mailer: () => ({ envoyer: async () => {} }) });

const bons = (db: BaseTest, tenant: string) =>
  db.tous<{ id: string; type: string; periode_debut: string; periode_fin: string; statut: string; total_ht: number; recurrent_ht: number; remise_taux: number; remise_montant: number; remise_motif: string | null; acces_facturables: number; lignes: string; numero: string | null }>(
    'SELECT * FROM bon_a_facturer WHERE tenant_id = ? ORDER BY periode_debut, type', tenant);
const lignes = (b: { lignes: string }): LigneBon[] => JSON.parse(b.lignes);
const montants = (b: { lignes: string }): Record<string, number> => Object.fromEntries(lignes(b).map((l) => [l.code, l.montant]));

// ------------------------------------------------------------------ les accès facturables

test('accès facturables : associés et collaborateurs actifs, et eux seuls', async () => {
  const db = baseNeuve();
  const c = cabinet(db, {}, { associes: 2 });
  nouveauCompte(db, c.id, 'collaborateur', 'collab@x.test');
  nouveauCompte(db, c.id, 'collaborateur', 'collab-inactif@x.test', { actif: 0 });
  nouveauCompte(db, c.id, 'lecture', 'lecture@x.test');
  nouveauCompte(db, c.id, 'support_editeur', 'support@x.test');
  nouveauCompte(db, c.id, 'viewer', 'client1@x.test');
  nouveauCompte(db, c.id, 'viewer', 'client2@x.test');
  nouveauCompte(db, c.id, 'viewer', 'client3@x.test');
  assert.equal(await accesFacturables(db, c.id), 3, '2 associés + 1 collaborateur actif ; ni lecture, ni support, ni viewers, ni inactif');
  // Un autre cabinet n'entre pas dans le compte.
  const autre = cabinet(db, {}, { associes: 5 });
  assert.equal(await accesFacturables(db, c.id), 3);
  assert.equal(await accesFacturables(db, autre.id), 5);
});

// ------------------------------------------------------------------ les lignes

test('bon annuel : chaque ligne vaut son prix × 12, les accès au-delà de ceux qui sont inclus se facturent', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', module_pilotage: 1, module_site: 1, acces_inclus: 2 }, { associes: 3 });
  nouveauCompte(db, c.id, 'collaborateur', 'c@x.test');
  nouveauCompte(db, c.id, 'lecture', 'l@x.test');
  await passe(env, '2026-03-20');
  const [b] = bons(db, c.id);
  assert.equal(b.acces_facturables, 4);
  assert.deepEqual(montants(b), { socle: 7900 * 12, pilotage: 4900 * 12, site: 3900 * 12, acces_sup: 2 * 2500 * 12 });
  assert.equal(lignes(b).find((l) => l.code === 'acces_sup')?.quantite, 2);
  assert.equal(b.recurrent_ht, (7900 + 4900 + 3900 + 5000) * 12);
  assert.equal(b.total_ht, b.recurrent_ht);
  assert.equal(b.remise_taux, 0);
  assert.equal(b.remise_motif, null);
  assert.equal(b.statut, 'brouillon');
  assert.equal(b.numero, null, 'un brouillon n\'a pas de numéro');
});

test('bon mensuel : × 1,15 arrondi à l\'euro LIGNE PAR LIGNE, socle + Pilotage = 147 €', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'mensuelle', module_pilotage: 1 });
  await passe(env, '2026-03-20');
  const b = bons(db, c.id)[0];
  assert.deepEqual(montants(b), { socle: 9100, pilotage: 5600 });
  assert.equal(b.recurrent_ht, 14700, 'jamais un coefficient sur le total : 91 + 56 = 147, pas 128 × 1,15 = 147,20');
  assert.equal(b.total_ht, 14700);
  const complet = await bonComplet(db, b.id);
  assert.equal(complet?.tva_taux, 2000);
  assert.equal(complet?.tva_montant, 2940);
  assert.equal(complet?.total_ttc, 17640);
  // Les quatre lignes au mois : 79 → 91, 49 → 56, 39 → 45, 25 → 29.
  const d = cabinet(db, { periodicite: 'mensuelle', module_pilotage: 1, module_site: 1 }, { associes: 3 });
  await passe(env, '2026-03-20');
  assert.deepEqual(montants(bons(db, d.id)[0]), { socle: 9100, pilotage: 5600, site: 4500, acces_sup: 2900 });
});

// ------------------------------------------------------------------ le calendrier des bons

test('le premier bon est celui de la période en cours ; le suivant se pose trente jours avant la date anniversaire', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  await passe(env, '2026-11-19');
  assert.deepEqual(bons(db, c.id).map((b) => [b.periode_debut, b.periode_fin]), [['2026-03-14', '2027-03-14']], 'mise en service tardive : le bon de la période en cours');
  await passe(env, '2027-02-11');
  assert.equal(bons(db, c.id).length, 1, 'à 31 jours de l\'anniversaire, rien');
  await passe(env, '2027-02-12');
  assert.deepEqual(bons(db, c.id).map((b) => b.periode_debut), ['2026-03-14', '2027-03-14'], 'à 30 jours, le bon de la période suivante');
  // Un contrat mensuel : un bon par mois.
  const m = cabinet(db, { periodicite: 'mensuelle', debut_le: '2026-10-14' });
  await passe(env, '2026-11-19');
  assert.deepEqual(bons(db, m.id).map((b) => b.periode_debut), ['2026-11-14', '2026-12-14'], 'la période en cours (14/11) et celle qui commence dans les 30 jours (14/12)');
});

test('seuls les contrats actifs avec une date de début sont facturés', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const sans = cabinet(db, { statut: 'actif', debut_le: null });
  const essai = cabinet(db, { statut: 'essai', date_mise_en_production: '2026-11-01', date_fin_essai: '2026-12-16' });
  const brouillon = cabinet(db, { statut: 'brouillon' });
  const suspendu = cabinet(db, { statut: 'suspendu' });
  await passe(env, '2026-11-19');
  for (const c of [sans, essai, brouillon, suspendu]) assert.equal(bons(db, c.id).length, 0, c.id);
});

// ------------------------------------------------------------------ le prorata

/** Active un module le jour dit, par la vraie fonction, avec l'horloge réglée ce jour-là. */
async function activerLe(db: BaseTest, tenant: string, jour: string): Promise<void> {
  mock.timers.enable({ apis: ['Date'], now: new Date(`${jour}T10:00:00Z`) });
  try {
    const r = await basculerModule(db, tenant, 'pilotage', true, EDITEUR, jour);
    assert.equal(r.ok, true);
  } finally {
    mock.timers.reset();
  }
}

test('prorata : Pilotage activé le 20/11/2026 → 4 mois → 196 € ; le 02/03/2027 → 1 mois → 49 € (anniversaire au 14/03/2027)', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const a = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  const b = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  await passe(env, '2026-11-10'); // les bons de la période, sans Pilotage
  assert.deepEqual(montants(bons(db, a.id)[0]), { socle: 7900 * 12 });

  await activerLe(db, a.id, '2026-11-20');
  // Le jour même, rien : on attend le lendemain pour que toutes les activations d'une date entrent dans le même bon.
  await passe(env, '2026-11-20');
  assert.equal(bons(db, a.id).filter((x) => x.type === 'complementaire').length, 0);
  await passe(env, '2026-11-21');
  const [compl] = bons(db, a.id).filter((x) => x.type === 'complementaire');
  assert.equal(compl.periode_debut, '2026-11-20');
  assert.equal(compl.periode_fin, '2027-03-14');
  assert.deepEqual(lignes(compl).map((l) => [l.code, l.mois, l.prix_unitaire, l.montant]), [['pilotage', 4, 4900, 19600]]);
  assert.equal(compl.total_ht, 19600, '4 mois × 49 € = 196 €');

  await activerLe(db, b.id, '2027-03-02');
  await passe(env, '2027-03-03');
  const [compl2] = bons(db, b.id).filter((x) => x.type === 'complementaire');
  assert.equal(compl2.periode_debut, '2027-03-02');
  assert.deepEqual(lignes(compl2).map((l) => [l.code, l.mois, l.montant]), [['pilotage', 1, 4900]]);
  assert.equal(compl2.total_ht, 4900, '1 mois × 49 € = 49 €');

  // Rejoué : un seul bon complémentaire par cabinet, et la même somme.
  await passe(env, '2026-11-21');
  await passe(env, '2027-03-03');
  assert.equal(bons(db, a.id).filter((x) => x.type === 'complementaire').length, 1);
  assert.equal(bons(db, b.id).filter((x) => x.type === 'complementaire').length, 1);
});

test('prorata : pas de bon complémentaire pour un contrat mensuel, ni pour un module déjà au bon de la période', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const mensuel = cabinet(db, { periodicite: 'mensuelle', debut_le: '2026-03-14' });
  await activerLe(db, mensuel.id, '2026-11-20');
  await passe(env, '2026-11-21');
  assert.equal(bons(db, mensuel.id).filter((x) => x.type === 'complementaire').length, 0, 'le module entre dans le bon du mois suivant');
  assert.ok(bons(db, mensuel.id).some((b) => 'pilotage' in montants(b) && b.type === 'periode' && b.periode_debut >= '2026-12-14'));

  // Activé avant le début de la période : relève du bon périodique, qui le porte déjà.
  const avant = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14' });
  await activerLe(db, avant.id, '2026-02-01');
  await passe(env, '2026-11-21');
  assert.equal(bons(db, avant.id).filter((x) => x.type === 'complementaire').length, 0);
});

// ------------------------------------------------------------------ la remise

test('remise : commerciale + parrainage plafonnées à 50 %, assiette = le récurrent seul, motif en clair', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const marraine = cabinet(db, { periodicite: 'annuelle', debut_le: '2026-03-14', remise_commerciale_taux: 4000, remise_motif: 'Réseau de partenaires' });
  db.exec("UPDATE contrat SET remise_revue_le = '2027-06-01' WHERE id = ?", marraine.contrat); // une remise commerciale s'écrit toujours avec sa date de revue
  // Deux filleuls au contrat actif depuis plus de six mois : leurs parrainages se valident à la passe.
  for (const f of [cabinet(db, { debut_le: '2026-01-10' }), cabinet(db, { debut_le: '2026-02-10' })]) {
    db.exec("INSERT INTO parrainage (id, tenant_id, filleul_tenant_id, statut, cree_le) VALUES (?, ?, ?, 'en_attente', '2026-01-01')", `p-${f.id}`, marraine.id, f.id);
  }
  const rapport = await passe(env, '2026-11-19');
  assert.equal(rapport.parrainages_valides, 2);
  assert.deepEqual(rapport.echecs, []);
  const [b] = bons(db, marraine.id);
  assert.equal(b.recurrent_ht, 7900 * 12);
  assert.equal(b.remise_taux, 5000, '40 % + 50 % de parrainage : plafonné à 50 %');
  assert.equal(b.remise_montant, 7900 * 6);
  assert.equal(b.total_ht, 7900 * 6);
  assert.match(b.remise_motif ?? '', /parrainage/i);
  assert.match(b.remise_motif ?? '', /Réseau de partenaires/);
  assert.match(b.remise_motif ?? '', /plafonnée à 50 %/);
  assert.equal(db.un<{ remise_parrainage_taux: number }>('SELECT remise_parrainage_taux FROM contrat WHERE id = ?', marraine.contrat)?.remise_parrainage_taux, 5000, 'la fiche du contrat suit les parrainages validés');
});

// Défaut relevé par ce banc puis corrigé (lot 18) : genererBons passait le contrat entier, frais d'installation compris, à calculerBon, qui
// les ajoutait au total ; chaque bon périodique les refacturait. tarif.ts dit que le bon périodique « n'en porte jamais ».
test('frais d\'installation : aucun bon périodique ne les porte, ni le premier, ni ceux des périodes suivantes, ni avec une remise', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { frais_installation: 150000, remise_commerciale_taux: 2500, remise_motif: 'Réseau' });
  db.exec("UPDATE contrat SET remise_revue_le = '2027-06-01' WHERE id = ?", c.contrat);
  await passe(env, '2026-11-19');
  await passe(env, '2027-02-12'); // le bon de la période suivante, posé 30 jours avant l'anniversaire
  const tous = bons(db, c.id);
  assert.equal(tous.length, 2);
  for (const b of tous) {
    assert.equal(b.recurrent_ht, 7900 * 12);
    assert.equal(b.remise_montant, 7900 * 3, '25 % du récurrent seul : les frais ne sont pas dans l\'assiette');
    assert.equal(b.total_ht, 7900 * 9, `${b.periode_debut} : le total est le récurrent moins la remise, sans les 1 500 € d'installation`);
  }
  // Le contrat les garde : seule leur facturation périodique est en cause.
  assert.equal(db.un<{ frais_installation: number }>('SELECT frais_installation FROM contrat WHERE id = ?', c.contrat)?.frais_installation, 150000);
});

test('remise : un parrainage ne se valide qu\'après six mois de service payant du filleul', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const marraine = cabinet(db, {});
  const recent = cabinet(db, { debut_le: '2026-06-01' });
  const essai = cabinet(db, { statut: 'essai', debut_le: '2026-01-01', date_mise_en_production: '2026-11-01', date_fin_essai: '2026-12-16' });
  for (const f of [recent, essai]) db.exec("INSERT INTO parrainage (id, tenant_id, filleul_tenant_id, cree_le) VALUES (?, ?, ?, '2026-01-01')", `p-${f.id}`, marraine.id, f.id);
  assert.equal((await passe(env, '2026-11-19')).parrainages_valides, 0, 'cinq mois et demi de service ; un essai ne compte pas');
  assert.equal((await passe(env, '2026-12-01')).parrainages_valides, 1, 'six mois révolus le 01/12/2026');
  assert.equal((await passe(env, '2026-12-02')).parrainages_valides, 0, 'rejoué : rien de plus');
  assert.equal(db.compte('evenement', "type = 'parrainage_valide'"), 1);
});

test('remise : la base elle-même refuse un bon dont la remise dépasse 50 %, et le calcul n\'y arrive jamais (60 % saisis)', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, { remise_commerciale_taux: 6000, remise_motif: 'Geste exceptionnel' });
  const rapport = await passe(env, '2026-11-19');
  assert.deepEqual(rapport.echecs, [], 'le plafond est tenu par le calcul avant que la base ne le refuse');
  assert.equal(bons(db, c.id)[0].remise_taux, 5000);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET remise_taux = 6000 WHERE tenant_id = ?", c.id), /CHECK/);
});

// ------------------------------------------------------------------ rejouabilité de la génération

test('traitement rejoué dix fois : un seul bon, un seul événement, un seul incident à l\'éditeur', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = cabinet(db, {});
  for (let i = 0; i < 10; i++) await passe(env, '2026-11-19');
  assert.equal(bons(db, c.id).length, 1);
  assert.equal(db.compte('evenement', "type = 'bon_genere' AND tenant_id = ?", c.id), 1);
  assert.equal(db.compte('incident', "quoi = 'bon_a_emettre' AND tenant_id = ?", c.id), 1, 'l\'éditeur n\'est prévenu qu\'une fois');
  assert.deepEqual(reseau.courriels(), [], 'aucun courriel pour un bon : la console, et elle seule');
});

test('un brouillon suit le contrat ; un bon émis ne bouge plus', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  // Un brouillon suit le contrat tant que sa période n'a pas commencé : celui de la période qui s'ouvre dans les 30 jours.
  const c = cabinet(db, { debut_le: '2026-12-01' }, { associes: 2 });
  await passe(env, '2026-11-19');
  assert.equal(bons(db, c.id)[0].periode_debut, '2026-12-01');
  assert.equal(bons(db, c.id)[0].total_ht, 7900 * 12);
  nouveauCompte(db, c.id, 'associe', 'troisieme@x.test');
  await passe(env, '2026-11-19');
  const [b] = bons(db, c.id);
  assert.equal(b.acces_facturables, 3);
  assert.equal(b.total_ht, (7900 + 2500) * 12, 'le brouillon a suivi l\'arrivée d\'un troisième accès');

  const r = await emettreBon(db, c.id, b.id, EDITEUR);
  assert.equal(r.ok, true);
  nouveauCompte(db, c.id, 'associe', 'quatrieme@x.test');
  await passe(env, '2026-11-19');
  assert.equal(bons(db, c.id)[0].total_ht, (7900 + 2500) * 12, 'émis : figé');
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET total_ht = 1 WHERE id = ?", b.id), /figé/);
});

// ------------------------------------------------------------------ la numérotation

function brouillons(db: BaseTest, k: number): { tenant: string; bon: string }[] {
  const out: { tenant: string; bon: string }[] = [];
  for (let i = 0; i < k; i++) {
    const c = cabinet(db, {});
    const bon = `bon-${c.id}`;
    db.exec(
      `INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, cree_le)
       VALUES (?, ?, ?, '2026-03-14', '2027-03-14', 2, '[]', 1000, 0, 0, 1000, '2026-11-19')`, bon, c.id, c.contrat);
    out.push({ tenant: c.id, bon });
  }
  return out;
}
const numeros = (db: BaseTest): string[] => db.tous<{ numero: string }>("SELECT numero FROM bon_a_facturer WHERE numero IS NOT NULL ORDER BY seq").map((r) => r.numero);

test('numérotation : 17 émissions simultanées plus des doublons → FACT-AAAA-0001 à 0017, sans trou ni collision', async () => {
  const db = baseNeuve();
  const lot = brouillons(db, 17);
  const annee = new Date().getUTCFullYear();
  // Chaque bon est émis deux fois, au même instant, depuis dix-sept « requêtes » qui s'entrelacent.
  const resultats = await Promise.all(lot.flatMap((b) => [emettreBon(db, b.tenant, b.bon, EDITEUR), emettreBon(db, b.tenant, b.bon, EDITEUR)]));
  assert.equal(resultats.filter((r) => r.ok).length, 17, 'une émission réussie par bon');
  const refus = resultats.filter((r) => !r.ok);
  assert.equal(refus.length, 17);
  assert.ok(refus.every((r) => !r.ok && r.code === 'pas_brouillon'), 'le doublon est refusé comme « plus un brouillon »');
  assert.deepEqual(numeros(db), Array.from({ length: 17 }, (_, i) => `FACT-${annee}-${String(i + 1).padStart(4, '0')}`));
  assert.equal(db.compte('evenement', "type = 'bon_emis'"), 17, 'un événement par émission réelle, aucun pour les doublons');
});

test('numérotation : réservée à l\'éditeur ; l\'identité incomplète se confirme ; un bon annulé garde son numéro et ne le rend pas', async () => {
  const db = baseNeuve();
  const [a, b, c] = brouillons(db, 3);
  assert.deepEqual(await emettreBon(db, a.tenant, a.bon, { id: 'u', role: 'associe' }), { ok: false, code: 'interdit' });
  assert.equal((await emettreBon(db, a.tenant, 'inconnu', EDITEUR)).ok, false);
  assert.deepEqual(await emettreBon(db, b.tenant, a.bon, EDITEUR), { ok: false, code: 'introuvable' }, 'le bon d\'un autre cabinet est introuvable');
  assert.equal(numeros(db).length, 0, 'aucun numéro consommé par les refus');

  db.exec("UPDATE tenant SET adresse_facturation = NULL, siren = NULL WHERE id = ?", a.tenant);
  assert.deepEqual(await emettreBon(db, a.tenant, a.bon, EDITEUR), { ok: false, code: 'identite_incomplete' });
  assert.equal(numeros(db).length, 0);
  const force = await emettreBon(db, a.tenant, a.bon, EDITEUR, { malgreIdentiteIncomplete: true });
  assert.equal(force.ok && force.bon.numero?.endsWith('-0001'), true);
  const detail = db.un<{ detail: string }>("SELECT detail FROM evenement WHERE type = 'bon_emis' AND tenant_id = ?", a.tenant)!.detail;
  assert.match(detail, /identite_incomplete/, 'l\'événement garde ce qui manquait');

  // Annuler un émis : avoir de sa propre séquence ; le bon garde son numéro ; le suivant reçoit le numéro suivant, jamais un numéro rendu.
  const an = await annulerBon(db, a.tenant, a.bon, EDITEUR);
  assert.equal(an.ok && an.avoir?.numero.endsWith('-0001'), true);
  assert.match((an.ok && an.avoir?.numero) || '', /^AVOIR-\d{4}-0001$/);
  assert.equal(db.un<{ numero: string; statut: string }>('SELECT numero, statut FROM bon_a_facturer WHERE id = ?', a.bon)?.statut, 'annulee');
  assert.ok(db.un<{ numero: string }>('SELECT numero FROM bon_a_facturer WHERE id = ?', a.bon)?.numero?.endsWith('-0001'));
  assert.deepEqual(await annulerBon(db, a.tenant, a.bon, EDITEUR), { ok: false, code: 'deja_annule' });
  const suite = await emettreBon(db, b.tenant, b.bon, EDITEUR);
  assert.equal(suite.ok && suite.bon.numero?.endsWith('-0002'), true, 'pas de trou, pas de réemploi');
  // Un brouillon s'annule sans trace comptable : ni numéro, ni avoir.
  const brouillon = await annulerBon(db, c.tenant, c.bon, EDITEUR);
  assert.equal(brouillon.ok && brouillon.avoir, undefined);
  assert.equal(db.compte('avoir'), 1);
  assert.equal(db.un<{ numero: string | null }>('SELECT numero FROM bon_a_facturer WHERE id = ?', c.bon)?.numero, null);
  // Une annulation simultanée de deux demandes n'écrit qu'un avoir.
  const [d] = brouillons(db, 1);
  await emettreBon(db, d.tenant, d.bon, EDITEUR);
  const deux = await Promise.all([annulerBon(db, d.tenant, d.bon, EDITEUR), annulerBon(db, d.tenant, d.bon, EDITEUR)]);
  assert.equal(deux.filter((r) => r.ok).length, 1);
  assert.equal(db.compte('avoir', 'bon_id = ?', d.bon), 1);
});

test('numérotation : la base refuse un numéro modifié, un bon effacé, un montant changé, un brouillon numéroté, une collision', async () => {
  const db = baseNeuve();
  const [a, b] = brouillons(db, 2);
  await emettreBon(db, a.tenant, a.bon, EDITEUR);
  await emettreBon(db, b.tenant, b.bon, EDITEUR);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET numero = 'FACT-2026-0999' WHERE id = ?", a.bon), /numéro d'un bon émis ne change pas/);
  assert.throws(() => db.exec('UPDATE bon_a_facturer SET seq = 99 WHERE id = ?', a.bon), /numéro d'un bon émis ne change pas/);
  assert.throws(() => db.exec('DELETE FROM bon_a_facturer WHERE id = ?', a.bon), /ne s'efface pas/);
  assert.throws(() => db.exec('UPDATE bon_a_facturer SET total_ht = 1 WHERE id = ?', a.bon), /figé/);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET statut = 'brouillon' WHERE id = ?", a.bon), /transition de statut interdite/);
  const [c] = brouillons(db, 1);
  assert.throws(() => db.exec("UPDATE bon_a_facturer SET numero = 'FACT-2026-0003' WHERE id = ?", c.bon), /CHECK/, 'un brouillon ne porte pas de numéro');
  // Collision (annee, seq) : l'index unique la refuse.
  const pris = db.un<{ annee: number; seq: number }>('SELECT annee, seq FROM bon_a_facturer WHERE id = ?', a.bon)!;
  assert.throws(
    () => db.exec("UPDATE bon_a_facturer SET statut = 'emise', annee = ?, seq = ?, numero = 'FACT-2026-7777', emis_le = '2026-11-19' WHERE id = ?", pris.annee, pris.seq, c.bon),
    /UNIQUE/,
  );
  // Un avoir ne se modifie ni ne s'efface.
  await annulerBon(db, a.tenant, a.bon, EDITEUR);
  assert.throws(() => db.exec('UPDATE avoir SET montant_ht = 1'), /ne se modifie pas/);
  assert.throws(() => db.exec('DELETE FROM avoir'), /ne s'efface pas/);
  // Le journal est en écriture seule.
  assert.throws(() => db.exec("UPDATE evenement SET type = 'x'"), /écriture seule/);
  assert.throws(() => db.exec('DELETE FROM evenement'), /écriture seule/);
});

// ------------------------------------------------------------------ le bon d'installation (lot 19)

const FRAIS = 120000; // 1 200 €
const MEP = '2026-11-01';
const installations = (db: BaseTest, tenant: string) => bons(db, tenant).filter((b) => b.type === 'installation');
/** Un cabinet à 1 200 € de frais, mis en production par la vraie fonction (DPA signé, essai de 45 jours). */
async function enProduction(db: BaseTest, c: Partial<Contrat> = {}, jour = MEP): Promise<Cab> {
  const cab = cabinet(db, { statut: 'brouillon', debut_le: null, frais_installation: FRAIS, ...c });
  const r = await poserMiseEnProduction(db, cab.id, jour, EDITEUR);
  assert.equal(r.ok, true);
  return cab;
}

test('installation : 1 200 € de frais mis en production → un bon de 1 200 €, et un seul, même après trois passes', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = await enProduction(db);
  assert.equal(installations(db, c.id).length, 0, 'rien avant la passe du traitement');
  const rapport = await passe(env, '2026-11-02');
  assert.equal(rapport.bons?.installations, 1);
  await passe(env, '2026-11-02');
  await passe(env, '2026-11-03');
  const [b] = installations(db, c.id);
  assert.equal(installations(db, c.id).length, 1);
  assert.equal(b.total_ht, FRAIS);
  assert.deepEqual(lignes(b).map((l) => [l.code, l.quantite, l.prix_unitaire, l.mois, l.montant]), [['installation', 1, FRAIS, 1, FRAIS]], 'une seule ligne');
  assert.equal(b.recurrent_ht, 0, 'aucun récurrent');
  assert.equal(b.remise_taux, 0);
  assert.equal(b.remise_montant, 0);
  assert.equal(b.remise_motif, null);
  assert.equal(b.statut, 'brouillon');
  assert.equal(b.numero, null);
  assert.deepEqual([b.periode_debut, b.periode_fin], [MEP, MEP], 'daté du jour de la mise en production');
  assert.equal(db.compte('evenement', "type = 'bon_genere' AND cible_id = ? AND detail LIKE '%installation%'", c.contrat), 1, 'un seul événement');
  assert.equal(db.compte('incident', "quoi = 'bon_a_emettre' AND tenant_id = ?", c.id), 1, 'l\'éditeur n\'est prévenu qu\'une fois');
  assert.match(db.un<{ detail: string }>("SELECT detail FROM incident WHERE quoi = 'bon_a_emettre' AND tenant_id = ?", c.id)!.detail, /installation.*1200,00 €/);
});

test('installation : la remise ne s\'applique pas — l\'assiette des remises est le récurrent seul', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const marraine = await enProduction(db, { remise_commerciale_taux: 4000, remise_motif: 'Réseau' });
  db.exec("UPDATE contrat SET remise_revue_le = '2027-06-01' WHERE id = ?", marraine.contrat);
  for (const f of [cabinet(db, { debut_le: '2026-01-10' }), cabinet(db, { debut_le: '2026-02-10' })]) {
    db.exec("INSERT INTO parrainage (id, tenant_id, filleul_tenant_id, statut, cree_le) VALUES (?, ?, ?, 'valide', '2026-01-01')", `p-${f.id}`, marraine.id, f.id);
  }
  await passe(env, '2026-11-02');
  const [b] = installations(db, marraine.id);
  assert.equal(b.total_ht, FRAIS, 'ni 40 %, ni 50 % de parrainage : 1 200 € pleins');
  assert.equal(b.remise_taux, 0);
  // La base le refuse aussi : un bon d'installation avec récurrent ou remise, ou à zéro euro, n'entre pas.
  const ligne = (o: string) => `UPDATE bon_a_facturer SET ${o} WHERE id = '${b.id}'`;
  assert.throws(() => db.exec(ligne('remise_taux = 2500, remise_montant = 30000')), /CHECK/);
  assert.throws(() => db.exec(ligne('recurrent_ht = 1000')), /CHECK/);
  assert.throws(() => db.exec(ligne('total_ht = 0')), /CHECK/);
});

test('installation : un contrat à frais nuls (cabinet fondateur) n\'en produit aucun — pas de bon à zéro euro', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  // Un fondateur : le statut met les frais à zéro (vraie fonction), avant ou après la mise en production.
  const avant = cabinet(db, { statut: 'brouillon', debut_le: null, frais_installation: FRAIS });
  const f = await poserStatutFondateur(db, avant.id, '2026-11-01', EDITEUR);
  assert.equal(f.ok && f.contrat.frais_installation, 0);
  assert.equal((await poserMiseEnProduction(db, avant.id, MEP, EDITEUR)).ok, true);
  const nuls = await enProduction(db, { frais_installation: 0 });
  const rapport = await passe(env, '2026-11-02');
  await passe(env, '2026-11-03');
  assert.equal(rapport.bons?.installations, 0);
  assert.equal(installations(db, avant.id).length, 0);
  assert.equal(installations(db, nuls.id).length, 0);
  assert.equal(db.compte('bon_a_facturer', "type = 'installation'"), 0);
});

test('installation : seulement avec une mise en production, et pour un contrat en cours', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const sansMep = cabinet(db, { statut: 'brouillon', debut_le: null, frais_installation: FRAIS });
  const actifSansMep = cabinet(db, { statut: 'actif', frais_installation: FRAIS });
  const sortis = [await enProduction(db), await enProduction(db)];
  db.exec("UPDATE contrat SET statut = 'essai_non_converti' WHERE id = ?", sortis[0].contrat);
  db.exec("UPDATE contrat SET statut = 'resilie' WHERE id = ?", sortis[1].contrat);
  await passe(env, '2026-11-02');
  for (const c of [sansMep, actifSansMep, ...sortis]) assert.equal(installations(db, c.id).length, 0, c.id);
  // Pour un contrat déjà en production avant ce lot, le traitement rattrape : le bon est posé à la première passe.
  const ancien = cabinet(db, { statut: 'actif', frais_installation: FRAIS, date_mise_en_production: '2026-03-01', date_fin_essai: '2026-04-15' });
  await passe(env, '2026-11-02');
  assert.deepEqual(installations(db, ancien.id).map((b) => [b.periode_debut, b.total_ht]), [['2026-03-01', FRAIS]]);
});

test('installation : il apparaît dans les bons à émettre, s\'émet, se numérote et s\'annule comme les autres', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = await enProduction(db);
  await passe(env, '2026-11-02');
  const aEmettre = await bonsParStatut(db, 'brouillon');
  assert.deepEqual(aEmettre.filter((b) => b.tenant_id === c.id).map((b) => [b.type, b.total_ht]), [['installation', FRAIS]]);
  const [b] = installations(db, c.id);
  const complet = await bonComplet(db, b.id);
  assert.equal(complet?.type, 'installation');
  assert.deepEqual(complet?.lignes.map((l) => l.libelle), ['Frais d’installation']);
  assert.deepEqual([complet?.total_ht, complet?.tva_montant, complet?.total_ttc], [FRAIS, 24000, 144000], '1 200 € HT, 240 € de TVA, 1 440 € TTC');

  const emis = await emettreBon(db, c.id, b.id, EDITEUR);
  assert.equal(emis.ok && /^FACT-\d{4}-0001$/.test(emis.bon.numero ?? ''), true);
  assert.equal((await bonsParStatut(db, 'brouillon')).some((x) => x.id === b.id), false, 'émis : il sort des bons à émettre');
  assert.equal((await bonsParStatut(db, 'emise')).some((x) => x.id === b.id), true);
  // Annulé, il ne se recrée pas : un seul bon d'installation par contrat, quel que soit son statut.
  const an = await annulerBon(db, c.id, b.id, EDITEUR);
  assert.equal(an.ok && an.avoir?.montant_ht, FRAIS);
  await passe(env, '2026-11-03');
  await passe(env, '2026-11-04');
  assert.equal(installations(db, c.id).length, 1);
  assert.equal(installations(db, c.id)[0].statut, 'annulee');
});

test('installation : la console liste le bon (type et date), et la page du bon s\'ouvre', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = await enProduction(db);
  await passe(env, '2026-11-02');
  const ed = cabinetEditeur(db);
  const cookie = ouvrirSession(db, ed.editeur);
  const liste = await envoyer(env, { url: '/admin/facturation?onglet=bons&statut=brouillon', hote: ed.hote, cookie });
  assert.equal(liste.statut, 200);
  const rendus = (dernier.rendu?.bons ?? []) as { type: string; tenant_id: string; total_ht: number }[];
  assert.deepEqual(rendus.filter((b) => b.tenant_id === c.id).map((b) => [b.type, b.total_ht]), [['installation', FRAIS]]);
  const page = await envoyer(env, { url: `/admin/bons/${installations(db, c.id)[0].id}`, hote: ed.hote, cookie });
  assert.equal(page.statut, 200);
});

test('installation : un brouillon suit les frais du contrat, un bon émis ne bouge plus, une date de mise en production corrigée n\'en crée pas un second', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = await enProduction(db);
  await passe(env, '2026-11-02');
  const f = await modifierFormule(db, c.id, { frais_installation: 90000 }, EDITEUR);
  assert.equal(f.ok, true);
  await passe(env, '2026-11-03');
  assert.equal(installations(db, c.id)[0].total_ht, 90000, 'les frais corrigés avant l\'émission : le brouillon suit');
  // Date de mise en production corrigée : le même bon, pas un second.
  assert.equal((await poserMiseEnProduction(db, c.id, '2026-11-05', EDITEUR)).ok, true);
  await passe(env, '2026-11-06');
  await passe(env, '2026-11-07');
  assert.equal(installations(db, c.id).length, 1);
  assert.equal(installations(db, c.id)[0].periode_debut, MEP, 'le bon garde sa date');
  // Émis : figé, quoi que devienne le contrat ensuite.
  await emettreBon(db, c.id, installations(db, c.id)[0].id, EDITEUR);
  await modifierFormule(db, c.id, { frais_installation: 50000 }, EDITEUR);
  await passe(env, '2026-11-08');
  assert.equal(installations(db, c.id)[0].total_ht, 90000);
  assert.equal(installations(db, c.id).length, 1);
});

test('installation : le bon périodique suivant ne contient toujours pas les frais, et l\'installation ne dispense pas du premier bon de période', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const c = await enProduction(db, { remise_commerciale_taux: 2500, remise_motif: 'Réseau' });
  db.exec("UPDATE contrat SET remise_revue_le = '2027-06-01' WHERE id = ?", c.contrat);
  await passe(env, '2026-11-02');
  assert.equal(bons(db, c.id).filter((b) => b.type === 'periode').length, 0, 'en essai : pas de bon de période');
  // L'essai devient contrat : début de service au 16/12/2026. Le traitement pose le bon de la période en cours, malgré le bon d'installation.
  db.exec("UPDATE contrat SET statut = 'actif', debut_le = '2026-12-16' WHERE id = ?", c.contrat);
  await passe(env, '2027-01-20'); // la période a commencé depuis plus d'un mois : seul le « premier bon » (période en cours) peut la poser
  await passe(env, '2027-11-20'); // un an plus tard : le bon de la période suivante
  const periodiques = bons(db, c.id).filter((b) => b.type === 'periode');
  assert.deepEqual(periodiques.map((b) => b.periode_debut), ['2026-12-16', '2027-12-16']);
  for (const b of periodiques) {
    assert.equal(b.recurrent_ht, 7900 * 12);
    assert.equal(b.total_ht, 7900 * 9, `${b.periode_debut} : récurrent moins 25 %, sans les 1 200 €`);
    assert.deepEqual(Object.keys(montants(b)), ['socle']);
  }
  assert.equal(installations(db, c.id).length, 1, 'et toujours un seul bon d\'installation');
  assert.equal(installations(db, c.id)[0].total_ht, FRAIS);
});
