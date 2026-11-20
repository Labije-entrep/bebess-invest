// Le passage de l'essai au contrat (lot 20) : « Signer le contrat ». Sans lui, aucun contrat réel n'était `actif` avec un `debut_le` : le
// traitement quotidien (contratsActifs) ne voyait aucun cabinet, donc aucun bon, aucun parrainage validé, aucun bon complémentaire.
// Tout ce qui suit passe par les vraies fonctions : création du cabinet, ouverture du contrat par la console, DPA, mise en production,
// signature, traitement quotidien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, type BaseTest } from './support/d1.ts';
import { cabinetEditeur, ouvrirSession, poserContrat, poserTenant, nouveauCompte } from './support/monde.ts';
import { envoyer, environnement, reseau } from './support/serveur.ts';
import { appliquerContrat } from '../src/lib/contrat-ecran';
import { contratEnCours, GRILLE_STANDARD, plusJours, poserMiseEnProduction, signerContrat } from '../src/lib/contrat';
import { creerCabinet } from '../src/lib/admin';
import { bonComplet } from '../src/lib/facturation';
import { traitementQuotidien } from '../src/lib/traitement';

const EDITEUR = { id: 'u-editeur', role: 'editeur' };
const MEP = '2026-11-01'; // fin d'essai : 2026-12-16
const FIN_ESSAI = plusJours(MEP, 45);

