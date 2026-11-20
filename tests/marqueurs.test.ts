// 7. Marqueurs. Le code ne connaît JAMAIS la clé d'une valeur de liste : il demande à la table de référence quelle valeur porte quel rôle.
// Preuve : on renomme les clés des neuf listes de référence (et, avec elles, tout ce qui les porte), et les indicateurs, le kanban, le
// parcours et la liste du suivi sont identiques avant et après, mot pour mot.
//
// Ce qui tourne : le vrai script du navigateur (src/scripts/suivi.ts) dans un navigateur de poche (tests/support/dom.ts), branché sur le
// vrai /api/suivi/etat du Worker. Les indicateurs, le kanban et le parcours sont CALCULÉS par ce script, nulle part ailleurs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, type BaseTest } from './support/d1.ts';
import { creerCabinet, ouvrirSession, type Cabinet } from './support/monde.ts';
import { envoyer, environnement, reseau, type Environnement } from './support/serveur.ts';
import { installerPage, texte, type Page } from './support/dom.ts';
import { LISTES_DEFAUT } from '../src/lib/listes-defaut';
import { cleMarquee, marqueursDe, terminauxDe } from '../src/lib/listes';
import { creerViewer, traiter } from '../src/lib/gestion';

let db: BaseTest;
let env: Environnement;
let a: Cabinet;
let cookie: string;

