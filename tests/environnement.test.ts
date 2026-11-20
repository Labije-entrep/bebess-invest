// 10. L'environnement d'essai : le courriel sur la boucle locale et le jeu de démonstration (lot 19). La recette a trouvé qu'un cabinet créé sur
// `cabinet3.localhost` ne recevait aucun lien (le pilote `console` ne reconnaissait que `localhost` et `127.0.0.1`), que le bloc « Chiffres » restait
// vide sans clé d'API, et que le second cabinet du seed était trop pauvre pour viser une ressource de son suivi.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baseNeuve } from './support/d1.ts';
import { environnement } from './support/serveur.ts';
import { creerMailer, hoteLocal } from '../src/lib/mail';
import { creerCabinet, lienPremierGestionnaire } from '../src/lib/admin';
import { derniersCours, SYMBOLES_DEFAUT } from '../src/lib/cours';

const SEED = fileURLToPath(new URL('../seeds/demo.sql', import.meta.url));
const EDITEUR = { id: 'u-editeur', role: 'editeur' as const };

test('hoteLocal : localhost, 127.0.0.1 et tout nom qui se termine par .localhost ; rien d\'autre', () => {
  for (const h of ['localhost', '127.0.0.1', 'cabinet3.localhost', 'cabinet2.localhost', 'A.B.Localhost', 'cabinet3.localhost.']) assert.equal(hoteLocal(h), true, h);
  for (const h of ['xlocalhost', 'localhost.exemple.fr', 'exemple.fr', 'cabinet3.local', 'localhost.evil.com', 'evil-localhost', '127.0.0.2', '', 'patrimoine.cabinet.fr']) assert.equal(hoteLocal(h), false, h);
});

test('pilote console : il écrit sur la boucle locale, y compris *.localhost, et refuse partout ailleurs', async () => {
  const log = mock.method(console, 'log', () => {});
  try {
    const env = environnement(baseNeuve(), { MAIL_DRIVER: 'console' });
    await creerMailer(env, 'cabinet3.localhost').envoyer('marc@alpha.test', 'Sujet', 'http://cabinet3.localhost:4321/connexion/abc');
    assert.equal(log.mock.callCount(), 1, 'le lien est écrit dans la console');
    for (const hote of ['patrimoine.cabinet.fr', 'localhost.exemple.fr', 'bebess.pages.dev']) {
      await assert.rejects(() => creerMailer(env, hote).envoyer('x@y.test', 's', 't'), /MAIL_DRIVER=console refusé/, hote);
    }
    assert.equal(log.mock.callCount(), 1, 'rien n\'est écrit hors de la boucle locale : un lien valable ne va jamais dans des journaux distants');
  } finally {
    log.mock.restore();
  }
});

async function cabinetSur(db: ReturnType<typeof baseNeuve>, hote: string) {
  const f = new FormData();
  f.set('nom', `Cabinet ${hote}`);
  f.set('hote', hote);
  f.set('gestionnaire_nom', 'Marc Gestionnaire');
  f.set('gestionnaire_email', `marc@${hote}`);
  const r = await creerCabinet(db, f, EDITEUR);
  assert.ok(!('erreurs' in r), 'le cabinet se crée');
  return r as Exclude<typeof r, { erreurs: unknown }>;
}

test('un cabinet créé sur cabinet3.localhost reçoit son lien de première connexion', async () => {
  const db = baseNeuve();
  const env = environnement(db, { MAIL_DRIVER: 'console' });
  const cree = await cabinetSur(db, 'cabinet3.localhost');
  const log = mock.method(console, 'log', () => {});
  try {
    const envoye = await lienPremierGestionnaire({ runtime: { env } }, cree, new URL('http://localhost:4321/admin/cabinets/nouveau'));
    assert.equal(envoye, true, 'le lien est parti');
    const ecrit = String(log.mock.calls[0]?.arguments[0] ?? '');
    assert.match(ecrit, /marc@cabinet3\.localhost/);
    assert.match(ecrit, /http:\/\/cabinet3\.localhost:4321\/connexion\/[0-9a-f]{64}/, 'le lien vise l\'hôte du cabinet');
    assert.equal(db.compte('incident', "quoi = 'mail_refuse'"), 0, 'aucun incident');
  } finally {
    log.mock.restore();
  }
});

