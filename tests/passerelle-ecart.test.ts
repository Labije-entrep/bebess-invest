// Le bouton « Créer un sujet depuis l'écart » est grisé tant qu'un sujet d'écart non clos existe pour la classe (retour de recette du
// 21/11/2026). Le calcul est celui de `classesAvecEcartOuvert` ; la route refuse aussi, en doublure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNeuve } from './support/d1.ts';
import { creerCabinet } from './support/monde.ts';
import { classesAvecEcartOuvert, prefixeEcart, sujetPourOrigine } from '../src/lib/passerelle';

test('bouton grisé : présent tant qu\'un sujet d\'écart est ouvert pour la classe, absent une fois clos, propre à la classe et au cabinet', async () => {
  const db = baseNeuve();
  const contrat = { module_pilotage: 1, module_site: 1 };
  const a = creerCabinet(db, 'A', { contrat });
  const b = creerCabinet(db, 'B', { contrat });
  const c = a.donnees.contact;
  assert.deepEqual([...(await classesAvecEcartOuvert(db, a.id, c))], [], 'aucun sujet d\'écart : le bouton est actif');

  const r = await sujetPourOrigine(db, a.id, c, 'ecart:actions:2026-05-31', 'Écart sur actions');
  assert.ok('id' in r && r.cree);
  assert.deepEqual([...(await classesAvecEcartOuvert(db, a.id, c))], ['actions'], 'sujet ouvert : bouton grisé pour « actions » seulement');
  assert.deepEqual([...(await classesAvecEcartOuvert(db, b.id, c))], [], 'un autre cabinet ne voit rien');

  // Doublure serveur : même classe, autre date d'arrêté → le sujet ouvert est rendu, rien n'est créé.
  const bis = await sujetPourOrigine(db, a.id, c, 'ecart:actions:2026-06-30', 'Écart sur actions', prefixeEcart('actions'));
  assert.ok('id' in bis && !bis.cree && bis.id === (r as { id: string }).id);
  // Une autre classe n'est pas gênée.
  const autre = await sujetPourOrigine(db, a.id, c, 'ecart:obligations:2026-05-31', 'Écart sur obligations', prefixeEcart('obligations'));
  assert.ok('id' in autre && autre.cree);
  assert.deepEqual([...(await classesAvecEcartOuvert(db, a.id, c))].sort(), ['actions', 'obligations']);

  // Clos (statut terminal) : le bouton redevient actif et un nouveau sujet peut naître.
  const terminal = db.un<{ cle: string }>("SELECT cle FROM liste_valeur WHERE tenant_id = ? AND liste = 'statut_sujet' AND terminal = 1 AND actif = 1 ORDER BY ordre LIMIT 1", a.id)!.cle;
  db.exec('UPDATE sujet SET statut = ? WHERE id = ?', terminal, (r as { id: string }).id);
  assert.deepEqual([...(await classesAvecEcartOuvert(db, a.id, c))], ['obligations'], 'sujet clos : « actions » est de nouveau actif');
  const neuf = await sujetPourOrigine(db, a.id, c, 'ecart:actions:2026-06-30', 'Écart sur actions', prefixeEcart('actions'));
  assert.ok('id' in neuf && neuf.cree);
});
