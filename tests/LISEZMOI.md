# Tests de non-régression

`npm test` lance tout : hors ligne, sur une base neuve en mémoire, sans configuration, sans réseau ni clé d'API, sans dépendance nouvelle.
Node 22.18 ou plus récent est requis (`node:sqlite`, retrait des types) ; le dépôt est développé sous Node 24.

## Ce que le banc fait tourner

Le code du dépôt, tel quel. Rien n'est réécrit pour être testable.

| Pièce | Rôle |
| --- | --- |
| `support/hooks.mjs`, `enregistrer.mjs` | Chargeur Node : résout les imports sans extension (écrits pour Vite), remplace `astro:middleware`, fixe `import.meta.env` comme `wrangler.cron.toml`, et transforme l'**en-tête** d'un fichier `.astro` en fonction (le gabarit HTML n'est pas rendu). |
| `support/d1.ts` | Une « D1 » : `node:sqlite` en mémoire derrière l'interface `Base`. Les 12 migrations réelles, clés étrangères actives, `batch` indivisible. |
| `support/serveur.ts` | La chaîne d'une requête : Worker (`src/worker.ts`) → contrôle d'origine d'Astro (celui du paquet installé) → `src/middleware.ts` → la route. `fetch` est remplacé : Scaleway et Cloudflare sont enregistrés, tout autre appel sortant fait échouer le test. |
| `support/monde.ts` | Trois cabinets (A, B, C) avec un exemplaire de chaque ressource, des comptes, des sessions, des contrats. |
| `support/dom.ts` | Un navigateur de poche, pour faire tourner `src/scripts/suivi.ts` (indicateurs, kanban, parcours). |

## Les sept domaines

| Fichier | Domaine |
| --- | --- |
| `cloisonnement.test.ts` | 1. Trois cabinets, lectures et écritures croisées : 404, même réponse qu'un identifiant inconnu, aucune ligne modifiée (empreinte intégrale de la base), R2 intact. |
| `connexion.test.ts` | 2. Lien, jeton, GET sans effet, POST qui consomme, session ; jeton expiré / utilisé / forgé / étranger ; Origin absent ou forgé. |
| `facturation.test.ts` | 3. Accès facturables, lignes, mensuel arrondi par ligne (147 €), prorata (196 € et 49 €), remise à 50 %, numérotation concurrente. |
| `essai.test.ts` | 4. J+38, J+45, J+68, J+75 ; rejeu sans doublon. |
| `modules.test.ts` | 5. Table de vérité statut × drapeaux, et ce que les drapeaux ferment. |
| `performance.test.ts` | 6. Chaînage, consolidation décalée, versements vides. |
| `marqueurs.test.ts` | 7. Renommage des clés des neuf listes : indicateurs, kanban, parcours identiques. |

Les trois tests purs d'origine (`src/lib/*.test.ts`) sont lancés avec les autres.

## Écarts relevés

Un test marqué `todo` décrit le comportement attendu et échoue aujourd'hui ; il ne fait pas échouer `npm test`. Quand l'écart est
corrigé, le test passe et la mention `todo` se retire.

- Ouvert — `cloisonnement.test.ts` : `/gestionnaire/notes/<id d'un autre cabinet>` répond une redirection (302) vers la liste, comme
  pour un identifiant inconnu, au lieu d'un 404. Rien ne fuit et rien n'est modifié.
- Corrigé (lot 18) — `facturation.test.ts` : `genererBons` transmettait les frais d'installation à `calculerBon` : chaque bon périodique
  les refacturait. Le test est désormais un test ordinaire.

## Ce que le banc n'exécute pas

Le rendu HTML des pages `.astro` (seuls leurs en-têtes tournent), Astro lui-même, D1 et Cloudflare réels, le déclenchement réel du
Cron, un navigateur réel.
