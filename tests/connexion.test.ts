// 2. Parcours de connexion, de bout en bout par le Worker : demande de lien, jeton, GET qui ne consomme pas, POST qui consomme, session
// posée, accès à /espace ; puis les refus (jeton expiré, déjà utilisé, forgé, étranger ; Origin absent ou forgé) qui ne doivent ni
// consommer le jeton ni aboutir à une page nue.
//
// Le contrôle d'origine est celui d'Astro (le paquet installé), et la reprise du rejet est celle de src/worker.ts : pas de doublure.
// Les en-têtes des pages /connexion et /connexion/<jeton> sont exécutés tels quels ; le gabarit HTML, lui, n'est pas rendu : on lit
// les variables que l'en-tête en tire (`invalide`, `refuse`, `envoye`).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, type BaseTest } from './support/d1.ts';
import { nouveauCompte, ouvrirSession, sha256, troisCabinets, type Cabinet, type Cle } from './support/monde.ts';
import { dernier, envoyer, environnement, reseau, type Environnement } from './support/serveur.ts';

let db: BaseTest;
let env: Environnement;
let cab: Record<Cle, Cabinet>;

beforeEach(() => {
  reseau.vider();
  db = baseNeuve();
  cab = troisCabinets(db);
  env = environnement(db);
});

const JETON = /\/connexion\/([0-9a-f]{64})/;

/** Demande un lien comme le fait le formulaire, et rend le jeton du courriel parti (ou null s'il n'en est parti aucun). */
async function demander(c: Cabinet, email: string): Promise<string | null> {
  const avant = reseau.courriels().length;
  const r = await envoyer(env, { url: '/connexion', hote: c.hote, formulaire: { email } });
  assert.equal(r.statut, 302, 'la réponse à une demande est toujours la même redirection');
  assert.equal(r.location, '/connexion?envoye=1');
  const nouveaux = reseau.courriels().slice(avant);
  if (nouveaux.length === 0) return null;
  assert.equal(nouveaux.length, 1, 'un seul courriel par demande');
  assert.equal(nouveaux[0].a, email.trim().toLowerCase());
  const m = JETON.exec(nouveaux[0].texte);
  assert.ok(m, 'le courriel porte le lien de connexion');
  assert.ok(nouveaux[0].texte.includes(`http://${c.hote}/connexion/`), 'le lien est sur l\'hôte du cabinet');
  return m[1];
}

const etatJeton = (jeton: string) => db.un<{ utilise_le: string | null; expire_le: string }>('SELECT utilise_le, expire_le FROM jeton_connexion WHERE hash = ?', sha256(jeton));
const nbSessions = (): number => db.compte('session');

