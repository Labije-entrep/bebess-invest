// 1. Cloisonnement entre locataires. Trois cabinets (A, B, C), chacun avec un exemplaire de chaque ressource ; chaque cabinet tente,
// avec une session valide chez lui, de lire et d'écrire sur les ressources des deux autres.
//
// Attendu : 404 (jamais 403), la même réponse qu'un identifiant qui n'existe pas, et AUCUNE ligne modifiée (empreinte intégrale de la
// base avant et après, objets R2 compris). Tout passe par la chaîne réelle : Worker, contrôle d'origine d'Astro, middleware, route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve, empreinte } from './support/d1.ts';
import { ouvrirSession, poserFichiers, troisCabinets, type Cabinet, type Cle } from './support/monde.ts';
import { envoyer, environnement, dernier, type Reponse } from './support/serveur.ts';
import { appartient, type Ressource } from '../src/lib/cloisonnement';
import { traiter } from '../src/lib/gestion';
import { documentAccessible } from '../src/lib/fichiers';
import { ENTITES, lire } from '../src/lib/api-suivi';

const CLES: Cle[] = ['A', 'B', 'C'];
const PAIRES: [Cle, Cle][] = CLES.flatMap((x) => CLES.filter((y) => y !== x).map((y) => [x, y] as [Cle, Cle]));

async function monde() {
  const db = baseNeuve();
  const cab = troisCabinets(db);
  const env = environnement(db);
  for (const c of Object.values(cab)) await poserFichiers(env.FICHIERS, c);
  const cookie = (c: Cabinet, qui: 'associe' | 'collaborateur' | 'lecture' | 'viewerCompte' | 'viewer2Compte' = 'associe') => ouvrirSession(db, c[qui]);
  return { db, cab, env, cookie };
}

/** Ce que voit un attaquant doit être indiscernable de ce que voit celui qui vise un identifiant qui n'existe pas. */
const memeReponse = (a: Reponse, b: Reponse, quoi: string): void => {
  assert.equal(a.statut, b.statut, `${quoi} : statut`);
  assert.equal(a.location, b.location, `${quoi} : redirection`);
  assert.equal(a.texte, b.texte, `${quoi} : corps`);
};

// ------------------------------------------------------------------ la table de contrôle, ressource par ressource

const RESSOURCES: [Ressource, (c: Cabinet) => string][] = [
  ['viewer', (c) => c.donnees.viewer],
  ['enveloppe', (c) => c.donnees.enveloppe],
  ['ligne', (c) => c.donnees.ligne],
  ['cible', (c) => c.donnees.cible],
  ['point', (c) => c.donnees.point],
  ['mouvement', (c) => c.donnees.mouvement],
  ['document', (c) => c.donnees.document],
  ['note', (c) => c.donnees.note],
  ['contact', (c) => c.donnees.contact],
  ['sujet', (c) => c.donnees.sujet],
  ['echange', (c) => c.donnees.echange],
  ['membre', (c) => c.donnees.membre],
  ['document_interne', (c) => c.donnees.documentInterne],
  ['actu', (c) => c.donnees.actu],
];

test('appartient : chaque ressource est à son cabinet et à lui seul (14 types × 3 cabinets)', async () => {
  const { db, cab } = await monde();
  for (const [ressource, id] of RESSOURCES) {
    for (const x of CLES) {
      for (const y of CLES) {
        const attendu = x === y;
        assert.equal(await appartient(db, cab[x].id, ressource, id(cab[y])), attendu, `${ressource} de ${y} vu depuis ${x}`);
      }
    }
    assert.equal(await appartient(db, cab.A.id, ressource, 'inconnu'), false, `${ressource} inconnu`);
    assert.equal(await appartient(db, '', ressource, id(cab.A)), false, `${ressource} sans locataire`);
    assert.equal(await appartient(db, cab.A.id, ressource, ''), false, `${ressource} sans identifiant`);
  }
});

