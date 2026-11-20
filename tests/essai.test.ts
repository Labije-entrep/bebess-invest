// 4. Calendrier d'essai : 45 jours à compter de la mise en production. J+38 (rappel), J+45 (le cabinet et les espaces de ses clients se
// ferment), J+68 (avis de suppression), J+75 (suppression réelle). Et le rejeu du traitement quotidien, qui ne duplique rien et
// n'envoie jamais deux fois.
//
// Chaque jalon est exercé par le vrai traitement (traitementQuotidien), le jour traité étant celui qu'on lui donne.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, empreinte, type BaseTest } from './support/d1.ts';
import { creerCabinet, nouveauCompte, ouvrirSession, poserFichiers, poserTenant, type Cabinet } from './support/monde.ts';
import { envoyer, environnement, reseau, type Environnement } from './support/serveur.ts';
import { traitementQuotidien } from '../src/lib/traitement';
import { plusJours, poserMiseEnProduction } from '../src/lib/contrat';

const MEP = '2026-09-01';
const J = (n: number): string => plusJours(MEP, n);

let db: BaseTest;
let env: Environnement;
let a: Cabinet;
let envoyes: { a: string; sujet: string; texte: string }[];
let mailerCasse: boolean;

beforeEach(() => {
  reseau.vider();
  envoyes = [];
  mailerCasse = false;
  db = baseNeuve();
  env = environnement(db, { CF_API_TOKEN: 'jeton', CF_ZONE_ID: 'zone', CF_CNAME_CIBLE: 'cible.test' });
  a = creerCabinet(db, 'A', { contrat: { statut: 'brouillon', debut_le: null, module_pilotage: 1, module_site: 1 } });
  nouveauCompte(db, a.id, 'associe', 'associe2-a@cabinet-a.test');
});

const passe = (jour: string) =>
  traitementQuotidien(env, {
    maintenant: new Date(`${jour}T03:00:00Z`),
    mailer: () => ({
      envoyer: async (dest, sujet, texte) => {
        if (mailerCasse) throw new Error('Scaleway : refusé');
        envoyes.push({ a: dest, sujet, texte });
      },
    }),
  });
const statut = (): string => db.un<{ statut: string }>('SELECT statut FROM contrat WHERE tenant_id = ?', a.id)!.statut;
const vers = (sujet: RegExp): string[] => envoyes.filter((m) => sujet.test(m.sujet)).map((m) => m.a).sort();
const ASSOCIES = ['associe-a@cabinet-a.test', 'associe2-a@cabinet-a.test'];

/** Met le contrat en essai par la vraie fonction (DPA signé, mise en production à MEP). */
async function mettreEnProduction(): Promise<void> {
  const r = await poserMiseEnProduction(db, a.id, MEP, { id: 'u-editeur', role: 'editeur' });
  assert.equal(r.ok, true);
}

test('la mise en production pose la fin d\'essai à +45 jours, et les quatre jalons sont J+38, J+45, J+68, J+75', async () => {
  await mettreEnProduction();
  const c = db.un<{ statut: string; date_fin_essai: string }>('SELECT statut, date_fin_essai FROM contrat WHERE tenant_id = ?', a.id)!;
  assert.equal(c.statut, 'essai');
  assert.equal(c.date_fin_essai, '2026-10-16');
  assert.deepEqual([J(38), J(45), J(68), J(75)], ['2026-10-09', '2026-10-16', '2026-11-08', '2026-11-15']);
});

test('J+38 : un rappel à chaque associé actif, une seule fois, même rejoué dix fois ; rien avant', async () => {
  await mettreEnProduction();
  assert.equal((await passe(J(37))).essais?.courriels, 0);
  assert.equal(envoyes.length, 0, 'la veille, rien');
  const r = await passe(J(38));
  assert.equal(r.essais?.courriels, 2);
  assert.deepEqual(vers(/se termine dans une semaine/), ASSOCIES, 'un par associé ; ni le collaborateur, ni la lecture, ni les clients');
  assert.match(envoyes[0].texte, /16 octobre 2026/, 'la date de fin d\'essai est dite');
  assert.equal(statut(), 'essai', 'le cabinet reste ouvert');
  for (let i = 0; i < 10; i++) await passe(J(38));
  for (let i = 39; i < 45; i++) await passe(J(i));
  assert.equal(envoyes.length, 2, 'rejoué le jour même et les jours suivants : aucun doublon');
  assert.equal(statut(), 'essai', 'encore en essai à J+44');
});