test('parcours nominal : demande, courriel, GET sans effet, POST qui consomme, session, accès', async () => {
  const c = cab.A;
  const jeton = await demander(c, c.viewerCompte.email);
  assert.ok(jeton);

  // Jamais en clair : la base ne contient que l'empreinte SHA-256 du jeton.
  assert.equal(db.compte('jeton_connexion', 'hash = ?', jeton), 0);
  assert.equal(etatJeton(jeton)?.utilise_le, null);
  const duree = Date.parse(etatJeton(jeton)!.expire_le) - Date.now();
  assert.ok(duree > 14 * 60_000 && duree <= 15 * 60_000, 'le jeton vit quinze minutes');

  // GET (un aperçu de lien, un scanner de messagerie) : la page de confirmation, sans rien consommer, autant de fois qu'on veut.
  for (let i = 0; i < 3; i++) {
    const g = await envoyer(env, { url: `/connexion/${jeton}`, hote: c.hote });
    assert.equal(g.statut, 200);
    assert.equal(dernier.rendu?.invalide, false, 'le lien est présenté comme valable');
    assert.equal(etatJeton(jeton)?.utilise_le, null, 'le GET ne consomme pas');
    assert.equal(g.cookieSession, null, 'le GET ne pose aucune session');
  }
  assert.equal(nbSessions(), 0);

  // POST (le bouton « Confirmer ») : consomme, pose la session, redirige vers l'accueil du rôle.
  const p = await envoyer(env, { url: `/connexion/${jeton}`, hote: c.hote, methode: 'POST' });
  assert.equal(p.statut, 303);
  assert.equal(p.location, '/espace');
  assert.ok(etatJeton(jeton)?.utilise_le, 'le POST consomme le jeton');
  assert.ok(p.cookieSession, 'le cookie de session est posé');
  assert.equal(nbSessions(), 1);
  const cookieBrut = p.entetes.getSetCookie().find((x) => x.startsWith('bbs='))!;
  assert.match(cookieBrut, /HttpOnly/);
  assert.match(cookieBrut, /SameSite=lax/);
  assert.match(cookieBrut, /Max-Age=2592000/, 'trente jours');
  assert.equal(db.compte('session', 'id = ?', p.cookieSession), 0, 'la base ne garde que l\'empreinte de la session');
  assert.equal(db.compte('session', 'id = ?', sha256(p.cookieSession!)), 1);

  // La session ouvre /espace, et lui seul pour un client.
  const cookie = `bbs=${p.cookieSession}`;
  const espace = await envoyer(env, { url: '/espace', hote: c.hote, cookie });
  assert.equal(espace.statut, 200);
  assert.equal(espace.entetes.get('cache-control'), 'private, no-store', 'une page authentifiée n\'est jamais en cache');
  const gestion = await envoyer(env, { url: '/gestionnaire', hote: c.hote, cookie });
  assert.equal(gestion.location, '/connexion', 'un client n\'entre pas dans l\'espace du personnel');
  // Sans cookie, /espace renvoie à la connexion.
  assert.equal((await envoyer(env, { url: '/espace', hote: c.hote })).location, '/connexion');

  // Le même lien, rejoué : plus valable, aucune seconde session.
  const rejeu = await envoyer(env, { url: `/connexion/${jeton}`, hote: c.hote, methode: 'POST' });
  assert.equal(rejeu.statut, 200);
  assert.equal(dernier.rendu?.invalide, true);
  assert.equal(rejeu.cookieSession, null);
  assert.equal(nbSessions(), 1);
  await envoyer(env, { url: `/connexion/${jeton}`, hote: c.hote });
  assert.equal(dernier.rendu?.invalide, true, 'même en GET, un lien utilisé est signalé tout de suite');
});

test('chaque rôle arrive chez lui : client à /espace, personnel à /gestionnaire', async () => {
  const c = cab.B;
  for (const [compte, attendu] of [[c.viewerCompte, '/espace'], [c.associe, '/gestionnaire'], [c.collaborateur, '/gestionnaire'], [c.lecture, '/gestionnaire']] as const) {
    const jeton = await demander(c, compte.email);
    assert.ok(jeton, compte.role);
    const p = await envoyer(env, { url: `/connexion/${jeton}`, hote: c.hote, methode: 'POST' });
    assert.equal(p.location, attendu, compte.role);
  }
});

test('un lien ne sert qu\'une fois, même sous deux POST simultanés', async () => {
  const c = cab.A;
  const jeton = (await demander(c, c.associe.email))!;
  const [a, b] = await Promise.all([
    envoyer(env, { url: `/connexion/${jeton}`, hote: c.hote, methode: 'POST' }),
    envoyer(env, { url: `/connexion/${jeton}`, hote: c.hote, methode: 'POST' }),
  ]);
  assert.equal([a, b].filter((r) => r.cookieSession !== null).length, 1, 'un seul des deux obtient une session');
  assert.equal(nbSessions(), 1);
});

// ------------------------------------------------------------------ demande de lien