// Les lectures « de seconde ligne » : derrière la garde de la route, chacune borne aussi, pour elle-même, au locataire. Une garde retirée
// par erreur ne doit pas suffire à ouvrir la porte : on les interroge directement.
test('lectures de seconde ligne : chacune borne au locataire à elle seule', async () => {
  const { db, cab } = await monde();
  for (const [x, y] of PAIRES) {
    const appel = { db, tenant: { id: cab[x].id } as never, utilisateur: { id: cab[x].associe.id, role: 'associe' } as never };
    for (const [nom, entite, id] of [['contact', ENTITES.contact, cab[y].donnees.contact], ['sujet', ENTITES.sujet, cab[y].donnees.sujet], ['échange', ENTITES.echange, cab[y].donnees.echange]] as const) {
      assert.equal(await lire(appel, entite, id), null, `${nom} de ${y} lu pour ${x}`);
    }
    assert.ok(await lire(appel, ENTITES.contact, cab[x].donnees.contact), 'le sien se lit');
    // Un rapport : le personnel d'un autre cabinet, le client d'un autre cabinet, un autre client du même cabinet.
    const personnel = { id: cab[x].associe.id, role: 'associe' };
    assert.equal(await documentAccessible(db, cab[x].id, personnel, cab[y].donnees.document), null);
    assert.equal(await documentAccessible(db, cab[x].id, { id: cab[x].viewer2Compte.id, role: 'viewer' }, cab[x].donnees.document), null, 'un autre client du même cabinet');
    assert.equal(await documentAccessible(db, cab[x].id, { id: cab[x].viewerCompte.id, role: 'viewer' }, cab[x].donnees.document).then((d) => d?.id), cab[x].donnees.document);
    assert.equal(await documentAccessible(db, cab[x].id, personnel, cab[x].donnees.document2).then((d) => d?.id), cab[x].donnees.document2, 'le personnel lit les rapports de tout son cabinet');
  }
});

// ------------------------------------------------------------------ lectures croisées

test('lectures croisées : 404 pour chaque ressource d\'un autre cabinet, identique à un identifiant inconnu', async () => {
  const { cab, env, cookie, db } = await monde();
  const avant = empreinte(db);
  for (const [x, y] of PAIRES) {
    const c = cookie(cab[x]);
    const d = cab[y].donnees;
    const lectures: [string, string, string][] = [
      ['fiche contact', `/gestionnaire/suivi/${d.contact}`, '/gestionnaire/suivi/inconnu'],
      ['fiche viewer', `/gestionnaire/viewers/${d.viewer}`, '/gestionnaire/viewers/inconnu'],
      ['export du contact', `/gestionnaire/export/contact/${d.contact}`, '/gestionnaire/export/contact/inconnu'],
      ['logo du contact', `/fichiers/contact/${d.contact}`, '/fichiers/contact/inconnu'],
      ['rapport (document)', `/fichiers/document/${d.document}`, '/fichiers/document/inconnu'],
    ];
    for (const [quoi, cible, inconnu] of lectures) {
      const r = await envoyer(env, { url: cible, hote: cab[x].hote, cookie: c });
      const i = await envoyer(env, { url: inconnu, hote: cab[x].hote, cookie: c });
      assert.equal(r.statut, 404, `${x} lit ${quoi} de ${y} : 404 attendu, jamais 403`);
      assert.notEqual(r.statut, 403);
      memeReponse(r, i, `${x} → ${y}, ${quoi}`);
    }
  }
  assert.equal(empreinte(db), avant, 'une lecture ne modifie rien');
});

test('lectures croisées : l\'état du suivi d\'un cabinet ne contient rien d\'un autre', async () => {
  const { cab, env, cookie } = await monde();
  for (const x of CLES) {
    const r = await envoyer(env, { url: '/api/suivi/etat', hote: cab[x].hote, cookie: cookie(cab[x]) });
    assert.equal(r.statut, 200);
    for (const y of CLES.filter((k) => k !== x)) {
      const d = cab[y].donnees;
      for (const marque of [d.contact, d.contactViewer, d.sujet, d.echange, d.membre, d.viewer, cab[y].id, `Contact ${y}`, `Sujet ${y}`, `Note ${y}`]) {
        assert.ok(!r.texte.includes(marque), `l'état de ${x} laisse voir « ${marque} » (cabinet ${y})`);
      }
    }
    assert.ok(r.texte.includes(cab[x].donnees.contact), `l'état de ${x} montre ses propres contacts`);
  }
});

