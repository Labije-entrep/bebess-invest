// Adresses d'un cabinet : le site public, la connexion et l'espace peuvent vivre à des hôtes différents du même cabinet. Ce que ces
// tests tiennent : rien ne change tant que rien n'est choisi ; une fois le choix posé, les bonnes redirections (et seulement elles) ;
// canonique, plan du site et robots.txt sur l'adresse du site ; liens des courriels sur l'adresse de connexion ; validation des choix côté
// serveur ; retour automatique à l'hôte d'origine ; cloisonnement par cabinet.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, type BaseTest } from './support/d1.ts';
import { cabinetEditeur, ouvrirSession, troisCabinets, type Cabinet, type Cle } from './support/monde.ts';
import { envoyer, environnement, reseau, type Environnement } from './support/serveur.ts';
import { tenantParHote } from '../src/lib/db';
import { adressesDe, lienConnexion, origineDuSite, pageHorsAdresseDuSite, redirectionHote } from '../src/lib/adresses';
import { enregistrerAdresses, lienPremierGestionnaire, creerCabinet, retirerDomaine, verifierDomaine } from '../src/lib/admin';

let db: BaseTest;
let env: Environnement;
let cab: Record<Cle, Cabinet>;
let ed: ReturnType<typeof cabinetEditeur>;
const PROPRE = 'www.cabinet-a.example';
const AUTRE = 'espace.cabinet-a.example';
const EDITEUR = { id: 'u-editeur', role: 'editeur' };

beforeEach(() => {
  reseau.vider();
  db = baseNeuve();
  cab = troisCabinets(db);
  ed = cabinetEditeur(db);
  env = environnement(db);
});

const valide = (c: Cabinet, hote: string, quand: string | null = '2026-01-01'): void => {
  db.exec("INSERT INTO domaine (hote, tenant_id, principal, valide_le, statut) VALUES (?, ?, 0, ?, 'actif')", hote, c.id, quand);
};
const choix = (c: Cabinet, site: string, espace: string) => enregistrerAdresses(db, c.id, EDITEUR, { site, espace });
const aller = (hote: string, url: string, methode = 'GET') => envoyer(env, { hote, url, methode, ...(methode === 'POST' ? { formulaire: {} } : {}) });

test('par défaut : aucune redirection, nulle part, sur aucun hôte du cabinet', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  for (const hote of [c.hote, PROPRE]) {
    for (const url of ['/', '/approche', '/notes', '/connexion', '/gestionnaire', '/espace', '/robots.txt', '/sitemap.xml']) {
      const r = await aller(hote, url);
      assert.ok(![301, 302].includes(r.statut) || r.location?.startsWith('/'), `${hote}${url} : pas de redirection d'hôte (${r.statut} ${r.location})`);
      assert.ok(!r.location || !r.location.startsWith('http'), `${hote}${url} ne mène pas ailleurs`);
    }
  }
  const t = await tenantParHote(db, c.hote);
  assert.equal(t?.hote_site, c.hote);
  assert.equal(t?.hote_espace, c.hote);
  assert.equal(t?.site_choisi, false);
});

test('matrice : site public chez le cabinet, connexion et espace chez l\'origine', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  assert.deepEqual(await choix(c, PROPRE, c.hote), { ok: true, code: 'adresses' });

  // Les pages publiques de l'origine vont au site, en 301, même chemin, mêmes paramètres.
  for (const url of ['/', '/approche', '/parcours', '/contact', '/mentions-legales', '/notes', '/notes/une-note', '/en', '/en/insights/x']) {
    const r = await aller(c.hote, `${url}${url === '/' ? '' : '?a=1&b=2'}`);
    assert.equal(r.statut, 301, url);
    assert.equal(r.location, `http://${PROPRE}${url}${url === '/' ? '' : '?a=1&b=2'}`, url);
  }
  // HEAD aussi.
  const h = await aller(c.hote, '/approche', 'HEAD');
  assert.equal(h.statut, 301);
  // La connexion et l'espace vers le site public : l'hôte propre redirige vers l'origine, en 302.
  for (const url of ['/connexion', '/connexion/abc?x=1', '/gestionnaire', '/gestionnaire/viewers', '/espace', '/espace/portefeuille']) {
    const r = await aller(PROPRE, url);
    assert.equal(r.statut, 302, url);
    assert.equal(r.location, `http://${c.hote}${url}`, url);
  }
  // Pas de boucle : chaque hôte sert ce qu'il porte.
  for (const url of ['/', '/approche', '/notes']) assert.notEqual((await aller(PROPRE, url)).statut, 301, `${PROPRE}${url}`);
  for (const url of ['/connexion', '/espace']) assert.ok(!(await aller(c.hote, url)).location?.startsWith('http'), `${c.hote}${url}`);
});

