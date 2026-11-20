# Rapport de recette — parcours nominal (20 étapes)

Date : 20 novembre 2026.

## 0. Périmètre et conditions

- **Environnement : local, pas la recette Cloudflare.** Aucune recette n'était joignable (pas de `wrangler.recette.toml`, compte Cloudflare non connecté, pas d'URL). Le parcours a été joué sur `astro dev` (`127.0.0.1:4321`) avec D1 et R2 locaux, `seeds/demo.sql`, et le Worker du traitement quotidien lancé par `wrangler dev -c wrangler.cron.toml --test-scheduled`. La production n'a jamais été touchée.
- **Ce que ce périmètre ne prouve pas** : Cron Triggers réels, R2 réel, domaines personnalisés (Cloudflare for SaaS), envoi de courriel réel, cours de marché réels. Ces points restent à éprouver sur la vraie recette.
- **Cabinets** : A = « Cabinet Recette Alpha » (créé pendant le parcours, hôte `cabinet3.localhost`, aussi servi par `127.0.0.1`) ; B = « Cabinet Delmas » (seed, `cabinet2.localhost`).
- **Règle suivie** : arrêt au premier échec. Le parcours s'est arrêté à l'étape 19 ; l'étape 20 a ensuite été jouée à la demande, séparément.
- **Aucun code du dépôt n'a été modifié.** Les corrections ci-dessous sont des propositions.

### Aménagements de test (traçabilité)

| Aménagement | Raison |
|---|---|
| Hôte `127.0.0.1` déclaré sur la fiche du cabinet A, puis passé à `actif` par SQL local | Le pilote de courriel `console` refuse `cabinet3.localhost` ; sans cela le lien du gestionnaire ne se lit pas (écart E6) |
| Fichiers déposés en plaçant un fichier dans le champ du vrai formulaire, puis en cliquant son bouton | Le navigateur intégré n'a pas de sélecteur de fichier |
| Session collaborateur ouverte avec `curl` et un pot de cookies séparé | Ne pas écraser les autres sessions |
| Étape 20 : trois sessions insérées en base locale (associé B, viewer B, associé A) et un contact, un rapport et une catégorie de documents ajoutés côté B | Le pilote de courriel refuse les hôtes de B ; le seed de B est trop pauvre (écart E9) |

## 1. Résultat par étape

Légende : ✅ conforme · ⚠️ conforme avec écart · ❌ rupture · ⏭️ non joué.

