# Labije Cab : mode d'emploi du gestionnaire

Ce document explique, pas à pas, comment utiliser votre espace. Vous y retrouvez ce que vous faites au quotidien, et ce que vous pouvez changer sur votre site public. Les captures d'écran seront ajoutées plus tard.

Les modules que vous avez souscrits déterminent ce que vous voyez. Selon votre formule, certaines entrées du menu n'apparaissent pas : c'est normal.

| Entrée du menu | Disponible avec |
| --- | --- |
| Tableau de bord, Viewers, Import CSV, Réglages | Socle (toujours) |
| Suivi, Actus, Bibliothèque | Module Pilotage |
| Contenus, Notes (et le site public) | Module Site vitrine |

Votre rôle compte aussi : l'**associé** voit tout, y compris les réglages et l'abonnement ; le **collaborateur** voit tout sauf les réglages ; le compte en **lecture** consulte sans modifier.

---

## 1. Se connecter

Il n'y a pas de mot de passe. Sur la page de connexion de votre cabinet, saisissez votre adresse e-mail et cliquez sur **« Recevoir un lien »**. Vous recevez un lien à usage unique. Ouvrez-le, puis confirmez : vous arrivez sur votre tableau de bord. Le lien expire au bout de quelques minutes ; vous pouvez en redemander un à tout moment.

Pour vous déconnecter, utilisez **« Déconnexion »** en haut de page.

## 2. Le tableau de bord

Il montre l'**encours total** que vous suivez, le nombre de clients, vos accès actifs, la date de dernière valorisation et, pour chaque client : son encours, sa **performance du mois**, la date de son dernier arrêté et son accès.

Un bandeau signale les clients dont l'arrêté est ancien (plus de 45 jours par défaut) ou absent. Un avertissement apparaît aussi quand la valeur du dernier point d'historique d'un client ne correspond plus à la somme de ses enveloppes : voir la section 4.

## 3. Créer un client

1. Menu **Nouveau viewer** : saisissez son nom et son adresse e-mail.
2. Le client reçoit un lien de première connexion par courriel.
3. Si vous suivez vos contacts dans le module Pilotage, vous pouvez aussi **promouvoir** un contact en client, depuis sa fiche (bouton « Promouvoir en viewer »). Ses informations sont reprises.

Un client nouvellement créé n'a encore rien à afficher : voir la section suivante.

## 4. Saisir les valeurs d'un client

Ouvrez la fiche du client (clic sur son nom dans le tableau de bord). Ses données se règlent dans l'ordre suivant.

1. **Enveloppes** (onglet « Enveloppes ») : une enveloppe par contrat ou compte (PEA, assurance-vie, compte-titres…). Renseignez le libellé, l'établissement, la date d'ouverture, la valorisation et la date d'arrêté.
2. **Lignes** (onglet « Lignes ») : les supports détenus dans chaque enveloppe, avec leur classe d'actifs et leur valorisation. Une enveloppe qui a des lignes vaut la **somme de ses lignes**.
3. **Nouvel arrêté** (onglet « Nouvel arrêté ») : à chaque arrêté, choisissez la date, cliquez sur « Charger », mettez à jour les valeurs, puis vérifiez. L'écran vous montre la **performance du mois** avant l'enregistrement : confirmez seulement si elle est plausible.
4. **Versements cumulés** : laissez le champ vide s'il n'y a eu ni apport ni retrait depuis le dernier point : la valeur précédente est reprise.
5. **Historique** (onglet « Historique ») : la liste des points mensuels. Pour corriger une date, saisissez à nouveau un point à cette date ; il remplace l'ancien.

**À savoir.** Pour que la performance soit calculable, il faut au moins **deux arrêtés à deux dates différentes**. Avec un seul, l'écran affiche « Non calculable » : ce n'est pas une erreur.

**Attention aux deux saisies.** L'onglet « Historique » n'écrit que le point d'historique ; l'état actuel du portefeuille (enveloppes et lignes) se met à jour par « Nouvel arrêté ». Si les deux divergent, le tableau de bord vous le signale.

## 5. Importer des lignes en masse

Menu **Import CSV**. Le fichier est en UTF-8, séparé par des points-virgules, avec la virgule comme séparateur décimal et les dates au format AAAA-MM-JJ. Colonnes dans l'ordre : `viewer_email`, `enveloppe`, `ligne`, `classe`, `valorisation_eur`, `pv_eur`, `frais_pct`, `arrete_le`, puis `portefeuille` (facultative). 250 lignes au plus, 500 Ko au plus. Les clients doivent exister avant l'import. L'écran affiche un aperçu : **rien n'est écrit tant que vous n'avez pas confirmé**.

## 6. Suivre vos contacts (module Pilotage)