test('jamais de redirection : POST, API, fichiers, logo, robots, plan du site, statiques, console, plateforme', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  await choix(c, PROPRE, PROPRE); // tout chez le cabinet : l'origine devrait tout rediriger
  const ailleurs = (r: { statut: number; location: string | null }) => [301, 302].includes(r.statut) && /^https?:/.test(r.location ?? '');
  for (const url of ['/api/suivi/etat', '/fichiers/document/x', '/logo-cabinet', '/robots.txt', '/sitemap.xml', '/_astro/x.js', '/favicon.svg', '/admin', '/admin/cabinets', '/plateforme', '/deconnexion']) {
    assert.ok(!ailleurs(await aller(c.hote, url)), `GET ${url}`);
  }
  for (const url of ['/', '/connexion', '/espace', '/gestionnaire', '/approche', '/api/suivi/x']) {
    assert.ok(!ailleurs(await aller(c.hote, url, 'POST')), `POST ${url}`);
    assert.ok(!ailleurs(await envoyer(env, { hote: c.hote, url, methode: 'PATCH', formulaire: {} })), `PATCH ${url}`);
  }
  // Et pourtant, un GET de page publique ou d'espace est bien redirigé.
  assert.equal((await aller(c.hote, '/approche')).statut, 301);
  assert.equal((await aller(c.hote, '/connexion')).statut, 302);
});

test('hôte inconnu, hôte d\'un autre cabinet, hôte local : jamais redirigés vers un cabinet', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  await choix(c, PROPRE, PROPRE);
  assert.ok(!(await aller('inconnu.example', '/approche')).location?.includes(PROPRE));
  assert.ok(!(await aller(cab.B.hote, '/approche')).location?.includes('cabinet-a'));
  assert.ok(!(await aller(cab.B.hote, '/connexion')).location?.includes('cabinet-a'));
  // Un hôte du cabinet B n'est jamais choisissable pour A.
  assert.deepEqual(await choix(c, cab.B.hote, ''), { ok: false, code: 'adresse_refusee' });
  // Local : pas de redirection, même avec un choix posé.
  const t = await tenantParHote(db, c.hote);
  for (const h of ['localhost', '127.0.0.1', 'cabinet.localhost', '[::1]']) {
    assert.equal(redirectionHote(t, new URL(`http://${h}:4321/approche`), 'GET'), null, h);
  }
});

test('cible lue en base, jamais dans la requête ; chemins pièges ; hôte en majuscules et avec port', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  await choix(c, PROPRE, '');
  const piege = await envoyer(env, { hote: c.hote, url: '/approche', entetes: { 'x-forwarded-host': 'evil.example', origin: 'http://evil.example' } });
  assert.equal(piege.location, `http://${PROPRE}/approche`);
  const double = await aller(c.hote, '//evil.example/notes');
  assert.ok(!double.location || double.location.startsWith(`http://${PROPRE}`), String(double.location));
  const t = await tenantParHote(db, c.hote.toUpperCase());
  assert.equal(redirectionHote(t, new URL(`https://${c.hote}:8443/approche`), 'GET')?.url, `https://${PROPRE}/approche`);
});

test('adresse par défaut : l\'hôte d\'origine sert tout, la canonique est la sienne', async () => {
  const c = cab.A;
  const t = await tenantParHote(db, c.hote);
  const u = new URL(`https://${c.hote}/approche`);
  assert.equal(origineDuSite(t, u), `https://${c.hote}`);
  assert.equal(pageHorsAdresseDuSite(t, u), false);
});

