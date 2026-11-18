# Règles communes

## Contexte et économie

Tu travailles sur la branche `main`, une fois le lot 6 du portail fusionné dedans
(prérequis P1). Elle porte le site public rendu depuis la base, l'espace viewer,
les écrans gestionnaire, la connexion par lien magique et le cloisonnement par
locataire.

Ne lis que les fichiers que ton lot nomme, plus ceux qu'ils importent. Ne reformate
rien. N'ajoute aucune dépendance sans le dire. Ne réécris pas ce qui marche.
Vérifie une fois, en local, puis arrête-toi.

## Conventions du projet

- Argent en centimes entiers, pourcentages en centièmes de point, dates ISO 8601.
- Toute lecture et toute écriture sont portées par le locataire, résolu par le nom
  d'hôte sans le port. Jamais de requête qui ne filtre pas sur `tenant_id`.
- Une liste fermée qui varie d'un cabinet à l'autre est une table de référence avec
  clé étrangère, jamais une contrainte `CHECK`.
- Aucun appel à un modèle de langage, aucune génération de texte, aucune heuristique
  qui devine. Le produit est déterministe.
- Le navigateur n'appelle aucun domaine extérieur. Les polices viennent de
  `@fontsource`, les services tiers sont appelés côté serveur.
- Pas de CI GitHub. Une seule tâche planifiée dans tout le produit, au lot 12.
- Les pages publiques et l'espace viewer restent rendus au serveur. Seul le module
  de suivi, derrière la connexion, est rendu côté client.
- La performance est pondérée par le temps, enchaînée mois par mois. Ne remplace
  jamais ce calcul par un rendement simple.

## Charte

Toutes les couleurs viennent des jetons définis dans `src/styles/app.css`. Aucune
valeur littérale dans un composant. Le thème du cabinet redéfinit ces jetons sur la
racine : n'en contourne aucun.

Typographie : Newsreader pour les titres et les chiffres d'affichage, IBM Plex Sans
pour le texte, IBM Plex Mono pour les étiquettes en capitales. Toutes auto-hébergées.

Palette des graphiques, validée en contraste :
`#B9862B`, `#4E9BD6`, `#C9684E`, `#3FA98A`, `#9B7BD4`

Sémantique : `--positif` `#4FB08D`, `--alerte` `#C2614F`. Ne les utilise pour rien
d'autre.

Les maquettes font foi pour la mise en page. Elles sont dans le dossier `maquettes/`
**à la racine du dépôt**, pas sous `chantier/` : depuis la racine, `ls maquettes/`.
Ouvre-les avant de coder, et lis `maquettes/LISEZMOI.md`.

## Vérification

`astro check` doit passer avant tout commit. Si `@astrojs/check` manque, installe-le
en dépendance de développement.

La vérification se fait sur le résultat de `npm run build` servi par `wrangler dev`,
pas sur le serveur de développement : la CSP à nonce et le regroupement des scripts
ne s'y comportent pas pareil.

Relève le poids du paquet du Worker après ton lot et note-le dans `ETAT.md`. Une
bibliothèque de douze mégaoctets a déjà dû être remplacée après coup.

Signale dans `ETAT.md` toute couleur littérale que tu rencontres dans un composant,
même hors de ton périmètre, sans y toucher. Au lot 09, cinq thèmes redéfiniront tous
les jetons : une couleur écrite en dur ne suivra pas le thème et deviendra illisible
sur l'un d'eux.

Après les lots 07 et 10, rejoue le test de cloisonnement à six cas : ce sont les
deux lots qui ouvrent des chemins entre des données qui ne se touchaient pas.

## Ce qui reste exclu

Aucune IA ni génération de texte. Pas de CI. Pas de glisser-déposer. Pas de champs
personnalisés ni de constructeur de formulaires. Pas de générateur Excel dans le
Worker. Aucun domaine externe appelé par le navigateur. Aucune URL publique de R2.
Aucune suspension automatique, pour aucun motif.
