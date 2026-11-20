# Fil d'étapes : de la recette à la production

Ce document se lit de haut en bas. Chaque case se coche une fois la ligne
« **Preuve** » obtenue. Ne passez pas à l'étape suivante si une preuve manque.

Trois parties :

- **A. La version de test (recette) avec les vraies données de la v0.**
- **B. Les prérequis pour ouvrir le SaaS en production.**
- **C. Le déploiement en production.**

Légende : 🧑 = vous (je ne peux pas le faire à votre place : compte, mot de passe,
décision, relecture) · 🤖 = Claude peut le faire dans une session · 💻 = commande
à copier dans le Terminal.

---

## 0. Ce que j'ai vérifié, et ce qui manque

**RECETTE.md ne suffit pas, il couvre la moitié.** Il décrit très bien comment monter
un second environnement Cloudflare séparé (base, fichiers, deux Workers, schéma,
déploiement, remise à zéro, grille tarifaire). Mais :

| Constat | Conséquence | Traité à l'étape |
| --- | --- | --- |
| Il charge `seeds/demo.sql`, des données **fictives**. Rien sur les données réelles de la v0. | Il faut un chemin « données v0 → base ». | A5 |
| Aucune donnée v0 n'est dans le dépôt, et rien n'en décrit le format. | Je ne peux pas confirmer qu'elle s'importe telle quelle. | A5 |
| L'import CSV existant (`/gestionnaire/import`) ne sait charger que **les lignes de portefeuille** (8 colonnes, 250 lignes max, 500 Ko). Pas les contacts, notes, sujets. | Ce qui n'est pas du portefeuille demande un script de conversion (🤖). | A5 |
| Il dit de se connecter avec `editeur@demo.local`. Or en recette le pilote de courriel `console` refuse de tourner hors `localhost` : **aucun lien de connexion n'arrive**. | On ne peut pas se connecter au site déployé sans un vrai envoi (Scaleway) ou une session posée à la main. | A3 |
| Le seed rattache le cabinet de démo à l'hôte `localhost`. Le site déployé répond sur `xxx.pages.dev`. | Le site ne reconnaîtrait aucun cabinet : il faut aligner l'hôte. | A4 |
| Aucune étape ne crée le **premier compte éditeur** sur une base vierge (le seed le faisait). | Sans lui, personne n'ouvre `/admin`. | A4 et C4 |

**Le site « déjà codé »** : oui, il est dans le dépôt (`src/pages` : accueil,
approche, parcours, contact, mentions légales, version anglaise, espace client,
console `/admin`). `README.md` est **périmé** (il parle d'un site statique, Node 18,
CMS) : ignorez-le, le déploiement fait foi dans `DEPLOIEMENT.md` et `RECETTE.md`.

**Données réelles en recette = vraies données personnelles.** Vous êtes responsable
de ces données. Règles tenues dans tout ce qui suit : environnement séparé de la
prod, aucun lien public vers les fichiers, accès limité à vous, suppression de la
base de recette quand elle ne sert plus (RECETTE.md §6).

---

## Partie A : la version de test avec les données de la v0

### A1. Comptes à avoir 🧑
- [ ] Un compte **Cloudflare** (gratuit suffit pour la recette).
- [ ] Un compte **Scaleway** avec Transactional Email (TEM). Un domaine d'envoi **de
      test**, distinct de celui de la prod, avec SPF, DKIM, DMARC posés.
- [ ] Node 22.18 ou plus récent : 💻 `node -v`
- **Preuve** : `node -v` affiche 22.18 ou plus ; vous vous connectez aux deux consoles.

### A2. Préparer le poste 🧑 + 💻
```bash
cd ~/Dev/Bebess-invest
git checkout main && git pull
npm install
npx wrangler login
npm run check
npm test
```
- **Preuve** : `npm run check` → 0 erreur ; `npm test` → tout vert.