| # | Attendu | Observé | Verdict |
|---|---|---|---|
| 1 | Cabinet créé (nom, hôte, SIREN valide, adresse, contact, thème), lien du gestionnaire relevé | Cabinet créé : SIREN `732 829 320`, adresse, contact, thème Forêt. Lien non envoyé : `MAIL_DRIVER=console refusé sur l'hôte « cabinet3.localhost »`, incident journalisé. Lien obtenu après contournement. Le formulaire d'ouverture du contrat n'enregistre rien tant que les quatre prix sont vides (aucun défaut proposé) | ⚠️ E6, E8 |
| 2 | DPA posé, mise en production : essai, fin à +45 jours | Statut « Essai », fin d'essai 03/01/2027 (19/11 + 45 j) | ✅ |
| 3 | Lien ouvert, confirmation, `/gestionnaire` | Confirmation puis tableau de bord vide (0 viewer, 0 €) | ✅ |
| 4 | Neuf listes peuplées, renommage, membre | Neuf listes remplies (statuts, étapes, types, métiers, échanges, documents, classes, mouvements, portefeuilles). « Appel » → « Appel téléphonique », repris dans le formulaire d'échange. Membre créé | ✅ |
| 5 | Accueil et mentions remplis, site public conforme | Accueil enregistré et affiché. Mentions : tous les champs repris sur `/mentions-legales`. Mais deux paragraphes séparés par une ligne vide sortent en un seul | ⚠️ E2 |
| 6 | Contact prospect, étape, sujet, échange | Contact « Delmont Sophie » (prospect), étape « Premier contact », sujet, échange téléphonique journalisé | ✅ |
| 7 | Parcours : une étape ; kanban : statut terminal, « sujets ouverts » diminue | Étape → RDV. Kanban : À faire → En cours → En attente → Fait. « Sujets ouverts » : 1 puis 0 | ✅ |
| 8 | Chiffres remplis depuis les cours ; résumé et « à dire aux clients » enregistrés | Fiche enregistrée. Bloc Chiffres vide (« aucun cours connu », `COURS_API_KEY` non configurée) | ⚠️ E7 |
| 9 | Promotion : viewer, fiche, portefeuille « Patrimoine », lien envoyé | Les quatre éléments présents. Lien lu dans la console | ✅ |
| 10 | Lien du viewer dans une autre session : espace vide | Valorisation 0,00 €, aucune courbe ni répartition | ✅ |
| 11 | Arrêté complet, versements vides : performance vraisemblable | Enveloppe + deux lignes (70 000 + 30 000 €). Aperçu : « Non calculable : aucun point antérieur ». Performance affichée « — » | ✅ |
| 12 | Valorisation, répartition, date d'arrêté côté viewer | 100 000 €, 70 % / 30 %, arrêté au 20 novembre 2026, plus-value latente +5 500 € | ✅ |
| 13 | Écart au-delà du seuil, sujet depuis le panneau Portail, provenance | Cibles 50/50, écarts ±20 points (seuil 5). Sujet créé avec « créé depuis l'écart d'allocation du 20 nov. » | ✅ |
| 14 | Note publiée depuis l'actu puis l'écran des notes, au mot près | L'actu crée un brouillon (texte copié) ; publication dans l'écran des notes ; page publique identique à « à dire aux clients » | ⚠️ E5 (libellé du scénario) |
| 15 | PDF déposé, téléchargé côté viewer | 200, `application/pdf`, pièce jointe, 603 octets identiques, classé sous « Patrimoine » | ✅ |
| 16 | Extension qui ment : refusé | `erreur=type_refuse`, absent de la liste | ✅ |
| 17 | Quatrième accès : phrase de dépassement une seule fois, bonne date | Absente aux 2ᵉ et 3ᵉ accès. Au 4ᵉ : « gratuit jusqu'au 03/01/2027 … 25 € HT par mois ». Absente au rechargement | ✅ |
| 18 | « Mon abonnement » : formule, montant, facturables, « illimités, non facturés », aucune jauge ni changement d'offre ; collaborateur refusé | « Socle seul », 948 + 300 = 1 248 € HT, 4 facturables / 3 inclus, « 1 publié, illimités, non facturés », aucune jauge ni bouton. Collaborateur : 403 sur « Mon abonnement » et sur l'onglet Accès | ✅ |
| 19 | Traitement quotidien : un bon avec les quatre identifiants de facturation | Traitement exécuté sans échec, `bons.crees = 1`, mais le bon appartient au cabinet de démonstration (SIREN, adresse et contact absents du seed). Aucun bon pour le cabinet A, dont le contrat est en essai | ❌ E1 |
| 20 | Cloisonnement : 404, jamais 403, jamais de donnée ; idem rapport avec une session viewer | Voir §2. Aucune fuite, aucune écriture croisée, aucun 403. Deux réponses ne sont pas des 404 | ⚠️ E3, E4 |

## 2. Étape 20 en détail

Témoins (le propriétaire accède à ses objets) : 200 sur viewer B, rapport B (côté viewer B), viewer A, rapport A (côté viewer A) ; `PATCH` du contact B avec la session de B : 200.

| Cas | Résultat |
|---|---|
| Associé A, hôte A, vers viewer B, fiche contact B, export contact B, logo contact B | 404 |
| Associé A, hôte A, `PATCH` / `DELETE` du contact B, création d'un sujet ou d'un échange sur un contact B | 404 (« Introuvable ») ; contact B intact, aucun sujet « intrus » créé |
| Associé A, hôte A, rapport de B ; suppression du rapport de B | 404 |
| Viewer A, rapport de B (hôte A, puis cookie rejoué hôte B) | 404 |
| Sens inverse : associé B et viewer B vers contact, sujet, viewer, rapport de A | 404 |
| Cookie de A rejoué sur l'hôte de B, pages | 302 vers `/connexion`, sans donnée (E3) |
| Cookie de A rejoué sur l'hôte de B, API | 401 « Connexion requise », sans donnée (E3) |
| `/gestionnaire/notes/<id d'un autre cabinet>` | 302 vers `/gestionnaire/notes`, sans donnée (E4) |

## 3. Écarts constatés et corrections proposées

### E1 — Aucun chemin pour passer un contrat de l'essai à l'actif : aucun bon ne peut être produit (étape 19) — **majeur, à confirmer**

- **Constat.** `genererBons` ne traite que les contrats `statut = 'actif'` avec `debut_le` renseigné ([facturation.ts:174](src/lib/facturation.ts:174), via `contratsActifs` dans [contrat.ts:126](src/lib/contrat.ts:126)). La console pose `essai` (mise en production) et la fiche affiche « Début du service : — ». Une recherche dans `src/` ne trouve **aucune** écriture de `statut = 'actif'` ni de `debut_le` en dehors du seed : seul `essai.ts` bascule vers `essai_non_converti` au J+45. Un cabinet réel ne peut donc jamais être facturé, et le traitement quotidien ne produit un bon que pour le contrat posé par le seed.
- **Impact.** Aucune facturation possible en dehors du jeu de démonstration ; les parrainages (validés sur contrat `actif`) et les bons complémentaires sont aussi inatteignables.
- **Correction proposée.** Ajouter à la fiche de contrat de la console une action « Signer le contrat / passer en actif » : date de signature, pose de `debut_le` et `statut = 'actif'`, refus sans DPA (comme la mise en production), refus hors statut `essai`, événement au journal, test. Le bon est alors produit au traitement suivant. Si la conversion est prévue dans un lot ultérieur, l'écrire dans `chantier/ETAT.md`.
- **Scénario.** Ajouter avant l'étape 19 : « Signer le contrat du cabinet A ». Attendu à l'étape 19 : un bon pour A avec raison sociale, SIREN `732 829 320`, adresse et contact de facturation.