const formulaire = (o: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const euros = (c: number): string => (c / 100).toFixed(2).replace('.', ',');

/** Un contrat en essai, posé directement : pour éprouver la signature elle-même. */
function enEssai(db: BaseTest, o: { dpa?: string | null; statut?: string; signature?: string | null } = {}): string {
  const id = `t${Math.random().toString(36).slice(2, 8)}`;
  poserTenant(db, id, `Cabinet ${id}`, `${id}.test`);
  poserContrat(db, id, {
    statut: o.statut ?? 'essai', debut_le: null, date_mise_en_production: o.statut === 'brouillon' ? null : MEP,
    date_fin_essai: o.statut === 'brouillon' ? null : FIN_ESSAI, dpa_signe_le: o.dpa === undefined ? '2026-10-20' : o.dpa,
  });
  if (o.signature) db.exec('UPDATE contrat SET date_signature = ? WHERE tenant_id = ?', o.signature, id);
  return id;
}

// ------------------------------------------------------------------ la règle

test('signer : pose date_signature, debut_le et statut actif en une écriture, journalisée ; le début de service est la fin d\'essai', async () => {
  const db = baseNeuve();
  const id = enEssai(db);
  const r = await signerContrat(db, id, '2026-11-11', EDITEUR, '2026-11-11');
  assert.equal(r.ok, true);
  const c = (await contratEnCours(db, id))!;
  assert.deepEqual([c.statut, c.date_signature, c.debut_le], ['actif', '2026-11-11', FIN_ESSAI], 'signé le 11/11, début du service le 16/12 : la date anniversaire est celle de la fin d\'essai');
  const e = db.tous<{ acteur_id: string; acteur_role: string; cible_type: string; cible_id: string; detail: string }>("SELECT * FROM evenement WHERE type = 'contrat_signe' AND tenant_id = ?", id);
  assert.equal(e.length, 1);
  assert.deepEqual([e[0].acteur_id, e[0].acteur_role, e[0].cible_type, e[0].cible_id], ['u-editeur', 'editeur', 'contrat', c.id]);
  assert.deepEqual(JSON.parse(e[0].detail), {
    signe_le: '2026-11-11', debut_le: FIN_ESSAI, date_fin_essai: FIN_ESSAI, statut_avant: 'essai', statut_apres: 'actif', avant: { date_signature: null, debut_le: null },
  });
});

test('signer : le jour de la fin d\'essai, ou après, le service commence à la signature — jamais avant elle', async () => {
  const db = baseNeuve();
  const memeJour = enEssai(db);
  assert.equal((await signerContrat(db, memeJour, FIN_ESSAI, EDITEUR, FIN_ESSAI)).ok, true);
  assert.equal((await contratEnCours(db, memeJour))?.debut_le, FIN_ESSAI);
  // Le traitement n'a pas encore passé le contrat en « essai non converti » : on signe le lendemain de la fin d'essai.
  const apres = enEssai(db);
  const lendemain = plusJours(FIN_ESSAI, 1);
  assert.equal((await signerContrat(db, apres, lendemain, EDITEUR, lendemain)).ok, true);
  assert.equal((await contratEnCours(db, apres))?.debut_le, lendemain, 'on ne facture pas une période écoulée avant que le contrat existe');
});

test('signer : refusé sans DPA signé, comme la mise en production — et rien n\'est écrit', async () => {
  const db = baseNeuve();
  for (const dpa of [null, '', '   ']) {
    const id = enEssai(db, { statut: 'brouillon', dpa });
    const avant = db.un('SELECT * FROM contrat WHERE tenant_id = ?', id);
    assert.deepEqual(await signerContrat(db, id, '2026-11-11', EDITEUR, '2026-11-11'), { ok: false, code: 'dpa_manquant' }, JSON.stringify(dpa));
    assert.deepEqual(db.un('SELECT * FROM contrat WHERE tenant_id = ?', id), avant);
    assert.equal(db.compte('evenement', "type = 'contrat_signe' AND tenant_id = ?", id), 0);
    // La mise en production, elle, refuse avec le même code : une seule règle, tenue des deux côtés.
    assert.deepEqual(await poserMiseEnProduction(db, id, MEP, EDITEUR), { ok: false, code: 'dpa_manquant' });
  }
  // La base elle-même refuse un contrat en essai sans DPA : il n'existe pas d'essai à signer qui n'en ait pas.
  const id = enEssai(db);
  assert.throws(() => db.exec('UPDATE contrat SET dpa_signe_le = NULL WHERE tenant_id = ?', id), /CHECK/);
});

test('signer : refusé hors du statut essai (brouillon, actif, suspendu, essai non converti, résilié), un contrat déjà signé ne se resigne pas', async () => {
  const db = baseNeuve();
  for (const statut of ['brouillon', 'actif', 'suspendu']) {
    const id = enEssai(db, { statut });
    const avant = db.un('SELECT * FROM contrat WHERE tenant_id = ?', id);
    assert.deepEqual(await signerContrat(db, id, '2026-11-11', EDITEUR, '2026-11-11'), { ok: false, code: 'pas_en_essai' }, statut);
    assert.deepEqual(db.un('SELECT * FROM contrat WHERE tenant_id = ?', id), avant, `${statut} : rien n'a bougé`);
  }
  // Un contrat sorti n'est plus « en cours » : il n'y a rien à signer.
  for (const statut of ['essai_non_converti', 'resilie']) {
    const id = enEssai(db, { statut });
    assert.deepEqual(await signerContrat(db, id, '2026-11-11', EDITEUR, '2026-11-11'), { ok: false, code: 'aucun_contrat' }, statut);
  }
  const id = enEssai(db);
  assert.equal((await signerContrat(db, id, '2026-11-11', EDITEUR, '2026-11-11')).ok, true);
  assert.deepEqual(await signerContrat(db, id, '2026-11-12', EDITEUR, '2026-11-12'), { ok: false, code: 'pas_en_essai' });
  assert.equal(db.compte('evenement', "type = 'contrat_signe' AND tenant_id = ?", id), 1, 'un seul événement');
  assert.deepEqual(await signerContrat(db, 'inconnu', '2026-11-11', EDITEUR), { ok: false, code: 'aucun_contrat' });
});

test('signer : la date doit exister, ne pas être dans le futur ni précéder la mise en production ; celle d\'un fondateur est reprise, pas changée', async () => {
  const db = baseNeuve();
  const id = enEssai(db);
  const refus = async (date: string | null, code: string, jour = '2026-11-11') => {
    assert.deepEqual(await signerContrat(db, id, date, EDITEUR, jour), { ok: false, code }, String(date));
    assert.equal((await contratEnCours(db, id))?.statut, 'essai');
  };
  await refus(null, 'signature_manquante');
  await refus('', 'signature_manquante');
  await refus('11/11/2026', 'date_invalide');
  await refus('2026-02-30', 'date_invalide');
  await refus('2026-11-12', 'signature_future');
  await refus('2026-10-31', 'signature_anterieure');
  // Un fondateur a déjà sa date de signature, dont le gel se calcule : la signature la reprend (champ vide) ou la confirme, jamais la change.
  const fondateur = enEssai(db, { signature: '2026-11-05' });
  assert.deepEqual(await signerContrat(db, fondateur, '2026-11-06', EDITEUR, '2026-11-11'), { ok: false, code: 'signature_differente' });
  const r = await signerContrat(db, fondateur, null, EDITEUR, '2026-11-11');
  assert.equal(r.ok && r.contrat.date_signature, '2026-11-05');
});

test('la signature d\'un cabinet ne touche pas le contrat d\'un autre', async () => {
  const db = baseNeuve();
  const a = enEssai(db);
  const b = enEssai(db);
  await signerContrat(db, a, '2026-11-11', EDITEUR, '2026-11-11');
  assert.equal((await contratEnCours(db, b))?.statut, 'essai');
  assert.equal(db.compte('contrat', "statut = 'actif'"), 1);
});

// ------------------------------------------------------------------ la console

test('console : « Signer le contrat » — éditeur seulement, retour par code, refus lisible', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const ed = cabinetEditeur(db);
  const cookie = ouvrirSession(db, ed.editeur);
  const cabinet = enEssai(db, { statut: 'brouillon', dpa: null });
  const associe = nouveauCompte(db, cabinet, 'associe', 'associe@cabinet.test');
  const route = `/admin/cabinets/${cabinet}/contrat`;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const ecrire = (formulaire: Record<string, string>, hote = ed.hote, cook = cookie) => envoyer(env, { url: route, hote, cookie: cook, formulaire });
  const statut = async () => (await contratEnCours(db, cabinet))?.statut;

  // Un associé du cabinet n'écrit pas son contrat : 403, rien n'est signé.
  assert.equal((await ecrire({ action: 'signature', date_signature: aujourdhui }, `${cabinet}.test`, ouvrirSession(db, associe))).statut, 403);
  // Sans DPA : refusé, avec son code.
  const sansDpa = await ecrire({ action: 'signature', date_signature: aujourdhui });
  assert.equal(sansDpa.statut, 303);
  assert.match(sansDpa.location ?? '', new RegExp(`^/admin/cabinets/${cabinet}\\?r=dpa_manquant&ok=0`));
  assert.equal(await statut(), 'brouillon');
  // DPA posé, mais pas en production : pas en essai, donc rien à signer.
  await ecrire({ action: 'dpa', dpa_signe_le: '2026-10-20' });
  assert.match((await ecrire({ action: 'signature', date_signature: aujourdhui })).location ?? '', /\?r=pas_en_essai&ok=0/);
  // En production depuis 50 jours : l'essai est fini, le service commencera à la signature (aujourd'hui).
  await ecrire({ action: 'production', date_mise_en_production: plusJours(aujourdhui, -50) });
  assert.equal(await statut(), 'essai');
  const ok = await ecrire({ action: 'signature', date_signature: aujourdhui });
  assert.match(ok.location ?? '', /\?r=contrat_signe&ok=1/);
  const c = (await contratEnCours(db, cabinet))!;
  assert.deepEqual([c.statut, c.date_signature, c.debut_le], ['actif', aujourdhui, aujourdhui]);
  // Déjà actif : refusé.
  assert.match((await ecrire({ action: 'signature', date_signature: aujourdhui })).location ?? '', /\?r=pas_en_essai&ok=0/);
  reseau.vider();
});