### A3. Créer l'environnement de recette 🧑 + 💻 (RECETTE.md §2 et §4)
1. 💻 `npx wrangler d1 create bebess-recette` → **notez le `database_id`**.
2. 💻 `npx wrangler r2 bucket create bebess-fichiers-recette` (jamais de domaine
   public ni `r2.dev`).
3. 🤖 Je crée `wrangler.recette.toml` et `wrangler.cron.recette.toml` comme décrit
   dans RECETTE.md §2 (je ne touche pas `wrangler.toml` ni `wrangler.cron.toml`, qui
   portent la prod). Donnez-moi le `database_id`.
4. **Courriels : choisissez maintenant.** Pour ouvrir une vraie session sur le site
   déployé, il faut recevoir le lien. Donc : pilote `scaleway` avec le domaine de
   test, secrets posés avec 💻 :
   ```bash
   npx wrangler secret put SCW_SECRET_KEY -c wrangler.cron.recette.toml
   npx wrangler secret put SCW_PROJECT_ID -c wrangler.cron.recette.toml
   npx wrangler secret put MAIL_FROM      -c wrangler.cron.recette.toml
   ```
   (Le site Pages a aussi besoin de ces trois secrets : les poser dans Cloudflare →
   Workers & Pages → `bebess-recette` → Settings → Variables and Secrets.)
5. 💻 Le schéma : `npx wrangler d1 migrations apply bebess-recette --remote -c wrangler.recette.toml`
- **Preuve** : la commande liste les migrations 0001 à 0014 « applied ».

### A4. Poser le cabinet et le compte éditeur (sans le seed de démo) 🤖 + 🧑
Pour des données réelles, **n'utilisez pas `seeds/demo.sql`** : il crée des
cabinets fictifs et l'hôte `localhost`.
1. 🧑 Déployez une première fois pour connaître l'adresse du site :
   💻 `npm run build && npx wrangler pages deploy dist --project-name bebess-recette`
   → relevez l'adresse `https://…pages.dev`.
2. 🤖 Je vous fournis les deux ordres SQL (cabinet avec **cet hôte**, puis votre compte
   `editeur` avec **votre** adresse), à jouer avec `d1 execute … --remote`.
   Colonnes : `tenant(id, nom, domaine, cree_le)` puis
   `utilisateur(id, tenant_id, email, nom, role='editeur', actif, cree_le)`.
3. 💻 `npx wrangler deploy -c wrangler.cron.recette.toml` (le traitement quotidien).
4. 🧑 Ouvrez le site, demandez votre lien de connexion, ouvrez-le, confirmez.
- **Preuve** : vous arrivez sur `/admin`, et le lien est bien arrivé dans votre boîte.

### A5. Les données réelles de la v0 🧑 + 🤖
1. 🧑 **Donnez-moi un extrait de la v0** (3 à 5 lignes de chaque fichier, avec les
   noms réels masqués si vous préférez) : tableur, export, base ? C'est le point
   que je ne peux pas deviner.
2. 🧑 Demandez au partenaire : **l'autorisation écrite** d'utiliser ces données en
   test, et la liste de ce que contient la v0 (clients, portefeuilles, lignes,
   contacts, notes, rapports PDF).
3. 🤖 Je compare la v0 à ce que le produit sait charger et je vous dis, rubrique par
   rubrique : chargé tel quel / converti par un script / à ressaisir.
   - Lignes de portefeuille : CSV à 8 colonnes
     `viewer_email;enveloppe;ligne;classe;valorisation_eur;pv_eur;frais_pct;arrete_le`
     (+ `portefeuille`), séparateur `;`, UTF-8, décimale virgule, dates AAAA-MM-JJ.
     Les viewers doivent **déjà exister** : on les crée d'abord.
   - Contacts, notes, sujets : à convertir (script 🤖) vers les tables du suivi.
   - Rapports PDF : à déposer depuis l'écran « Fichiers » (10 Mo max, PDF/PNG/JPEG/WebP).
4. 🤖 Je produis les fichiers prêts à charger, **hors du dépôt** (jamais de données
   réelles dans Git), dans un dossier que vous choisissez.
