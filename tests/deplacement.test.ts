// Déplacement libre dans le suivi : sauter un statut ou une étape, revenir en arrière, rouvrir un sujet clos, et le faire au
// glisser-déposer. Deux niveaux : l'API (les règles : valeurs actives de LA bonne liste, date de clôture, cloisonnement, rôle
// `lecture`) et le vrai script du navigateur (tests/support/dom.ts) pour les cartes, les boutons et le glisser-déposer.
// Aucune clé de liste n'est supposée par le code ; le test, lui, nomme les clés par défaut puisque c'est le décor qu'il pose.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, type BaseTest } from './support/d1.ts';
import { creerCabinet, ouvrirSession, type Cabinet } from './support/monde.ts';
import { envoyer, environnement, reseau, type Environnement } from './support/serveur.ts';
import { liaison } from '../src/scripts/commun.ts';
import { installerPage, texte, type Element, type Page } from './support/dom.ts';

let db: BaseTest;
let env: Environnement;
let a: Cabinet;
let b: Cabinet;

const aujourdhui = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const aujourdhuiUtc = (): string => new Date().toISOString().slice(0, 10);
/** Clos il y a 3 jours : dans la colonne « Fait » du kanban (les sujets clos depuis plus de 30 jours n'y sont que comptés). */
const RECENT = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  reseau.vider();
  db = baseNeuve();
  const contrat = { module_pilotage: 1, module_site: 1 };
  a = creerCabinet(db, 'A', { contrat });
  b = creerCabinet(db, 'B', { contrat });
  env = environnement(db);
  // Un sujet déjà clos, pour la réouverture.
  db.exec('INSERT INTO sujet (id, tenant_id, contact_id, texte, statut, fait_le, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', 'clos-a', a.id, a.donnees.contact, 'Sujet clos A', 'fait', RECENT, '2026-04-01T00:00:00Z');
});

const patch = (cab: Cabinet, qui: 'associe' | 'collaborateur' | 'lecture', entite: 'sujet' | 'contact', id: string, json: Record<string, unknown>, hote = cab.hote) =>
  envoyer(env, { url: `/api/suivi/${entite}/${id}`, methode: 'PATCH', hote, cookie: ouvrirSession(db, cab[qui]), json });
const sujet = (id: string) => ({ ...db.un<{ statut: string; fait_le: string | null }>('SELECT statut, fait_le FROM sujet WHERE id = ?', id)! });
const etape = (id: string) => db.un<{ etape: string | null }>('SELECT etape FROM contact WHERE id = ?', id)!.etape;

// ------------------------------------------------------------------ l'API

test('sauter un statut : « À faire » directement à « Fait » pose la date de clôture du jour', async () => {
  const r = await patch(a, 'associe', 'sujet', a.donnees.sujet, { statut: 'fait' });
  assert.equal(r.statut, 200);
  assert.deepEqual(sujet(a.donnees.sujet), { statut: 'fait', fait_le: aujourdhuiUtc() });
});

test('revenir en arrière : un sujet clos rouvert redevient ouvert et perd sa date de clôture', async () => {
  const r = await patch(a, 'collaborateur', 'sujet', 'clos-a', { statut: 'attente' });
  assert.equal(r.statut, 200);
  assert.deepEqual(sujet('clos-a'), { statut: 'attente', fait_le: null });
  // L'indicateur « sujets ouverts » du client le compte de nouveau : voir le test de la page plus bas.
  // Reculer d'un cran depuis un statut ouvert ne touche pas à la date (il n'y en a pas).
  assert.equal((await patch(a, 'associe', 'sujet', 'clos-a', { statut: 'encours' })).statut, 200);
  assert.deepEqual(sujet('clos-a'), { statut: 'encours', fait_le: null });
});

test('un sujet clos qu\'on range dans un autre statut terminal garde sa date de clôture', async () => {
  db.exec("UPDATE liste_valeur SET terminal = 1 WHERE tenant_id = ? AND liste = 'statut_sujet' AND cle = 'attente'", a.id);
  assert.equal((await patch(a, 'associe', 'sujet', 'clos-a', { statut: 'attente' })).statut, 200);
  assert.deepEqual(sujet('clos-a'), { statut: 'attente', fait_le: RECENT });
});

test('une date de clôture envoyée par le client est respectée (annulation d\'un déplacement)', async () => {
  assert.equal((await patch(a, 'associe', 'sujet', 'clos-a', { statut: 'afaire', fait_le: null })).statut, 200);
  assert.equal((await patch(a, 'associe', 'sujet', 'clos-a', { statut: 'fait', fait_le: RECENT })).statut, 200);
  assert.deepEqual(sujet('clos-a'), { statut: 'fait', fait_le: RECENT });
});

