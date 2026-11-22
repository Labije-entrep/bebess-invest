// Personnalisation du site et de l'espace d'un cabinet (22/11/2026) : accent (contraste WCAG calculé), police, taille du texte, forme.
// Fonctions pures testées sur des couleurs connues ; réglages mémorisés par cabinet ; rendu des attributs sur les quatre gabarits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baseNeuve } from './support/d1.ts';
import { poserTenant } from './support/monde.ts';
import { tenantParHote } from '../src/lib/db';
import { enregistrerIdentite, enregistrerPersonnalisation, personnalisationDe } from '../src/lib/reglages';
import { REGLAGES, aLeRole } from '../src/lib/roles';
import { THEMES } from '../src/lib/themes';
import {
  PERSONNALISATION_DEFAUT, attributsCabinet, contraste, couleurProche, evaluerAccent, lirePersonnalisation, luminance, messageRefusAccent, normaliserHex,
  FORMES, POLICES, TAILLES,
} from '../src/lib/personnalisation';

const formulaire = (o: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const OK = { accent: '', police: 'classique', taille_texte: 'standard', forme_elements: 'anguleux' };

// ------------------------------------------------------------------ le contraste

test('contraste WCAG : valeurs de référence (noir/blanc 21:1, identiques 1:1, #767676 sur blanc 4,54:1, #777777 4,48:1)', () => {
  assert.equal(contraste('#000000', '#ffffff'), 21);
  assert.equal(contraste('#ffffff', '#000000'), 21, 'symétrique');
  assert.equal(contraste('#123456', '#123456'), 1);
  assert.equal(contraste('#000000', '#000000'), 1, 'noir sur noir');
  assert.ok(contraste('#767676', '#ffffff') >= 4.5 && contraste('#767676', '#ffffff') < 4.6);
  assert.ok(contraste('#777777', '#ffffff') < 4.5 && contraste('#777777', '#ffffff') > 4.4);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(luminance('#000000'), 0);
});

test('accent : le noir sur noir (thème sombre) est refusé, avec un message chiffré et une couleur proche qui, elle, est acceptée', () => {
  const e = evaluerAccent('#000000', 'maison');
  assert.equal(e.ok, false);
  assert.match(messageRefusAccent('#000000', 'maison')!, /illisible.*1,0:1.*4,5:1/);
  const proche = couleurProche('#000000', 'maison')!;
  assert.match(proche, /^#[0-9a-f]{6}$/);
  assert.equal(evaluerAccent(proche, 'maison').ok, true);
  assert.match(messageRefusAccent('#000000', 'maison')!, new RegExp(proche));
  // Un jaune clair sur le thème clair : illisible ; sa version foncée proche est acceptée.
  assert.equal(evaluerAccent('#ffee88', 'clair').ok, false);
  assert.equal(evaluerAccent(couleurProche('#ffee88', 'clair')!, 'clair').ok, true);
});

test('accent : une bonne couleur est acceptée sur chaque thème sombre, et les jetons dérivés eux-mêmes sont lisibles', () => {
  for (const id of ['maison', 'nuit', 'foret', 'pierre']) {
    const e = evaluerAccent('#7fb3e0', id);
    assert.equal(e.ok, true, id);
    if (!e.ok) continue;
    const t = THEMES.find((x) => x.id === id)!;
    assert.ok(e.mesures.surFond >= 4.5 && e.mesures.surMarine >= 4.5 && e.mesures.surBouton >= 4.5);
    assert.ok(contraste(e.jetons.accentClair, t.fond) >= 4.5, 'l’accent clair reste lisible comme texte');
    assert.equal(e.jetons.surAccent, 'var(--fond)', 'le texte du bouton est un jeton du thème, pas une couleur nouvelle');
  }
  const clair = evaluerAccent('#1f5f8b', 'clair');
  assert.equal(clair.ok, true);
  assert.equal(evaluerAccent('#ffffff', 'clair').ok, false, 'blanc sur fond ivoire');
  assert.equal(evaluerAccent('#202020', 'maison').ok, false, 'sombre sur fond sombre');
  // L'accent d'origine d'un thème est, bien sûr, accepté sur ce thème.
  assert.equal(evaluerAccent('#b99455', 'maison').ok, true);
  assert.equal(evaluerAccent('#82601f', 'clair').ok, true);
});

test('accent : seule la syntaxe #RRGGBB est admise (aucune autre couleur, aucune injection)', () => {
  assert.equal(normaliserHex(' #A1B2C3 '), '#a1b2c3');
  for (const v of ['#fff', 'red', 'rgb(0,0,0)', '#12345g', '#1234567', '', null, undefined, 42, 'url(javascript:1)', '#aabbcc;background:red', '#aabbcc"><script>']) assert.equal(normaliserHex(v), null, String(v));
  assert.equal(evaluerAccent('rouge', 'maison').ok, false);
  const a = attributsCabinet({ ...PERSONNALISATION_DEFAUT, accent: '#aabbcc;background:red' } as never, 'maison');
  assert.equal(a.style, undefined, 'une valeur qui n’est pas un code hexadécimal ne parvient jamais au style');
});

test('les couleurs de thème que le serveur mesure sont celles de app.css (aucune dérive)', () => {
  const css = readFileSync('src/styles/app.css', 'utf8');
  for (const t of THEMES) {
    const bloc = css.slice(css.indexOf(`:root[data-cabinet-theme="${t.id}"]`));
    const lire = (jeton: string) => new RegExp(`--${jeton}: (#[0-9a-f]{6});`).exec(bloc)![1];
    assert.deepEqual([lire('fond'), lire('marine'), lire('texte')], [t.fond, t.marine, t.texte], t.id);
    assert.equal(bloc.slice(0, 60).includes(`color-scheme: ${t.sombre ? 'dark' : 'light'}`), true, `${t.id} : sombre`);
  }
});

// ------------------------------------------------------------------ valeurs lues, valeurs par défaut

test('lecture : une valeur absente, inconnue ou mal formée retombe sur le défaut (rendu d’origine)', () => {
  assert.deepEqual(lirePersonnalisation({}), PERSONNALISATION_DEFAUT);
  assert.deepEqual(lirePersonnalisation({ accent: 'bleu', police: 'comic', taille_texte: 'énorme', forme_elements: 'rond' }), PERSONNALISATION_DEFAUT);
  assert.deepEqual(
    lirePersonnalisation({ accent: '#AABBCC', police: 'moderne', taille_texte: 'grand', forme_elements: 'arrondi' }),
    { accent: '#aabbcc', police: 'moderne', taille: 'grand', forme: 'arrondi' },
  );
  assert.deepEqual(POLICES.map((o) => o.id), ['classique', 'moderne', 'editoriale']);
  assert.deepEqual(TAILLES.map((o) => o.id), ['standard', 'confortable', 'grand']);
  assert.deepEqual(FORMES.map((o) => o.id), ['anguleux', 'arrondi']);
});

test('attributs de <html> : aucun pour un cabinet qui n’a rien changé ; un attribut par réglage modifié ; style borné aux jetons calculés', () => {
  assert.deepEqual(attributsCabinet(PERSONNALISATION_DEFAUT, 'maison'), {});
  assert.deepEqual(attributsCabinet(undefined, 'maison'), {});
  const a = attributsCabinet({ accent: '#7fb3e0', police: 'moderne', taille: 'grand', forme: 'arrondi' }, 'maison');
  assert.deepEqual(Object.keys(a).sort(), ['data-cabinet-forme', 'data-cabinet-police', 'data-cabinet-taille', 'style']);
  assert.equal(a['data-cabinet-police'], 'moderne');
  assert.equal(a['data-cabinet-taille'], 'grand');
  assert.equal(a['data-cabinet-forme'], 'arrondi');
  assert.match(a.style, /^--accent:#7fb3e0;--accent-clair:#[0-9a-f]{6};--sur-accent:var\(--fond\);--filet:rgba\(127, 179, 224, 0\.26\);--courbe-valeur:#[0-9a-f]{6}$/);
  // Le thème choisi par le client final garde la priorité : pas d'accent du cabinet, le reste demeure.
  const b = attributsCabinet({ accent: '#7fb3e0', police: 'moderne', taille: 'standard', forme: 'anguleux' }, 'clair', false);
  assert.deepEqual(b, { 'data-cabinet-police': 'moderne' });
  // Un accent devenu illisible sur le thème en vigueur n'est pas posé.
  assert.equal(attributsCabinet({ ...PERSONNALISATION_DEFAUT, accent: '#7fb3e0' }, 'clair').style, undefined);
});

// ------------------------------------------------------------------ enregistrement, par cabinet

function deuxCabinets() {
  const db = baseNeuve();
  poserTenant(db, 'ta', 'Cabinet A', 'a.test');
  poserTenant(db, 'tb', 'Cabinet B', 'b.test');
  return db;
}
const lignes = (db: ReturnType<typeof baseNeuve>, t: string) =>
  Object.fromEntries(db.tous<{ cle: string; valeur: string }>("SELECT cle, valeur FROM reglage WHERE tenant_id = ? AND cle IN ('accent','police','taille_texte','forme_elements')", t).map((r) => [r.cle, r.valeur]));

test('enregistrement : valeurs valides mémorisées, retour au défaut = ligne retirée ; relues par le locataire de l’hôte', async () => {
  const db = deuxCabinets();
  assert.deepEqual(await enregistrerPersonnalisation(db, 'ta', formulaire({ accent: '#7FB3E0', police: 'editoriale', taille_texte: 'confortable', forme_elements: 'arrondi' })), {});
  assert.deepEqual(lignes(db, 'ta'), { accent: '#7fb3e0', police: 'editoriale', taille_texte: 'confortable', forme_elements: 'arrondi' });
  assert.deepEqual(await personnalisationDe(db, 'ta'), { accent: '#7fb3e0', police: 'editoriale', taille: 'confortable', forme: 'arrondi' });
  const t = (await tenantParHote(db, 'a.test'))!;
  assert.deepEqual(t.personnalisation, { accent: '#7fb3e0', police: 'editoriale', taille: 'confortable', forme: 'arrondi' });
  // Retour aux défauts : plus aucune ligne.
  assert.deepEqual(await enregistrerPersonnalisation(db, 'ta', formulaire(OK)), {});
  assert.deepEqual(lignes(db, 'ta'), {});
  assert.deepEqual((await tenantParHote(db, 'a.test'))!.personnalisation, PERSONNALISATION_DEFAUT);
});

test('enregistrement : couleur illisible et noms inconnus refusés, rien n’est écrit (tout ou rien)', async () => {
  const db = deuxCabinets();
  const e1 = await enregistrerPersonnalisation(db, 'ta', formulaire({ ...OK, accent: '#000000', police: 'moderne' }));
  assert.match(e1.accent, /illisible/);
  assert.deepEqual(lignes(db, 'ta'), {}, 'la police valide n’est pas écrite non plus');
  assert.match((await enregistrerPersonnalisation(db, 'ta', formulaire({ ...OK, accent: 'rouge' }))).accent, /#RRGGBB/);
  assert.ok((await enregistrerPersonnalisation(db, 'ta', formulaire({ ...OK, police: 'comic-sans' }))).police);
  assert.ok((await enregistrerPersonnalisation(db, 'ta', formulaire({ ...OK, taille_texte: '300%' }))).taille_texte);
  assert.ok((await enregistrerPersonnalisation(db, 'ta', formulaire({ ...OK, forme_elements: 'cercle' }))).forme_elements);
  assert.ok((await enregistrerPersonnalisation(db, 'ta', formulaire({ accent: '', police: '', taille_texte: '', forme_elements: '' }))).police, 'un champ vide n’est pas une option');
  assert.deepEqual(lignes(db, 'ta'), {});
  // « Utiliser la couleur proche » enregistre la couleur acceptable la plus proche, pas la saisie.
  const r = await enregistrerPersonnalisation(db, 'ta', formulaire({ ...OK, accent: '#000000', utiliser_proche: '1' }));
  assert.deepEqual(r, {});
  assert.equal(lignes(db, 'ta').accent, couleurProche('#000000', 'maison'));
});

test('l’accent est mesuré sur le thème en vigueur du cabinet ; changer de thème qui le rendrait illisible est refusé', async () => {
  const db = deuxCabinets();
  db.exec("INSERT INTO reglage (tenant_id, cle, valeur) VALUES ('ta', 'theme', 'clair')");
  assert.match((await enregistrerPersonnalisation(db, 'ta', formulaire({ ...OK, accent: '#7fb3e0' }))).accent, /illisible/, 'trop clair sur fond ivoire');
  assert.deepEqual(await enregistrerPersonnalisation(db, 'ta', formulaire({ ...OK, accent: '#1f5f8b' })), {});
  const f = formulaire({ nom_affiche: '', theme: 'nuit' });
  assert.match((await enregistrerIdentite(db, 'ta', f)).theme, /pas lisible sur ce thème/);
  assert.equal(db.un<{ valeur: string }>("SELECT valeur FROM reglage WHERE tenant_id = 'ta' AND cle = 'theme'")!.valeur, 'clair', 'le thème n’a pas changé');
});

test('cloisonnement : les réglages d’un cabinet ne touchent jamais ceux d’un autre', async () => {
  const db = deuxCabinets();
  await enregistrerPersonnalisation(db, 'ta', formulaire({ accent: '#7fb3e0', police: 'moderne', taille_texte: 'grand', forme_elements: 'arrondi' }));
  assert.deepEqual(lignes(db, 'tb'), {});
  assert.deepEqual((await tenantParHote(db, 'b.test'))!.personnalisation, PERSONNALISATION_DEFAUT);
  await enregistrerPersonnalisation(db, 'tb', formulaire({ ...OK, police: 'editoriale' }));
  assert.equal(lignes(db, 'ta').police, 'moderne');
  assert.equal((await tenantParHote(db, 'b.test'))!.personnalisation!.police, 'editoriale');
  // Une valeur inconnue déjà en base (modification directe) ne casse pas la page : défaut.
  db.exec("UPDATE reglage SET valeur = 'xyz' WHERE tenant_id = 'ta' AND cle = 'police'");
  assert.equal((await tenantParHote(db, 'a.test'))!.personnalisation!.police, 'classique');
});

test('rôle : seuls l’associé (et le support de l’éditeur) ouvrent les réglages, donc la personnalisation', () => {
  assert.equal(aLeRole('associe', REGLAGES), true);
  for (const r of ['collaborateur', 'lecture', 'viewer'] as const) assert.equal(aLeRole(r, REGLAGES), false, r);
  const page = readFileSync('src/pages/gestionnaire/reglages.astro', 'utf8');
  assert.match(page, /contexte\(Astro, \{ reglages: true \}\)/, 'la page entière est gardée par le rôle des réglages');
  assert.match(page, /action === 'personnalisation'/);
});

// ------------------------------------------------------------------ rendu sur les quatre gabarits

test('les quatre gabarits posent les attributs de personnalisation sur <html>, à la suite du thème', () => {
  for (const g of ['Public', 'Viewer', 'Gestion', 'Connexion']) {
    const src = readFileSync(`src/layouts/${g}.astro`, 'utf8');
    assert.match(src, /import \{ attributsCabinet \} from '..\/lib\/personnalisation'/, g);
    assert.match(src, /<html [^>]*data-cabinet-theme=\{[^}]+\}[^>]*\{\.\.\.attributsCabinet\(Astro\.locals\.tenant\?\.personnalisation, /, g);
  }
  // Espace client : le choix de thème du client final garde la priorité sur l'accent du cabinet.
  assert.match(readFileSync('src/layouts/Viewer.astro', 'utf8'), /attributsCabinet\(Astro\.locals\.tenant\?\.personnalisation, theme, choixClient === null\)/);
});

test('feuille de style : un bloc par option, aucune couleur littérale, aucun domaine externe', () => {
  const css = readFileSync('src/styles/app.css', 'utf8');
  const bloc = css.slice(css.indexOf('personnalisation du cabinet (22/11/2026)'), css.indexOf('*, *::before, *::after {'));
  for (const sel of ['[data-cabinet-police="moderne"]', '[data-cabinet-police="editoriale"]', '[data-cabinet-taille="confortable"]', '[data-cabinet-taille="grand"]', '[data-cabinet-forme="arrondi"]']) {
    assert.ok(bloc.includes(`html${sel}`), sel);
  }
  assert.doesNotMatch(bloc.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,6}\b|rgb|hsl|url\(|https?:/, 'aucune couleur ni URL');
  assert.doesNotMatch(css, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(css, /--rayon: 0;/);
});
