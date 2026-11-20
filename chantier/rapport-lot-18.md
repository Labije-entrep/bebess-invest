# Rapport — lot 18 : le banc de vérification rejoint le dépôt

Date : 2026-11-20. Branche : `claude/bebess-invest-regression-tests-93c4e8`. Deux commits de code (le banc, puis la correction qu'il a
provoquée) et un commit de rapport. `astro check` : 0 erreur.

`npm test` : **112 tests, 111 verts, 1 « todo », 0 échec, environ 2 s** (1,2 à 2,4 s selon la machine), hors ligne, sur une base neuve, sans
configuration. Les 27 tests d'avant (trois fichiers de fonctions pures) sont conservés et lancés avec les autres ; le lot en ajoute 85.

## Objet

Seize lots avaient chacun construit un banc sérieux — SQLite en mémoire, middleware réel, trois locataires croisés — et l'avaient jeté.
Ce lot n'ajoute aucune fonctionnalité : il remonte dans le dépôt ce qui avait été écrit, pour qu'une modification future ne rouvre pas en
silence un défaut déjà corrigé. Un seul fichier de `src/` est modifié, pour corriger le défaut que le banc a relevé (voir plus bas).

## Ce qui est dans le dépôt

`tests/` (tout le reste du dépôt est inchangé, hors `package.json` : le script `test`, et `tsconfig.json` : `tests` exclu de `astro check`).
Le détail est dans `tests/LISEZMOI.md`.

| Pièce | Rôle |
| --- | --- |
| `support/hooks.mjs`, `enregistrer.mjs` | Chargeur Node : imports sans extension (écrits pour Vite), `astro:middleware`, `import.meta.env` fixé comme `wrangler.cron.toml`, et en-tête d'un `.astro` converti en fonction. |
| `support/d1.ts` | Une D1 en mémoire (`node:sqlite`) : les 12 migrations réelles, clés étrangères actives, `batch` indivisible, entiers liés en INTEGER comme D1. |
| `support/serveur.ts` | La chaîne d'une requête : `src/worker.ts` → contrôle d'origine d'Astro (celui du paquet installé) → `src/middleware.ts` → la route. `fetch` remplacé : Scaleway et Cloudflare enregistrés, tout autre appel sortant fait échouer le test. |
| `support/monde.ts` | Trois cabinets (A, B, C) avec un exemplaire de chaque ressource, des comptes, des sessions, des contrats. |
| `support/dom.ts` | Un navigateur de poche, pour faire tourner le vrai `src/scripts/suivi.ts`. |

Aucune dépendance nouvelle : `node:test`, `node:sqlite`, le retrait des types de Node. **Node 22.18 ou plus récent** est requis (le dépôt
est développé sous Node 24).

## Les sept domaines