test('J+45 : le contrat passe en essai non converti, un seul événement, un courriel par associé avec la date de suppression et le lien d\'export', async () => {
  await mettreEnProduction();
  await passe(J(38));
  envoyes.length = 0;
  const r = await passe(J(45));
  assert.equal(r.essais?.suspendus, 1);
  assert.equal(statut(), 'essai_non_converti');
  assert.deepEqual(vers(/est terminé/), ASSOCIES);
  assert.match(envoyes[0].sujet, /15 novembre 2026/, 'la suppression est annoncée au J+75');
  assert.match(envoyes[0].texte, /https:\/\/cabinet-a\.test\/gestionnaire\/export\/locataire/, 'le lien d\'export');
  assert.equal(db.compte('evenement', "type = 'essai_non_converti' AND tenant_id = ?", a.id), 1);
  for (let i = 0; i < 5; i++) await passe(J(45));
  await passe(J(46));
  assert.equal(envoyes.length, 2, 'rejoué : pas de second courriel');
  assert.equal(db.compte('evenement', "type = 'essai_non_converti'"), 1, 'ni de second événement');
  assert.equal((await passe(J(45))).essais?.suspendus, 0);
});

test('J+45 : l\'associé garde l\'export et rien d\'autre ; collaborateur, lecture et clients sont coupés ; un contrat suspendu ne ferme rien', async () => {
  await mettreEnProduction();
  const cookies = {
    associe: ouvrirSession(db, a.associe), collab: ouvrirSession(db, a.collaborateur), lecture: ouvrirSession(db, a.lecture), viewer: ouvrirSession(db, a.viewerCompte),
  };
  const voir = async (url: string, cookie: string) => (await envoyer(env, { url, hote: a.hote, cookie })).statut;
  assert.equal(await voir('/gestionnaire/suivi', cookies.collab), 200, 'pendant l\'essai, tout est ouvert');
  assert.equal(await voir('/espace', cookies.viewer), 200);

  await passe(J(45));
  const fermeture = await envoyer(env, { url: '/gestionnaire/suivi', hote: a.hote, cookie: cookies.associe });
  assert.equal(fermeture.statut, 403);
  assert.match(fermeture.texte, /L’essai de Cabinet A est terminé/);
  assert.ok(fermeture.texte.includes('/gestionnaire/export/locataire'));
  const exportable = await envoyer(env, { url: '/gestionnaire/export/locataire', hote: a.hote, cookie: cookies.associe });
  assert.notEqual(exportable.statut, 403, 'l\'export reste ouvert à l\'associé');
  assert.equal((await envoyer(env, { url: '/api/suivi/etat', hote: a.hote, cookie: cookies.associe })).statut, 403);
  for (const k of ['collab', 'lecture'] as const) assert.equal(await voir('/gestionnaire/suivi', cookies[k]), 302, `${k} : session coupée`);
  assert.equal(await voir('/espace', cookies.viewer), 302, 'les espaces des clients se ferment aussi');

  // Un contrat « suspendu » (litige de facturation) est un autre mécanisme : il ne ferme rien.
  db.exec("UPDATE contrat SET statut = 'suspendu' WHERE tenant_id = ?", a.id);
  assert.equal(await voir('/gestionnaire/suivi', cookies.collab), 200);
  assert.equal(await voir('/espace', cookies.viewer), 200);
});