test('espace client : un viewer ne lit que son dossier, jamais celui d\'un autre cabinet ni d\'un autre client du sien', async () => {
  const { cab, env, cookie, db } = await monde();
  const avant = empreinte(db, ['consultation']);
  for (const [x, y] of PAIRES) {
    const c = cookie(cab[x], 'viewerCompte');
    // Un portefeuille d'un autre cabinet, passé dans l'adresse (?p=), vaut « Tout » : rien de l'autre ne remonte.
    for (const page of ['/espace', '/espace/portefeuille', '/espace/mouvements', '/espace/rapports']) {
      const r = await envoyer(env, { url: `${page}?p=${cab[y].donnees.portefeuille}`, hote: cab[x].hote, cookie: c });
      assert.equal(r.statut, 200, `${x} ouvre ${page}`);
      const vu = JSON.stringify(dernier.rendu ?? {});
      for (const marque of [cab[y].donnees.enveloppe, cab[y].donnees.portefeuille, cab[y].donnees.mouvement, cab[y].donnees.document, `Versement ${y}`, `Rapport ${y}`]) {
        assert.ok(!vu.includes(marque), `${x} sur ${page} : « ${marque} » (cabinet ${y}) ne doit pas remonter`);
      }
    }
    // Ses rapports à lui, oui ; ceux d'un autre cabinet, 404.
    assert.equal((await envoyer(env, { url: `/fichiers/document/${cab[x].donnees.document}`, hote: cab[x].hote, cookie: c })).statut, 200);
    assert.equal((await envoyer(env, { url: `/fichiers/document/${cab[y].donnees.document}`, hote: cab[x].hote, cookie: c })).statut, 404);
  }
  // Même cabinet, autre client : son rapport est à un autre dossier, 404.
  for (const x of CLES) {
    const c = cookie(cab[x], 'viewerCompte');
    const r = await envoyer(env, { url: `/fichiers/document/${cab[x].donnees.document2}`, hote: cab[x].hote, cookie: c });
    assert.equal(r.statut, 404, `${x} : un client ne lit pas le rapport d'un autre client du même cabinet`);
    const vu = await envoyer(env, { url: `/espace/rapports?p=${cab[x].donnees.portefeuille3}`, hote: cab[x].hote, cookie: c });
    assert.equal(vu.statut, 200);
    assert.ok(!JSON.stringify(dernier.rendu).includes(cab[x].donnees.document2), `${x} : le rapport de l'autre client ne remonte pas dans la liste`);
  }
  assert.equal(empreinte(db, ['consultation']), avant);
});

test('session d\'un cabinet présentée à l\'hôte d\'un autre : aucune session', async () => {
  const { cab, env, cookie } = await monde();
  for (const [x, y] of PAIRES) {
    const c = cookie(cab[x]);
    const api = await envoyer(env, { url: '/api/suivi/etat', hote: cab[y].hote, cookie: c });
    assert.equal(api.statut, 401, `${x} → hôte de ${y} : API`);
    const page = await envoyer(env, { url: '/gestionnaire/suivi', hote: cab[y].hote, cookie: c });
    assert.equal(page.statut, 302);
    assert.equal(page.location, '/connexion');
    const espace = await envoyer(env, { url: '/espace', hote: cab[y].hote, cookie: ouvrirSession(env.DB, cab[x].viewerCompte) });
    assert.equal(espace.location, '/connexion', `${x} → hôte de ${y} : espace client`);
  }
  const inconnu = await envoyer(env, { url: '/api/suivi/etat', hote: 'inconnu.test', cookie: cookie(cab.A) });
  assert.equal(inconnu.statut, 401, 'un hôte qui ne désigne aucun cabinet n\'ouvre rien');
});

// ------------------------------------------------------------------ écritures croisées