### E2 — Les paragraphes saisis dans un navigateur ne se séparent pas (étape 5) — **moyen**

- **Constat.** Un `<textarea>` envoie ses retours à la ligne en `\r\n`. La valeur est stockée telle quelle (vérifié en base : `recette.\r\n\r\nSIREN`), et `paragraphes()` ne coupe que sur `\n{2,}` ([site.ts:221](src/lib/site.ts:221)). Toute rubrique « paragraphes séparés par une ligne vide » (mentions légales, horaires du contact) sort en un seul bloc. `markdown.ts` normalise déjà `\r\n`, pas `site.ts`.
- **Correction proposée.** Dans `paragraphes()` : `texte.split(/(?:\r?\n){2,}/)`, ou normaliser `\r\n?` en `\n` une fois à l'enregistrement des contenus. Ajouter un test unitaire avec `\r\n\r\n`.

### E3 — Cookie d'un cabinet rejoué sur l'hôte d'un autre : 302 / 401 au lieu de 404 (étape 20) — **faible**

- **Constat.** [middleware.ts:112-118](src/middleware.ts:112) ignore la session si `utilisateur.tenant_id` diffère du tenant de l'hôte : la requête est traitée comme anonyme (302 vers `/connexion` pour les pages, 401 pour l'API). Aucune donnée ne fuit.
- **Correction proposée (au choix).** (a) Garder le comportement, qui est cohérent avec le commentaire du middleware, et reformuler l'attendu de l'étape 20 en « aucune donnée, jamais de 403 ». (b) Pour tenir un 404 strict : si la session est valide mais d'un autre tenant, répondre 404 sur les chemins privés. À noter : (b) confirme à un porteur de cookie volé que le cookie est valide ; (a) est plus sobre.

### E4 — `/gestionnaire/notes/<id>` d'un autre cabinet : 302 au lieu de 404 (étape 20) — **faible**

- **Constat.** [notes/[id].astro:11](src/pages/gestionnaire/notes/[id].astro:11) redirige vers la liste quand la note est introuvable. Même réponse pour un identifiant inexistant : le cloisonnement n'est pas en cause, mais la règle « 404, jamais autre chose » n'est pas tenue sur cet écran.
- **Correction proposée.** Remplacer la redirection par un 404 (`return new Response(null, { status: 404 })` ou la page 404 du site), comme sur les autres écrans à identifiant.

### E5 — Libellé du scénario : « publier depuis l'actu » (étape 14) — **information**

- **Constat.** Depuis l'actu on crée seulement un brouillon, dont le texte est repris mot pour mot ; la publication est un second geste dans l'écran des notes (c'est écrit à l'écran). Comportement conforme à la conception.
- **Correction proposée.** Corriger l'étape : « Créer la note depuis l'actu, puis la publier depuis l'écran des notes ».

### E6 — Le pilote `console` refuse les hôtes `*.localhost` (étape 1) — **faible, environnement**

- **Constat.** [mail.ts:42](src/lib/mail.ts:42) n'admet que `localhost` et `127.0.0.1`. Un cabinet créé sur `cabinet3.localhost` ne reçoit pas son lien de première connexion, ni aucun lien (connexion, promotion), sauf à passer par `127.0.0.1`. Sur la vraie recette, le pilote est volontairement refusé (aucun courriel ne part) : le lien du gestionnaire n'y est lisible que dans les journaux d'incident, pas dans le lien lui-même.
- **Correction proposée.** En local : accepter les noms terminant par `.localhost` (ils résolvent sur la boucle locale), ce qui ne rouvre rien en production. Pour la vraie recette : monter un domaine d'envoi Scaleway de recette, comme le prévoit [RECETTE.md](RECETTE.md), ou ajouter un moyen contrôlé de relever le lien de première connexion (à décider, avec le risque d'exposer un lien valide).

### E7 — Chiffres de l'actu vides sans clé de cours (étape 8) — **faible, environnement**

- **Constat.** Sans `COURS_API_KEY`, la table `cours` est vide : le bloc Chiffres ne peut se remplir (« aucun cours connu »). L'écran le dit clairement.
- **Correction proposée.** Fournir une clé en recette, ou ajouter quelques cours fictifs à `seeds/demo.sql` pour que l'étape soit jouable partout. Rendre l'étape conditionnelle à la présence de la clé dans le scénario.