test('console : la fiche propose le formulaire de signature pendant l\'essai (contrôle du câblage par le source : le gabarit n\'est pas rendu)', async () => {
  const { readFileSync } = await import('node:fs');
  const gabarit = readFileSync(new URL('../src/components/admin/ContratCabinet.astro', import.meta.url), 'utf8');
  assert.match(gabarit, /name="action" value="signature"/);
  assert.match(gabarit, /c\.statut === 'essai'/);
  assert.match(gabarit, /GRILLE_STANDARD\[cle as keyof typeof GRILLE_STANDARD\]/, 'les quatre prix du formulaire d\'ouverture sont préremplis');
});

test('la grille standard : 79, 49, 39 et 25 €, et elle ouvre un contrat tel quelle', async () => {
  assert.deepEqual(GRILLE_STANDARD, { prix_socle: 7900, prix_pilotage: 4900, prix_site: 3900, prix_acces_sup: 2500 });
  const db = baseNeuve();
  poserTenant(db, 't', 'T', 't.test');
  const r = await appliquerContrat(db, 't', formulaire({
    action: 'formule', periodicite: 'annuelle', acces_inclus: '3', frais_installation: '0',
    ...Object.fromEntries(Object.entries(GRILLE_STANDARD).map(([k, v]) => [k, euros(v)])),
  }), EDITEUR);
  assert.deepEqual([r.code, r.ok], ['contrat_ouvert', true]);
  const c = (await contratEnCours(db, 't'))!;
  assert.deepEqual([c.prix_socle, c.prix_pilotage, c.prix_site, c.prix_acces_sup], [7900, 4900, 3900, 2500]);
});

