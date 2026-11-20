# Tests de non-régression

`npm test` lance tout : hors ligne, sur une base neuve en mémoire, sans configuration, sans réseau ni clé d'API, sans dépendance nouvelle.
Node 22.18 ou plus récent est requis (`node:sqlite`, retrait des types) ; le dépôt est développé sous Node 24.

## Ce que le banc fait tourner

Le code du dépôt, tel quel. Rien n'est réécrit pour être testable.

| Pièce | Rôle |
| --- | --- |
| `support/hooks.mjs`, `enregistrer.mjs` | Chargeur Node : résout les imports sans extension (écrits pour Vite), remplace `astro:middleware`, fixe `import.meta.env` comme `wrangler.cron.toml`, et transforme l'**en-tête** d'un fichier `.astro` en fonction (le gabarit HTML n'est pas rendu). |
| `support/d1.ts` | Une « D1 » : `node:sqlite` en mémoire derrière l'interface `Base`. Les 14 migrations réelles, clés étrangères actives, `batch` indivisible. |
| `support/serveur.ts` | La chaîne d'une requête : Worker (`src/worker.ts`) → contrôle d'origine d'Astro (celui du paquet installé) → `src/middleware.ts` → la route. `fetch` est remplacé : Scaleway et Cloudflare sont enregistrés, tout autre appel sortant fait échouer le test. |
| `support/monde.ts` | Trois cabinets (A, B, C) avec un exemplaire de chaque ressource, des comptes, des sessions, des contrats. |
| `support/dom.ts` | Un navigateur de poche, pour faire tourner `src/scripts/suivi.ts` (indicateurs, kanban, parcours). |

## Les dix domaines

| Fichier | Domaine |
| --- | --- |
| `cloisonnement.test.ts` | 1. Trois cabinets, lectures et écritures croisées : 404, même réponse qu'un identifiant inconnu, aucune ligne modifiée (empreinte intégrale de la base), R2 intact. |
| `connexion.test.ts` | 2. Lien, jeton, GET sans effet, POST qui consomme, session ; jeton expiré / utilisé / forgé / étranger ; Origin absent ou forgé. |
| `facturation.test.ts` | 3. Accès facturables, lignes, mensuel arrondi par ligne (147 €), prorata (196 € et 49 €), remise à 50 %, numérotation concurrente. |
| `essai.test.ts` | 4. J+38, J+45, J+68, J+75 ; rejeu sans doublon. |
| `modules.test.ts` | 5. Table de vérité statut × drapeaux, et ce que les drapeaux ferment. |
| `performance.test.ts` | 6. Chaînage, consolidation décalée, versements vides. |
| `marqueurs.test.ts` | 7. Renommage des clés des neuf listes : indicateurs, kanban, parcours identiques. |
| `signature.test.ts` | 8. La signature du contrat (essai → actif, début de service, DPA exigé, refusée hors essai et deux fois), la chaîne cabinet → contrat → production → signature → traitement quotidien → bon avec ses quatre identifiants, le bon d'installation (un seul, sans remise, aucun à frais nuls). |
| `contenus.test.ts` | 9. Les paragraphes des contenus du site : `\r\n` normalisé à l'enregistrement, lecture tolérante des lignes déjà en base. |
| `environnement.test.ts` | 10. Le courriel sur `*.localhost`, refusé partout ailleurs ; le jeu de démonstration (cours fictifs, second cabinet complet). |

Les trois tests purs d'origine (`src/lib/*.test.ts`) sont lancés avec les autres.

## Écarts relevés

Un test marqué `todo` décrit le comportement attendu et échoue aujourd'hui ; il ne fait pas échouer `npm test`. Quand l'écart est
corrigé, le test passe et la mention `todo` se retire. **Aucun écart n'est ouvert** : il n'y a plus de `todo`.

- Corrigé (lot 19) — `cloisonnement.test.ts` : `/gestionnaire/notes/<id d'un autre cabinet>` répondait une redirection (302) vers la liste ;
  il répond 404, comme un identifiant inconnu.
- Corrigé (lot 18) — `facturation.test.ts` : `genererBons` transmettait les frais d'installation à `calculerBon` : chaque bon périodique
  les refacturait. Le test est désormais un test ordinaire.

## Ce que le banc ne couvre pas

**Des tests verts ne veulent pas dire « tout est vérifié ».** Le banc prouve la logique du dépôt sur une base SQLite en mémoire ; il ne
prouve rien de ce qui suit, et une recette sur la plateforme réelle reste nécessaire avant d'ouvrir un cabinet.

| Ce que le banc n'exécute pas | Ce que cela laisse sans preuve |
| --- | --- |
| Le **gabarit HTML** des pages `.astro` (seul l'en-tête tourne) | Qu'une page affiche bien ce que son en-tête calcule : un libellé, un formulaire, un bouton « Signer le contrat », un champ prérempli (les quatre prix de l'ouverture de contrat), l'ordre des blocs. Un défaut de gabarit passe tous les tests. |
| **Astro** lui-même | Le routage réel, les redirections, `Astro.rewrite('/404')`, le rendu serveur, la compilation (`npm run check` et `npm run build` ne sont pas lancés par `npm test`). |
| **D1 et Cloudflare réels** (`workerd`, R2, domaines personnalisés, Cloudflare for SaaS) | Les limites et les comportements de la plateforme ; le DDL des migrations tel que D1 l'applique (les migrations 0008, 0009 et 0014 reconstruisent des tables sous `PRAGMA defer_foreign_keys`, ce que `node:sqlite` ne reproduit qu'en partie) ; les objets R2 réels. |
| Le **Cron réel** | Le déclenchement quotidien à 03:00 UTC, l'exécution du Worker du traitement, ses secrets et ses variables. Le banc appelle `traitementQuotidien` directement. |
| Un **navigateur réel** | Les cookies (`Secure`, `SameSite`), les envois de formulaire (`\r\n` des `<textarea>`, boutons de soumission portant un `name`), le JavaScript du suivi hors du petit navigateur de `support/dom.ts`, les téléchargements. |
| La **concurrence de deux transactions** réelles | Le banc entrelace des appels asynchrones, mais un `batch` ne s'entrelace jamais : il ne reproduit pas deux isolats Cloudflare qui écrivent en même temps. Les garde-fous (index uniques, `changes()`) y sont éprouvés, pas l'ordonnancement réel. |
| L'**horloge** | Les dates sont passées en paramètre (`maintenant`, `jour`) ; rien ne prouve le comportement autour de minuit UTC, d'un changement d'heure ou d'un traitement qui chevauche deux jours. |
| Le **courriel et les cours réels** | Scaleway et le fournisseur de cours sont enregistrés, jamais appelés. |

Les défauts du lot 19 en sont l'illustration : la bascule en `actif` n'existait nulle part et aucun test ne le disait, parce que les
contrats de test étaient posés directement `actif`.