5. 🧑 Chargez : création des viewers dans le gestionnaire, puis `/gestionnaire/import`
   (l'écran montre un aperçu et n'écrit rien tant que vous ne confirmez pas).
- **Preuve** : pour 2 ou 3 clients que vous connaissez, la valorisation totale à
  l'écran est égale au chiffre de la v0 (écart toléré : à fixer avec le partenaire).

### A6. Dérouler la recette 🧑 (30 à 40 minutes)
Suivre `chantier/RECETTE-E2E.md`, sections A à G, **dans l'ordre**, et s'arrêter au
premier échec en le notant. Avant : renseigner l'adresse de support dans `/admin` →
Réglages. Les six cas de tarif sont dans RECETTE.md §7 (à ne jamais jouer en prod).
- **À regarder vous-même** (aucun agent ne le fait) : les thèmes sombres sur le tableau
  de bord d'un client, la connexion dans **Safari**, un vrai courriel reçu, les
  mentions légales.
- **Preuve** : 22 étapes cochées, un compte rendu avec ce qui a été observé.

### A7. Faire valider par le partenaire 🧑
Lui donner l'adresse de recette, un compte `viewer` de test, et la liste de ce qu'il
doit vérifier. Recueillir ses retours par écrit. 🤖 Je corrige dans de nouveaux lots.
- **Preuve** : validation écrite (même un courriel).

---

## Partie B : prérequis pour une mise à disposition SaaS

Ce sont les cases laissées ouvertes dans `chantier/ETAT.md` (P2, P3, P4) plus ce qui
n'est pas du code.