// ------------------------------------------------------------------ la chaîne entière : un cabinet réel, facturé

/** Un cabinet CRÉÉ par la console, son contrat ouvert avec la grille, DPA, mise en production, signature : rien n'est posé en SQL. */
async function cabinetReel(db: BaseTest, hote: string, signature: string, jourSignature = signature) {
  const cree = await creerCabinet(db, formulaire({
    nom: 'Cabinet Delmas & Associés', hote, gestionnaire_nom: 'Paul Delmas', gestionnaire_email: `paul@${hote}`,
    siren: '732829320', adresse_facturation: '12 rue de la Paix, 75002 Paris', contact_facturation: 'compta@delmas.test',
  }), EDITEUR);
  assert.ok('id' in cree, JSON.stringify(cree));
  const id = (cree as { id: string }).id;
  const etape = async (o: Record<string, string>, jour = signature) => {
    const r = await appliquerContrat(db, id, formulaire(o), EDITEUR, jour);
    assert.equal(r.ok, true, `${o.action} : ${r.code}`);
  };
  await etape({
    action: 'formule', periodicite: 'annuelle', acces_inclus: '2', frais_installation: '1200,00',
    ...Object.fromEntries(Object.entries(GRILLE_STANDARD).map(([k, v]) => [k, euros(v)])),
  });
  await etape({ action: 'dpa', dpa_signe_le: '2026-10-20' });
  await etape({ action: 'production', date_mise_en_production: MEP });
  await etape({ action: 'signature', date_signature: signature }, jourSignature);
  return id;
}
const passe = (env: ReturnType<typeof environnement>, jour: string) =>
  traitementQuotidien(env, { maintenant: new Date(`${jour}T03:00:00Z`), mailer: () => ({ envoyer: async () => {} }) });
const bons = (db: BaseTest, id: string) =>
  db.tous<{ id: string; type: string; periode_debut: string; periode_fin: string; total_ht: number; statut: string }>('SELECT * FROM bon_a_facturer WHERE tenant_id = ? ORDER BY type, periode_debut', id);

test('un cabinet créé, mis en production, signé : le traitement produit SON bon, avec ses quatre identifiants, et le bon d\'installation reste distinct', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const id = await cabinetReel(db, 'cabinet3.test', '2026-11-11'); // fin d'essai le 16/12/2026

  // Le jour de la signature, le service ne commence que dans 35 jours : le bon d'installation est là, pas encore le bon périodique.
  await passe(env, '2026-11-11');
  assert.deepEqual(bons(db, id).map((b) => [b.type, b.total_ht]), [['installation', 120000]]);
  // À 30 jours de la date anniversaire (16/12), le bon de la première période est posé.
  await passe(env, '2026-11-16');
  await passe(env, '2026-11-17');
  await passe(env, '2026-11-17');
  const tous = bons(db, id);
  assert.deepEqual(tous.map((b) => [b.type, b.periode_debut, b.periode_fin, b.total_ht, b.statut]), [
    ['installation', MEP, MEP, 120000, 'brouillon'],
    ['periode', '2026-12-16', '2027-12-16', 94800, 'brouillon'],
  ], 'un bon de période de 948 € (socle × 12, 2 accès inclus), un bon d\'installation de 1 200 €, distincts');
  const periodique = tous.find((b) => b.type === 'periode')!;
  assert.equal(periodique.total_ht, 94800, 'les frais d\'installation ne sont pas dans le bon périodique');

  // Ses quatre identifiants de facturation sont sur le bon : raison sociale, SIREN, adresse, contact. Aucun ne manque.
  const complet = (await bonComplet(db, periodique.id))!;
  assert.deepEqual(complet.identite, {
    raison_sociale: 'Cabinet Delmas & Associés', siren: '732829320', adresse_facturation: '12 rue de la Paix, 75002 Paris', contact_facturation: 'compta@delmas.test',
  });
  assert.deepEqual(complet.manque, []);
  assert.equal((await bonComplet(db, tous.find((b) => b.type === 'installation')!.id))?.manque.length, 0);
  assert.equal(complet.tenant_id, id, 'le bon est celui de CE cabinet');
  assert.equal(db.compte('bon_a_facturer', 'tenant_id <> ?', id), 0);
});

