// Marque Labije Cab / Labije Software et mentions de la plateforme (22/11/2026) : jetons de marque, pied de page, page /plateforme, identité de l'éditeur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { baseNeuve } from './support/d1.ts';
import { cabinetEditeur, creerCabinet, ouvrirSession } from './support/monde.ts';
import { dernier, envoyer, environnement, reseau } from './support/serveur.ts';
import { THEMES } from '../src/lib/themes';
import { contraste } from '../src/lib/personnalisation';
import { CHAMPS_PLATEFORME, identitePlateforme, identitePlateformeManquante, lignesPlateforme, poserIdentitePlateforme } from '../src/lib/plateforme';

const form = (o: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const EDITEUR = { id: 'u-editeur', role: 'editeur' };
const COMPLET = {
  raison_sociale: 'Labije Software SAS', forme_juridique: 'SAS', capital: '1 000 euros', siren: '443 061 841', siege: '1 rue du Test\n75001 Paris',
  directeur_publication: 'Une Personne', contact: 'contact@labije.test', hebergeur: 'Cloudflare, Inc.',
};

// ------------------------------------------------------------------ les jetons de marque

test('jetons : --marque-encre et --marque-rouille existent dans les cinq thèmes (et le repli), avec les couleurs du pack', () => {
  const css = readFileSync('src/styles/app.css', 'utf8');
  const bloc = (t: string) => css.slice(css.indexOf(`:root[data-cabinet-theme="${t}"]`)).split('\n}')[0];
  for (const t of THEMES) {
    const b = bloc(t.id);
    const [encre, rouille] = t.sombre ? ['#f7f5f1', '#d98a5c'] : ['#16242f', '#9e4e2f'];
    assert.ok(b.includes(`--marque-encre: ${encre};`) && b.includes(`--marque-rouille: ${rouille};`), t.id);
    // Un élément graphique secondaire : 3:1 au moins, sur le fond ET sur les surfaces du thème.
    for (const c of [encre, rouille]) for (const f of [t.fond, t.marine]) assert.ok(contraste(c, f) >= 3, `${t.id} ${c} sur ${f}`);
  }
  assert.match(css.split('\n}')[0], /--marque-encre: #f7f5f1;/, 'le repli (:root) vaut le thème maison');
});

test('logos : les quatre SVG du pack sont dans public/marque ; leurs seules couleurs sont celles que le composant remplace par les jetons', () => {
  const fichiers = readdirSync('public/marque');
  for (const f of ['labije-cab-horizontale-couleur.svg', 'labije-software-horizontale-couleur.svg', 'labije-cab-horizontale-reserve.svg', 'labije-software-horizontale-reserve.svg', 'LISEZ-MOI.md']) assert.ok(fichiers.includes(f), f);
  for (const f of ['labije-cab-horizontale-couleur.svg', 'labije-software-horizontale-couleur.svg']) {
    const couleurs = new Set(readFileSync(`public/marque/${f}`, 'utf8').match(/#[0-9A-Fa-f]{6}/g));
    assert.deepEqual([...couleurs].sort(), ['#16242F', '#9E4E2F'], f);
  }
  const c = readFileSync('src/components/MarqueLabije.astro', 'utf8');
  assert.match(c, /variante = 'cab'/);
  assert.match(c, /replaceAll\('#16242F', 'var\(--marque-encre\)'\)/);
  assert.match(c, /replaceAll\('#9E4E2F', 'var\(--marque-rouille\)'\)/);
  assert.match(c, /role="img"/);
  assert.match(c, /<title>\{nom\}<\/title>/);
  assert.match(c, /Math\.max\(110,/, 'jamais en dessous de 110 px de large');
  assert.doesNotMatch(c, /<img/, 'SVG en ligne, pas une balise img');
});

// ------------------------------------------------------------------ le pied de page

test('pied de page : dans l’espace gestionnaire, l’espace client et la connexion ; jamais sur le site public ; logo dans la console de l’éditeur', () => {
  const lire = (g: string) => readFileSync(`src/layouts/${g}.astro`, 'utf8');
  assert.match(lire('Gestion'), /\{!admin && <PiedMarque \/>\}/);
  assert.match(lire('Viewer'), /<PiedMarque \/>/);
  assert.match(lire('Connexion'), /\{pied && <PiedMarque \/>\}/);
  assert.match(lire('Connexion'), /pied = true/, 'affiché par défaut');
  assert.doesNotMatch(lire('Public'), /PiedMarque|MarqueLabije|Labije Software/, 'rien sur le site public du cabinet');
  assert.match(lire('Gestion'), /admin \? <span class="gest-marque-console"><MarqueLabije variante="cab"/);
  const pied = readFileSync('src/components/PiedMarque.astro', 'utf8');
  assert.match(pied, /Labije Cab, un logiciel de Labije Software/);
  assert.match(pied, /href="\/plateforme">Mentions de la plateforme/);
  assert.match(pied, /<MarqueLabije variante="cab"/);
  // Pas de marque blanche : aucun réglage ne masque la marque.
  assert.doesNotMatch(readFileSync('src/lib/personnalisation.ts', 'utf8') + readFileSync('src/lib/reglages.ts', 'utf8'), /marque_masqu|masquer_marque|marque_blanche/i);
});

// ------------------------------------------------------------------ la page /plateforme

test('/plateforme : 200 sans session sur tout hôte de cabinet (même sans module), les seules lignes renseignées, rien d’un cabinet', async () => {
  reseau.vider();
  const db = baseNeuve();
  const a = creerCabinet(db, 'A', { contrat: { module_pilotage: 0, module_site: 0 } });
  const b = creerCabinet(db, 'B');
  const env = environnement(db);
  // Rien de renseigné : la page répond, sans ligne (jamais « à compléter » devant un client).
  let r = await envoyer(env, { url: '/plateforme', hote: a.hote });
  assert.equal(r.statut, 200);
  assert.deepEqual(dernier.rendu?.lignes, []);
  // Deux champs seulement.
  assert.deepEqual(await poserIdentitePlateforme(db, form({ ...Object.fromEntries(CHAMPS_PLATEFORME.map((c) => [c.champ, ''])), raison_sociale: 'Labije Software SAS', siren: '443061841' }), EDITEUR), { ok: true });
  for (const hote of [a.hote, b.hote]) {
    r = await envoyer(env, { url: '/plateforme', hote });
    assert.equal(r.statut, 200, hote);
    assert.deepEqual(dernier.rendu?.lignes, [
      { libelle: 'Raison sociale', valeur: 'Labije Software SAS', long: false },
      { libelle: 'SIREN', valeur: '443 061 841', long: false },
    ], 'identiques chez chaque cabinet : la page ne lit aucune donnée du cabinet');
  }
  // Un hôte qui ne désigne aucun cabinet : la page reste publique.
  assert.equal((await envoyer(env, { url: '/plateforme', hote: 'inconnu.test' })).statut, 200);
  // Avec la session d'un autre cabinet, elle n'est ni fermée ni redirigée.
  assert.equal((await envoyer(env, { url: '/plateforme', hote: a.hote, cookie: ouvrirSession(db, b.associe) })).statut, 200);
});

test('/plateforme : le contenu des réglages est du texte, jamais du HTML (échappé par le gabarit)', async () => {
  const src = readFileSync('src/pages/plateforme.astro', 'utf8');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /set:html|innerHTML/, 'aucun HTML injecté depuis les réglages');
  assert.match(src, /à faire valider par un juriste/i);
  assert.match(src, /Labije Cab est un logiciel édité par Labije Software\./);
  assert.match(src, /Labije Cab est un outil mis à disposition de votre cabinet : le conseil est fourni par votre cabinet, pas par Labije Software\./);
  assert.match(src, /sous-traitant/);
  // La valeur n'est pas transformée : le gabarit reçoit la chaîne telle quelle et l'échappe à l'affichage.
  const db = baseNeuve();
  await poserIdentitePlateforme(db, form({ ...COMPLET, raison_sociale: '<script>alert(1)</script>' }), EDITEUR);
  assert.equal(lignesPlateforme(await identitePlateforme(db))[0].valeur, '<script>alert(1)</script>');
});

// ------------------------------------------------------------------ l'identité de l'éditeur

test('identité : l’éditeur seul l’enregistre ; champs bornés, SIREN et e-mail contrôlés, tout ou rien ; vide = retirée ; la console signale l’incomplet', async () => {
  const db = baseNeuve();
  assert.deepEqual(identitePlateformeManquante(await identitePlateforme(db)).length, CHAMPS_PLATEFORME.length);
  for (const role of ['associe', 'collaborateur', 'lecture', 'viewer', 'support_editeur']) assert.deepEqual(await poserIdentitePlateforme(db, form(COMPLET), { id: 'x', role }), { ok: false, code: 'interdit' }, role);
  assert.equal(db.compte('reglage_editeur', "cle LIKE 'plateforme_%'"), 0);
  const refus = async (o: Record<string, string>) => poserIdentitePlateforme(db, form({ ...COMPLET, ...o }), EDITEUR) as Promise<{ ok: false; code: string; erreurs: Record<string, string> }>;
  assert.ok((await refus({ siren: '443061842' })).erreurs.siren, 'clé de contrôle fausse');
  assert.ok((await refus({ contact: 'pas-un-courriel' })).erreurs.contact);
  assert.ok((await refus({ raison_sociale: 'x'.repeat(121) })).erreurs.raison_sociale);
  assert.ok((await refus({ siege: 'x'.repeat(301) })).erreurs.siege);
  assert.equal(db.compte('reglage_editeur', "cle LIKE 'plateforme_%'"), 0, 'tout ou rien');
  assert.deepEqual(await poserIdentitePlateforme(db, form(COMPLET), EDITEUR), { ok: true });
  const v = await identitePlateforme(db);
  assert.equal(v.siren, '443061841');
  assert.deepEqual(identitePlateformeManquante(v), []);
  assert.equal(lignesPlateforme(v).length, 8);
  assert.equal(lignesPlateforme(v).find((l) => l.libelle === 'SIREN')!.valeur, '443 061 841');
  assert.deepEqual(await poserIdentitePlateforme(db, form({ ...COMPLET, capital: '', hebergeur: '' }), EDITEUR), { ok: true });
  assert.deepEqual(identitePlateformeManquante(await identitePlateforme(db)), ['Capital social', 'Hébergeur']);
});

test('console : /admin/reglages est réservée à l’éditeur (un gestionnaire reçoit un refus et rien n’est écrit) ; elle avertit quand l’identité est incomplète', async () => {
  reseau.vider();
  const db = baseNeuve();
  const a = creerCabinet(db, 'A');
  const ed = cabinetEditeur(db);
  const env = environnement(db);
  const r = await envoyer(env, { methode: 'POST', url: '/admin/reglages', hote: a.hote, cookie: ouvrirSession(db, a.associe), formulaire: { action: 'plateforme', ...COMPLET } });
  assert.ok([403, 302, 303, 404].includes(r.statut) && r.statut !== 200, `statut ${r.statut}`);
  assert.equal(db.compte('reglage_editeur', "cle LIKE 'plateforme_%'"), 0);
  const page = readFileSync('src/pages/admin/reglages.astro', 'utf8');
  assert.match(page, /Identité de la plateforme incomplète/);
  const e = await envoyer(env, { methode: 'POST', url: '/admin/reglages', hote: ed.hote, cookie: ouvrirSession(db, ed.editeur), formulaire: { action: 'plateforme', ...COMPLET } });
  assert.equal(e.statut, 200);
  assert.equal(db.compte('reglage_editeur', "cle LIKE 'plateforme_%'"), 8);
});
