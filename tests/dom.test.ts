// Le navigateur de poche (tests/support/dom.ts) : `pret()` attend un SIGNAL, le dessin du script, jamais un nombre de tours de boucle.
// Ces tests protègent le banc lui-même : l'ancienne attente (200 tours de setImmediate, abandon silencieux) faisait échouer marqueurs.test.ts
// sous Node 22.23 dès que le premier chargement était un peu lent, et le script en retard dessinait ensuite dans la page du test suivant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, installerPage } from './support/dom.ts';

const dessin = (page: ReturnType<typeof installerPage>) => page.corps.replaceChildren(Object.assign(new Element('ul'), { className: 'suivi-kpis' }));

test('pret attend un dessin tardif : 150 ms de retard, bien plus que 200 tours de boucle', async () => {
  const page = installerPage();
  setTimeout(() => dessin(page), 150);
  const debut = Date.now();
  await page.pret();
  assert.ok(Date.now() - debut >= 140, 'il a attendu le signal');
  assert.ok(page.corps.querySelector('.suivi-kpis'));
});

test('pret rend la main dès que le script a dessiné, sans attendre davantage', async () => {
  const page = installerPage();
  dessin(page);
  const debut = Date.now();
  await page.pret();
  assert.ok(Date.now() - debut < 100);
});

test('pret échoue en disant l\'écran d\'erreur que le script a affiché, au lieu de laisser le test échouer plus loin', async () => {
  const page = installerPage();
  const message = new Element('p');
  message.append('Le suivi n’a pas pu être chargé. ');
  page.corps.replaceChildren(message);
  await assert.rejects(page.pret(), /écran d'erreur au lieu de la page : « Le suivi n’a pas pu être chargé\./);
});

test('pret échoue bruyamment si le script ne dessine jamais (garde-fou contre un blocage, pas mécanisme d\'attente)', async () => {
  const page = installerPage();
  await assert.rejects(page.pret(60), /n'a rien dessiné en 60 ms/);
});

test('le signal est propre à chaque page : le dessin d\'une page ne signale pas la suivante', async () => {
  const premiere = installerPage();
  const seconde = installerPage();
  dessin(premiere);
  await premiere.pret();
  await assert.rejects(seconde.pret(60), /n'a rien dessiné/);
});