| Domaine | Fichier | Tests | Ce qui est établi |
| --- | --- | --- | --- |
| 1. Cloisonnement | `cloisonnement.test.ts` | 12 | 14 types de ressource × 3 cabinets ; lectures et écritures croisées dans les 6 sens (fiche, export, logo, rapport, API du suivi, passerelle, fichiers, fiche viewer) : 404, jamais 403, **même réponse qu'un identifiant inconnu**, **empreinte intégrale de la base inchangée**, objets R2 intacts ; entre clients d'un même cabinet ; contenu du site ; session d'un cabinet sur l'hôte d'un autre. |
| 2. Connexion | `connexion.test.ts` | 19 | Demande, courriel, GET sans effet (trois fois de suite), POST qui consomme, session posée (empreinte seule en base, `HttpOnly`, 30 jours), accès à `/espace`, rôle → accueil ; jeton expiré, déjà utilisé (y compris deux POST simultanés), forgé (8 formes), d'un autre cabinet, d'un compte devenu inactif ; Origin absent ou forgé (6 formes) sur la confirmation et sur la demande : le Worker renvoie vers la page d'explication, jamais un 403 nu, jeton non consommé, aucune session. |
| 3. Facturation | `facturation.test.ts` | 16 | Accès facturables par rôle ; annuel × 12 ; mensuel arrondi **ligne par ligne** (socle + Pilotage = 147 €, TVA 29,40 €) ; calendrier des bons (période en cours, puis 30 jours avant l'anniversaire) ; prorata 196 € (20/11/2026) et 49 € (02/03/2027) ; remise plafonnée à 50 % (40 % + 2 parrainages, et 60 % saisis) ; parrainage validé après 6 mois ; rejeu dix fois ; **17 émissions simultanées + doublons → 0001 à 0017 sans trou**, avoirs, annulation, et refus par la base (numéro, suppression, montant, collision). |
| 4. Essai | `essai.test.ts` | 10 | J+38, J+45, J+68, J+75 par le vrai traitement quotidien ; un courriel par associé et par jalon, jamais deux, même rejoué ; courriel refusé retenté sans doublon ; associé borné à l'export, autres rôles et clients coupés ; suppression réelle (base, R2, Cloudflare, voisin dont l'identifiant commence pareil intact, journal intact) ; suppression retenue tant qu'aucun avis n'est parti une semaine avant. |
| 5. Modules | `modules.test.ts` | 10 | Table de vérité 7 situations de contrat × 4 combinaisons de drapeaux ; ce que les drapeaux ferment (404 sur suivi, API, passerelle, logos ; menu ; site public ; écrans de contenu) ; l'essai ouvre tout ; désactivation programmée, bascule le jour J, rejeu, module repris. |
| 6. Performance | `performance.test.ts` | 13 | Chaînage (un versement n'est pas de la performance ; un retrait non plus) ; consolidation de portefeuilles aux dates décalées (report du dernier connu, zéro avant le premier point) ; **versements vides : +2,5 % et non +65 %** (point, import CSV, arrêté) ; l'aperçu et le chaînage donnent le même nombre sur 3 000 cas tirés au hasard. |
| 7. Marqueurs | `marqueurs.test.ts` | 5 | Les **neuf listes** renommées (clés de la table et de tout ce qui les porte) : indicateurs, huit filtres, liste, kanban, parcours **identiques mot pour mot** avant et après, dans le vrai script du navigateur branché sur le vrai `/api/suivi/etat` ; écritures qui suivent ; marqueur déplacé, retiré, désactivé ; valeur terminale lue dans la table. |

## Ce que le banc a révélé

C'est ce qu'on attend d'un banc qui n'est pas suspect.

1. **Défaut corrigé : le bon périodique refacturait les frais d'installation à chaque période.** `genererBons` passait le contrat entier
   (`...c`, frais compris) à `calculerBon`, qui les ajoute au total, alors que `tarif.ts` dit que le bon périodique « n'en porte jamais ».
   Un cabinet à 1 500 € de frais voyait son bon annuel passer de 948 € à 2 448 €, et chaque renouvellement recommençait. Correction :
   `frais_installation: 0` transmis au calcul (`src/lib/facturation.ts`, 3 lignes). Le test échoue sans elle (vérifié) et passe avec.
   **Les frais d'installation ne sont désormais facturés par aucun bon généré** : le code ne les facture nulle part, leur facture est « à part »,
   tapée par l'éditeur dans son outil comme les autres. Si l'on veut qu'un bon d'installation soit généré, c'est un lot à définir.
   À vérifier en base avant la mise en service : les bons **brouillons** déjà posés pour un cabinet qui a des frais portent encore la somme ;
   un brouillon suit le contrat et se recalcule à la prochaine passe (si sa période commence dans les 30 jours), mais un bon **émis** est
   figé et doit être annulé par avoir.
2. **Le banc a attrapé, dès sa première exécution sur `main`, un changement voulu du lot 17** (`resilie` et `essai_non_converti` ferment
   tout au lieu de tout rouvrir) : la table de vérité des modules a échoué, et je l'ai mise à jour. C'est la preuve que le filet joue son
   rôle, et que la règle est maintenant écrite dans un test.
3. **Écart ouvert, test « todo »** : `/gestionnaire/notes/<id d'un autre cabinet>` répond une redirection 302 vers la liste, et non un 404.
   Rien ne fuit (la réponse est identique à celle d'un identifiant inconnu) et rien n'est modifié ; c'est un écart avec la règle « 404,
   jamais 403 », pas une faille. Le test décrit le 404 attendu ; il passera quand la route sera alignée, et il faudra alors retirer `todo`.
4. Observations sans gravité, décrites par les tests tels qu'elles sont :
   - une écriture `DELETE` sans corps JSON répond 415 avant tout contrôle d'appartenance (le client du suivi n'en envoie jamais) ;
   - un parent étranger glissé dans une écriture (`apporteur_id`, `responsable_id`, `binome_id`) répond 422, identique à un identifiant
     inconnu, et non 404 ;
   - un sous-identifiant étranger dans une fiche viewer est refusé par « Accès refusé » sur une page 200, sans rien modifier ;
   - un premier bon posé en retard (mise en service tardive) n'est plus mis à jour tant qu'il reste brouillon : seuls les bons des
     périodes qui s'ouvrent dans les 30 jours suivent le contrat ;
   - une remise de parrainage n'est pas reportée sur la fiche du contrat quand le contrat porte une remise commerciale sans date de revue
     (état impossible par les écrans, atteignable en SQL) : le refus de `saisirRemise` est ignoré en silence ; le bon, lui, est juste ;
   - le chaînage arrondit un demi-centième de point d'un côté ou de l'autre selon le flottant (437 au lieu de 438) : négligeable.

## Preuve que le banc voit

26 sabotages du code, un à la fois, chacun suivi de `npm test`, puis annulé : filtre de locataire retiré (contact, rapport, lecture de
l'API, fichiers), jeton réutilisable / d'un autre cabinet / expiré, GET qui consomme, rejet d'origine laissé en 403 nu, arrondi du mensuel
sur le total, remise non plafonnée, prorata arrondi à l'inférieur, numérotation par `COUNT`, lecteurs comptés dans les accès, jalons à J+37
et J+74, registre des envois supprimé, essai qui n'ouvre plus tout, contrat suspendu qui ouvre tout, versements vides remis à zéro,
consolidation sans report, chaînage remplacé par un gain simple, clés `fait` / `encours` / `personne` écrites en dur. **26 sur 26 attrapés.**
Au premier passage, 2 survivaient (les filtres de seconde ligne de `lire` et de `documentAccessible`, masqués par la garde de la route) :
deux tests directs les attrapent désormais.

## Ce que le banc n'exécute pas

- Le **gabarit HTML** des pages `.astro` : seul leur en-tête tourne. Ce que la page affiche (message, mise en page) n'est pas vérifié ;
  on lit les variables que l'en-tête en tire (`invalide`, `refuse`, `erreurs`…).
- **Astro** lui-même (hors son contrôle d'origine, importé du paquet), **D1** et **Cloudflare** réels, le **déclenchement réel du Cron**,
  un **navigateur réel** (le script de suivi tourne dans un navigateur de poche : pas de mise en page, pas d'événement réel).
- La **concurrence réelle** de deux transactions D1 : le banc entrelace les appels entre leurs `await`, mais SQLite en mémoire est
  mono-thread. Le « sans trou » est tenu par l'instruction unique et l'index unique, que la base elle-même fait respecter.
- L'horloge : les dates du traitement sont passées en paramètre ; celles que SQLite lit lui-même (`date('now')`, année du numéro de facture)
  sont celles de la machine.

## Choix à relire

1. **Le défaut des frais d'installation est corrigé dans ce lot**, sur demande, bien que le lot « n'ajoute aucune fonctionnalité » : c'est
   le seul fichier de `src/` touché (3 lignes), dans son propre commit.
2. **Le `todo` des notes reste ouvert** : la consigne était de le signaler. L'aligner sur le 404 est un changement d'une ligne dans
   `src/pages/gestionnaire/notes/[id].astro`.
3. **Le chargeur lit les en-têtes `.astro` par expression régulière** (imports de `.astro`, `.css` et polices retirés, `export` retiré,
   variables de premier niveau relevées). Un en-tête qui déclarerait ses variables autrement (destructuration multi-lignes) serait exécuté
   normalement mais n'apparaîtrait pas dans `rendu`. Aucun test actuel n'en dépend.
4. **Le script `test` passe `--experimental-transform-types`** : `api-suivi.ts` utilise une propriété de paramètre (`constructor(public …)`),
   que le simple retrait des types refuse.

## Mise en service

Aucune migration, aucun redéploiement du Worker de traitement, aucun changement visible, hors le correctif de facturation : déployer le
site (et le Worker `bebess-traitement`, qui partage `facturation.ts`) suffit.
Avant de déployer, lister les bons d'un cabinet à frais d'installation :

```sql
SELECT b.id, b.tenant_id, b.statut, b.periode_debut, b.total_ht FROM bon_a_facturer b
  JOIN contrat c ON c.id = b.contrat_id WHERE c.frais_installation > 0 AND b.type = 'periode' ORDER BY b.tenant_id, b.periode_debut;
```

Un brouillon se corrige à la passe suivante ; un bon émis dont le total inclut les frais se règle par un avoir.