// La date du jour telle que le script la lit (heure locale du navigateur).
const aujourdhui = (decalage = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

beforeEach(() => {
  reseau.vider();
  db = baseNeuve();
  a = creerCabinet(db, 'A', { contrat: { module_pilotage: 1, module_site: 1 } });
  env = environnement(db);
  cookie = ouvrirSession(db, a.associe);
  peupler();
});

/** Un cabinet qui a de quoi remplir chaque indicateur, chaque colonne du kanban et chaque colonne du parcours. */
function peupler(): void {
  const T = a.id;
  const c = (id: string, nom: string, o: { etape?: string | null; relance?: string | null; dernier?: string | null; avoirs?: number | null; archive?: number; responsable?: string | null; metier?: string | null } = {}) =>
    db.exec(
      `INSERT INTO contact (id, tenant_id, nom, etape, relance, dernier_echange, type_echange, avoirs_cents, avoirs_le, archive, responsable_id, metier, cree_le, maj_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')`,
      id, T, nom, o.etape ?? null, o.relance ?? null, o.dernier ?? null, o.dernier ? 'tel' : null, o.avoirs ?? null, o.avoirs ? aujourdhui(-3) : null, o.archive ?? 0, o.responsable ?? null, o.metier ?? null);
  const type = (contact: string, t: string) => db.exec('INSERT INTO contact_type (tenant_id, contact_id, type) VALUES (?, ?, ?)', T, contact, t);
  const sujet = (id: string, contact: string, statut: string, echeance: string | null, faitLe: string | null = null, archive = 0) =>
    db.exec('INSERT INTO sujet (id, tenant_id, contact_id, texte, statut, echeance, fait_le, archive, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, T, contact, `Texte ${id}`, statut, echeance, faitLe, archive, '2026-01-01T00:00:00Z');

  c('alice', 'Alice', { etape: 'rdv', relance: aujourdhui(3), dernier: aujourdhui(), responsable: a.donnees.membre, metier: 'notaire' });
  type('alice', 'prospect');
  c('bob', 'Bob', { dernier: aujourdhui(-100), metier: 'avocat' });
  type('bob', 'client');
  c('chloe', 'Chloé', { avoirs: 12_000_000, relance: aujourdhui(-2), metier: 'cgp' });
  type('chloe', 'prescripteur');
  c('dan', 'Dan', { etape: 'perdu', dernier: aujourdhui(-10) });
  type('dan', 'prospect');
  c('eve', 'Eve', { etape: null, dernier: aujourdhui(-70) });
  type('eve', 'prospect');
  type('eve', 'partenaire');
  c('franck', 'Franck', { archive: 1 });
  type('franck', 'prospect');
  c('gina', 'Gina', { etape: 'proposition', dernier: aujourdhui(-1) });
  type('gina', 'prospect');
  type('gina', 'client');
  db.exec('UPDATE contact SET apporteur_id = ? WHERE id = ?', 'chloe', 'alice');

  sujet('s1', 'alice', 'encours', aujourdhui(-5)); // en cours, en retard
  sujet('s2', 'alice', 'attente', aujourdhui(5));
  sujet('s3', 'bob', 'afaire', aujourdhui(-1)); // à faire, en retard
  sujet('s4', 'bob', 'fait', aujourdhui(-20), aujourdhui(-5)); // clos récemment : dans la colonne
  sujet('s5', 'bob', 'fait', aujourdhui(-200), aujourdhui(-90)); // clos depuis longtemps : compté, pas affiché
  sujet('s6', 'chloe', 'encours', null);
  sujet('s7', 'gina', 'afaire', aujourdhui(10));
  sujet('s8', 'dan', 'fait', null, aujourdhui(-1));
  sujet('s9', 'franck', 'encours', aujourdhui(-9)); // contact archivé : ne compte pas
  sujet('s10', 'gina', 'attente', null, null, 1); // sujet archivé : ne compte pas
  // Un contact rattaché au portail, avec un arrêté périmé.
  db.exec("UPDATE contact SET nom = 'Client Portail' WHERE id = ?", a.donnees.contactViewer);
}

interface Vues {
  kpis: string[];
  liste: string;
  kanban: string;
  parcours: string;
  filtres: Record<string, string>;
  etat: any;
}

let instance = 0;

/** Ouvre la page du suivi (le vrai script), la laisse charger, et relève tout ce que l'utilisateur peut voir. */
async function ouvrir(): Promise<Vues> {
  const page: Page = installerPage('liste');
  reseau.interne = async (url, init) => {
    const r = await envoyer(env, { url, hote: a.hote, cookie, methode: init?.method ?? 'GET' });
    return new Response(r.texte, { status: r.statut, headers: { 'content-type': 'application/json' } });
  };
  await import(`../src/scripts/suivi.ts?instance=${++instance}`);
  await page.pret();
  const principal = () => page.corps.children[2] as unknown as { textContent: string } & Parameters<typeof texte>[0];
  const vue = (nom: string): string => {
    page.corps.querySelector(`[data-f="vue:${nom}"]`)!.click();
    return texte(principal());
  };
  const kpis = () => page.corps.querySelector('.suivi-kpis')!.children.map((li) => texte(li));
  const liste = vue('liste');
  const lesKpis = kpis();
  const filtres: Record<string, string> = {};
  for (const id of ['vus', 'ouverts', 'encours', 'attente', 'retard', 'relance', 'sans', 'avoirs']) {
    const bouton = page.corps.querySelector(`[data-f="kpi:${id}"]`);
    if (!bouton) continue; // un indicateur sans valeur qui le porte n'a pas de bouton
    bouton.click();
    filtres[id] = texte(principal());
    page.corps.querySelector(`[data-f="kpi:${id}"]`)!.click(); // on le relâche
  }
  const kanban = vue('kanban');
  const parcours = vue('parcours');
  const etat = (await (await fetch('/api/suivi/etat')).json()) as Vues['etat'];
  return { kpis: lesKpis, liste, kanban, parcours, filtres, etat };
}

// ------------------------------------------------------------------ le renommage

const SUFFIXE = '_v2';
const U = '(SELECT id FROM utilisateur WHERE tenant_id = ?)';
const PF = '(SELECT id FROM portefeuille WHERE tenant_id = ?)';
/** Renommer les clés d'une liste, c'est changer la clé dans la table de référence ET partout où elle est portée : une requête par porteur. */
const RENOMMAGE: Record<string, string[]> = {
  type_contact: ['UPDATE contact_type SET type = type || ? WHERE tenant_id = ?'],
  metier: ['UPDATE contact SET metier = metier || ? WHERE tenant_id = ? AND metier IS NOT NULL'],
  etape: ['UPDATE contact SET etape = etape || ? WHERE tenant_id = ? AND etape IS NOT NULL'],
  type_echange: [
    'UPDATE echange SET type = type || ? WHERE tenant_id = ?',
    'UPDATE contact SET type_echange = type_echange || ? WHERE tenant_id = ? AND type_echange IS NOT NULL',
  ],
  statut_sujet: ['UPDATE sujet SET statut = statut || ? WHERE tenant_id = ?'],
  categorie_doc: [
    `UPDATE document SET categorie = categorie || ? WHERE viewer_id IN ${U.replace('?', '?')} AND ? IS NOT NULL`,
    'UPDATE document_interne SET categorie = categorie || ? WHERE tenant_id = ?',
  ],
  classe_actif: [
    `UPDATE ligne SET classe = classe || ? WHERE enveloppe_id IN (SELECT e.id FROM enveloppe e WHERE e.portefeuille_id IN ${PF}) AND ? IS NOT NULL`,
    `UPDATE cible SET classe = classe || ? WHERE portefeuille_id IN ${PF} AND ? IS NOT NULL`,
  ],
  statut_mouvement: [`UPDATE mouvement SET statut = statut || ? WHERE viewer_id IN ${U} AND ? IS NOT NULL`],
  type_portefeuille: ['UPDATE portefeuille SET type = type || ? WHERE tenant_id = ?'],
};

function renommerLesNeufListes(): void {
  assert.deepEqual(Object.keys(RENOMMAGE).sort(), Object.keys(LISTES_DEFAUT).sort(), 'les neuf listes de référence, toutes');
  db.brut.exec('BEGIN');
  db.brut.exec('PRAGMA defer_foreign_keys = ON');
  for (const requetes of Object.values(RENOMMAGE)) {
    for (const sql of requetes) {
      // Deux formes : (suffixe, tenant) et (suffixe, tenant, garde-fou) ; les sous-requêtes ne portent qu'un « ? ».
      const n = sql.split('?').length - 1;
      db.exec(sql, ...(n === 2 ? [SUFFIXE, a.id] : [SUFFIXE, a.id, SUFFIXE]));
    }
  }
  db.exec('UPDATE liste_valeur SET cle = cle || ? WHERE tenant_id = ?', SUFFIXE, a.id);
  db.brut.exec('COMMIT');
}

test('renommer les clés des neuf listes : indicateurs, filtres, liste, kanban et parcours sont identiques avant et après', async () => {
  const avant = await ouvrir();

  // Le décor n'est pas vide : chaque vue a de quoi montrer, sinon l'égalité ne prouverait rien.
  assert.equal(avant.kpis.length, 8);
  assert.match(avant.kpis[2], /^2 En cours$/, 'deux sujets « en cours » comptés (celui du contact archivé ne l\'est pas)');
  assert.match(avant.kpis[3], /^1 En attente$/);
  assert.match(avant.kpis[1], /^6 Sujets ouverts$/);
  assert.match(avant.kpis[4], /^2 En retard$/);
  assert.match(avant.kanban, /À faire 3/, 's3, s7 et le sujet du décor');
  assert.match(avant.kanban, /Fait 2/);
  assert.match(avant.kanban, /1 sujet clos plus ancien/, 'le sujet clos depuis 90 jours est compté, pas affiché');
  assert.match(avant.parcours, /Sans étape/);
  assert.match(avant.parcours, /Perdu/);
  assert.match(avant.parcours, /Sortie/);
  assert.ok(avant.parcours.includes('ALICE') && avant.parcours.includes('EVE'), 'les prospects sont rangés');
  assert.ok(!avant.parcours.includes('FRANCK'), 'un contact archivé n\'est pas dans le parcours');
  assert.ok(!avant.parcours.includes('CHLOÉ'), 'un prescripteur n\'est pas un prospect');
  assert.ok(Object.keys(avant.filtres).length === 8, 'les huit indicateurs filtrent');

  const clesAvant = JSON.stringify(avant.etat.listes);
  renommerLesNeufListes();
  const apres = await ouvrir();

  // Les clés ont vraiment changé, dans les neuf listes…
  for (const liste of Object.keys(LISTES_DEFAUT)) {
    const av = avant.etat.listes[liste].map((v: { cle: string }) => v.cle);
    const ap = apres.etat.listes[liste].map((v: { cle: string }) => v.cle);
    assert.deepEqual(ap, av.map((k: string) => k + SUFFIXE), `liste ${liste} : clés renommées`);
  }
  assert.notEqual(JSON.stringify(apres.etat.listes), clesAvant);
  assert.deepEqual(apres.etat.marqueurs.statut_sujet, { en_cours: ['encours' + SUFFIXE], en_attente: ['attente' + SUFFIXE] }, 'les marqueurs suivent leurs valeurs');
  assert.deepEqual(apres.etat.terminaux.statut_sujet, ['fait' + SUFFIXE]);
  assert.deepEqual(apres.etat.terminaux.etape, ['perdu' + SUFFIXE]);
  // … et pourtant, ce que l'utilisateur voit est identique.
  assert.deepEqual(apres.kpis, avant.kpis, 'indicateurs');
  assert.deepEqual(apres.filtres, avant.filtres, 'listes filtrées par chaque indicateur');
  assert.equal(apres.liste, avant.liste, 'liste des contacts');
  assert.equal(apres.kanban, avant.kanban, 'kanban');
  assert.equal(apres.parcours, avant.parcours, 'parcours');
});

test('après renommage, les écritures suivent : les anciennes clés sont refusées, les nouvelles acceptées, rien n\'est supposé', async () => {
  renommerLesNeufListes();
  const ecrire = (json: unknown) => envoyer(env, { url: '/api/suivi/sujet', hote: a.hote, cookie, json });
  const ancien = await ecrire({ contact_id: 'alice', texte: 'x', statut: 'afaire' });
  assert.equal(ancien.statut, 422, 'l\'ancienne clé n\'existe plus');
  assert.ok(ancien.json.admises.includes('afaire' + SUFFIXE));
  const neuf = await ecrire({ contact_id: 'alice', texte: 'x', statut: 'afaire' + SUFFIXE });
  assert.equal(neuf.statut, 201);

  // Le type du portefeuille d'un nouveau viewer vient du marqueur « Type par défaut », quelle que soit sa clé.
  assert.equal(await cleMarquee(db, a.id, 'type_portefeuille', 'defaut'), 'personne' + SUFFIXE);
  const f = new FormData();
  f.set('nom', 'Nouveau Client');
  f.set('email', 'nouveau@cabinet-a.test');
  const r = await creerViewer(db, a.id, f, null);
  assert.ok('id' in r);
  assert.equal(db.un<{ type: string }>('SELECT type FROM portefeuille WHERE viewer_id = ?', 'id' in r ? r.id : '')?.type, 'personne' + SUFFIXE);

  // Un mouvement « terminé » l'est par le marqueur « clos », pas par la clé « execute ».
  const g = (o: Record<string, string>): FormData => { const x = new FormData(); for (const [k, v] of Object.entries(o)) x.set(k, v); return x; };
  const m = await traiter(db, a.id, a.donnees.viewer, 'mouvement', g({ date: '2026-06-01', libelle: 'Rachat', statut: 'execute' + SUFFIXE, etape: '2', en_cours: '1' }));
  assert.deepEqual(m.erreurs, {});
  assert.deepEqual({ ...db.un('SELECT en_cours, etape FROM mouvement WHERE libelle = ?', 'Rachat') }, { en_cours: 0, etape: 0 }, 'terminé : plus de barre d\'avancement');
  const enCours = await traiter(db, a.id, a.donnees.viewer, 'mouvement', g({ date: '2026-06-01', libelle: 'Arbitrage', statut: 'transmis' + SUFFIXE, etape: '2', en_cours: '1' }));
  assert.deepEqual(enCours.erreurs, {});
  assert.deepEqual({ ...db.un('SELECT en_cours, etape FROM mouvement WHERE libelle = ?', 'Arbitrage') }, { en_cours: 1, etape: 2 });
});

test('un marqueur se pose où le cabinet veut : l\'indicateur suit la valeur marquée, pas le nom', async () => {
  const avant = await ouvrir();
  assert.match(avant.kpis[2], /^2 En cours$/);
  // Le marqueur « En cours » passe de « En cours » à « À faire » : l'indicateur compte alors les sujets « À faire » (s3, s7, hors archivés).
  db.exec("UPDATE liste_valeur SET marqueur = NULL WHERE tenant_id = ? AND liste = 'statut_sujet' AND cle = 'encours'", a.id);
  db.exec("UPDATE liste_valeur SET marqueur = 'en_cours' WHERE tenant_id = ? AND liste = 'statut_sujet' AND cle = 'afaire'", a.id);
  const apres = await ouvrir();
  assert.match(apres.kpis[2], /^3 En cours$/, 'trois sujets « À faire » : s3, s7 et celui du décor');
  assert.notEqual(apres.filtres.encours, avant.filtres.encours, 'et ce ne sont pas les mêmes contacts');
  assert.ok(apres.filtres.encours.includes('BOB') && apres.filtres.encours.includes('GINA') && apres.filtres.encours.includes('CONTACT A'));
  assert.ok(avant.filtres.encours.includes('ALICE') && avant.filtres.encours.includes('CHLOÉ'));
});

test('sans valeur qui porte le marqueur, l\'indicateur le dit au lieu d\'afficher un zéro ; le parcours aussi', async () => {
  db.exec("UPDATE liste_valeur SET marqueur = NULL WHERE tenant_id = ? AND liste IN ('statut_sujet', 'type_contact')", a.id);
  const v = await ouvrir();
  assert.match(v.kpis[2], /Aucun statut n’est marqué « Indicateur En cours »/);
  assert.match(v.kpis[3], /Aucun statut n’est marqué « Indicateur En attente »/);
  assert.ok(!('encours' in v.filtres) && !('attente' in v.filtres), 'pas de bouton, pas de filtre');
  assert.match(v.kpis[1], /^6 Sujets ouverts$/, 'les autres indicateurs ne dépendent pas des marqueurs');
  assert.match(v.parcours, /Aucun type de contact n’est marqué « Alimente le parcours »/);
  // Désactiver la valeur qui porte le marqueur retire le rôle : même message.
  db.exec("UPDATE liste_valeur SET marqueur = 'en_cours' WHERE tenant_id = ? AND liste = 'statut_sujet' AND cle = 'encours'", a.id);
  assert.match((await ouvrir()).kpis[2], /^2 En cours$/);
  db.exec("UPDATE liste_valeur SET actif = 0 WHERE tenant_id = ? AND liste = 'statut_sujet' AND cle = 'encours'", a.id);
  assert.match((await ouvrir()).kpis[2], /Aucun statut n’est marqué/);
  assert.deepEqual((await marqueursDe(db, a.id)).statut_sujet ?? {}, {}, 'une valeur désactivée ne porte plus son rôle');
});

test('la valeur terminale vient de la table, pas du nom : un statut marqué terminal clôt ses sujets, un autre non', async () => {
  const avant = await ouvrir();
  // « Attente » devient terminal et « Fait » ne l'est plus : le kanban et « Sujets ouverts » suivent.
  db.exec("UPDATE liste_valeur SET terminal = 1 WHERE tenant_id = ? AND liste = 'statut_sujet' AND cle = 'attente'", a.id);
  db.exec("UPDATE liste_valeur SET terminal = 0 WHERE tenant_id = ? AND liste = 'statut_sujet' AND cle = 'fait'", a.id);
  assert.deepEqual(await terminauxDe(db, a.id), { etape: ['perdu'], statut_sujet: ['attente'] });
  const apres = await ouvrir();
  assert.notEqual(apres.kpis[1], avant.kpis[1]);
  assert.match(apres.kpis[1], /^8 Sujets ouverts$/, 's2 est clos ; s4, s5 et s8 sont rouverts : 6 − 1 + 3 = 8');
  assert.notEqual(apres.kanban, avant.kanban);
});
