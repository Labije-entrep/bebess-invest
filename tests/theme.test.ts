// Le thème choisi par le client final (retour de recette du 21/11/2026) : choix valide, nom inconnu, défaut du cabinet, cloisonnement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve } from './support/d1.ts';
import { creerCabinet, ouvrirSession } from './support/monde.ts';
import { envoyer, environnement, reseau } from './support/serveur.ts';
import { THEMES, themeEffectif, themeConnu } from '../src/lib/themes';
import { sessionCourante } from '../src/lib/auth';

const theme = (db: ReturnType<typeof baseNeuve>, id: string) => db.un<{ theme: string | null }>('SELECT theme FROM utilisateur WHERE id = ?', id)!.theme;

test('thème : le choix du client, puis le thème du cabinet, puis le défaut ; un nom inconnu retombe sur le cabinet', () => {
  assert.equal(themeEffectif('clair', 'nuit'), 'clair', 'le choix du client l\'emporte');
  assert.equal(themeEffectif(null, 'nuit'), 'nuit', 'rien choisi : le thème du cabinet est le défaut');
  assert.equal(themeEffectif(undefined, undefined), 'maison', 'ni l\'un ni l\'autre : le défaut');
  assert.equal(themeEffectif('#ff0000', 'foret'), 'foret', 'une valeur de couleur n\'est jamais un thème');
  assert.equal(themeEffectif('inconnu', 'pierre'), 'pierre');
  assert.equal(themeEffectif('clair', 'inconnu'), 'clair');
  assert.deepEqual(THEMES.map((t) => t.id), ['maison', 'nuit', 'foret', 'pierre', 'clair']);
  assert.equal(themeConnu('nuit'), 'nuit');
  assert.equal(themeConnu('rouge'), null);
});

test('thème : POST /espace/theme enregistre un nom valide sur le compte du client seulement, refuse tout le reste', async () => {
  reseau.vider();
  const db = baseNeuve();
  const contrat = { module_pilotage: 1, module_site: 1 };
  const a = creerCabinet(db, 'A', { contrat });
  const b = creerCabinet(db, 'B', { contrat });
  const env = environnement(db);
  const poster = (hote: string, cookie: string | undefined, formulaire: Record<string, string>) =>
    envoyer(env, { methode: 'POST', url: '/espace/theme', hote, cookie, formulaire });
  const cookieA = ouvrirSession(db, a.viewerCompte);

  assert.equal(theme(db, a.viewerCompte.id), null, 'au départ : aucun choix');
  const r = await poster(a.hote, cookieA, { theme: 'clair', retour: '/espace/portefeuille' });
  assert.equal(r.statut, 303);
  assert.equal(theme(db, a.viewerCompte.id), 'clair');
  // La session relit le choix : c'est ce que lit le gabarit de l'espace.
  assert.equal(themeEffectif((await sessionCourante(db, { get: () => ({ value: cookieA.slice(4) }) } as never))?.theme, 'maison'), 'clair');

  // Nom inconnu ou valeur de couleur : le choix est effacé, jamais enregistré tel quel ; l'espace suit alors le cabinet.
  for (const mauvais of ['#ff0000', 'rouge', '<script>', 'maison; x']) {
    await poster(a.hote, cookieA, { theme: 'nuit' });
    await poster(a.hote, cookieA, { theme: mauvais });
    assert.equal(theme(db, a.viewerCompte.id), null, `« ${mauvais} » n'est pas un thème`);
  }
  await poster(a.hote, cookieA, { theme: 'foret' });
  await poster(a.hote, cookieA, { theme: '' });
  assert.equal(theme(db, a.viewerCompte.id), null, 'vide : retour au thème du cabinet');

  // Cloisonnement : un identifiant glissé dans le formulaire ne vise personne d'autre ; le cabinet B et les autres comptes ne bougent pas.
  await poster(a.hote, cookieA, { theme: 'pierre', id: b.viewerCompte.id, utilisateur_id: b.viewerCompte.id });
  assert.equal(theme(db, a.viewerCompte.id), 'pierre');
  assert.equal(theme(db, b.viewerCompte.id), null);
  assert.equal(theme(db, a.viewer2Compte.id), null, 'les autres clients du même cabinet non plus');
  assert.equal(db.compte('utilisateur', 'theme IS NOT NULL'), 1);
  // La session du cabinet A présentée chez B : 404, rien d'écrit. Sans session : pas d'écriture. Un membre du personnel : refusé.
  assert.equal((await poster(b.hote, cookieA, { theme: 'nuit' })).statut, 404);
  assert.notEqual((await poster(a.hote, undefined, { theme: 'nuit' })).statut, 200);
  const perso = await poster(a.hote, ouvrirSession(db, a.associe), { theme: 'nuit' });
  assert.notEqual(perso.statut, 200);
  assert.equal(db.compte('utilisateur', "theme = 'nuit'"), 0, 'rien n\'a été écrit par ces refus');
});