test('référencement : canonique, noindex hors adresse, plan du site, robots.txt', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  await choix(c, PROPRE, '');
  const t = await tenantParHote(db, c.hote);
  assert.equal(origineDuSite(t, new URL(`https://${c.hote}/approche`)), `https://${PROPRE}`);
  assert.equal(pageHorsAdresseDuSite(t, new URL(`https://${c.hote}/approche`)), true);
  assert.equal(pageHorsAdresseDuSite(t, new URL(`https://${PROPRE}/approche`)), false);
  assert.equal(pageHorsAdresseDuSite(t, new URL('http://localhost:4321/approche')), false);

  // Le plan du site et robots.txt : servis à chaque hôte, sur l'adresse du site, sans redirection.
  for (const hote of [c.hote, PROPRE]) {
    const plan = await aller(hote, '/sitemap.xml');
    assert.equal(plan.statut, 200, hote);
    assert.match(plan.texte, new RegExp(`<loc>http://${PROPRE.replace(/\./g, '\\.')}/approche</loc>`));
    assert.ok(!plan.texte.includes(c.hote), `plan de ${hote} : aucun ${c.hote}`);
    const robots = await aller(hote, '/robots.txt');
    assert.equal(robots.statut, 200);
    assert.match(robots.texte, new RegExp(`Sitemap: http://${PROPRE.replace(/\./g, '\\.')}/sitemap.xml`));
  }
  // Par défaut : l'hôte de la requête, qui est l'origine.
  const b = await aller(cab.B.hote, '/sitemap.xml');
  assert.match(b.texte, new RegExp(`<loc>http://${cab.B.hote.replace(/\./g, '\\.')}/</loc>`));
});

test('courriels : demande de lien, nouveau viewer, promotion et premier gestionnaire sur l\'adresse de connexion', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  valide(c, AUTRE);
  await choix(c, PROPRE, AUTRE);
  const dernierLien = (): string => {
    const m = reseau.courriels().at(-1)!.texte.match(/https?:\/\/\S+\/connexion\/[0-9a-f]{64}/);
    assert.ok(m, 'un lien dans le courriel');
    return m[0];
  };
  // 1. La demande depuis /connexion, faite sur l'hôte d'origine ET sur l'hôte du site (qui redirige : le POST n'est jamais redirigé).
  for (const hote of [c.hote, PROPRE, AUTRE]) {
    const avant = reseau.courriels().length;
    const r = await envoyer(env, { url: '/connexion', hote, formulaire: { email: c.viewerCompte.email } });
    assert.equal(r.statut, 302);
    assert.equal(reseau.courriels().length, avant + 1, hote);
    assert.ok(dernierLien().startsWith(`http://${AUTRE}/connexion/`), `${hote} : ${dernierLien()}`);
  }
  // 2. Nouveau viewer, 3. promotion d'un contact : créés depuis l'espace gestionnaire.
  const cookie = ouvrirSession(db, c.associe);
  const nv = await envoyer(env, { hote: c.hote, url: '/gestionnaire/viewers/nouveau', cookie, formulaire: { nom: 'Nouvelle Cliente', email: 'nouvelle@cabinet-a.test' } });
  assert.equal(nv.statut, 303, nv.texte);
  assert.ok(dernierLien().startsWith(`http://${AUTRE}/connexion/`), dernierLien());
  const promo = await envoyer(env, { hote: c.hote, url: `/gestionnaire/passerelle/promotion/${c.donnees.contact}`, cookie, formulaire: {} });
  assert.ok([302, 303].includes(promo.statut), String(promo.statut));
  if (reseau.courriels().at(-1)!.sujet.includes('accès')) assert.ok(dernierLien().startsWith(`http://${AUTRE}/connexion/`), dernierLien());
  // 4. Le premier gestionnaire d'un cabinet créé depuis la console.
  const f = new FormData();
  f.set('nom', 'Cabinet D'); f.set('hote', 'cabinet-d.test'); f.set('gestionnaire_nom', 'Une Personne'); f.set('gestionnaire_email', 'gd@cabinet-d.test');
  const cree = await creerCabinet(db, f, EDITEUR);
  assert.ok(!('erreurs' in cree));
  if ('erreurs' in cree) return;
  db.exec("INSERT INTO domaine (hote, tenant_id, principal, valide_le, statut) VALUES ('espace.cabinet-d.test', ?, 0, '2026-01-01', 'actif')", cree.id);
  db.exec("INSERT INTO reglage (tenant_id, cle, valeur) VALUES (?, 'hote_espace', 'espace.cabinet-d.test')", cree.id);
  assert.equal(await lienPremierGestionnaire({ runtime: { env } }, cree, new URL('https://admin.exemple.fr/admin/cabinets/nouveau')), true);
  assert.ok(dernierLien().startsWith('https://espace.cabinet-d.test/connexion/'), dernierLien());
});