test('écritures croisées sur l\'API du suivi : 404 ou refus, jamais 403, aucune ligne modifiée', async () => {
  const { cab, env, cookie, db } = await monde();
  const avant = empreinte(db);
  for (const [x, y] of PAIRES) {
    const c = cookie(cab[x]);
    const d = cab[y].donnees;
    const nous = cab[x].donnees;
    // Une écriture sans corps JSON est refusée en 415 avant tout (le client du suivi n'envoie jamais de DELETE) : on envoie un corps vide.
    const ecrire = (methode: string, url: string, json: unknown = {}) => envoyer(env, { methode, url, hote: cab[x].hote, cookie: c, json });

    const par404: [string, Reponse][] = [
      ['PATCH contact', await ecrire('PATCH', `/api/suivi/contact/${d.contact}`, { nom: 'Piraté' })],
      ['DELETE contact', await ecrire('DELETE', `/api/suivi/contact/${d.contact}`)],
      ['PATCH sujet', await ecrire('PATCH', `/api/suivi/sujet/${d.sujet}`, { texte: 'Piraté' })],
      ['DELETE sujet', await ecrire('DELETE', `/api/suivi/sujet/${d.sujet}`)],
      ['PATCH échange', await ecrire('PATCH', `/api/suivi/echange/${d.echange}`, { note: 'Piraté' })],
      ['DELETE échange', await ecrire('DELETE', `/api/suivi/echange/${d.echange}`)],
      ['POST sujet sur un contact étranger', await ecrire('POST', '/api/suivi/sujet', { contact_id: d.contact, texte: 'Piraté', statut: 'afaire' })],
      ['POST échange sur un contact étranger', await ecrire('POST', '/api/suivi/echange', { contact_id: d.contact, date: '2026-06-01', type: 'tel' })],
    ];
    for (const [quoi, r] of par404) {
      assert.equal(r.statut, 404, `${x} → ${y} : ${quoi}`);
      assert.deepEqual(r.json.erreur === undefined, false);
    }
    // Un parent étranger glissé dans une écriture sur SES propres données : refusé (422), et c'est le même refus qu'un identifiant inconnu.
    const refuses: [string, Reponse, Reponse][] = [
      ['apporteur à la création', await ecrire('POST', '/api/suivi/contact', { nom: 'X', apporteur_id: d.contact }), await ecrire('POST', '/api/suivi/contact', { nom: 'X', apporteur_id: 'inconnu' })],
      ['responsable à la création', await ecrire('POST', '/api/suivi/contact', { nom: 'X', responsable_id: d.membre }), await ecrire('POST', '/api/suivi/contact', { nom: 'X', responsable_id: 'inconnu' })],
      ['apporteur en modification', await ecrire('PATCH', `/api/suivi/contact/${nous.contact}`, { apporteur_id: d.contact }), await ecrire('PATCH', `/api/suivi/contact/${nous.contact}`, { apporteur_id: 'inconnu' })],
      ['binôme en modification', await ecrire('PATCH', `/api/suivi/contact/${nous.contact}`, { binome_id: d.membre }), await ecrire('PATCH', `/api/suivi/contact/${nous.contact}`, { binome_id: 'inconnu' })],
    ];
    for (const [quoi, r, i] of refuses) {
      assert.equal(r.statut, 422, `${x} → ${y} : ${quoi}`);
      assert.notEqual(r.statut, 403);
      assert.equal(r.texte, i.texte, `${x} → ${y} : ${quoi} indiscernable d'un identifiant inconnu`);
    }
  }
  assert.equal(empreinte(db), avant, 'aucune ligne n\'a bougé après toutes ces écritures refusées');
});

test('écritures croisées sur la passerelle, les fichiers et l\'export : 404, rien n\'est écrit, R2 intact', async () => {
  const { cab, env, cookie, db } = await monde();
  const avant = empreinte(db);
  const objets = [...env.FICHIERS.objets.keys()].sort();
  const pdf = (): FormData => {
    const f = new FormData();
    f.set('titre', 'Piraté');
    f.set('categorie', 'reglementaire');
    f.set('date', '2026-06-01');
    f.set('fichier', new Blob(['%PDF-1.4 pirate'], { type: 'application/pdf' }), 'p.pdf');
    return f;
  };
  const logo = (): FormData => {
    const f = new FormData();
    f.set('fichier', new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], { type: 'image/png' }), 'l.png');
    return f;
  };
  for (const [x, y] of PAIRES) {
    const c = cookie(cab[x]);
    const d = cab[y].donnees;
    const poster = (url: string, extra: Partial<Parameters<typeof envoyer>[1]> = {}) =>
      envoyer(env, { methode: 'POST', url, hote: cab[x].hote, cookie: c, formulaire: {}, ...extra });
    const essais: [string, Reponse][] = [
      ['note depuis l\'actu', await poster(`/gestionnaire/passerelle/note/${d.actu}`)],
      ['promotion du contact', await poster(`/gestionnaire/passerelle/promotion/${d.contact}`)],
      ['sujet depuis le portail', await poster(`/gestionnaire/passerelle/sujet/${d.contact}`, { formulaire: { type: 'ecart', cle: 'actions' } })],
      ['rattacher un rapport', await poster(`/gestionnaire/fichiers/rattacher/${d.document}`, { formulaire: { portefeuille_id: '' } })],
      ['supprimer un rapport', await poster(`/gestionnaire/fichiers/supprimer/${d.document}`)],
      ['déposer un rapport chez un viewer étranger', await poster(`/gestionnaire/fichiers/document?viewer_id=${d.viewer}`, { formulaire: undefined, multipart: pdf() })],
      ['logo d\'un contact étranger', await poster(`/gestionnaire/fichiers/logo-contact/${d.contact}`, { formulaire: undefined, multipart: logo() })],
      ['fiche d\'un viewer étranger (POST)', await poster(`/gestionnaire/viewers/${d.viewer}`, { formulaire: { action: 'pf_creer', libelle: 'Piraté', type: 'personne' } })],
      ['arrêté chez un viewer étranger', await poster(`/gestionnaire/viewers/${d.viewer}`, { formulaire: { action: 'mouvement', date: '2026-06-01', libelle: 'Piraté', statut: 'execute' } })],
    ];
    for (const [quoi, r] of essais) {
      assert.equal(r.statut, 404, `${x} → ${y} : ${quoi}`);
      assert.notEqual(r.statut, 403, `${x} → ${y} : ${quoi}`);
    }
  }
  assert.equal(empreinte(db), avant, 'aucune ligne n\'a bougé');
  assert.deepEqual([...env.FICHIERS.objets.keys()].sort(), objets, 'aucun objet R2 déposé ni supprimé');
});