test('signé avant J+38 : plus de rappel, plus de suspension à J+45 ni de suppression à J+75 — le contrat est un contrat', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const envoyes: string[] = [];
  const mailer = () => ({ envoyer: async (a: string) => void envoyes.push(a) });
  const id = await cabinetReel(db, 'cabinet4.test', '2026-11-11');
  for (const n of [38, 45, 68, 75, 90]) await traitementQuotidien(env, { maintenant: new Date(`${plusJours(MEP, n)}T03:00:00Z`), mailer });
  assert.deepEqual(envoyes, [], 'aucun des courriels de l\'essai');
  assert.equal((await contratEnCours(db, id))?.statut, 'actif');
  assert.ok(db.compte('utilisateur', 'tenant_id = ?', id) > 0);
  assert.equal(db.compte('evenement', "type = 'essai_non_converti'"), 0);
});

test('le premier bon périodique est posé même si la période a commencé depuis plus d\'un mois, malgré le bon d\'installation déjà là', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  // Signé le jour de la fin d'essai : le service commence ce jour-là. La première passe qui le voit a lieu plus de 30 jours après.
  const id = await cabinetReel(db, 'cabinet5.test', FIN_ESSAI);
  await passe(env, '2026-11-02'); // le bon d'installation est posé pendant l'essai ; le contrat est déjà actif (signé le 16/12 : pas encore)
  assert.equal(bons(db, id).filter((b) => b.type === 'installation').length, 1);
  await passe(env, '2027-02-01'); // 47 jours après le début de service : seul le « premier bon » (période en cours) peut le poser
  const periodiques = bons(db, id).filter((b) => b.type === 'periode');
  assert.deepEqual(periodiques.map((b) => [b.periode_debut, b.periode_fin]), [[FIN_ESSAI, '2027-12-16']]);
});

test('un module activé après la signature donne un bon complémentaire au prorata : la chaîne de bout en bout', async () => {
  const db = baseNeuve();
  const env = environnement(db);
  const id = await cabinetReel(db, 'cabinet6.test', FIN_ESSAI);
  await passe(env, '2027-01-05');
  assert.equal(bons(db, id).filter((b) => b.type === 'periode').length, 1);
  // Pilotage activé le 20/01/2027 par la console : l'événement est daté d'aujourd'hui, on le date au 20/01 pour le traitement du lendemain.
  const r = await appliquerContrat(db, id, formulaire({ action: 'module', module: 'pilotage', actif: '1' }), EDITEUR, '2027-01-20');
  assert.equal(r.ok, true);
  db.brut.exec('DROP TRIGGER evenement_pas_de_modification');
  db.exec("UPDATE evenement SET cree_le = '2027-01-20T10:00:00.000Z' WHERE type = 'module_active' AND tenant_id = ?", id);
  await passe(env, '2027-01-21');
  const compl = bons(db, id).filter((b) => b.type === 'complementaire');
  assert.deepEqual(compl.map((b) => [b.periode_debut, b.periode_fin, b.total_ht]), [['2027-01-20', '2027-12-16', 4900 * 11]], 'du 20/01 au 16/12 : 11 mois entamés, 11 × 49 €');
});
