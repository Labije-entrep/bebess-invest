# Tests de non-régression

`npm test` lance tout : hors ligne, sur une base neuve en mémoire, sans configuration, sans réseau ni clé d'API, sans dépendance nouvelle.
Node 22.18 ou plus récent est requis (`node:sqlite`, retrait des types) ; le dépôt est développé sous Node 24.

## Ce que le banc fait tourner

Le code du dépôt, tel quel. Rien n'est réécrit pour être testable.

| Pièce | Rôle |
| --- | --- |
| `support/hooks.mjs`, `enregistrer.mjs` | Chargeur Node : résout les imports sans extension (écrits pour Vite), remplace `astro:middleware`, fixe `import.meta.env` comme `wrangler.cron.toml`, et transforme l'**en-tête** d'un fichier `.astro` en fonction (le gabarit HTML n'est pas rendu). |
| `support/d1.ts` | Une « D1 » : `node:sqlite` en mémoire derrière l'interface `Base`. Les migrations réelles (0001 à 0014), clés étrangères actives, `batch` indivisible. |
| `support/serveur.ts` | La chaîne d'une requête : Worker (`src/worker.ts`) → contrôle d'origine d'Astro (celui du paquet installé) → `src/middleware.ts` → la route. `fetch` est remplacé : Scaleway et Cloudflare sont enregistrés, tout autre appel sortant fait échouer le test. |
| `support/monde.ts` | Trois cabinets (A, B, C) avec un exemplaire de chaque ressource, des comptes, des sessions, des contrats. |
| `support/dom.ts` | Un navigateur de poche, pour faire tourner `src/scripts/suivi.ts` (indicateurs, kanban, parcours). |

## Ce que « tous les tests sont verts » ne dit PAS

Un `npm test` vert signifie : *le code du dépôt se comporte comme ces tests l'attendent, dans ce banc.* Il ne signifie pas « tout est
vérifié ». Ce que le banc n'exécute pas, et qu'aucun test vert ne couvre :

| Non couvert | Ce qui reste à vérifier, et comment |
| --- | --- |
| **Le gabarit HTML des pages `.astro`** | Seul l'en-tête (le code entre les deux `---`) tourne. Ce que la page affiche — textes, mise en page, boutons présents ou grisés, menus, accessibilité — n'est jamais rendu ni lu. On lit les variables que l'en-tête calcule (`invalide`, `refuse`, `erreurs`, `bons`…). À vérifier dans un navigateur (`RECETTE.md`). |
| **Astro lui-même** | Le routage, la fabrication de la `Response`, les cookies, `Astro.redirect` / `Astro.rewrite` sont des **doublures** écrites pour le banc (`support/serveur.ts`). Seul le contrôle d'origine est celui du paquet installé. Une montée de version d'Astro peut changer un comportement que ces doublures ne voient pas. |
| **D1 réel** | La base est SQLite en mémoire (`node:sqlite`), pas D1. Même moteur SQL, mais pas la même version, pas les mêmes limites (taille, nombre de paramètres, durée), pas la même latence. `D1` sérialise les écritures et applique les migrations à sa manière : à éprouver sur D1 local (`wrangler`) puis distant. |
| **Cloudflare réel** | Workers, Pages, R2, « custom hostnames » : R2 est une table en mémoire, Cloudflare et Scaleway sont des réponses scriptées. Les vrais appels, les vraies erreurs, les délais, les certificats ne sont pas éprouvés. |
| **Le Cron réel** | `traitementQuotidien` est appelé à la main, avec le jour qu'on lui donne. Le déclenchement à 03:00 UTC, le Worker `bebess-traitement`, ses secrets et ses liaisons ne sont pas exercés (`wrangler dev --test-scheduled`, `wrangler deploy --dry-run`). |
| **Un navigateur réel** | `src/scripts/suivi.ts` tourne dans un navigateur de poche (`support/dom.ts`) : pas de mise en page, pas d'événement réel, pas de focus, pas de glisser, pas de `<dialog>`, pas de réseau instable, pas de Safari ni de mobile. |
| **La concurrence réelle de deux transactions** | Les appels « simultanés » s'entrelacent entre leurs `await`, dans un seul processus ; un `batch` ne s'entrelace jamais. Deux Workers sur deux machines ne sont pas simulés : le « sans trou » repose sur l'instruction unique et l'index unique de la base, que le banc fait jouer mais ne met pas sous contention réelle. |
| **L'horloge** | Les dates du traitement sont passées en paramètre, et l'horloge est figée par endroits (`mock.timers`). Mais SQLite lit lui-même `date('now')` et `strftime('now')` (année et instant du numéro de facture, gel du tarif) : ceux-là sont l'heure de la machine. Aucun test ne vérifie un changement d'année, de fuseau ou de changement d'heure en conditions réelles. |
| **Les formulaires des pages `.astro`** | Le gabarit n'étant pas rendu, deux câblages de la fiche de contrat (le formulaire « Signer le contrat », les quatre prix préremplis de la grille standard) ne sont éprouvés que par **lecture du source** du gabarit (`signature.test.ts`) : on vérifie que le code y est, pas que le navigateur l'affiche. |
| **Le chargeur `.astro`** | Il lit les en-têtes par expression régulière (imports retirés, `export` retiré, variables de premier niveau relevées). Un en-tête écrit autrement serait exécuté, mais ses variables n'apparaîtraient pas dans `rendu`. |

Les migrations, elles, sont éprouvées : appliquées dans l'ordre sur une base neuve, et la dernière (reconstruction d'une table) sur une
base qui a déjà ses lignes (`migration.test.ts`). Mais sur SQLite en mémoire, pas sur D1.