test('sous-ressources étrangères glissées dans une fiche viewer du bon cabinet : refusées, rien n\'est modifié', async () => {
  const { cab, env, cookie, db } = await monde();
  const avant = empreinte(db);
  for (const [x, y] of PAIRES) {
    const c = cookie(cab[x]);
    const d = cab[y].donnees;
    const route = `/gestionnaire/viewers/${cab[x].donnees.viewer}`;
    const cas: [string, Record<string, string>][] = [
      ['supprimer le point d\'un autre cabinet', { action: 'suppr_point', id: d.point }],
      ['supprimer le mouvement d\'un autre cabinet', { action: 'suppr_mouvement', id: d.mouvement }],
      ['modifier l\'enveloppe d\'un autre cabinet', { action: 'enveloppes', n: '1', r0_id: d.enveloppe, r0_libelle: 'Piraté', r0_valo: '1' }],
      ['modifier la ligne d\'un autre cabinet', { action: 'lignes', n: '1', r0_id: d.ligne, r0_libelle: 'Piraté', r0_valo: '1' }],
    ];
    for (const [quoi, formulaire] of cas) {
      const r = await envoyer(env, { url: route, hote: cab[x].hote, cookie: c, formulaire });
      assert.equal(r.statut, 200, `${x} → ${y} : ${quoi}`);
      assert.equal((dernier.rendu?.erreurs as Record<string, string>)?.general, 'Accès refusé.', `${x} → ${y} : ${quoi} doit être refusé`);
    }
    // Un portefeuille d'un autre cabinet visé par le champ « pf » : inconnu pour ce viewer.
    const pf = await envoyer(env, { url: route, hote: cab[x].hote, cookie: c, formulaire: { action: 'enveloppes', pf: d.portefeuille, n: '0' } });
    assert.equal((dernier.rendu?.erreurs as Record<string, string>)?.general, 'Portefeuille inconnu pour ce viewer.', `${x} → ${y} : pf étranger`);
    assert.equal(pf.statut, 200);
  }
  assert.equal(empreinte(db), avant);
});

test('un client d\'un cabinet n\'écrit pas sur les données d\'un autre client du même cabinet (traiter)', async () => {
  const { cab, db } = await monde();
  const A = cab.A;
  const avant = empreinte(db);
  // Le viewer 1 est le viewer actif ; les identifiants visés sont ceux du viewer 2, du MÊME cabinet.
  const autres = A.donnees;
  const f = (o: Record<string, string>): FormData => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(o)) fd.set(k, v);
    return fd;
  };
  // On prend un point et un mouvement du viewer 2 : ils vivent dans le même locataire, mais dans un autre dossier.
  db.exec("INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES ('pt-v2', ?, '2026-05-31', 1000, 1000)", autres.portefeuille3);
  db.exec("INSERT INTO mouvement (id, viewer_id, date, libelle, statut) VALUES ('mv-v2', ?, '2026-05-31', 'Autre client', 'execute')", A.viewer2Compte.id);
  const apresPose = empreinte(db);
  const r1 = await traiter(db, A.id, autres.viewer, 'suppr_point', f({ id: 'pt-v2' }));
  const r2 = await traiter(db, A.id, autres.viewer, 'suppr_mouvement', f({ id: 'mv-v2' }));
  assert.ok(r1 && r2);
  assert.equal(empreinte(db), apresPose, 'le point et le mouvement de l\'autre client sont intacts');
  assert.ok(avant !== apresPose);
});

