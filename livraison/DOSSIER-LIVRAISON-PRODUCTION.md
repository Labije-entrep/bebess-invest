# Labije Cab : dossier de livraison en production

Version du 22 novembre 2026. Premier jet, à ajuster après la recette.

Ce dossier explique **comment mettre Labije Cab en production** et **comment livrer un premier cabinet**. Il est écrit pour être suivi dans l'ordre par quelqu'un qui n'a pas construit l'outil. Chaque étape a une **preuve** : on ne passe à la suivante que si elle est obtenue.

## Lire d'abord

**Ce qui est éprouvé et ce qui ne l'est pas.** La recette en ligne a validé le produit sur Cloudflare : site, espace gestionnaire, espace client, contrat, bons de commande, migrations. Les éléments ci-dessous n'ont **jamais été essayés en réel** et doivent être validés pendant cette mise en production, un par un :

| Élément | Pourquoi c'est à valider |
| --- | --- |
| Envoi de courriels (Scaleway) | Aucun courriel réel n'est parti pendant la recette. |
| Noms de domaine de cabinets (Cloudflare for SaaS) | Le code suit la documentation de Cloudflare, mais n'a jamais parlé au vrai service. |
| Sous-domaines de plateforme (route joker) | Jamais configuré. |
| Stockage de fichiers (R2) | Seulement émulé en local, jamais activé en recette. |
| Cours de marché (Alpha Vantage) | Aucun appel réel, aucune clé. |
| Traitement quotidien (Cron) | Éprouvé en local et lancé à la main sur la base de recette, jamais déployé. |