## Les sept domaines

| Fichier | Domaine |
| --- | --- |
| `cloisonnement.test.ts` | 1. Trois cabinets, lectures et écritures croisées : 404, même réponse qu'un identifiant inconnu, aucune ligne modifiée (empreinte intégrale de la base), R2 intact. |
| `connexion.test.ts` | 2. Lien, jeton, GET sans effet, POST qui consomme, session ; jeton expiré / utilisé / forgé / étranger ; Origin absent ou forgé. |
| `facturation.test.ts` | 3. Accès facturables, lignes, mensuel arrondi par ligne (147 €), prorata (196 € et 49 €), remise à 50 %, numérotation concurrente. |
| `essai.test.ts` | 4. J+38, J+45, J+68, J+75 ; rejeu sans doublon. |
| `modules.test.ts` | 5. Table de vérité statut × drapeaux, et ce que les drapeaux ferment. |
| `signature.test.ts` | Le passage de l'essai au contrat : « Signer le contrat » (règle, console, chaîne entière d'un cabinet créé, mis en production, signé, facturé). |
| `site.test.ts` | Les paragraphes des contenus du site : `\r\n` normalisé à l'enregistrement et à l'affichage. |
| `recette.test.ts` | L'environnement de recette : courriel sur `*.localhost`, seed (second cabinet complet, cours fictifs). |
| `migration.test.ts` | La migration 0014 (reconstruction de `bon_a_facturer`) sur une base qui a déjà ses bons, ses numéros et un avoir. |
| `performance.test.ts` | 6. Chaînage, consolidation décalée, versements vides. |
| `marqueurs.test.ts` | 7. Renommage des clés des neuf listes : indicateurs, kanban, parcours identiques. |

Les trois tests purs d'origine (`src/lib/*.test.ts`) sont lancés avec les autres.

## Écarts connus

Aucun test `todo` : tous les écarts relevés par le banc ont été corrigés. Un test `todo` décrit un comportement attendu qui échoue
aujourd'hui sans faire échouer `npm test` ; s'il en revient un, c'est un écart connu et non corrigé, et il doit figurer ici.