test('un statut désactivé n\'est pas une cible : 422, rien n\'est écrit', async () => {
  db.exec("UPDATE liste_valeur SET actif = 0 WHERE tenant_id = ? AND liste = 'statut_sujet' AND cle = 'attente'", a.id);
  const r = await patch(a, 'associe', 'sujet', a.donnees.sujet, { statut: 'attente' });
  assert.equal(r.statut, 422);
  assert.deepEqual(sujet(a.donnees.sujet), { statut: 'afaire', fait_le: null });
});

test('une valeur d\'une autre liste n\'est pas une cible : une étape pour un statut, un statut pour une étape', async () => {
  assert.equal((await patch(a, 'associe', 'sujet', a.donnees.sujet, { statut: 'perdu' })).statut, 422);
  assert.equal((await patch(a, 'associe', 'contact', a.donnees.contact, { etape: 'fait' })).statut, 422);
  assert.equal(sujet(a.donnees.sujet).statut, 'afaire');
  assert.equal(etape(a.donnees.contact), 'contact');
});

test('étape : saut (« Premier contact » → « Proposition »), retour, et sortie « perdu » par une valeur terminale', async () => {
  assert.equal((await patch(a, 'associe', 'contact', a.donnees.contact, { etape: 'proposition' })).statut, 200);
  assert.equal(etape(a.donnees.contact), 'proposition');
  assert.equal((await patch(a, 'associe', 'contact', a.donnees.contact, { etape: 'rdv' })).statut, 200);
  assert.equal(etape(a.donnees.contact), 'rdv');
  assert.equal((await patch(a, 'associe', 'contact', a.donnees.contact, { etape: 'perdu' })).statut, 200);
  assert.equal((await patch(a, 'associe', 'contact', a.donnees.contact, { etape: 'contact' })).statut, 200, 'revenir d\'une sortie');
  assert.equal(etape(a.donnees.contact), 'contact');
});

test('une étape désactivée n\'est pas une cible', async () => {
  db.exec("UPDATE liste_valeur SET actif = 0 WHERE tenant_id = ? AND liste = 'etape' AND cle = 'proposition'", a.id);
  assert.equal((await patch(a, 'associe', 'contact', a.donnees.contact, { etape: 'proposition' })).statut, 422);
  assert.equal(etape(a.donnees.contact), 'contact');
});

test('cloisonnement : un autre cabinet reçoit 404 (jamais 403) et rien ne bouge', async () => {
  for (const [entite, id, json] of [['sujet', a.donnees.sujet, { statut: 'fait' }], ['sujet', 'clos-a', { statut: 'afaire' }], ['contact', a.donnees.contact, { etape: 'rdv' }]] as const) {
    const r = await patch(b, 'associe', entite, id, json);
    assert.equal(r.statut, 404, `${entite} ${id}`);
    // Le même identifiant inconnu : même réponse, rien ne distingue « autre cabinet » de « n'existe pas ».
    const inconnu = await patch(b, 'associe', entite, 'inconnu', json);
    assert.equal(r.texte, inconnu.texte);
  }
  // Même chemin, mais par l'hôte du cabinet A avec la session de B : la session ne vaut pas pour un autre cabinet.
  const croise = await patch(b, 'associe', 'sujet', a.donnees.sujet, { statut: 'fait' }, a.hote);
  assert.notEqual(croise.statut, 200);
  assert.deepEqual(sujet(a.donnees.sujet), { statut: 'afaire', fait_le: null });
  assert.deepEqual(sujet('clos-a'), { statut: 'fait', fait_le: RECENT });
  assert.equal(etape(a.donnees.contact), 'contact');
});

test('le rôle lecture ne déplace rien : 403, et l\'état annonce qu\'il ne peut pas écrire', async () => {
  assert.equal((await patch(a, 'lecture', 'sujet', a.donnees.sujet, { statut: 'fait' })).statut, 403);
  assert.equal((await patch(a, 'lecture', 'contact', a.donnees.contact, { etape: 'rdv' })).statut, 403);
  assert.deepEqual(sujet(a.donnees.sujet), { statut: 'afaire', fait_le: null });
  assert.equal(etape(a.donnees.contact), 'contact');
  const etat = async (qui: 'associe' | 'lecture') => JSON.parse((await envoyer(env, { url: '/api/suivi/etat', hote: a.hote, cookie: ouvrirSession(db, a[qui]) })).texte);
  assert.equal((await etat('lecture')).peut_ecrire, false);
  assert.equal((await etat('associe')).peut_ecrire, true);
});