### E8 — Ouverture du contrat : quatre prix à saisir sans valeur par défaut (étape 1) — **faible, ergonomie**

- **Constat.** Les champs de prix sont vides ; le formulaire ne s'envoie pas tant qu'ils ne sont pas remplis. Le scénario ne dit pas quels prix poser (79 / 49 / 39 / 25 € ont été utilisés, grille de [RECETTE.md](RECETTE.md)).
- **Correction proposée.** Préremplir la grille standard (7900 / 4900 / 3900 / 2500 centimes) et le dire dans le scénario. Accessoirement, le compte de support de l'éditeur n'a pas été créé (« adresse non configurée ») : prévoir l'adresse dans les réglages éditeur avant l'étape 1.

### E9 — Seed du cabinet B trop pauvre pour les tests de cloisonnement (étape 20) — **faible, jeu de test**

- **Constat.** Le cabinet B n'a ni liste `type_contact`, ni `categorie_doc`, ni `statut_sujet` : impossible d'y créer un contact typé ou un rapport sans insertion manuelle.
- **Correction proposée.** Compléter `seeds/demo.sql` pour B avec les listes par défaut, un contact et un sujet ; et fournir un moyen documenté d'ouvrir une session de test sur B.

## Suite donnée (lot 19)

| Écart | Suite |
| --- | --- |
| E1 — pas de passage de l'essai à l'actif | **Corrigé** : `signerContrat` et l'action « Signer le contrat » de la fiche (DPA exigé, refusée hors essai, journalisée). Début de service = 45ᵉ jour de l'essai si signé avant sa fin. |
| E2 — paragraphes perdus | **Corrigé** : `\r\n` normalisé à l'enregistrement (pages, notes, formulaire) et à la lecture. |
| E3 — cookie rejoué sur l'hôte d'un autre cabinet : 302 / 401 | **Corrigé (lot 20)** : 404 strict sur les routes privées (`/espace`, `/gestionnaire`, `/admin`, `/api/suivi`, `/fichiers`), indiscernable d'une page inexistante ; `/connexion` et `/deconnexion` restent ouvertes. Un cookie volé n'apprend ainsi plus qu'il est valide ailleurs que par ce qu'il ouvre déjà chez son cabinet. |
| E4 — note d'un autre cabinet : 302 | **Corrigé** : 404 ; le `todo` du banc est retiré. |
| E5 — libellé du scénario (note depuis l'actu) | À corriger dans le scénario, pas dans le produit. |
| E6 — pilote console et `*.localhost` | **Corrigé** : tout nom qui se termine par `.localhost` est accepté, le refus ailleurs est inchangé. |
| E7 — Chiffres vides sans clé de cours | **Corrigé dans le seed** : cours fictifs. La vraie clé reste à poser en recette. |
| E8 — prix sans valeur par défaut | **Corrigé** : grille standard préremplie. |
| E9 — seed du cabinet B trop pauvre | **Corrigé** : listes, contact, sujet, échange, rapport. |
| (nouveau) frais d'installation sur aucun bon | **Ajouté** : bon de type `installation`, posé une seule fois à la signature. |

## 4. Points d'attention hors écart

- Le message de l'écran contrat prévient qu'à la signature, Pilotage et Site vitrine seront fermés s'ils ne sont pas activés (le cabinet A est en « Socle seul »). Conforme, mais à dire au cabinet avant qu'il signe.
- Le seuil d'arrêté périmé est de 45 jours par défaut ; la date d'arrêté saisie (20/11) est donc à jour.
- Le débit de l'API du suivi (120 écritures/min) est un compteur par instance du Worker ([chantier/ETAT.md](chantier/ETAT.md), « limite à trancher ») : non éprouvé ici.

## 5. Remise à zéro de l'environnement local

La base locale contient maintenant le cabinet A, ses données de test, trois sessions de test et des ajouts côté B. Pour repartir d'un état propre :

```bash
rm -rf .wrangler/state
npx wrangler d1 migrations apply bebess --local
npx wrangler d1 execute bebess --local --file=seeds/demo.sql
```

## 6. Synthèse

- 14 étapes conformes, 4 conformes avec écart non bloquant (1, 5, 8, 14), 1 rupture (19), 1 étape à écart de forme (20).
- **Bloquant avant mise en production : E1.** Sans conversion d'essai en contrat actif, aucun cabinet réel n'est facturable.
- **À corriger avant ouverture au premier cabinet : E2** (rendu des contenus).
- Le reste est de la forme (E3, E4), du scénario (E5, E8) ou de l'environnement et du jeu de test (E6, E7, E9).
- Aucune fuite entre cabinets n'a été observée dans les deux sens.