test('demande : la réponse est la même pour une adresse connue, inconnue, inactive ou mal formée, et rien ne part pour les trois dernières', async () => {
  const c = cab.A;
  db.exec("UPDATE utilisateur SET actif = 0 WHERE id = ?", c.lecture.id);
  const connue = await envoyer(env, { url: '/connexion', hote: c.hote, formulaire: { email: c.associe.email } });
  assert.equal(reseau.courriels().length, 1);
  for (const email of ['inconnu@cabinet-a.test', c.lecture.email, 'pas-une-adresse', '', 'a'.repeat(300) + '@x.fr']) {
    const r = await envoyer(env, { url: '/connexion', hote: c.hote, formulaire: { email } });
    assert.equal(r.statut, connue.statut, email.slice(0, 20));
    assert.equal(r.location, connue.location);
    assert.equal(r.texte, connue.texte);
  }
  assert.equal(reseau.courriels().length, 1, 'aucun courriel de plus');
  assert.equal(db.compte('jeton_connexion'), 1);
});

test('demande : l\'adresse est normalisée, et ne vaut que dans le cabinet de l\'hôte', async () => {
  const c = cab.A;
  const jeton = await demander(c, `  ${c.associe.email.toUpperCase()} `);
  assert.ok(jeton, 'espaces et majuscules ne comptent pas');
  // L'adresse d'un associé du cabinet A, demandée sur l'hôte de B : rien.
  const autre = await demander(cab.B, c.associe.email);
  assert.equal(autre, null);
  // Une même adresse peut exister dans deux cabinets : chacun reçoit son lien, qui n'ouvre que le sien.
  const commune = 'les.deux@exemple.test';
  nouveauCompte(db, cab.A.id, 'associe', commune);
  nouveauCompte(db, cab.B.id, 'associe', commune);
  const jA = (await demander(cab.A, commune))!;
  const jB = (await demander(cab.B, commune))!;
  assert.ok(jA && jB && jA !== jB);
  const surB = await envoyer(env, { url: `/connexion/${jA}`, hote: cab.B.hote, methode: 'POST' });
  assert.equal(surB.cookieSession, null, 'le lien d\'un cabinet ne s\'ouvre pas sur l\'hôte d\'un autre');
  assert.equal(etatJeton(jA)?.utilise_le, null, '… et n\'est pas consommé pour autant');
  const surA = await envoyer(env, { url: `/connexion/${jA}`, hote: cab.A.hote, methode: 'POST' });
  assert.ok(surA.cookieSession);
});

test('demande : dix liens par heure et par personne, le onzième ne part pas, sans que la réponse change', async () => {
  const c = cab.A;
  for (let i = 0; i < 10; i++) assert.ok(await demander(c, c.associe.email), `demande ${i + 1}`);
  assert.equal(await demander(c, c.associe.email), null, 'la onzième est silencieusement refusée');
  assert.equal(reseau.courriels().length, 10);
  // La limite est par personne : une autre adresse du même cabinet n'est pas touchée.
  assert.ok(await demander(c, c.collaborateur.email));
});

test('demande : un courriel qui n\'part pas (Scaleway en panne) ne change rien pour le navigateur', async () => {
  const c = cab.A;
  reseau.scalewayRefuse = true;
  const r = await envoyer(env, { url: '/connexion', hote: c.hote, formulaire: { email: c.associe.email } });
  assert.equal(r.statut, 302);
  assert.equal(r.location, '/connexion?envoye=1');
});

test('demande : un cabinet suspendu n\'ouvre plus de lien à son personnel, et laisse ses clients entrer', async () => {
  const c = cab.A;
  db.exec("INSERT INTO suspension (id, tenant_id, motif, debut_le, par) VALUES ('s1', ?, 'impayé', '2026-06-01T00:00:00Z', ?)", c.id, c.associe.id);
  assert.equal(await demander(c, c.associe.email), null);
  assert.equal(await demander(c, c.collaborateur.email), null);
  assert.ok(await demander(c, c.viewerCompte.email), 'un client n\'est pas partie au litige');
  db.exec("UPDATE suspension SET fin_le = '2026-06-02T00:00:00Z' WHERE id = 's1'");
  assert.ok(await demander(c, c.associe.email), 'levée la suspension, tout revient');
});