- **Suivi** : trois vues. La **liste** (recherche, filtres par membre de l'équipe), le **kanban** (colonnes par statut des sujets) et le **parcours** (colonnes par étape de prospection).
- **Nouveau contact** : nom, prénom, e-mail, type (client, prospect, prescripteur, partenaire…), responsable.
- **La fiche d'un contact** réunit ses sujets à traiter (avec échéance), ses échanges (rendez-vous, appels, courriels), ses notes et, s'il est client, un panneau « Portail » avec son encours et sa performance.
- **Déplacer** : vous pouvez faire glisser une carte d'une colonne à l'autre, ou utiliser les boutons. On peut sauter une étape, revenir en arrière et rouvrir un sujet clos.
- **Écart d'allocation** : si vous posez des cibles dans l'onglet « Allocation cible » d'un client et que la réalité s'en écarte au-delà du seuil, la fiche propose de créer un sujet pour chaque classe concernée. Le bouton est grisé quand un sujet non clos existe déjà.

## 7. Actus et bibliothèque (module Pilotage)

- **Actus** : une fiche par jour. Le bloc « Chiffres » se remplit seul à partir des cours du marché ; vous saisissez le résumé, les faits, ce qu'il y a « à dire aux clients », les mots-clés et la source. Vous pouvez coller le texte d'origine tel quel.
- À partir d'une actu enregistrée, vous pouvez **créer une note de marché** (voir la section 9).
- **Bibliothèque** : vos documents et liens de référence, classés par catégorie, avec recherche.

## 8. Les contenus de votre site public (module Site vitrine)

Menu **Contenus**. Votre site comprend six pages : **Accueil, Approche, Parcours, Contact, Notes de marché** (la page de liste) et **Mentions légales**. Pour chacune :

1. Cliquez sur **« Modifier »** à droite de la ligne.
2. Remplissez les champs. Chaque champ correspond à un emplacement précis de la page : étiquette, titre, introduction, missions, questions fréquentes, appel final…
3. Cliquez sur **« Enregistrer »**, puis sur **« Aperçu »** pour voir le résultat.

Quelques règles utiles :
- dans un champ de texte long, **séparez les paragraphes par une ligne vide** ;
- le champ « Description (balise meta) » n'est **pas affiché** sur la page : il sert aux moteurs de recherche ;
- le site se rafraîchit en une minute environ après l'enregistrement ;
- vous ne composez pas la mise en page : la structure de chaque page est fixe, seul son contenu change.

Le formulaire de contact du site envoie un courriel à l'adresse que vous indiquez dans le champ « Adresse de réception des messages ».

## 9. Les notes de marché

Menu **Notes**. Une note est d'abord un **brouillon**, invisible du public.
1. Créez-la (à la main, ou depuis une actu), rédigez son titre, son chapeau et son texte (les intertitres se notent avec `##`).
2. Cliquez sur **« Publier »** : son statut devient « Publié » et elle apparaît sur la page Notes de votre site.
3. **« Repasser en brouillon »** la retire du site sans la supprimer.

Les chiffres d'une actu ne bougent plus une fois sa note publiée.

## 10. Les réglages (associé uniquement)

Menu **Réglages**, onglets :
- **Listes** : les valeurs proposées dans les menus déroulants (statuts, étapes, types de contact, classes d'actifs…). Vous pouvez en ajouter, les renommer, les réordonner et les désactiver. Une valeur déjà utilisée ne se supprime pas : on la désactive.
- **Seuils** : jours sans échange, délai de rappel, ancienneté d'un arrêté, écart d'allocation.
- **Membres** : l'équipe, avec une couleur par membre.
- **Accès** : les personnes qui se connectent à votre espace. Créer un accès au-delà des accès inclus dans votre contrat s'accompagne d'un message qui indique le montant facturé. Un accès en lecture n'est jamais facturé.
- **Identité** : le nom affiché, le thème de couleurs de votre site et de l'espace client (cinq au choix), et votre logo (PNG, JPEG ou WebP, 512 Ko au plus).
- **Mentions légales** : les mentions affichées sur le site (raison sociale, ORIAS, statut, association, médiateur, hébergeur, contact pour les données personnelles).
- **Mon abonnement** : votre formule, le montant, le nombre d'accès facturables et la liste de vos comptes.

## 11. Ce que voient vos clients

Votre client se connecte avec son adresse e-mail et voit **son** espace : valorisation, performance de l'année, évolution, répartition, mouvements en cours et rapports. Il peut choisir l'apparence de son espace (liste « Apparence » en pied de page) ; par défaut c'est le thème de votre cabinet. Un client ne voit jamais les données d'un autre client ni celles d'un autre cabinet.

## 12. Exporter vos données

Sur le tableau de bord, la section **Exports** fournit des fichiers CSV (contacts, sujets, échanges, actus) et, pour l'associé, l'export complet du cabinet. Vos données restent les vôtres.

## 13. En cas de difficulté

Notez ce que vous faisiez, le message affiché et l'heure, puis écrivez à votre interlocuteur. Les incidents techniques sont aussi consultés de notre côté.