### B1. Technique 🧑 + 💻
- [ ] **Domaine du produit** acheté, géré dans Cloudflare (DNS).
- [ ] **P2 : courriels de production.** Domaine d'envoi Scaleway de prod, SPF, DKIM,
      DMARC. Preuve : un lien de connexion reçu sur une adresse Outlook
      professionnelle (c'est le test de délivrabilité demandé dans ETAT.md).
- [ ] **P3 : domaines personnalisés** (Cloudflare for SaaS : chaque cabinet pointe son
      propre nom de domaine). Jeton API limité à la zone, droit « SSL and
      Certificates : Edit », puis `CF_ZONE_ID` et `CF_CNAME_CIBLE`. Cette partie n'a
      **jamais été essayée contre le vrai Cloudflare** : à éprouver en recette avant la
      prod avec un domaine de test.
- [ ] **P4 : le Worker du traitement quotidien** (`bebess-traitement`, Cron 03:00 UTC)
      déployé, avec ses six secrets. Il produit les bons à facturer et envoie les
      courriels d'essai.
- [ ] **Cours de marché** (Alpha Vantage) : clé à créer, sinon l'écran Actus le dit et
      fonctionne sans.
- [ ] **Sauvegardes** : décider qui exporte la base D1 (`wrangler d1 export`) et à
      quelle fréquence. Le produit offre l'export d'un cabinet, pas une sauvegarde de
      la plateforme.
- [ ] **Surveillance** : qui regarde `/admin/incidents` et les journaux Cloudflare, et
      à quel rythme.

### B2. Juridique et commercial 🧑 (aucun code ne le remplace)
- [ ] **DPA** (accord de sous-traitance RGPD) : modèle prêt à faire signer. La console
      refuse la mise en production d'un cabinet sans date de DPA.
- [ ] **CGV / contrat d'abonnement** et conditions d'essai (45 jours).
- [ ] **Mentions légales** exactes (ORIAS, médiateur, association agréée AMF, RCS) :
      à relire par vous ou un juriste.
- [ ] **Politique de confidentialité** et registre des traitements ; hébergement dans
      l'UE à vérifier côté Cloudflare (D1/R2 : localisation).
- [ ] **Facturation** : le produit émet un « bon à facturer », pas une facture légale
      (TVA 20 % codée). Décidez de l'outil qui émet la vraie facture.
- [ ] **Grille tarifaire** validée : 79 / 49 / 39 / 25 € (mensuel +15 %).
- [ ] **Premier cabinet** identifié (SIREN, adresse, contact de facturation).

### B3. Dernière relecture 🤖
- [ ] Je repasse `npm run check`, `npm test`, build et `wrangler deploy --dry-run` sur
      `main`, et je relis les points « non vérifié » d'`ETAT.md` pour vous dire
      lesquels deviennent bloquants pour la prod.
- **Preuve** : un rapport court, sans surprise.

---

## Partie C : le déploiement en production

À ne faire que si A7 et toute la partie B sont cochées.

### C1. Créer les ressources de prod 💻
```bash
npx wrangler d1 create bebess                  # → database_id à reporter dans wrangler.toml ET wrangler.cron.toml
npx wrangler r2 bucket create bebess-fichiers  # jamais de domaine public ni r2.dev
```
🤖 Je reporte les `database_id` (le fichier contient `A_REMPLIR`) et `CF_ZONE_ID`.

### C2. Configurer 💻
- `MAIL_DRIVER = "scaleway"` ; **jamais** `console` en prod.
- Secrets du site et du Worker : `SCW_SECRET_KEY`, `SCW_PROJECT_ID`, `MAIL_FROM`,
  `CF_API_TOKEN` (voir `DEPLOIEMENT.md`, 4ᵉ et 24ᵉ lignes).
- `CF_ZONE_ID` et `CF_CNAME_CIBLE` sous `[vars]`.

### C3. Schéma, jamais de seed 💻
```bash
npx wrangler d1 migrations apply bebess --remote
```
⚠ Ne **jamais** lancer `seeds/demo.sql` sur la prod.
- **Preuve** : migrations 0001 à 0014 appliquées.

### C4. Premier compte éditeur 🤖 + 🧑
Le cabinet de l'éditeur et votre compte `editeur` (mêmes deux ordres SQL qu'en A4,
avec l'hôte **de production**). C'est la seule écriture SQL à la main permise en
prod ; ensuite tout passe par `/admin`.

### C5. Déployer 💻
```bash
npm run build
npx wrangler pages deploy dist --project-name bebess
npx wrangler deploy -c wrangler.cron.toml
```
Puis dans Cloudflare : brancher le **domaine du produit** sur le projet Pages ;
vérifier, sous `bebess-traitement` → Triggers, que le cron est bien là, et que
`DB` et `FICHIERS` sont liés.

### C6. Contrôle de fumée 🧑 (10 minutes)
1. Le site public s'ouvre en HTTPS, sur le bon domaine.
2. Vous recevez un lien de connexion **réel**, arrivez sur `/admin`.
3. Adresse de support renseignée dans Réglages.
4. Créer le premier cabinet (hôte, SIREN, grille 7900/4900/3900/2500), poser le DPA,
   mettre en production, **signer le contrat** (RECETTE-E2E.md A1 à A3).
5. Le gestionnaire du cabinet reçoit et ouvre son lien (RECETTE-E2E.md B4).
6. Domaine personnalisé du cabinet validé chez Cloudflare (si utilisé).
7. Déclencher une fois le traitement quotidien : un bon est produit pour ce cabinet.
- **Preuve** : sept points cochés.

### C7. Après le lancement 🧑
- Sauvegarde D1 faite une première fois.
- Noter la date, la version déployée (`git log -1`) et ce que vous avez observé.
- Planifier la première revue de `/admin/incidents` (J+1, J+7).

---

## Si ça tourne mal
- **Une étape de recette échoue** : on s'arrête, on me donne le message exact, je
  corrige dans le dépôt, on redéploie la recette. On ne contourne pas.
- **Repartir de zéro en recette** : RECETTE.md §6 (supprimer et recréer la base).
- **Erreur en prod** : ne rien rejouer au hasard ; me transmettre la sortie de la
  commande. Les migrations ne se défont pas : c'est pour cela que la recette existe.
