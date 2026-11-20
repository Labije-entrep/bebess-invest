// 5. Modules : la table de vérité statut du contrat × drapeaux. Contrat absent, brouillon et essai ouvrent tout ; actif et suspendu
// suivent les drapeaux ; résilié et essai non converti, sans nouveau contrat en cours, ferment tout (lot 17). Puis ce que les
// drapeaux ferment réellement, par la chaîne du Worker : 404 (jamais 403), menu, site public, données intactes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, empreinte } from './support/d1.ts';
import { creerCabinet, ouvrirSession, poserContrat, poserTenant } from './support/monde.ts';
import { dernier, envoyer, environnement } from './support/serveur.ts';
import { estPageSite, estRouteContenu, estRoutePilotage, modulesDuTenant, TOUT_FERME, TOUT_OUVERT } from '../src/lib/modules';
import { basculerModule, basculerModulesEchus } from '../src/lib/contrat';
import { traitementQuotidien } from '../src/lib/traitement';

const FLAGS: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
const ATTENDU: Record<string, (p: number, s: number) => { pilotage: boolean; site: boolean }> = {
  absent: () => TOUT_OUVERT,
  brouillon: () => TOUT_OUVERT,
  essai: () => TOUT_OUVERT,
  actif: (p, s) => ({ pilotage: p === 1, site: s === 1 }),
  suspendu: (p, s) => ({ pilotage: p === 1, site: s === 1 }),
  // En sortie, sans nouveau contrat en cours : tout fermé (lot 17). Avant ce lot, l'absence de contrat « en cours » rouvrait tout.
  resilie: () => TOUT_FERME,
  essai_non_converti: () => TOUT_FERME,
};

test('table de vérité : 7 situations de contrat × 4 combinaisons de drapeaux', async () => {
  const db = baseNeuve();
  let i = 0;
  for (const [statut, attendu] of Object.entries(ATTENDU)) {
    for (const [p, s] of FLAGS) {
      const id = `t${++i}`;
      poserTenant(db, id, id, `${id}.test`);
      if (statut !== 'absent') poserContrat(db, id, { statut, module_pilotage: p, module_site: s });
      assert.deepEqual(await modulesDuTenant(db, id), attendu(p, s), `${statut}, pilotage=${p}, site=${s}`);
    }
  }
});

test('un contrat résilié suivi d\'un contrat actif : seul le contrat en cours compte', async () => {
  const db = baseNeuve();
  poserTenant(db, 't', 't', 't.test');
  poserContrat(db, 't', { id: 'ancien', statut: 'resilie', module_pilotage: 1, module_site: 1 });
  poserContrat(db, 't', { id: 'nouveau', statut: 'actif', module_pilotage: 0, module_site: 1 });
  assert.deepEqual(await modulesDuTenant(db, 't'), { pilotage: false, site: true });
});

test('un contrat d\'un autre cabinet ne change rien', async () => {
  const db = baseNeuve();
  poserTenant(db, 'x', 'x', 'x.test');
  poserTenant(db, 'y', 'y', 'y.test');
  poserContrat(db, 'x', { statut: 'actif', module_pilotage: 0, module_site: 0 });
  poserContrat(db, 'y', { statut: 'actif', module_pilotage: 1, module_site: 1 });
  assert.deepEqual(await modulesDuTenant(db, 'x'), { pilotage: false, site: false });
});

test('les routes : ce qui relève du suivi, du contenu du site et des pages publiques', () => {
  for (const r of ['/gestionnaire/suivi', '/gestionnaire/suivi/abc', '/gestionnaire/actus', '/gestionnaire/bibliotheque', '/gestionnaire/passerelle/note/1', '/gestionnaire/fichiers/logo-contact/1', '/fichiers/contact/1', '/api/suivi/etat', '/api/suivi/contact/1']) {
    assert.equal(estRoutePilotage(r), true, r);
  }
  for (const r of ['/gestionnaire', '/gestionnaire/reglages', '/gestionnaire/viewers/1', '/gestionnaire/suivix', '/gestionnaire/export/contact/1', '/fichiers/document/1', '/espace', '/gestionnaire/notes']) {
    assert.equal(estRoutePilotage(r), false, r);
  }
  for (const r of ['/gestionnaire/notes', '/gestionnaire/notes/abc', '/gestionnaire/contenus', '/gestionnaire/contenus/accueil']) assert.equal(estRouteContenu(r), true, r);
  for (const r of ['/gestionnaire/actus', '/gestionnaire/notesx', '/gestionnaire', '/notes']) assert.equal(estRouteContenu(r), false, r);
  for (const r of ['/', '/approche', '/parcours', '/notes', '/notes/abc', '/contact', '/mentions-legales', '/en', '/en/about', '/sitemap.xml']) assert.equal(estPageSite(r), true, r);
  for (const r of ['/connexion', '/robots.txt', '/espace', '/gestionnaire', '/logo-cabinet', '/approchex', '/api/suivi/etat']) assert.equal(estPageSite(r), false, r);
});