test('J+68 : l\'avis de suppression, une fois par associé ; J+75 : la suppression réelle, une seule fois', async () => {
  await mettreEnProduction();
  // Des données à effacer, un voisin dont l'identifiant commence pareil, des objets R2 et un domaine chez Cloudflare.
  await poserFichiers(env.FICHIERS, a);
  const voisin = 'tenant-a2';
  poserTenant(db, voisin, 'Voisin', 'voisin.test', '999999999');
  nouveauCompte(db, voisin, 'associe', 'v@voisin.test');
  const viewerVoisin = nouveauCompte(db, voisin, 'viewer', 'client@voisin.test');
  db.exec("INSERT INTO portefeuille (id, tenant_id, viewer_id, libelle, type, ordre, cree_le) VALUES ('pf-voisin', ?, ?, 'P', 'personne', 0, '2026-01-01')", voisin, viewerVoisin.id);
  db.exec("INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES ('pt-voisin', 'pf-voisin', '2026-05-31', 1, 1)");
  await env.FICHIERS.put(`${voisin}/documents/x.pdf`, new ArrayBuffer(4));
  await env.FICHIERS.put(`factures/${a.id}/bon-1.pdf`, new ArrayBuffer(4));
  db.exec("INSERT INTO domaine (hote, tenant_id, principal, valide_le, cf_id) VALUES ('www.cabinet-a.example', ?, 0, '2026-01-01', 'cf-123')", a.id);
  const contratAvant = db.un('SELECT * FROM contrat WHERE tenant_id = ?', a.id);
  const voisinAvant = JSON.stringify([db.tous('SELECT * FROM utilisateur WHERE tenant_id = ?', voisin), db.tous('SELECT * FROM portefeuille WHERE tenant_id = ?', voisin), db.tous('SELECT * FROM point WHERE id = ?', 'pt-voisin')]);

  await passe(J(45));
  envoyes.length = 0;
  assert.equal((await passe(J(67))).essais?.courriels, 0, 'entre J+45 et J+68, silence');
  const r68 = await passe(J(68));
  assert.equal(r68.essais?.courriels, 2);
  assert.deepEqual(vers(/supprimées dans une semaine/), ASSOCIES);
  for (let i = 0; i < 5; i++) await passe(J(68));
  assert.equal(envoyes.length, 2, 'J+68 rejoué : un seul courriel par associé');

  const r74 = await passe(J(74));
  assert.equal(r74.essais?.purges, 0, 'la veille, rien n\'est supprimé');
  assert.equal(db.compte('utilisateur', 'tenant_id = ?', a.id) > 0, true);

  const r75 = await passe(J(75));
  assert.equal(r75.essais?.purges, 1);
  assert.deepEqual(r75.echecs, []);
  // Effacé : comptes, sessions, dossiers, valorisations, mouvements, documents, consultations, suivi, site, domaines, incidents.
  for (const [table, ou] of [
    ['utilisateur', 'tenant_id = ?'], ['portefeuille', 'tenant_id = ?'], ['contact', 'tenant_id = ?'], ['sujet', 'tenant_id = ?'], ['echange', 'tenant_id = ?'],
    ['note_marche', 'tenant_id = ?'], ['page_contenu', 'tenant_id = ?'], ['actu', 'tenant_id = ?'], ['document_interne', 'tenant_id = ?'], ['membre', 'tenant_id = ?'],
    ['liste_valeur', 'tenant_id = ?'], ['domaine', 'tenant_id = ?'], ['incident', 'tenant_id = ?'],
  ] as const) assert.equal(db.compte(table, ou, a.id), 0, `${table} effacé`);
  assert.equal(db.compte('enveloppe', "portefeuille_id = ?", a.donnees.portefeuille), 0);
  assert.equal(db.compte('point', 'portefeuille_id = ?', a.donnees.portefeuille), 0);
  assert.equal(db.compte('document', 'viewer_id = ?', a.donnees.viewer), 0);
  assert.equal(db.compte('mouvement', 'viewer_id = ?', a.donnees.viewer), 0);
  // R2 vidé de `tenant-a/`, mais ni le voisin (`tenant-a2/`) ni la facture (`factures/tenant-a/`).
  assert.deepEqual([...env.FICHIERS.objets.keys()].sort(), [`factures/${a.id}/bon-1.pdf`, `${voisin}/documents/x.pdf`].sort());
  // Domaine libéré chez Cloudflare : un seul appel.
  assert.equal(reseau.sortants.filter((s) => s.methode === 'DELETE' && s.url.includes('cf-123')).length, 1);
  // Conservés : la raison sociale, le contrat, le journal ; libéré : l'hôte d'origine. Le voisin est intact.
  const t = db.un<{ nom: string; domaine: string | null; siren: string | null }>('SELECT nom, domaine, siren FROM tenant WHERE id = ?', a.id)!;
  assert.equal(t.nom, 'Cabinet A');
  assert.equal(t.domaine, null);
  assert.equal(t.siren, '732829320');
  assert.deepEqual(db.un('SELECT * FROM contrat WHERE tenant_id = ?', a.id)?.id, (contratAvant as { id: string }).id);
  assert.equal(db.compte('evenement', "type = 'cabinet_purge' AND tenant_id = ?", a.id), 1);
  assert.ok(db.compte('evenement', 'tenant_id = ?', a.id) >= 3, 'le journal est intact');
  assert.throws(() => db.exec('DELETE FROM evenement WHERE tenant_id = ?', a.id), /écriture seule/);
  assert.equal(JSON.stringify([db.tous('SELECT * FROM utilisateur WHERE tenant_id = ?', voisin), db.tous('SELECT * FROM portefeuille WHERE tenant_id = ?', voisin), db.tous('SELECT * FROM point WHERE id = ?', 'pt-voisin')]), voisinAvant, 'le voisin dont l\'identifiant commence pareil est intact');

  // Rejoué : rien de plus, un seul appel Cloudflare, un seul événement.
  const apres = empreinte(db);
  for (let i = 0; i < 3; i++) assert.equal((await passe(J(75))).essais?.purges, 0);
  await passe(J(76));
  assert.equal(empreinte(db), apres);
  assert.equal(reseau.sortants.filter((s) => s.methode === 'DELETE').length, 1);
  assert.equal(db.compte('evenement', "type = 'cabinet_purge'"), 1);
});