test('hors de la boucle locale, le lien n\'est PAS écrit et l\'incident est noté (comportement de la recette et de la production)', async () => {
  const db = baseNeuve();
  const env = environnement(db, { MAIL_DRIVER: 'console' });
  const cree = await cabinetSur(db, 'patrimoine.cabinet.fr');
  const log = mock.method(console, 'log', () => {});
  const erreur = mock.method(console, 'error', () => {});
  try {
    const envoye = await lienPremierGestionnaire({ runtime: { env } }, cree, new URL('https://admin.exemple.fr/admin/cabinets/nouveau'));
    assert.equal(envoye, false);
    assert.equal(log.mock.callCount(), 0, 'aucun lien dans les journaux');
    assert.equal(db.compte('incident', "tenant_id = ? AND quoi = 'mail_refuse'", cree.id), 1);
  } finally {
    log.mock.restore();
    erreur.mock.restore();
  }
});

// ------------------------------------------------------------------ le jeu de démonstration

const LISTES = ['statut_sujet', 'etape', 'type_contact', 'metier', 'type_echange', 'categorie_doc', 'classe_actif', 'statut_mouvement', 'type_portefeuille'];

function baseAvecSeed() {
  const db = baseNeuve();
  db.brut.exec(readFileSync(SEED, 'utf8'));
  return db;
}

test('seed : des cours fictifs remplissent le bloc Chiffres sans clé d\'API', async () => {
  const db = baseAvecSeed();
  const cours = await derniersCours(db, SYMBOLES_DEFAUT, '2026-11-20');
  assert.deepEqual(cours.map((c) => c.cle).sort(), SYMBOLES_DEFAUT.map((s) => s.cle).sort(), 'les cinq symboles par défaut ont un cours');
  for (const c of cours) {
    assert.ok(Number.isFinite(Number(c.valeur)), `${c.cle} : une valeur numérique`);
    assert.equal(c.date, '2026-11-13');
    assert.notEqual(c.variation_bp, null, `${c.cle} : une variation`);
  }
  assert.equal((await derniersCours(db, SYMBOLES_DEFAUT, '2026-11-12')).every((c) => c.variation_bp === null), true, 'la veille n\'a pas de variation : un seul point connu');
});

test('seed : le second cabinet a les mêmes listes de référence, un contact, un sujet, un échange et un rapport', () => {
  const db = baseAvecSeed();
  const cles = (tenant: string, liste: string) =>
    db.tous<{ cle: string; terminal: number; marqueur: string | null }>('SELECT cle, terminal, marqueur FROM liste_valeur WHERE tenant_id = ? AND liste = ? ORDER BY ordre', tenant, liste);
  for (const liste of ['statut_sujet', 'etape', 'type_contact', 'metier', 'type_echange', 'categorie_doc']) {
    assert.deepEqual(cles('tnt_autre', liste), cles('tnt_demo', liste), `${liste} : mêmes valeurs, mêmes terminaux et mêmes marqueurs dans les deux cabinets`);
  }
  for (const liste of LISTES) assert.ok(cles('tnt_autre', liste).length > 0, `${liste} : peuplée dans le second cabinet`);
  assert.equal(db.compte('contact', "tenant_id = 'tnt_autre'"), 1);
  assert.equal(db.compte('contact_type', "tenant_id = 'tnt_autre' AND type = 'prospect'"), 1);
  assert.equal(db.compte('sujet', "tenant_id = 'tnt_autre' AND contact_id = 'ct_autre' AND statut = 'afaire'"), 1);
  assert.equal(db.compte('echange', "tenant_id = 'tnt_autre' AND contact_id = 'ct_autre'"), 1);
  const rapports = db.tous<{ categorie: string }>("SELECT categorie FROM document WHERE viewer_id = 'usr_autre_viewer'");
  assert.ok(rapports.length >= 2);
  assert.ok(rapports.some((d) => cles('tnt_autre', 'categorie_doc').some((l) => l.cle === d.categorie)), 'un rapport est rangé dans une catégorie qui existe dans la liste du cabinet');
  // Rien de ce qui est posé pour le second cabinet n'est visible du premier.
  assert.equal(db.compte('contact', "tenant_id = 'tnt_demo'"), 0);
  assert.deepEqual(db.brut.prepare('PRAGMA foreign_key_check').all(), [], 'aucune clé étrangère orpheline');
});