// ------------------------------------------------------------------ ce que les drapeaux ferment, par le Worker

function monde(contrat: Parameters<typeof poserContrat>[2] | null) {
  const db = baseNeuve();
  const c = creerCabinet(db, 'A', { contrat });
  const env = environnement(db);
  const cookie = ouvrirSession(db, c.associe);
  // `null` : aucune session (undefined retomberait sur la valeur par défaut).
  const voir = (url: string, avec: string | null = cookie, extra: Record<string, unknown> = {}) => envoyer(env, { url, hote: c.hote, ...extra, cookie: avec ?? undefined });
  return { db, c, env, cookie, voir };
}

const PILOTAGE = ['/gestionnaire/suivi', '/gestionnaire/actus', '/gestionnaire/bibliotheque', '/api/suivi/etat', `/gestionnaire/suivi/ct-a`];
const CONTENU = ['/gestionnaire/contenus', '/gestionnaire/contenus/accueil', '/gestionnaire/notes', '/gestionnaire/notes/nouveau'];
const SITE_PUBLIC = ['/approche', '/parcours', '/notes', '/contact', '/mentions-legales', '/sitemap.xml'];

test('actif sans Pilotage : suivi, fiche, actus, bibliothèque, API, passerelle, logos répondent 404, le menu le sait, les données restent', async () => {
  const { db, c, voir } = monde({ statut: 'actif', module_pilotage: 0, module_site: 1 });
  const avant = empreinte(db);
  for (const url of PILOTAGE) {
    const r = await voir(url);
    assert.equal(r.statut, 404, url);
    assert.notEqual(r.statut, 403);
    assert.deepEqual(dernier.locals?.modules, { pilotage: false, site: true }, 'le menu masque le suivi (locals.modules)');
  }
  // Sans session, une route gardée (/gestionnaire) redirige comme avant : rien n'est annoncé de ce qui est fermé.
  for (const url of [`/gestionnaire/passerelle/note/${c.donnees.actu}`, `/gestionnaire/passerelle/promotion/${c.donnees.contact}`, `/gestionnaire/fichiers/logo-contact/${c.donnees.contact}`]) {
    const r = await voir(url, null, { methode: 'POST', formulaire: {} });
    assert.equal(r.statut, 302, `${url} sans session`);
    assert.equal(r.location, '/connexion');
  }
  assert.equal((await voir(`/fichiers/contact/${c.donnees.contact}`, null)).statut, 404);
  const post = await voir(`/gestionnaire/passerelle/note/${c.donnees.actu}`, ouvrirSession(db, c.associe), { methode: 'POST', formulaire: {} });
  assert.equal(post.statut, 404);
  const api = await voir('/api/suivi/contact', ouvrirSession(db, c.associe), { json: { nom: 'x' } });
  assert.equal(api.statut, 404, 'l\'API du suivi est fermée aussi');
  // Ce qui n'est pas le suivi reste ouvert.
  assert.equal((await voir('/gestionnaire')).statut, 200);
  assert.equal((await voir(`/gestionnaire/viewers/${c.donnees.viewer}`)).statut, 200);
  assert.equal((await voir('/gestionnaire/reglages')).statut, 200);
  assert.equal(empreinte(db), avant, 'aucune donnée n\'a été touchée : un module repris retrouve tout');
});

test('actif sans Site vitrine : « / » mène à /connexion, les autres pages publiques et les écrans de contenu répondent 404 ; connexion et robots.txt restent servis', async () => {
  const { db, c, voir } = monde({ statut: 'actif', module_pilotage: 1, module_site: 0 });
  const racine = await voir('/', null);
  assert.equal(racine.statut, 302);
  assert.equal(racine.location, '/connexion');
  for (const url of SITE_PUBLIC) assert.equal((await voir(url, null)).statut, 404, url);
  assert.equal((await voir('/en/about', null)).statut, 404);
  for (const url of CONTENU) assert.equal((await voir(url)).statut, 404, `${url} : écran de contenu fermé avec le module`);
  assert.equal((await voir('/connexion', null)).statut, 200);
  assert.equal((await voir('/robots.txt', null)).statut, 200);
  // Le suivi, lui, est ouvert, et l'actu aussi (elle appartient au module de suivi, pas au site).
  assert.equal((await voir('/gestionnaire/suivi')).statut, 200);
  assert.equal((await voir('/gestionnaire/actus')).statut, 200);
  // La passerelle vers une note de marché refuse sans le site : retour fixe, rien n'est créé.
  const avant = db.compte('note_marche');
  const note = await voir(`/gestionnaire/passerelle/note/${c.donnees.actu}`, ouvrirSession(db, c.associe), { methode: 'POST', formulaire: {} });
  assert.equal(note.statut, 303);
  assert.match(note.location ?? '', /ok=note_site_ferme/);
  assert.equal(db.compte('note_marche'), avant);
});

