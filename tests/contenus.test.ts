// 9. Les contenus du site : les paragraphes survivent à un `<textarea>` (lot 19). Un navigateur envoie les sauts de ligne en `\r\n` ; le code ne
// coupait les paragraphes que sur `\n\n`, et toute rubrique « paragraphes séparés par une ligne vide » (mentions légales, horaires du contact)
// sortait en un seul bloc. La normalisation se fait à l'ENREGISTREMENT, et la lecture reste tolérante pour les lignes déjà en base.
//
// Ce que ce fichier ne rend pas : le gabarit HTML de la page (voir tests/LISEZMOI.md). Il éprouve la fonction `paragraphes` que le gabarit
// appelle, sur ce que la base contient réellement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve } from './support/d1.ts';
import { poserTenant } from './support/monde.ts';
import { chargerPage, enregistrerNote, enregistrerPage, lireFormulaire, modeleParCle, normaliserSauts, paragraphes } from '../src/lib/site';

const TROIS = 'Premier paragraphe.\r\n\r\nSecond paragraphe.\r\n\r\nTroisième paragraphe.';

test('paragraphes : trois paragraphes séparés par \\r\\n\\r\\n sortent en trois paragraphes', () => {
  assert.deepEqual(paragraphes(TROIS), ['Premier paragraphe.', 'Second paragraphe.', 'Troisième paragraphe.']);
  assert.deepEqual(paragraphes('a\n\nb'), ['a', 'b'], 'le \\n\\n d\'avant ne change pas');
  assert.deepEqual(paragraphes('a\r\rb'), ['a', 'b'], 'un \\r seul (anciens systèmes) vaut un saut de ligne');
  assert.deepEqual(paragraphes('a\r\n\r\n\r\n\r\nb'), ['a', 'b'], 'plusieurs lignes vides ne font qu\'une coupure');
  assert.deepEqual(paragraphes('une seule ligne\r\nsuite sans ligne vide'), ['une seule ligne\nsuite sans ligne vide'], 'un simple retour à la ligne ne coupe pas');
  assert.equal(normaliserSauts('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('enregistrement d\'une page : aucun \\r n\'entre en base, et les mentions légales à trois paragraphes ressortent en trois', async () => {
  const db = baseNeuve();
  poserTenant(db, 't1', 'Cabinet un', 'un.test');
  await enregistrerPage(db, 't1', 'mentions', 'Mentions légales', {
    eyebrow: 'Informations\r\nlégales',
    sections: [{ titre: 'Éditeur', texte: TROIS }, { titre: 'Hébergement', texte: 'Une ligne.' }],
  });
  const brut = db.un<{ contenu_json: string }>("SELECT contenu_json FROM page_contenu WHERE tenant_id = 't1' AND cle = 'mentions'")!.contenu_json;
  assert.ok(!brut.includes('\\r'), 'le JSON stocké ne contient aucun \\r');
  const page = await chargerPage(db, 't1', 'mentions');
  const sections = page.c?.sections as { titre: string; texte: string }[];
  assert.equal(sections[0].texte, 'Premier paragraphe.\n\nSecond paragraphe.\n\nTroisième paragraphe.');
  assert.equal(paragraphes(sections[0].texte).length, 3);
  assert.equal(page.c?.eyebrow, 'Informations\nlégales');
});

test('formulaire de contenus : ce que le navigateur envoie (CRLF) est ramené à \\n avant tout enregistrement', () => {
  const m = modeleParCle('mentions')!;
  const f = new FormData();
  f.set('meta_titre', 'Mentions');
  f.set('sections.0.titre', 'Éditeur');
  f.set('sections.0.texte', TROIS);
  const { contenu } = lireFormulaire(m, f);
  const sections = contenu.sections as { texte: string }[];
  assert.ok(!sections[0].texte.includes('\r'));
  assert.equal(paragraphes(sections[0].texte).length, 3);
});

test('une ligne déjà en base avec \\r\\n (enregistrée avant ce lot) sort, elle aussi, en trois paragraphes', async () => {
  const db = baseNeuve();
  poserTenant(db, 't2', 'Cabinet deux', 'deux.test');
  const json = JSON.stringify({ sections: [{ titre: 'Éditeur', texte: TROIS }] });
  assert.ok(json.includes('\\r\\n\\r\\n'), 'la fixture reproduit le défaut : du JSON qui porte des \\r\\n');
  db.exec("INSERT INTO page_contenu (id, tenant_id, cle, langue, titre, contenu_json, maj_le) VALUES ('p', 't2', 'mentions', 'fr', 'M', ?, '2026-11-20')", json);
  const page = await chargerPage(db, 't2', 'mentions');
  const sections = page.c?.sections as { texte: string }[];
  assert.equal(paragraphes(sections[0].texte).length, 3);
});

test('notes de marché : chapeau et corps sont normalisés à l\'enregistrement, à la création comme à la mise à jour', async () => {
  const db = baseNeuve();
  poserTenant(db, 't3', 'Cabinet trois', 'trois.test');
  const id = await enregistrerNote(db, 't3', null, { slug: 'n1', titre: 'Note', chapeau: 'Un\r\nchapeau', corps_md: 'a\r\n\r\nb', date: '2026-11-20', publiee: true });
  let n = db.un<{ chapeau: string; corps_md: string }>('SELECT chapeau, corps_md FROM note_marche WHERE id = ?', id)!;
  assert.equal(n.chapeau, 'Un\nchapeau');
  assert.equal(n.corps_md, 'a\n\nb');
  await enregistrerNote(db, 't3', id, { slug: 'n1', titre: 'Note', chapeau: null, corps_md: 'c\r\n\r\nd\r\n\r\ne', date: '2026-11-20', publiee: true });
  n = db.un('SELECT chapeau, corps_md FROM note_marche WHERE id = ?', id)!;
  assert.equal(n.chapeau, null);
  assert.equal(n.corps_md, 'c\n\nd\n\ne');
});