test('lien : le pilote console refuse toujours les hôtes non locaux', async () => {
  const c = cab.A;
  valide(c, AUTRE);
  await choix(c, '', AUTRE);
  const envConsole = environnement(db, { MAIL_DRIVER: 'console' });
  const avant = reseau.courriels().length;
  await envoyer(envConsole, { url: '/connexion', hote: c.hote, formulaire: { email: c.viewerCompte.email } });
  assert.equal(reseau.courriels().length, avant, 'rien n\'est parti');
  assert.equal(lienConnexion(await tenantParHote(db, c.hote), new URL('http://localhost:4321/connexion'), 'j'), 'http://localhost:4321/connexion/j');
});

test('validation : hôte non validé, inconnu, d\'un autre cabinet : refus, rien n\'est écrit', async () => {
  const c = cab.A;
  valide(c, 'attente.cabinet-a.example', null);
  valide(cab.B, 'www.cabinet-b.example');
  for (const h of ['attente.cabinet-a.example', 'inconnu.example', 'www.cabinet-b.example', cab.B.hote, 'pas un hote', 'https://x.example/']) {
    assert.deepEqual(await choix(c, h, ''), { ok: false, code: 'adresse_refusee' }, h);
    assert.deepEqual(await choix(c, '', h), { ok: false, code: 'adresse_refusee' }, h);
  }
  assert.equal(db.compte('reglage', "tenant_id = ? AND cle LIKE 'hote_%'", c.id), 0);
  assert.equal(db.compte('evenement', "tenant_id = ? AND type = 'adresses_modifiees'", c.id), 0);
  // Un choix valide est enregistré ; le même une seconde fois ne change rien.
  assert.equal((await choix(c, c.hote, '')).code, 'adresses');
  assert.equal((await choix(c, c.hote, '')).code, 'adresses_inchangees');
  // Une valeur forgée en base pour un hôte non validé est ignorée par la requête du cabinet.
  db.exec("INSERT INTO reglage (tenant_id, cle, valeur) VALUES (?, 'hote_espace', 'attente.cabinet-a.example')", c.id);
  const t = await tenantParHote(db, c.hote);
  assert.equal(t?.hote_espace, c.hote);
  assert.equal(t?.espace_choisi, false);
});

test('journalisation : hôtes avant et après, rien de personnel', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  await choix(c, PROPRE, '');
  await choix(c, PROPRE, c.hote);
  const e = db.tous<{ detail: string; acteur_role: string; cible_id: string }>("SELECT detail, acteur_role, cible_id FROM evenement WHERE tenant_id = ? AND type = 'adresses_modifiees' ORDER BY cree_le, rowid", c.id);
  assert.equal(e.length, 2);
  assert.deepEqual(JSON.parse(e[1].detail), { site_avant: PROPRE, site_apres: PROPRE, espace_avant: null, espace_apres: c.hote });
  assert.equal(e[0].acteur_role, 'editeur');
  assert.equal(e[0].cible_id, c.id);
  assert.ok(!/@/.test(e[0].detail + e[1].detail));
});

