// L'environnement de recette jouable (lot 20) : un cabinet sur `*.localhost` reçoit son lien sans contourner par SQL ; le seed donne des
// cours fictifs (le bloc Chiffres d'une actu se joue sans clé d'API) et un second cabinet assez riche pour éprouver le cloisonnement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baseNeuve, type BaseTest } from './support/d1.ts';
import { ouvrirSession } from './support/monde.ts';
import { console_, dernier, envoyer, environnement, reseau } from './support/serveur.ts';
import { creerCabinet, lienPremierGestionnaire } from '../src/lib/admin';
import { creerMailer, estHoteLocal } from '../src/lib/mail';
import { lienExport } from '../src/lib/essai';
import { derniersCours, SYMBOLES_DEFAUT } from '../src/lib/cours';
import { creerViewer } from '../src/lib/gestion';
import { LISTES_DEFAUT } from '../src/lib/listes-defaut';

// ------------------------------------------------------------------ le courriel sur *.localhost

test('hôte local : localhost, 127.0.0.1 et tout nom en « .localhost » ; rien d\'autre', () => {
  for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', 'cabinet3.localhost', 'cabinet-3.localhost', 'a.b.localhost', 'Cabinet3.Localhost', ' cabinet3.localhost ']) {
    assert.equal(estHoteLocal(h), true, h);
  }
  for (const h of [
    'cabinet3.local', 'localhost.evil.com', 'cabinet3.localhost.evil.com', 'xlocalhost', 'evil-localhost', '.localhost', 'cabinet3.localhostt',
    'www.cabinet-delmas.fr', 'bebess-invest.fr', '127.0.0.2', '10.0.0.1', '0.0.0.0', '', 'localhost.fr', 'cabinet3_localhost',
  ]) {
    assert.equal(estHoteLocal(h), false, h);
  }
});

test('pilote console : écrit pour un hôte local, lève pour tout autre — production inchangée', async () => {
  const env = environnement(baseNeuve(), { MAIL_DRIVER: 'console' });
  for (const hote of ['localhost', '127.0.0.1', 'cabinet3.localhost']) {
    console_.lignes.length = 0;
    await creerMailer(env, hote).envoyer('paul@exemple.test', 'Sujet', 'Corps du message');
    assert.ok(console_.lignes.some((l) => l.includes('[mail:console] À : paul@exemple.test')), hote);
  }
  for (const hote of ['www.cabinet-delmas.fr', 'cabinet3.local', 'localhost.evil.com', 'cabinet3.localhost.evil.com']) {
    console_.lignes.length = 0;
    await assert.rejects(creerMailer(env, hote).envoyer('paul@exemple.test', 'Sujet', 'Corps du message'), /MAIL_DRIVER=console refusé/, hote);
    assert.ok(!console_.lignes.some((l) => l.includes('Corps du message')), `${hote} : rien n'est écrit dans les journaux`);
  }
});

test('un cabinet créé sur cabinet3.localhost reçoit son lien de première connexion, et il ouvre le cabinet', async () => {
  const db = baseNeuve();
  const env = environnement(db, { MAIL_DRIVER: 'console' });
  const cree = await creerCabinet(db, formulaire({ nom: 'Cabinet Trois', hote: 'cabinet3.localhost', gestionnaire_nom: 'Paul Delmas', gestionnaire_email: 'paul@cabinet3.test' }), { id: 'u-editeur', role: 'editeur' });
  assert.ok('id' in cree);
  const c = cree as Exclude<typeof cree, { erreurs: unknown }>;
  console_.lignes.length = 0;
  const parti = await lienPremierGestionnaire({ runtime: { env } }, c, new URL('http://localhost:4321/admin'));
  assert.equal(parti, true, 'le courriel est parti : plus de contournement par SQL');
  const journal = console_.lignes.join('\n');
  assert.match(journal, /\[mail:console\] À : paul@cabinet3\.test/);
  const lien = /(http:\/\/cabinet3\.localhost:4321\/connexion\/[0-9a-f]{64})/.exec(journal);
  assert.ok(lien, 'le lien est sur l\'hôte du nouveau cabinet, avec le port de l\'éditeur');
  assert.equal(db.compte('incident', "quoi = 'mail_refuse'"), 0);
  // Le lien ouvre bien le cabinet : GET (valable), POST (session).
  const g = await envoyer(env, { url: lien[1] });
  assert.equal(g.statut, 200);
  const p = await envoyer(env, { url: lien[1], methode: 'POST' });
  assert.equal(p.statut, 303);
  assert.equal(p.location, '/gestionnaire');
  assert.ok(p.cookieSession);
  assert.equal((await envoyer(env, { url: 'http://cabinet3.localhost:4321/gestionnaire', cookie: `bbs=${p.cookieSession}` })).statut, 200);
});