test('demande : un essai non converti ferme aussi les clients ; seul l\'associé garde son lien', async () => {
  const id = cab.C.id;
  db.exec("UPDATE contrat SET statut = 'essai_non_converti' WHERE tenant_id = ?", id);
  assert.equal(await demander(cab.C, cab.C.viewerCompte.email), null);
  assert.equal(await demander(cab.C, cab.C.collaborateur.email), null);
  assert.ok(await demander(cab.C, cab.C.associe.email), 'l\'associé garde l\'export de ses données');
});

// ------------------------------------------------------------------ les refus : le jeton n'est pas consommé, la page n'est pas nue

/** Un jeton valable, prêt à servir, et ce qu'il faut vérifier après une tentative qui doit échouer. */
async function jetonPret(c: Cabinet = cab.A, email = c.associe.email): Promise<string> {
  const j = await demander(c, email);
  assert.ok(j);
  return j;
}
function aucunEffet(jeton: string, reponse: { cookieSession: string | null }, quoi: string): void {
  assert.equal(reponse.cookieSession, null, `${quoi} : aucune session posée`);
  assert.equal(nbSessions(), 0, `${quoi} : aucune session en base`);
  assert.equal(etatJeton(jeton)?.utilise_le ?? null, null, `${quoi} : le jeton n'est pas consommé`);
}

test('jeton expiré : refusé en GET comme en POST, non consommé, avec l\'explication et un nouveau lien', async () => {
  const j = await jetonPret();
  db.exec('UPDATE jeton_connexion SET expire_le = ? WHERE hash = ?', new Date(Date.now() - 1000).toISOString(), sha256(j));
  const g = await envoyer(env, { url: `/connexion/${j}`, hote: cab.A.hote });
  assert.equal(g.statut, 200);
  assert.equal(dernier.rendu?.invalide, true, 'GET : signalé expiré tout de suite');
  const p = await envoyer(env, { url: `/connexion/${j}`, hote: cab.A.hote, methode: 'POST' });
  assert.equal(p.statut, 200, 'POST : une page, pas un 403 nu');
  assert.equal(dernier.rendu?.invalide, true);
  assert.equal(dernier.rendu?.refuse, false);
  aucunEffet(j, p, 'expiré');
});

test('jeton forgé : inconnu, trop court, non hexadécimal, injection, ou jeton d\'un autre hôte : refusé, rien n\'est écrit', async () => {
  const forges = ['a'.repeat(64), '0'.repeat(63), 'g'.repeat(64), 'A'.repeat(64), `${'a'.repeat(60)}' OR 1=1 --`, '../../etc/passwd', 'x', 'a'.repeat(65)];
  const avant = [db.compte('jeton_connexion'), db.compte('session'), db.compte('utilisateur')];
  for (const f of forges) {
    const g = await envoyer(env, { url: `/connexion/${encodeURIComponent(f)}`, hote: cab.A.hote });
    assert.ok([200, 404].includes(g.statut), f);
    if (g.statut === 200) assert.equal(dernier.rendu?.invalide, true, f);
    const p = await envoyer(env, { url: `/connexion/${encodeURIComponent(f)}`, hote: cab.A.hote, methode: 'POST' });
    assert.equal(p.cookieSession, null, f);
    assert.ok(p.statut !== 303 || !p.location?.startsWith('/espace'), f);
  }
  assert.deepEqual([db.compte('jeton_connexion'), db.compte('session'), db.compte('utilisateur')], avant);
});