test('ni Pilotage ni Site : tout ce qui en dépend est fermé, l\'espace client et la connexion ne le sont jamais', async () => {
  const { db, c, voir } = monde({ statut: 'actif', module_pilotage: 0, module_site: 0 });
  for (const url of [...PILOTAGE, ...CONTENU]) assert.equal((await voir(url)).statut, 404, url);
  assert.equal((await voir('/', null)).location, '/connexion');
  assert.equal((await voir('/espace', ouvrirSession(db, c.viewerCompte))).statut, 200, 'les clients gardent leur espace');
  assert.equal((await voir('/gestionnaire')).statut, 200);
});

test('tout est ouvert : pendant l\'essai et le brouillon quels que soient les drapeaux, et pour un cabinet sans contrat', async () => {
  for (const contrat of [{ statut: 'essai', module_pilotage: 0, module_site: 0 }, { statut: 'brouillon', module_pilotage: 0, module_site: 0 }, null, { statut: 'actif', module_pilotage: 1, module_site: 1 }]) {
    const { voir } = monde(contrat);
    for (const url of [...PILOTAGE, ...CONTENU]) assert.equal((await voir(url)).statut, 200, `${JSON.stringify(contrat)} ${url}`);
    assert.equal((await voir('/', null)).statut, 200, `${JSON.stringify(contrat)} : la racine`);
    for (const url of SITE_PUBLIC) assert.notEqual((await voir(url, null)).statut, 404, `${JSON.stringify(contrat)} ${url}`);
  }
});

test('un module non pris se ferme quand l\'essai devient contrat ; l\'essai l\'avait ouvert', async () => {
  const { db, c, voir } = monde({ statut: 'essai', module_pilotage: 0, module_site: 1, date_mise_en_production: '2026-11-01', date_fin_essai: '2026-12-16' });
  assert.equal((await voir('/gestionnaire/suivi')).statut, 200);
  db.exec("UPDATE contrat SET statut = 'actif', debut_le = '2026-11-20' WHERE tenant_id = ?", c.id);
  assert.equal((await voir('/gestionnaire/suivi')).statut, 404);
  assert.equal((await voir('/gestionnaire/contenus')).statut, 200);
});

test('désactiver Pilotage : le drapeau tient jusqu\'à la date anniversaire, le traitement le baisse ce jour-là une seule fois ; reprendre le module rend tout', async () => {
  const { db, c, env, voir } = monde({ statut: 'actif', module_pilotage: 1, module_site: 1, debut_le: '2026-03-14' });
  const prog = await basculerModule(db, c.id, 'pilotage', false, { id: 'u', role: 'editeur' }, '2026-11-19');
  assert.equal(prog.ok && prog.effet, 'programme');
  assert.equal(db.un<{ module_pilotage: number; module_pilotage_fin_le: string }>('SELECT module_pilotage, module_pilotage_fin_le FROM contrat WHERE tenant_id = ?', c.id)?.module_pilotage, 1);
  assert.equal((await voir('/gestionnaire/suivi')).statut, 200, 'tant que la période est payée, le module sert');
  const mailer = () => ({ envoyer: async () => {} });
  await traitementQuotidien(env, { maintenant: new Date('2027-03-13T03:00:00Z'), mailer });
  assert.equal((await voir('/gestionnaire/suivi')).statut, 200, 'la veille, rien');
  const jour = await traitementQuotidien(env, { maintenant: new Date('2027-03-14T03:00:00Z'), mailer });
  assert.equal(jour.modules_desactives, 1);
  assert.equal((await voir('/gestionnaire/suivi')).statut, 404);
  assert.equal(db.compte('evenement', "type = 'module_desactive' AND tenant_id = ?", c.id), 1);
  for (let i = 0; i < 3; i++) assert.equal(await basculerModulesEchus(db, '2027-03-14'), 0, 'rejoué : rien de plus');
  assert.equal(db.compte('contact', 'tenant_id = ?', c.id) > 0, true, 'les données sont intactes');
  const reprise = await basculerModule(db, c.id, 'pilotage', true, { id: 'u', role: 'editeur' }, '2027-03-15');
  assert.equal(reprise.ok, true);
  assert.equal((await voir('/gestionnaire/suivi')).statut, 200, 'module repris : tout revient');
});