// ------------------------------------------------------------------ contenu du site

test('contenu du site : chaque cabinet ne modifie que ses pages et ses notes', async () => {
  const { cab, env, cookie, db } = await monde();
  const pageB = db.un('SELECT * FROM page_contenu WHERE id = ?', cab.B.donnees.pageContenu);
  const noteB = db.un('SELECT * FROM note_marche WHERE id = ?', cab.B.donnees.note);
  const pageC = db.un('SELECT * FROM page_contenu WHERE id = ?', cab.C.donnees.pageContenu);
  const noteC = db.un('SELECT * FROM note_marche WHERE id = ?', cab.C.donnees.note);

  // A modifie sa page d'accueil.
  const maj = await envoyer(env, { url: '/gestionnaire/contenus/accueil', hote: cab.A.hote, cookie: cookie(cab.A), formulaire: { meta_titre: 'Accueil modifié par A' } });
  assert.equal(maj.statut, 303);
  assert.equal(db.un<{ titre: string }>('SELECT titre FROM page_contenu WHERE id = ?', cab.A.donnees.pageContenu)?.titre, 'Accueil modifié par A');
  assert.deepEqual(db.un('SELECT * FROM page_contenu WHERE id = ?', cab.B.donnees.pageContenu), pageB, 'la page de B n\'a pas bougé');
  assert.deepEqual(db.un('SELECT * FROM page_contenu WHERE id = ?', cab.C.donnees.pageContenu), pageC);

  // A vise la note de B par son identifiant : même issue que pour une note inconnue, et la note de B est intacte.
  const piratage = await envoyer(env, {
    url: `/gestionnaire/notes/${cab.B.donnees.note}`, hote: cab.A.hote, cookie: cookie(cab.A),
    formulaire: { titre: 'Piratée', slug: 'note-b', date: '2026-06-01', corps_md: 'Piraté' },
  });
  const inconnue = await envoyer(env, {
    url: '/gestionnaire/notes/inconnue', hote: cab.A.hote, cookie: cookie(cab.A),
    formulaire: { titre: 'Piratée', slug: 'note-b', date: '2026-06-01', corps_md: 'Piraté' },
  });
  assert.notEqual(piratage.statut, 403);
  memeReponse(piratage, inconnue, 'note de B visée par A');
  assert.deepEqual(db.un('SELECT * FROM note_marche WHERE id = ?', cab.B.donnees.note), noteB, 'la note de B n\'a pas bougé');
  assert.deepEqual(db.un('SELECT * FROM note_marche WHERE id = ?', cab.C.donnees.note), noteC);
  assert.equal(db.compte('note_marche', "titre = 'Piratée'"), 0);

  // Le même slug, dans deux cabinets, est possible : l'unicité est par cabinet.
  const creation = await envoyer(env, {
    url: '/gestionnaire/notes/nouveau', hote: cab.A.hote, cookie: cookie(cab.A),
    formulaire: { titre: 'Note de A', slug: 'note-b', date: '2026-06-01', corps_md: 'Corps A' },
  });
  assert.equal(creation.statut, 303);
  assert.equal(db.compte('note_marche', "slug = 'note-b'"), 2, 'un slug identique vit dans deux cabinets sans collision');
  assert.deepEqual(db.un('SELECT * FROM note_marche WHERE id = ?', cab.B.donnees.note), noteB);
});

// Écart relevé par ce banc (la route redirigeait en 302 vers la liste), corrigé au lot 19 : la note d'un autre cabinet répond 404.
test('contenu du site : la note d\'un autre cabinet répond 404 sur sa page d\'édition', async () => {
  const { cab, env, cookie } = await monde();
  const r = await envoyer(env, { url: `/gestionnaire/notes/${cab.B.donnees.note}`, hote: cab.A.hote, cookie: cookie(cab.A) });
  assert.equal(r.statut, 404);
  const inconnue = await envoyer(env, { url: '/gestionnaire/notes/00000000-0000-0000-0000-000000000000', hote: cab.A.hote, cookie: cookie(cab.A) });
  assert.equal(inconnue.statut, 404, 'un identifiant inconnu répond comme celui d\'un autre cabinet');
});