test('jeton d\'un autre cabinet : refusé sur l\'hôte qui n\'est pas le sien, non consommé', async () => {
  const jB = await jetonPret(cab.B);
  const p = await envoyer(env, { url: `/connexion/${jB}`, hote: cab.A.hote, methode: 'POST' });
  assert.equal(dernier.rendu?.invalide, true);
  aucunEffet(jB, p, 'jeton de B sur A');
  const g = await envoyer(env, { url: `/connexion/${jB}`, hote: cab.A.hote });
  assert.equal(g.statut, 200);
  assert.equal(dernier.rendu?.invalide, true);
  // Sur son hôte, il sert.
  const bon = await envoyer(env, { url: `/connexion/${jB}`, hote: cab.B.hote, methode: 'POST' });
  assert.ok(bon.cookieSession);
});

test('jeton d\'un compte devenu inactif depuis la demande : refusé, non consommé', async () => {
  const j = await jetonPret();
  db.exec('UPDATE utilisateur SET actif = 0 WHERE id = ?', cab.A.associe.id);
  const p = await envoyer(env, { url: `/connexion/${j}`, hote: cab.A.hote, methode: 'POST' });
  aucunEffet(j, p, 'compte inactif');
});

test('Origin absent ou forgé sur la confirmation : le Worker renvoie vers l\'explication, le jeton n\'est pas consommé', async () => {
  const j = await jetonPret();
  const url = `/connexion/${j}`;
  const forges: [string, string | null][] = [
    ['Origin absent', null],
    ['Origin d\'un autre site', 'https://evil.test'],
    ['Origin d\'un autre cabinet', `http://${cab.B.hote}`],
    ['Origin « null »', 'null'],
    ['même hôte, autre schéma', `https://${cab.A.hote}`],
    ['même hôte, autre port', `http://${cab.A.hote}:8080`],
  ];
  for (const [quoi, origine] of forges) {
    const r = await envoyer(env, { url, hote: cab.A.hote, methode: 'POST', origine });
    assert.equal(r.statut, 303, `${quoi} : jamais un 403 nu`);
    assert.equal(r.location, `${url}?refus=1`, `${quoi} : renvoi vers la page d'explication`);
    aucunEffet(j, r, quoi);
    const suite = await envoyer(env, { url: r.location!, hote: cab.A.hote });
    assert.equal(suite.statut, 200, `${quoi} : l'explication s'affiche`);
    assert.equal(dernier.rendu?.refuse, true, `${quoi} : la page dit que la connexion n'a pas pu être confirmée`);
  }
  // Et le même jeton, présenté honnêtement ensuite, fonctionne : rien n'avait été consommé.
  const bon = await envoyer(env, { url, hote: cab.A.hote, methode: 'POST' });
  assert.ok(bon.cookieSession);
});

test('Origin absent ou forgé sur la demande de lien : renvoi vers l\'explication, aucun courriel, aucun jeton', async () => {
  const c = cab.A;
  for (const origine of [null, 'https://evil.test', `http://${cab.B.hote}`]) {
    const r = await envoyer(env, { url: '/connexion', hote: c.hote, formulaire: { email: c.associe.email }, origine });
    assert.equal(r.statut, 303, String(origine));
    assert.equal(r.location, '/connexion?refus=1');
    const suite = await envoyer(env, { url: r.location!, hote: c.hote });
    assert.equal(suite.statut, 200);
    assert.equal(dernier.rendu?.refuse, true);
  }
  assert.equal(reseau.courriels().length, 0, 'aucun courriel');
  assert.equal(db.compte('jeton_connexion'), 0, 'aucun jeton');
});

test('le refus d\'origine ne touche que la connexion : ailleurs, le 403 d\'Astro reste un 403', async () => {
  const c = cab.A;
  const cookie = ouvrirSession(db, c.associe);
  const r = await envoyer(env, { url: '/gestionnaire/notes/nouveau', hote: c.hote, cookie, formulaire: { titre: 'x' }, origine: 'https://evil.test' });
  assert.equal(r.statut, 403, 'la reprise du Worker est bornée à /connexion et /connexion/<jeton>');
  assert.equal(db.compte('note_marche', "titre = 'x'"), 0);
});