test('retour automatique à l\'hôte d\'origine : hôte retiré ou plus valide, avec incident, jamais sans adresse', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  valide(c, AUTRE);
  await choix(c, PROPRE, AUTRE);
  // Retiré par la console.
  assert.equal((await retirerDomaine(db, env, c.id, PROPRE)).code, 'retire');
  assert.equal(db.compte('reglage', "tenant_id = ? AND cle = 'hote_public'", c.id), 0);
  assert.equal(db.compte('incident', "tenant_id = ? AND quoi = 'adresse_repli'", c.id), 1);
  let t = await tenantParHote(db, c.hote);
  assert.equal(t?.hote_site, c.hote);
  assert.equal(t?.hote_espace, AUTRE, 'l\'autre réglage est intact');
  assert.equal((await aller(c.hote, '/approche')).statut !== 301, true, 'plus de redirection vers l\'hôte retiré');
  // Validation perdue (hors de toute action : la requête du cabinet l'ignore déjà), puis repérée par la fiche de la console.
  db.exec("UPDATE domaine SET valide_le = NULL WHERE hote = ?", AUTRE);
  t = await tenantParHote(db, c.hote);
  assert.equal(t?.hote_espace, c.hote);
  assert.equal(t?.espace_choisi, false);
  const page = await envoyer(env, { hote: ed.hote, url: `/admin/cabinets/${c.id}`, cookie: ouvrirSession(db, ed.editeur) });
  assert.equal(page.statut, 200);
  assert.equal(db.compte('reglage', "tenant_id = ? AND cle LIKE 'hote_%'", c.id), 0);
  assert.equal(db.compte('incident', "tenant_id = ? AND quoi = 'adresse_repli'", c.id), 2);
  // Vérification Cloudflare qui retire la validation : même retour.
  valide(c, 'nouveau.cabinet-a.example');
  await choix(c, 'nouveau.cabinet-a.example', '');
  db.exec("UPDATE domaine SET cf_id = 'cf-1' WHERE hote = 'nouveau.cabinet-a.example'");
  const jeton = environnement(db, { CF_API_TOKEN: 'x', CF_ZONE_ID: 'z', CF_CNAME_CIBLE: 'cible.test' } as never);
  await verifierDomaine(db, jeton, c.id, 'nouveau.cabinet-a.example');
  assert.equal(db.compte('reglage', "tenant_id = ? AND cle = 'hote_public'", c.id), 0);
});

test('console : deux listes déroulantes (hôtes validés seulement), éditeur seul, cloisonnement', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  valide(c, 'attente.cabinet-a.example', null);
  await choix(c, PROPRE, '');
  const page = await envoyer(env, { hote: ed.hote, url: `/admin/cabinets/${c.id}`, cookie: ouvrirSession(db, ed.editeur) });
  assert.equal(page.statut, 200);
  const poster = (hote: string, cookie: string | undefined, id = c.id) =>
    envoyer(env, { hote, url: `/admin/cabinets/${id}/domaines`, cookie, formulaire: { action: 'adresses', site: c.hote, espace: PROPRE } });
  // Éditeur : enregistré.
  assert.equal((await poster(ed.hote, ouvrirSession(db, ed.editeur))).statut, 303);
  const t = await tenantParHote(db, c.hote);
  assert.equal(t?.hote_espace, PROPRE);
  assert.deepEqual((await adressesDe(db, c.id)).choisissables, [c.hote, PROPRE]);
  // Associé du cabinet, viewer, sans session : jamais.
  const avant = db.compte('evenement', "type = 'adresses_modifiees'");
  for (const [hote, cookie] of [[c.hote, ouvrirSession(db, c.associe)], [c.hote, ouvrirSession(db, c.viewerCompte)], [c.hote, undefined]] as const) {
    const r = await poster(hote, cookie);
    assert.ok(r.statut !== 303 || r.location === '/connexion', `statut ${r.statut}`);
    assert.ok([302, 403, 404].includes(r.statut), `statut ${r.statut}`);
  }
  assert.equal(db.compte('evenement', "type = 'adresses_modifiees'"), avant);
  // Cabinet inconnu : 404.
  assert.equal((await poster(ed.hote, ouvrirSession(db, ed.editeur), 'tnt_inexistant')).statut, 404);
});

test('une seule requête de base pour résoudre le cabinet et ses adresses', async () => {
  const c = cab.A;
  valide(c, PROPRE);
  await choix(c, PROPRE, PROPRE);
  let n = 0;
  const compteur = { ...db, prepare: (sql: string) => { n++; return db.prepare(sql); } } as never;
  const t = await tenantParHote(compteur, PROPRE);
  assert.equal(n, 1);
  assert.equal(t?.hote_site, PROPRE);
  assert.equal(t?.site_choisi, true);
});