**Ce que ce dossier ne remplace pas.** Les documents juridiques (contrat d'abonnement, DPA, conditions générales, politique de confidentialité) sont à rédiger avec un juriste. Les textes de la page « Mentions de la plateforme » sont provisoires.

---

## 1. Les acteurs et ce que chacun fait

Quatre rôles, que ce dossier désigne par une lettre :

| | Qui | Ce qu'il fait |
| --- | --- | --- |
| **A** | **L'éditeur** (Labije Software) | Édite et héberge Labije Cab. Crée les cabinets, pose les contrats, assure l'exploitation. |
| **B** | **Le cabinet** (le gestionnaire) | Utilise l'espace gestionnaire, alimente les données de ses clients, administre le contenu de son site public. |
| **C** | **Les visiteurs** | Cherchent le site du cabinet par **son nom**. Ne se connectent pas. |
| **D** | **Les clients du cabinet** | Se connectent à leur espace pour consulter leur patrimoine. |

**Qui voit quoi, et à quelle adresse :**

| Écran | Édité par | Utilisé par | Adresse recommandée |
| --- | --- | --- | --- |
| Site public du cabinet | A (le produit), B (le contenu) | C | Le **nom de domaine de B** : l'adresse doit rappeler B, pas A. |
| Espace gestionnaire | A | B | Celle de B ou une adresse de A (peu importe, B seul y accède). |
| Espace client | A | D | Celle de B de préférence ; une adresse de A est acceptable, A étant clairement indiqué comme éditeur. |
| Console de l'éditeur | A | A seul | Une adresse de A (par exemple `console.<domaine de A>`). |

**Le principe technique à retenir.** Il n'y a **qu'une seule application** pour tous les cabinets. Quand une requête arrive, le produit lit le **nom d'hôte** de l'adresse, cherche le cabinet qui le porte, et sert ses pages avec son contenu et son thème. Un même cabinet peut donc être joint par **plusieurs adresses** : celle de A (toujours disponible) et celle de B (son propre nom de domaine).

---

## 2. L'architecture en une page

Tout est chez **Cloudflare**, sur le compte de A, sauf les courriels et les cours de marché.

| Brique | Rôle | Nom de production |
| --- | --- | --- |
| Worker du site | Répond aux visiteurs, aux gestionnaires, aux clients, sert les fichiers statiques | `labije-cab` |
| Worker du traitement | Tâche quotidienne à 03:00 UTC : bons de commande, courriels d'essai, cours de marché | `labije-cab-traitement` |
| Base de données D1 | Toutes les données (cabinets, clients, valorisations, contrats, bons) | `labije-cab` |
| Stockage R2 | Fichiers : rapports PDF, logos, factures déposées. Jamais d'accès public | `labije-cab-fichiers` |
| Zone DNS de la plateforme | Le nom de domaine de A, géré chez Cloudflare | à choisir |
| Cloudflare for SaaS | Valide et sert les noms de domaine propres aux cabinets | (service) |
| Scaleway (courriels) | Envoie les liens de connexion et les courriels d'essai | compte à créer |
| Alpha Vantage | Fournit les cours de marché (clé gratuite) | clé à créer |
| GitHub | Le code. Branche `develop` (intégration) et `master` (production) | dépôt existant |

**Flux d'une requête :** le visiteur tape une adresse → le DNS l'envoie à Cloudflare → le Worker du site lit le nom d'hôte → il retrouve le cabinet en base → il répond avec les pages de ce cabinet.

---

## 3. Choisir les adresses

Trois montages sont possibles. Ils se combinent.

| Montage | Adresse du site public | Adresse de l'espace client | Quand le choisir |
| --- | --- | --- | --- |
| **1. Tout chez B** | `www.cabinet-b.fr` | `www.cabinet-b.fr/connexion` | Le cabinet a ou prend un nom de domaine. **Cible à terme.** |
| **2. Site chez B, espace chez A** | `www.cabinet-b.fr` | `cabinet-b.<domaine de A>` | Le cabinet veut son site à son nom mais accepte une adresse de A pour ses clients. |
| **3. Tout chez A** | `cabinet-b.<domaine de A>` | `cabinet-b.<domaine de A>/connexion` | Cabinet sans nom de domaine, ou **pilote**. Aucune configuration de son côté. |

**Ma recommandation.** Commencer le pilote en **montage 3** (immédiat, sans dépendance chez le cabinet), puis passer au **montage 1 ou 2** quand le cabinet a son nom. L'adresse de A reste toujours valide, même une fois le nom de B branché.

**Deux points à connaître.**
- **Le contenu en double.** Quand le site de B est joint par deux adresses, ses pages publiques existent aux deux adresses. Pour les moteurs de recherche, il faudrait signaler l'adresse de B comme adresse principale. **Ce n'est pas encore développé** (voir la section 9).
- **Changer d'adresse déconnecte les clients**, car la session est liée à l'adresse. Choisissez l'adresse de l'espace client une fois pour toutes.

---

## 4. Les prérequis

Cochez chaque ligne avant de passer à la procédure. La colonne « preuve » dit comment s'en assurer.

### 4.1 Comptes et abonnements

| # | Prérequis | Responsable | Preuve |
| --- | --- | --- | --- |
| 1 | **Compte Cloudflare** de Labije Software, avec moyen de paiement | A | Connexion au tableau de bord. |
| 2 | **Plan Workers payant** recommandé : l'offre gratuite limite le temps de calcul par requête, ce qui peut gêner un site rendu côté serveur (à vérifier au moment de souscrire) | A | Plan affiché dans le tableau de bord. |
| 3 | **R2 activé** sur le compte (une carte bancaire est demandée, l'usage reste dans l'offre gratuite au début) | A | `npx wrangler r2 bucket list` répond sans erreur. |
| 4 | **Compte Scaleway** avec le service de courriel transactionnel (TEM), région Paris | A | Connexion à la console Scaleway. |
| 5 | **Clé Alpha Vantage** gratuite | A | La clé est reçue par courriel. |
| 6 | **Node 22.18 ou plus** et `wrangler` sur le poste de déploiement | A | `node -v` et `npx wrangler whoami`. |

### 4.2 Nom de domaine de la plateforme

| # | Prérequis | Responsable | Preuve |
| --- | --- | --- | --- |
| 7 | **Choisir et acheter le nom de domaine** de Labije Cab (par exemple `labije-cab.fr`) | A | Le domaine est à votre nom. |
| 8 | **Marque** : vérifier le dépôt de « Labije Cab » et du logo à l'INPI, avant de communiquer largement | A | Certificat ou récépissé de dépôt. |
| 9 | **Ajouter la zone chez Cloudflare** et changer les serveurs de noms chez le registrar | A | La zone est « active » chez Cloudflare. |

### 4.3 Courriels

| # | Prérequis | Responsable | Preuve |
| --- | --- | --- | --- |
| 10 | **Domaine d'envoi vérifié chez Scaleway**, avec les enregistrements SPF, DKIM et DMARC posés dans la zone | A | Le domaine est « vérifié » chez Scaleway. |
| 11 | **Un lien de connexion reçu** sur une adresse Outlook professionnelle, hors courrier indésirable | A | Capture du courriel reçu. |
| 12 | Une adresse d'expédition (`MAIL_FROM`) et une adresse de support de l'éditeur | A | Adresses créées. |

### 4.4 Juridique et commercial

| # | Prérequis | Responsable | Preuve |
| --- | --- | --- | --- |
| 13 | **DPA** (accord de sous-traitance) modèle prêt à faire signer à chaque cabinet | A + juriste | Document signé. La console refuse la mise en production sans date de DPA. |
| 14 | **Contrat d'abonnement** et conditions générales, dont la mention de la marque Labije Cab et l'engagement de 12 mois | A + juriste | Documents validés. |
| 15 | **Politique de confidentialité** et registre des traitements de Labije Software | A + juriste | Documents validés. |
| 16 | **Identité de la plateforme** : raison sociale, forme, capital, SIREN, siège, directeur de la publication, contact, hébergeur | A | Renseignée dans la console `/admin/reglages` ; la page `/plateforme` l'affiche. |
| 17 | **Hébergement des données** : vérifier avec Cloudflare et Scaleway la localisation et le cadre contractuel (clauses types) | A | Note écrite. |
| 18 | **Grille tarifaire** : 79, 49, 39 et 25 € HT par mois (+ 15 % en mensuel), engagement de 12 mois | A | Grille validée. |
| 19 | **Outil de facturation** : le produit prépare des bons de commande `BC-AAAA-NNNN`, vous facturez dans vos outils | A | Outil choisi. |

### 4.5 Exploitation

| # | Prérequis | Responsable | Preuve |
| --- | --- | --- | --- |
| 20 | **Sauvegardes** : qui exporte la base, à quelle fréquence, où est stockée la copie | A | Procédure écrite et un export réalisé. |
| 21 | **Surveillance** : qui consulte `/admin/incidents` et les journaux, à quel rythme | A | Rythme fixé. |
| 22 | **Support** : adresse, délai de réponse annoncé | A | Texte dans le contrat. |

### 4.6 Code

| # | Prérequis | Responsable | Preuve |
| --- | --- | --- | --- |
| 23 | **Recette validée** sur toutes les étapes jouables | A | Compte rendu de recette. |
| 24 | **`develop` vert** : `npm test` et `npm run check` sans erreur | A | Résultats affichés. |
| 25 | **Fusion de `develop` dans `master`** par une demande de fusion (la branche est protégée) | A | La PR est fusionnée. |

---

## 5. La procédure de mise en production

Toutes les commandes se lancent depuis le dossier du projet, sur `master` à jour, avec `npx wrangler login` fait. **Ne lancez jamais `seeds/demo.sql` ni un autre jeu de démonstration sur la production.**

### Étape 1. Préparer les fichiers de configuration

Le dépôt est public : les identifiants ne doivent jamais y figurer. Copiez les deux configurations de production vers des fichiers **ignorés par Git** :

```bash
git checkout master && git pull
cp wrangler.toml wrangler.prod.toml
cp wrangler.cron.toml wrangler.cron.prod.toml
```

Les noms de production sont déjà posés : `labije-cab`, `labije-cab-traitement`, base `labije-cab`, stockage `labije-cab-fichiers`.

**Preuve :** `git status` ne montre pas `wrangler.prod.toml` (il est ignoré).

### Étape 2. Créer les ressources

```bash
npx wrangler d1 create labije-cab
npx wrangler r2 bucket create labije-cab-fichiers
```

Notez le `database_id` renvoyé par la première commande et reportez-le **dans les deux fichiers `*.prod.toml`** (à la place de `A_REMPLIR`). Ne créez **aucun** domaine public ni accès `r2.dev` sur le stockage.

**Preuve :** les deux commandes réussissent ; `npx wrangler d1 list` montre `labije-cab`.

### Étape 3. Créer le schéma de la base

```bash
npx wrangler d1 migrations apply labije-cab --remote -c wrangler.prod.toml
```

**Preuve :** toutes les migrations (0001 à 0018) sont cochées. **Prenez ensuite un point de restauration** : `npx wrangler d1 time-travel info labije-cab` et notez la ligne « bookmark ».

### Étape 4. Poser les secrets et les variables

Les secrets se posent **une fois pour le Worker du site, une fois pour le Worker du traitement**. Chaque commande demande la valeur en saisie.

```bash
# Worker du site
npx wrangler secret put SCW_SECRET_KEY -c wrangler.prod.toml
npx wrangler secret put SCW_PROJECT_ID -c wrangler.prod.toml
npx wrangler secret put MAIL_FROM      -c wrangler.prod.toml
npx wrangler secret put CF_API_TOKEN   -c wrangler.prod.toml
npx wrangler secret put COURS_API_KEY  -c wrangler.prod.toml

# Worker du traitement : les mêmes cinq
npx wrangler secret put SCW_SECRET_KEY -c wrangler.cron.prod.toml
npx wrangler secret put SCW_PROJECT_ID -c wrangler.cron.prod.toml
npx wrangler secret put MAIL_FROM      -c wrangler.cron.prod.toml
npx wrangler secret put CF_API_TOKEN   -c wrangler.cron.prod.toml
npx wrangler secret put COURS_API_KEY  -c wrangler.cron.prod.toml
```

Dans `wrangler.prod.toml`, ajoutez sous `[vars]` : `MAIL_DRIVER = "scaleway"`, `CF_ZONE_ID = "<identifiant de la zone>"`, `CF_CNAME_CIBLE = "<adresse de repli, voir l'étape 8>"`. Dans `wrangler.cron.prod.toml`, renseignez `CF_ZONE_ID`. **Ne posez jamais `MAIL_DRIVER = "console"` en production** : le produit n'enverrait plus aucun courriel.

Le jeton `CF_API_TOKEN` est limité à la zone de la plateforme, avec le droit « SSL et certificats : modifier » et le droit de gérer les noms d'hôte personnalisés.

**Preuve :** `npx wrangler secret list -c wrangler.prod.toml` liste les cinq secrets, et de même pour le traitement.

### Étape 5. Construire et déployer le site et le traitement

```bash
npm install
npm run build
npx wrangler deploy --dry-run -c wrangler.prod.toml
npx wrangler deploy -c wrangler.prod.toml
npx wrangler deploy -c wrangler.cron.prod.toml
```

**Preuve :** les deux déploiements réussissent. Dans le tableau de bord, `labije-cab-traitement` › Triggers montre le cron `0 3 * * *`, et ses variables montrent `DB` et `FICHIERS`.

### Étape 6. Brancher le nom de domaine de la plateforme

Dans le tableau de bord Cloudflare, sur la zone de la plateforme :
1. **Console de l'éditeur** : ajouter un domaine personnalisé du Worker `labije-cab` pour `console.<domaine de A>`.
2. **Sous-domaines des cabinets** : ajouter un enregistrement DNS joker `*` (proxifié), puis une **route** `*.<domaine de A>/*` vers le Worker `labije-cab`. Les sous-domaines de A (`cabinet-b.<domaine de A>`) arrivent alors au Worker.
3. Le certificat de la zone (Universal SSL) couvre les sous-domaines directs.

**Preuve :** `https://console.<domaine de A>` répond (la page de connexion) en https, sans avertissement.

**À valider à la première mise en place :** le fonctionnement de la route joker avec le domaine personnalisé. Si un point diffère de ce qui est décrit, notez-le : ce dossier sera corrigé.

### Étape 7. Activer les noms de domaine propres aux cabinets (Cloudflare for SaaS)

1. Dans la zone, activer **Cloudflare for SaaS** (noms d'hôte personnalisés).
2. Créer l'**origine de repli** : un enregistrement DNS proxifié, par exemple `repli.<domaine de A>`, qui mène au Worker du site (route `*/*` ou équivalent selon la documentation Cloudflare du moment).
3. Reporter ce nom dans `CF_CNAME_CIBLE` de `wrangler.prod.toml`, puis redéployer le Worker du site (étape 5).

**Preuve :** dans la console de l'éditeur, la fiche d'un cabinet ne dit plus « Jeton d'API Cloudflare absent ». Un nom d'hôte de test déclaré affiche l'enregistrement CNAME à poser.

Cloudflare annonce un quota gratuit de noms d'hôte personnalisés, puis une facturation à l'unité : à vérifier sur leur tarification avant de promettre un nombre de domaines aux cabinets.

### Étape 8. Configurer les courriels

1. Chez Scaleway : vérifier le domaine d'envoi, poser les enregistrements SPF, DKIM et DMARC dans la zone Cloudflare.
2. Attendre la vérification, puis tester un envoi vers une adresse Outlook professionnelle.

**Preuve :** un courriel de test est reçu, dans la boîte de réception et pas dans le courrier indésirable.

### Étape 9. Créer le premier compte éditeur

Le premier compte éditeur se crée à la main, **une seule fois**, car personne ne peut encore se connecter pour le créer. Remplacez les valeurs entre chevrons :

```bash
npx wrangler d1 execute labije-cab --remote -c wrangler.prod.toml --command "INSERT INTO tenant (id, nom, domaine, cree_le) VALUES ('tnt_editeur', 'Labije Software', 'console.<domaine de A>', '2026-12-01T09:00:00Z')"
npx wrangler d1 execute labije-cab --remote -c wrangler.prod.toml --command "INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le) VALUES ('usr_editeur', 'tnt_editeur', '<votre adresse>', '<votre nom>', 'editeur', 1, '2026-12-01T09:00:00Z')"
```

Ouvrez ensuite `https://console.<domaine de A>`, demandez votre lien de connexion, ouvrez-le, confirmez.

**Preuve :** vous arrivez sur la console `/admin`, et le lien est bien arrivé dans votre boîte.

### Étape 10. Renseigner la plateforme dans la console

Dans `/admin/reglages` :
- l'**adresse du compte de support** de l'éditeur ;
- l'**identité de la plateforme** (raison sociale, forme, capital, SIREN, siège, directeur de la publication, contact, hébergeur).

**Preuve :** `https://console.<domaine de A>/plateforme` affiche ces informations, et l'avertissement « Identité de la plateforme incomplète » a disparu.

### Étape 11. Contrôle de fumée

À faire **avant** de livrer un cabinet :
1. Le site s'ouvre en https sur `console.<domaine de A>`.
2. Vous recevez un lien de connexion **réel** et arrivez sur `/admin`.
3. Vous créez un cabinet **de test** (nom, hôte `test.<domaine de A>`, grille 79/49/39/25 €), posez le DPA, la mise en production, puis signez le contrat.
4. Son gestionnaire de test reçoit et ouvre son lien.
5. Le site public de ce cabinet s'ouvre sur `test.<domaine de A>` après avoir rempli au moins l'accueil.
6. Un client de test est promu, reçoit son lien et voit son espace.
7. Vous déclenchez le traitement quotidien : un bon de commande est produit. Pour le lancer à la main : `npx wrangler dev -c wrangler.cron.prod.toml --test-scheduled --remote`, puis `curl "http://localhost:8787/__scheduled"`.
8. Un dépôt de rapport PDF et son téléchargement marchent (premier test réel du stockage R2).

**Preuve :** les huit points sont cochés. Supprimez ensuite le cabinet de test depuis la console, ou suspendez-le.

### Étape 12. Organiser la sauvegarde et la surveillance

- **Sauvegarde automatique de Cloudflare** : la base D1 garde un historique restaurable (`wrangler d1 time-travel`). C'est un filet, pas une sauvegarde à vous.
- **Sauvegarde à vous** : un export régulier, stocké ailleurs et chiffré, par exemple chaque semaine : `npx wrangler d1 export labije-cab --remote -c wrangler.prod.toml --output=sauvegarde.sql`. Faites un **essai de restauration** dans une base de test avant la première livraison.
- **Surveillance** : consulter `/admin/incidents` chaque jour ouvré les premières semaines, et les journaux avec `npx wrangler tail labije-cab`. Activez les notifications de Cloudflare sur les échecs de Worker et de tâche planifiée.

**Preuve :** un fichier d'export existe et sa restauration a été essayée.

---

## 6. Livrer un cabinet B

Dérouler la **checklist de livraison d'un cabinet** (document séparé). Pour l'adresse :

### Montage 3 : sous-domaine de A (le pilote)

1. À la création du cabinet dans la console, saisir comme **nom d'hôte** : `cabinet-b.<domaine de A>`.
2. Rien d'autre : l'adresse répond immédiatement, en https.

### Montage 1 ou 2 : le nom de domaine de B

1. **A** : à la création, laisser le sous-domaine de A comme hôte d'origine.
2. **A** : dans la fiche du cabinet, rubrique « Domaines », déclarer le nom d'hôte de B (`www.cabinet-b.fr`). La console affiche l'enregistrement **CNAME** à poser.
3. **B** (ou son prestataire) : crée cet enregistrement chez son hébergeur de noms de domaine, et conserve son site actuel sur une autre adresse tant que la bascule n'est pas décidée.
4. **Cloudflare** vérifie et délivre le certificat. La console passe le nom à **« validé »**.
5. **A** : vérifie que `www.cabinet-b.fr` affiche bien le site et la connexion de B.

**Preuve :** le nom de B est « validé » dans la console, et le site s'ouvre en https à cette adresse.

**Un nom non validé n'ouvre rien.** Prévoir quelques heures à quelques jours selon le prestataire de B.

---

## 7. L'exploitation courante

### Mettre à jour la production

1. Les évolutions passent par `develop` (demande de fusion, tests verts).
2. Quand une version est validée en recette : demande de fusion de `develop` dans `master` (la branche est protégée).
3. Sur `master` à jour : **migrations d'abord**, puis déploiement du code.

```bash
npx wrangler d1 time-travel info labije-cab        # noter le point de restauration
npx wrangler d1 migrations apply labije-cab --remote -c wrangler.prod.toml
npm run build
npx wrangler deploy -c wrangler.prod.toml
npx wrangler deploy -c wrangler.cron.prod.toml
```

**Une règle d'or :** une migration ne se défait pas. Elle s'essaie d'abord en recette, sur une copie de la base.

### Revenir en arrière

| Situation | Que faire |
| --- | --- |
| Le nouveau code se comporte mal, la base est compatible | Revenir à la version précédente du Worker : `npx wrangler rollback -c wrangler.prod.toml`. |
| Une migration a mal tourné | Restaurer la base au point de restauration noté avant : `npx wrangler d1 time-travel restore labije-cab --bookmark=<point>`. Les écritures faites depuis sont perdues : prévenir les cabinets. |
| Un cabinet doit être coupé (impayé, litige) | Console › fiche du cabinet › Suspension. Rien n'est effacé, ses clients gardent leur espace. |
| Le courriel ne part plus | Consulter `/admin/incidents` (type « Mail refusé »), vérifier Scaleway et les secrets. |

### Tâches courantes

- **Chaque jour ouvré** : consulter `/admin/incidents` et la liste des bons à émettre.
- **Chaque mois** : émettre les bons de commande, puis facturer dans vos outils.
- **Chaque semaine** : exporter la base, vérifier que le traitement quotidien a tourné (incident « cours » ou « courriel » éventuels).
- **Fin d'essai et résiliation** : le traitement prévient le cabinet à J+38, J+45 et J+68, et supprime ses données à J+75 (J+30 pour une résiliation). Un export complet est proposé avant.

---

## 8. Quand ça ne marche pas

| Symptôme | Cause probable | Que faire |
| --- | --- | --- |
| L'adresse d'un cabinet affiche « page introuvable » ou la connexion d'un autre cabinet | Le nom d'hôte ne correspond à aucun cabinet, ou il n'est pas validé | Vérifier le nom d'hôte du cabinet dans la console, et son état « validé ». |
| Les pages publiques d'un cabinet répondent 404 | Le module Site vitrine n'est pas actif sur son contrat | Console › fiche › « 2. Modules » › Activer. |
| Aucun lien de connexion ne part | `MAIL_DRIVER` mal posé, secrets absents, domaine d'envoi non vérifié | Vérifier `/admin/incidents` et les secrets ; ne jamais poser `console` en production. |
| Un client ne peut plus se connecter après un changement d'adresse | La session est liée à l'ancienne adresse | Lui demander de se reconnecter par un nouveau lien. |
| Le nom de B reste « non validé » | L'enregistrement CNAME n'est pas posé ou pas encore propagé | Revérifier l'enregistrement chez l'hébergeur de B ; attendre la propagation. |
| Les cours de marché ne s'affichent pas | Clé Alpha Vantage absente ou quota atteint | Console › incidents ; vérifier le secret `COURS_API_KEY`. |

---

## 9. Points ouverts : ce qui reste à développer ou à valider

| Sujet | État |
| --- | --- |
| **Adresse principale du site de B** : signaler aux moteurs de recherche l'adresse de B comme principale quand son nom propre est validé (balise canonique, ou exclusion de l'adresse de A de l'indexation) | **Non développé.** À faire avant d'ouvrir un site de cabinet au public sous deux adresses. |
| **Noms de domaine de cabinets** (Cloudflare for SaaS) | Code écrit selon la documentation, **jamais essayé en réel**. |
| **Route joker** pour les sous-domaines de A | Jamais configurée. |
| **Courriels réels** (Scaleway) | Jamais essayés. |
| **Stockage de fichiers réel** (R2) | Jamais essayé en réel. |
| **Cours de marché réels** | Aucun appel réel ; formes de réponse lues dans la documentation du fournisseur. |
| **Sauvegarde automatisée** de la base, avec alerte | À mettre en place. |
| **Défaut d'affichage mobile** : le contenu principal reste collé au bord gauche | Signalé, non corrigé. |
| **Textes juridiques** : mentions de la plateforme, politique de confidentialité | Provisoires. |
| **Marque blanche** | Volontairement non prévue pour l'instant. |

---

## Annexe A. Secrets et variables

| Nom | Type | Worker du site | Worker du traitement | À quoi ça sert |
| --- | --- | --- | --- | --- |
| `SCW_SECRET_KEY` | secret | oui | oui | Clé d'accès au service de courriel |
| `SCW_PROJECT_ID` | secret | oui | oui | Projet Scaleway |
| `MAIL_FROM` | secret | oui | oui | Adresse d'expédition |
| `CF_API_TOKEN` | secret | oui | oui | Noms d'hôte personnalisés et libération des domaines |
| `COURS_API_KEY` | secret | oui | oui | Clé Alpha Vantage |
| `MAIL_DRIVER` | variable | `scaleway` | `scaleway` | Choix du pilote de courriel. Jamais `console` en production |
| `CF_ZONE_ID` | variable | oui | oui | Zone qui porte les noms d'hôte personnalisés |
| `CF_CNAME_CIBLE` | variable | oui | non | Adresse de repli que le cabinet vise par CNAME |

## Annexe B. Glossaire

| Terme | Sens |
| --- | --- |
| **Cabinet** | Un client de l'éditeur (B). Un « locataire » dans le produit. |
| **Gestionnaire** | L'utilisateur du cabinet (associé, collaborateur, lecture). |
| **Viewer** | Un client final d'un cabinet (D). |
| **Éditeur** | Labije Software (A). |
| **Nom d'hôte** | L'adresse sans le `https://` : `www.cabinet-b.fr`. Le produit reconnaît le cabinet grâce à lui. |
| **CNAME** | Enregistrement DNS qui renvoie un nom vers un autre. |
| **Bon de commande** | Document préparé par le produit pour l'échéance d'un contrat (`BC-AAAA-NNNN`). Ce n'est pas une facture. |
| **Worker** | Programme exécuté par Cloudflare. |
| **D1, R2** | Base de données et stockage de fichiers de Cloudflare. |
| **Point de restauration** | Photo de la base que Cloudflare peut restaurer (`time-travel`). |