test('en production, le même cabinet sur un domaine public n\'a pas de lien par le pilote console : l\'échec est un incident visible', async () => {
  const db = baseNeuve();
  const env = environnement(db, { MAIL_DRIVER: 'console' });
  const cree = await creerCabinet(db, formulaire({ nom: 'Cabinet Public', hote: 'patrimoine.cabinet-public.fr', gestionnaire_nom: 'Paul', gestionnaire_email: 'paul@cabinet-public.fr' }), { id: 'u-editeur', role: 'editeur' });
  const c = cree as Exclude<typeof cree, { erreurs: unknown }>;
  console_.lignes.length = 0;
  assert.equal(await lienPremierGestionnaire({ runtime: { env } }, c, new URL('https://www.bebess-invest.fr/admin')), false);
  assert.ok(!console_.lignes.join('\n').includes('/connexion/'), 'aucun lien valable n\'est écrit dans les journaux');
  assert.equal(db.compte('incident', "quoi = 'mail_refuse'"), 1);
  reseau.vider();
});

test('le lien d\'export de l\'essai suit la même convention : http sur *.localhost, https ailleurs', () => {
  assert.match(lienExport('cabinet3.localhost:4321') ?? '', /^http:\/\/cabinet3\.localhost:4321\/gestionnaire\/export\/locataire$/);
  assert.match(lienExport('localhost') ?? '', /^http:\/\/localhost/);
  assert.match(lienExport('patrimoine.cabinet-public.fr') ?? '', /^https:\/\//);
  assert.match(lienExport('cabinet3.localhost.evil.com') ?? '', /^https:\/\//);
  assert.equal(lienExport(null), null);
});

// ------------------------------------------------------------------ le seed

const formulaire = (o: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

function avecSeed(): BaseTest {
  const db = baseNeuve();
  db.brut.exec(readFileSync(new URL('../seeds/demo.sql', import.meta.url), 'utf8'));
  return db;
}

test('seed : le second cabinet a les neuf listes de référence COMPLÈTES, identiques à celles du premier, avec valeurs terminales et marqueurs', () => {
  const db = avecSeed();
  const listes = (t: string) => db.tous<{ liste: string; cle: string; libelle: string; ordre: number; actif: number; terminal: number; marqueur: string | null }>(
    'SELECT liste, cle, libelle, ordre, actif, terminal, marqueur FROM liste_valeur WHERE tenant_id = ? ORDER BY liste, ordre, cle', t);
  assert.deepEqual(listes('tnt_autre'), listes('tnt_demo'), 'les mêmes valeurs, dans le même ordre, avec les mêmes rôles');
  assert.deepEqual([...new Set(listes('tnt_autre').map((l) => l.liste))].sort(), Object.keys(LISTES_DEFAUT).sort(), 'les neuf listes');
  assert.ok(listes('tnt_autre').some((l) => l.marqueur === 'en_cours') && listes('tnt_autre').some((l) => l.terminal === 1));
});

test('seed : le second cabinet a un contact, un sujet, un échange, un rapport — et le cloisonnement joue dans les deux sens', async () => {
  const db = avecSeed();
  const env = environnement(db);
  assert.equal(db.compte('contact', "tenant_id = 'tnt_autre'"), 1);
  assert.equal(db.compte('sujet', "tenant_id = 'tnt_autre'"), 1);
  assert.equal(db.compte('echange', "tenant_id = 'tnt_autre'"), 1);
  assert.equal(db.compte('document', "viewer_id = 'usr_autre_viewer'"), 2);
  const rapport = db.un<{ categorie: string; cle_fichier: string }>("SELECT categorie, cle_fichier FROM document WHERE id = 'doc_autre_2'")!;
  assert.equal(db.compte('liste_valeur', "tenant_id = 'tnt_autre' AND liste = 'categorie_doc' AND cle = ?", rapport.categorie), 1, 'une catégorie de SA liste');
  assert.ok(rapport.cle_fichier.startsWith('tnt_autre/'), 'une clé R2 qui commence par l\'identifiant du cabinet');

  const autre = ouvrirSession(db, 'usr_autre_gest');
  const etat = await envoyer(env, { url: '/api/suivi/etat', hote: 'cabinet2.localhost', cookie: autre });
  assert.equal(etat.statut, 200);
  assert.deepEqual(etat.json.contacts.map((c: { id: string }) => c.id), ['ctc_autre_1']);
  assert.deepEqual(etat.json.sujets.map((s: { id: string }) => s.id), ['suj_autre_1']);
  // Le premier cabinet ne voit rien du second, ni par l'état, ni par l'identifiant.
  const demo = ouvrirSession(db, 'usr_gestionnaire');
  const etatDemo = await envoyer(env, { url: '/api/suivi/etat', hote: 'localhost', cookie: demo });
  assert.ok(!etatDemo.texte.includes('Lefèvre') && !etatDemo.texte.includes('ctc_autre_1') && !etatDemo.texte.includes('tnt_autre'));
  assert.equal((await envoyer(env, { url: '/gestionnaire/suivi/ctc_autre_1', hote: 'localhost', cookie: demo })).statut, 404);
  assert.equal((await envoyer(env, { url: '/api/suivi/sujet/suj_autre_1', hote: 'localhost', cookie: demo, methode: 'PATCH', json: { texte: 'x' } })).statut, 404);
  // Et le second est jouable : on y crée un viewer (le type par défaut vient du marqueur).
  const f = formulaire({ nom: 'Nouveau Client', email: 'nouveau@delmas.local' });
  assert.ok('id' in (await creerViewer(db, 'tnt_autre', f, null)));
});

test('seed : cinq symboles, quatre séances ; une fiche d\'actu affiche les derniers cours connus à sa date, sans clé d\'API', async () => {
  const db = avecSeed();
  const env = environnement(db);
  assert.equal(db.compte('cours'), 20);
  assert.deepEqual(db.tous<{ symbole: string }>('SELECT DISTINCT symbole FROM cours ORDER BY symbole').map((r) => r.symbole), SYMBOLES_DEFAUT.map((s) => s.cle).sort());
  for (const [date, seance] of [['2026-11-14', '2026-11-13'], ['2026-11-19', '2026-11-19'], ['2026-10-31', '2026-10-30'], ['2026-11-06', '2026-11-06']]) {
    const c = await derniersCours(db, SYMBOLES_DEFAUT, date);
    assert.equal(c.length, 5, date);
    assert.ok(c.every((x) => x.date === seance), `${date} → séance du ${seance}`);
  }
  assert.deepEqual(await derniersCours(db, SYMBOLES_DEFAUT, '2026-10-29'), [], 'avant la première séance : aucun cours');
  // Les variations sont cohérentes avec le sens.
  for (const r of db.tous<{ variation_bp: number | null; sens: string | null }>('SELECT variation_bp, sens FROM cours')) {
    assert.equal(r.sens, r.variation_bp === null ? null : r.variation_bp > 0 ? 'hausse' : r.variation_bp < 0 ? 'baisse' : 'stable');
  }
  // La vue des actus du premier cabinet, sans COURS_API_KEY : le bloc Chiffres est rempli, aucun appel sortant n'est parti.
  const r = await envoyer(env, { url: '/gestionnaire/actus?date=2026-11-14', hote: 'localhost', cookie: ouvrirSession(db, 'usr_gestionnaire') });
  assert.equal(r.statut, 200);
  const chiffres = dernier.rendu?.chiffres as { cle: string; date: string }[];
  assert.equal(chiffres.length, 5);
  assert.ok(chiffres.every((c) => c.date === '2026-11-13'));
  assert.equal(reseau.sortants.length, 0, 'aucun appel au fournisseur de cours');
});