test('un courriel refusé se retente à la passe suivante, sans doublon ; l\'échec est un incident de la console', async () => {
  await mettreEnProduction();
  mailerCasse = true;
  const r = await passe(J(38));
  assert.equal(r.essais?.courriels, 0);
  assert.equal(envoyes.length, 0);
  assert.equal(db.compte('incident', "quoi = 'mail_refuse' AND tenant_id = ?", a.id), 2, 'un incident par associé qui n\'a rien reçu');
  assert.equal(db.compte('envoi_automatique', "cle LIKE 'essai:%:J38:%' AND envoye_le IS NULL"), 0, 'la réservation est libérée');
  mailerCasse = false;
  await passe(J(39));
  assert.equal(envoyes.length, 2, 'retenté le lendemain');
  await passe(J(39));
  await passe(J(40));
  assert.equal(envoyes.length, 2, 'et jamais deux fois');
});

test('la suppression est irréversible : sans avis réellement parti depuis une semaine, elle est retenue', async () => {
  await mettreEnProduction();
  mailerCasse = true; // la messagerie est en panne depuis J+38
  for (const j of [38, 45, 68, 74]) await passe(J(j));
  assert.equal(envoyes.length, 0);
  const r75 = await passe(J(75));
  assert.equal(r75.essais?.purges, 0, 'aucun avis n\'est parti : rien n\'est supprimé');
  assert.equal(r75.essais?.retenues, 1);
  assert.ok(db.compte('utilisateur', 'tenant_id = ?', a.id) > 0);
  assert.ok(db.compte('incident', "quoi = 'purge_bloquee' AND tenant_id = ?", a.id) >= 1, 'l\'éditeur le voit dans la console');

  mailerCasse = false;
  const r76 = await passe(J(76)); // l'avis tardif part maintenant
  assert.equal(r76.essais?.courriels, 2);
  assert.equal(r76.essais?.purges, 0);
  assert.equal((await passe(J(82))).essais?.purges, 0, 'une semaine de préavis révolue le 83');
  assert.ok(db.compte('utilisateur', 'tenant_id = ?', a.id) > 0);
  assert.equal((await passe(J(83))).essais?.purges, 1, 'une semaine après l\'avis, la suppression a lieu');
  assert.equal(db.compte('utilisateur', 'tenant_id = ?', a.id), 0);
});

test('domaine non libérable chez Cloudflare : la suppression s\'arrête avant la base, et se retente', async () => {
  await mettreEnProduction();
  db.exec("INSERT INTO domaine (hote, tenant_id, principal, valide_le, cf_id) VALUES ('www.cabinet-a.example', ?, 0, '2026-01-01', 'cf-123')", a.id);
  await env.FICHIERS.put(`${a.id}/documents/x.pdf`, new ArrayBuffer(4));
  await passe(J(45));
  await passe(J(68));
  reseau.cloudflareRefuse = true;
  const r = await passe(J(75));
  assert.equal(r.essais?.purges, 0);
  assert.ok(db.compte('utilisateur', 'tenant_id = ?', a.id) > 0, 'la base n\'a pas bougé');
  assert.ok(env.FICHIERS.objets.has(`${a.id}/documents/x.pdf`), 'ni R2');
  reseau.cloudflareRefuse = false;
  assert.equal((await passe(J(76))).essais?.purges, 1, 'la passe suivante recommence');
  assert.equal(env.FICHIERS.objets.size, 0);
});

test('un cabinet qui devient client avant J+45 n\'est ni suspendu, ni relancé, ni supprimé', async () => {
  await mettreEnProduction();
  await passe(J(38));
  db.exec("UPDATE contrat SET statut = 'actif', debut_le = ? WHERE tenant_id = ?", J(40), a.id);
  envoyes.length = 0;
  for (const j of [45, 68, 75, 90]) await passe(J(j));
  assert.equal(envoyes.length, 0);
  assert.equal(statut(), 'actif');
  assert.ok(db.compte('utilisateur', 'tenant_id = ?', a.id) > 0);
});

test('un cabinet sans date de mise en production ne déclenche rien', async () => {
  db.exec("UPDATE contrat SET statut = 'essai' WHERE tenant_id = ?", a.id);
  for (const j of [38, 45, 75]) await passe(J(j));
  assert.equal(envoyes.length, 0);
  assert.equal(statut(), 'essai');
});
