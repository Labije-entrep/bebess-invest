// Les paragraphes se perdaient (lot 20) : un `<textarea>` envoie ses sauts de ligne en `\r\n`, et `paragraphes` coupait sur `/\n{2,}/` :
// des mentions légales à trois paragraphes sortaient en un seul bloc. La normalisation se fait à l'enregistrement (le défaut ne doit plus
// jamais entrer en base) ET à l'affichage (il y est peut-être déjà).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve } from './support/d1.ts';
import { creerCabinet, ouvrirSession } from './support/monde.ts';
import { envoyer, environnement } from './support/serveur.ts';
import { chargerPage, enregistrerPage, lireFormulaire, modeleParCle, paragraphes, sansRetourChariot } from '../src/lib/site';

const TROIS = 'Éditeur : BeBess’Invest.\r\n\r\nHébergeur : Cloudflare.\r\n\r\nDirecteur de la publication : le gérant.';

test('paragraphes : « \\r\\n\\r\\n », « \\n\\n » et « \\r\\r » séparent tous les paragraphes', () => {
  const attendu = ['Éditeur', 'Hébergeur', 'Directeur'];
  assert.deepEqual(paragraphes('Éditeur\r\n\r\nHébergeur\r\n\r\nDirecteur'), attendu, 'un textarea (CRLF)');
  assert.deepEqual(paragraphes('Éditeur\n\nHébergeur\n\nDirecteur'), attendu, 'LF');
  assert.deepEqual(paragraphes('Éditeur\r\rHébergeur\r\rDirecteur'), attendu, 'CR seul');
  assert.deepEqual(paragraphes('Éditeur\r\n\r\n\r\n\r\nHébergeur\n\n\n\nDirecteur'), attendu, 'plusieurs lignes vides');
  assert.deepEqual(paragraphes('Une seule ligne\r\nsur deux lignes'), ['Une seule ligne\nsur deux lignes'], 'un simple retour ne coupe pas');
  assert.deepEqual(paragraphes(''), []);
  assert.deepEqual(paragraphes('\r\n\r\n'), []);
  assert.equal(sansRetourChariot('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('enregistrement : la base ne reçoit jamais de « \\r », à tous les étages d\'un contenu', async () => {
  const db = baseNeuve();
  const a = creerCabinet(db, 'A');
  await enregistrerPage(db, a.id, 'mentions', 'Titre\r\nSuite', {
    description: 'Une\r\ndescription',
    sections: [{ titre: 'Éditeur', texte: TROIS }, { titre: 'Autre', texte: 'a\rb' }],
    groupe: { horaires: 'Lundi\r\nMardi' },
    nombre: 3, vide: null, actif: true,
  });
  const ligne = db.un<{ titre: string; contenu_json: string }>('SELECT titre, contenu_json FROM page_contenu WHERE tenant_id = ? AND cle = ?', a.id, 'mentions')!;
  assert.ok(!ligne.contenu_json.includes('\\r'), 'aucun \\r dans le JSON');
  assert.ok(!ligne.titre.includes('\r'));
  const page = await chargerPage(db, a.id, 'mentions');
  assert.equal((page.c as any).sections[0].texte, TROIS.replace(/\r\n/g, '\n'));
  assert.equal((page.c as any).sections[1].texte, 'a\nb');
  assert.equal((page.c as any).nombre, 3, 'les valeurs qui ne sont pas du texte ne changent pas');
  assert.equal((page.c as any).vide, null);
  assert.equal((page.c as any).actif, true);
  assert.deepEqual(paragraphes((page.c as any).sections[0].texte).length, 3, 'trois paragraphes relus de la base');
  // Une mise à jour (la page existe) normalise aussi.
  await enregistrerPage(db, a.id, 'mentions', null, { sections: [{ titre: 'x', texte: 'p1\r\n\r\np2' }] });
  assert.ok(!db.un<{ contenu_json: string }>('SELECT contenu_json FROM page_contenu WHERE tenant_id = ? AND cle = ?', a.id, 'mentions')!.contenu_json.includes('\\r'));
});

test('le formulaire : les champs d\'un textarea sont ramenés à « \\n » avant d\'être rangés', () => {
  const m = modeleParCle('mentions')!;
  const f = new FormData();
  f.set('meta_titre', 'Mentions');
  f.set('titre', 'Mentions légales');
  f.set('sections.0.titre', 'Éditeur');
  f.set('sections.0.texte', `  ${TROIS}  `);
  const { titre, contenu } = lireFormulaire(m, f);
  assert.equal(titre, 'Mentions');
  assert.equal(contenu.sections[0].texte, TROIS.replace(/\r\n/g, '\n'), 'normalisé et rogné');
  assert.equal(paragraphes(contenu.sections[0].texte).length, 3);
});

test('de bout en bout : des mentions légales saisies à trois paragraphes (CRLF) sortent en trois paragraphes', async () => {
  const db = baseNeuve();
  const a = creerCabinet(db, 'A', { contrat: { module_pilotage: 1, module_site: 1 } });
  const env = environnement(db);
  const r = await envoyer(env, {
    url: '/gestionnaire/contenus/mentions', hote: a.hote, cookie: ouvrirSession(db, a.associe),
    formulaire: { meta_titre: 'Mentions', titre: 'Mentions légales', 'sections.0.titre': 'Éditeur', 'sections.0.texte': TROIS },
  });
  assert.equal(r.statut, 303);
  const stocke = db.un<{ contenu_json: string }>('SELECT contenu_json FROM page_contenu WHERE tenant_id = ? AND cle = ?', a.id, 'mentions')!.contenu_json;
  assert.ok(!stocke.includes('\\r'), 'la base ne garde que « \\n »');
  const page = await chargerPage(db, a.id, 'mentions');
  assert.deepEqual(paragraphes((page.c as any).sections[0].texte), ['Éditeur : BeBess’Invest.', 'Hébergeur : Cloudflare.', 'Directeur de la publication : le gérant.']);
});

test('contenu déjà en base avec des « \\r\\n » (avant la correction) : il s\'affiche quand même en trois paragraphes', async () => {
  const db = baseNeuve();
  const a = creerCabinet(db, 'A');
  db.exec('UPDATE page_contenu SET contenu_json = ? WHERE id = ?', JSON.stringify({ sections: [{ titre: 'Éditeur', texte: TROIS }] }), a.donnees.pageContenu);
  db.exec("UPDATE page_contenu SET cle = 'mentions' WHERE id = ?", a.donnees.pageContenu);
  const page = await chargerPage(db, a.id, 'mentions');
  assert.ok((page.c as any).sections[0].texte.includes('\r\n'), 'le défaut est bien en base');
  assert.equal(paragraphes((page.c as any).sections[0].texte).length, 3);
});

test('la page de contact : les horaires saisis sur plusieurs lignes vides se découpent aussi', () => {
  assert.deepEqual(paragraphes('Lundi au vendredi, 9 h – 18 h\r\n\r\nSamedi sur rendez-vous'), ['Lundi au vendredi, 9 h – 18 h', 'Samedi sur rendez-vous']);
});