// ------------------------------------------------------------------ la page (le vrai script, dans le navigateur de poche)

let instance = 0;
let sessionPage: string;

async function ouvrir(qui: 'associe' | 'lecture' = 'associe', vue: 'kanban' | 'parcours' = 'kanban'): Promise<Page> {
  // `commun.ts` est partagé entre les pages du test : la version de la dernière écriture d'une base ne vaut pas pour la suivante.
  Object.assign(liaison, { versionMin: 0, ko: false, sessionPerdue: false });
  const page = installerPage(vue);
  sessionPage = ouvrirSession(db, a[qui]);
  reseau.interne = async (url, init) => {
    const r = await envoyer(env, {
      url, hote: a.hote, cookie: sessionPage, methode: init?.method ?? 'GET',
      json: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(r.texte, { status: r.statut, headers: { 'content-type': 'application/json' } });
  };
  await import(`../src/scripts/suivi.ts?deplacement=${++instance}`);
  await page.pret();
  return page;
}

const colonnes = (page: Page): Element[] => page.corps.querySelectorAll('section').filter((s) => /\bsuivi-colonne\b/.test(s.className));
const colonne = (page: Page, titre: string): Element => {
  const c = colonnes(page).find((s) => texte(s.querySelector('h2')!) === titre);
  assert.ok(c, `colonne « ${titre} »`);
  return c;
};
const carte = (page: Page, id: string): Element => {
  const c = page.corps.querySelector(`[data-f="carte:${id}"]`);
  assert.ok(c, `carte ${id}`);
  return c;
};
const ouverts = (page: Page): number => Number(/(\d+) Sujets ouverts/.exec(texte(page.corps.querySelector('.suivi-kpis')!))?.[1]);
/** Laisse la file d'écritures (asynchrone) aboutir : on attend l'état de la base, jamais un nombre de tours. */
async function jusqua(condition: () => boolean, quoi: string): Promise<void> {
  const debut = Date.now();
  while (!condition()) {
    if (Date.now() - debut > 5000) assert.fail(`jamais atteint : ${quoi}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const evenement = () => ({ dataTransfer: { data: {} as Record<string, string>, setData(t: string, v: string) { this.data[t] = v; }, getData(t: string) { return this.data[t]; }, effectAllowed: '', dropEffect: '' } });

/** Un glisser-déposer complet : saisir la carte, survoler la colonne, déposer, relâcher. Rend ce que le survol a vu. */
function glisser(page: Page, id: string, versTitre: string): { survol: { defaultPrevented: boolean }; classeSurvol: string } {
  const dt = evenement();
  const c = carte(page, id);
  const cible = colonne(page, versTitre);
  c.dispatch('dragstart', dt);
  const apresSaisie = c.className;
  assert.match(apresSaisie, /\bglisse\b/, 'la carte saisie est marquée');
  const survol = cible.dispatch('dragover', dt);
  const classeSurvol = cible.className;
  cible.dispatch('drop', dt);
  c.dispatch('dragend', dt);
  return { survol, classeSurvol };
}

test('glisser-déposer au kanban : saut « À faire » → « Fait », puis retour à « En attente » : indicateur et date de clôture suivent', async () => {
  const page = await ouvrir();
  assert.equal(carte(page, a.donnees.sujet).getAttribute('draggable'), 'true');
  const avant = ouverts(page);

  const { survol, classeSurvol } = glisser(page, a.donnees.sujet, 'Fait');
  assert.equal(survol.defaultPrevented, true, 'la colonne accepte le dépôt');
  assert.match(classeSurvol, /\bcible\b/, 'retour visuel pendant le survol');
  await jusqua(() => sujet(a.donnees.sujet).statut === 'fait', 'le sujet est « Fait »');
  assert.equal(sujet(a.donnees.sujet).fait_le, aujourdhui());
  assert.equal(ouverts(page), avant - 1, 'un sujet clos ne compte plus parmi les ouverts');
  assert.match(texte(colonne(page, 'Fait')), /Sujet su-a|su-a|Sujet A/);

  // Retour arrière : rouvrir le sujet clos en le glissant dans une colonne ouverte.
  glisser(page, a.donnees.sujet, 'En attente');
  await jusqua(() => sujet(a.donnees.sujet).statut === 'attente', 'le sujet est rouvert');
  assert.equal(sujet(a.donnees.sujet).fait_le, null, 'la date de clôture est perdue');
  assert.equal(ouverts(page), avant, 'le sujet rouvert redevient ouvert');
});

test('sujet clos rouvert depuis la liste « Déplacer vers… » (sans souris)', async () => {
  const page = await ouvrir();
  const sel = page.corps.querySelector('[data-f="saut:avancer:clos-a"]')!;
  assert.ok(sel, 'la liste de saut existe sur la carte');
  const options = sel.querySelectorAll('option').map((o) => o.value);
  assert.deepEqual(options, ['', 'afaire', 'encours', 'attente'], 'tous les statuts sauf le sien, aucune clé écrite dans le code');
  const avant = ouverts(page);
  Object.assign(sel, { value: 'afaire' });
  sel.dispatch('change', { target: sel });
  await jusqua(() => sujet('clos-a').statut === 'afaire', 'rouvert');
  assert.equal(sujet('clos-a').fait_le, null);
  assert.equal(ouverts(page), avant + 1);
});

test('le bouton « reculer » ramène au statut précédent, y compris depuis un statut clos', async () => {
  const page = await ouvrir();
  const reculer = page.corps.querySelector('[data-f="reculer:avancer:clos-a"]')!;
  assert.ok(reculer, 'bouton reculer sur la carte du sujet clos');
  assert.match(texte(reculer), /En attente/);
  reculer.click();
  await jusqua(() => sujet('clos-a').statut === 'attente', 'reculé');
  assert.equal(sujet('clos-a').fait_le, null);
  // Le premier statut n'a pas de précédent.
  assert.equal(page.corps.querySelector(`[data-f="reculer:avancer:${a.donnees.sujet}"]`), null);
});

test('un statut désactivé n\'est ni colonne ni cible : le glisser-déposer ne le propose pas', async () => {
  db.exec("UPDATE liste_valeur SET actif = 0 WHERE tenant_id = ? AND liste = 'statut_sujet' AND cle = 'attente'", a.id);
  const page = await ouvrir();
  assert.equal(colonnes(page).some((s) => texte(s.querySelector('h2')!) === 'En attente'), false);
  const sel = page.corps.querySelector(`[data-f="saut:avancer:${a.donnees.sujet}"]`)!;
  assert.ok(!sel.querySelectorAll('option').some((o) => o.value === 'attente'));
});

test('glisser-déposer au parcours : « Premier contact » → « Proposition » (saut), retour à « RDV », puis sortie « Perdu »', async () => {
  const page = await ouvrir('associe', 'parcours');
  glisser(page, a.donnees.contact, 'Proposition');
  await jusqua(() => etape(a.donnees.contact) === 'proposition', 'saut d\'étape');
  glisser(page, a.donnees.contact, 'RDV');
  await jusqua(() => etape(a.donnees.contact) === 'rdv', 'retour arrière');
  // « Perdu » est une sortie : on peut y déposer, mais ce n'est le « suivant » d'aucune étape.
  const reculer = page.corps.querySelector(`[data-f="reculer:etape:${a.donnees.contact}"]`)!;
  assert.match(texte(reculer), /Premier contact/);
  const avancer = page.corps.querySelector(`[data-f="etape:${a.donnees.contact}"]`)!;
  assert.match(texte(avancer), /Proposition/, 'le suivant de « RDV » reste « Proposition »');
  glisser(page, a.donnees.contact, 'Perdu');
  await jusqua(() => etape(a.donnees.contact) === 'perdu', 'sortie');
  assert.equal(page.corps.querySelector(`[data-f="etape:${a.donnees.contact}"]`), null, 'une sortie n\'a pas de « suivant »');
  assert.equal(page.corps.querySelector(`[data-f="reculer:etape:${a.donnees.contact}"]`), null, 'ni de « précédent » deviné');
  // Et on en revient par la liste.
  const sel = page.corps.querySelector(`[data-f="saut:etape:${a.donnees.contact}"]`)!;
  assert.deepEqual(sel.querySelectorAll('option').map((o) => o.value), ['', 'contact', 'rdv', 'proposition', 'signe']);
});

test('le rôle lecture : aucune carte glissable, aucun bouton de déplacement, aucune colonne qui accepte un dépôt', async () => {
  const page = await ouvrir('lecture');
  assert.equal(carte(page, a.donnees.sujet).getAttribute('draggable'), null);
  assert.equal(page.corps.querySelectorAll('button').filter((x) => /^(avancer|reculer):/.test(x.getAttribute('data-f') ?? '')).length, 0);
  assert.equal(page.corps.querySelectorAll('select').length, 0);
  const dt = evenement();
  carte(page, a.donnees.sujet).dispatch('dragstart', dt);
  assert.equal(colonne(page, 'Fait').dispatch('dragover', dt).defaultPrevented, false);
  colonne(page, 'Fait').dispatch('drop', dt);
  assert.equal(sujet(a.donnees.sujet).statut, 'afaire');
});