test('Origin honnête mais un autre cookie ou un autre hôte : la session n\'est jamais celle d\'un autre', async () => {
  const j = await jetonPret();
  const p = await envoyer(env, { url: `/connexion/${j}`, hote: cab.A.hote, methode: 'POST' });
  const cookie = `bbs=${p.cookieSession}`;
  assert.equal((await envoyer(env, { url: '/gestionnaire', hote: cab.A.hote, cookie })).statut, 200);
  assert.equal((await envoyer(env, { url: '/gestionnaire', hote: cab.B.hote, cookie })).location, '/connexion');
});

// ------------------------------------------------------------------ la session

test('session : expirée, effacée, compte désactivé ou cabinet suspendu : plus d\'accès ; la déconnexion l\'efface', async () => {
  const c = cab.A;
  const cookie = ouvrirSession(db, c.associe);
  const secret = cookie.slice(4);
  const acces = async (cook = cookie) => (await envoyer(env, { url: '/gestionnaire', hote: c.hote, cookie: cook })).statut;
  assert.equal(await acces(), 200);

  db.exec('UPDATE session SET expire_le = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), sha256(secret));
  assert.equal(await acces(), 302, 'expirée');
  db.exec('UPDATE session SET expire_le = ? WHERE id = ?', new Date(Date.now() + 60_000).toISOString(), sha256(secret));
  assert.equal(await acces(), 200);

  db.exec('UPDATE utilisateur SET actif = 0 WHERE id = ?', c.associe.id);
  assert.equal(await acces(), 302, 'compte désactivé : la session déjà ouverte tombe');
  db.exec('UPDATE utilisateur SET actif = 1 WHERE id = ?', c.associe.id);

  db.exec("INSERT INTO suspension (id, tenant_id, motif, debut_le, par) VALUES ('s2', ?, 'litige', '2026-06-01T00:00:00Z', ?)", c.id, c.associe.id);
  assert.equal(await acces(), 302, 'cabinet suspendu : la session du personnel tombe sans être effacée');
  assert.equal(db.compte('session', 'id = ?', sha256(secret)), 1);
  db.exec("UPDATE suspension SET fin_le = '2026-06-02T00:00:00Z'");
  assert.equal(await acces(), 200, 'suspension levée : elle revit');

  for (const mauvais of ['bbs=', 'bbs=court', `bbs=${'z'.repeat(64)}`, `bbs=${'0'.repeat(64)}`, `bbs=${secret.toUpperCase()}`]) {
    assert.equal(await acces(mauvais), 302, mauvais);
  }

  const sortie = await envoyer(env, { url: '/deconnexion', hote: c.hote, cookie, methode: 'POST' });
  assert.equal(sortie.location, '/connexion');
  assert.equal(db.compte('session', 'id = ?', sha256(secret)), 0, 'la session est effacée en base');
  assert.equal(await acces(), 302);
  assert.equal((await envoyer(env, { url: '/deconnexion', hote: c.hote, cookie })).statut, 405, 'une image ou un lien ne déconnecte personne');
});

test('éditeur : sa session ouvre /admin, celle d\'un cabinet ne l\'ouvre pas', async () => {
  const ed = nouveauCompte(db, cab.A.id, 'editeur', 'editeur@cabinet-a.test');
  const j = await demander(cab.A, ed.email);
  const p = await envoyer(env, { url: `/connexion/${j}`, hote: cab.A.hote, methode: 'POST' });
  assert.equal(p.location, '/admin');
  const admin = await envoyer(env, { url: '/admin', hote: cab.A.hote, cookie: `bbs=${p.cookieSession}` });
  assert.equal(admin.statut, 200);
  const associe = await envoyer(env, { url: '/admin', hote: cab.A.hote, cookie: ouvrirSession(db, cab.A.associe) });
  assert.equal(associe.statut, 403, 'refus net, jamais une redirection');
});
