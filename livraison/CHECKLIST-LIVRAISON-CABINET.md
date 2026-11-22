# Checklist de livraison d'un cabinet

À dérouler à chaque nouveau cabinet, dans l'ordre. Une case se coche quand la **preuve** est obtenue.

## 0. Avant de commencer
- [ ] Le cabinet a signé le **DPA** (sans date de DPA, la console refuse la mise en production).
- [ ] Vous disposez de : raison sociale, SIREN, adresse de facturation, contact de facturation, adresse e-mail du premier gestionnaire, thème choisi.
- [ ] Les **modules** souscrits sont connus : le socle est obligatoire, Pilotage et Site vitrine sont optionnels. Il n'existe pas d'offre « site seul ».
- [ ] La formule : annuelle (engagement de 12 mois) ou mensuelle, les accès inclus (3 par défaut), les frais d'installation.
- [ ] Le **nom d'hôte** du cabinet (par exemple `patrimoine.cabinet.fr`) et la personne qui peut poser un enregistrement CNAME chez son hébergeur DNS.

## 1. Créer le cabinet (console de l'éditeur)
- [ ] Console `/admin` › Nouveau cabinet : nom, nom d'hôte, premier gestionnaire, SIREN, adresse, contact de facturation, thème.
- [ ] **Preuve** : la fiche du cabinet s'ouvre, « Cabinet créé » est affiché, l'associé figure dans les accès.

## 2. Poser le contrat
- [ ] Rubrique « 1. Formule et prix » : périodicité, quatre prix en euros HT (grille standard : 79, 49, 39 et 25 €), accès inclus, frais d'installation. Cliquer sur « Ouvrir le contrat ».
- [ ] Rubrique « 2. Modules » : activer Pilotage et Site vitrine selon la commande. **Pendant l'essai tout est ouvert ; à la signature un module non activé se ferme.**
- [ ] Rubrique « 5. Démarrage » : date du DPA, puis mise en production (début de l'essai de 45 jours).
- [ ] À la fin de l'essai, **« Signer le contrat »** : le contrat devient actif, le bon d'installation est posé s'il y a des frais.
- [ ] **Preuve** : statut « Actif », date de début de service posée.

## 3. Brancher le nom de domaine
- [ ] Rubrique « Domaines » de la fiche : déclarer le nom d'hôte.
- [ ] Le cabinet pose l'enregistrement CNAME indiqué chez son hébergeur DNS.
- [ ] **Preuve** : le nom d'hôte est « validé » (nécessite le jeton Cloudflare de la plateforme).

## 4. Donner l'accès au gestionnaire
- [ ] Le gestionnaire ouvre son lien de première connexion (nécessite le service de courriel configuré).
- [ ] Il arrive sur `/gestionnaire`.
- [ ] Remettre le [mode d'emploi du gestionnaire](MODE-EMPLOI-GESTIONNAIRE.md).

## 5. Si le module Site vitrine est souscrit
- [ ] Recueillir les contenus du cabinet, page par page (accueil, approche, parcours, contact, mentions légales) : titres, textes, questions fréquentes, coordonnées.
- [ ] Les saisir dans Contenus, ou les faire saisir par le cabinet.
- [ ] Renseigner Réglages › Identité (nom affiché, logo, thème) et Mentions légales.
- [ ] Publier une ou deux notes de marché pour que la page Notes ne soit pas vide.
- [ ] **Preuve** : les six pages du site répondent sur le nom d'hôte du cabinet, sans mention « (exemple) » ni texte provisoire.
- [ ] Rappel au cabinet : le formulaire de contact envoie un courriel à l'adresse choisie.

## 6. Si le module Pilotage est souscrit
- [ ] Vérifier les listes de référence (étapes, types de contact, statuts) et les adapter au vocabulaire du cabinet.
- [ ] Créer les membres de l'équipe.
- [ ] Importer les contacts existants ou en créer quelques-uns avec le cabinet.

## 7. Les clients du cabinet
- [ ] Créer les premiers clients (ou promouvoir des contacts).
- [ ] Saisir enveloppes, lignes et deux arrêtés (ou importer un fichier CSV).
- [ ] **Preuve** : le client voit sa valorisation et sa performance dans son espace.

## 8. Facturation
- [ ] Le **bon de commande** est préparé par le traitement quotidien. Contrôler l'identité de facturation (SIREN, adresse, contact) avant de l'émettre.
- [ ] Éventuellement poser une remise ponctuelle sur une ligne (motif obligatoire), tant que le bon est un brouillon.
- [ ] Émettre le bon, puis facturer dans vos outils internes (le produit ne produit pas de facture).

## 9. Clôture de la livraison
- [ ] Le cabinet a confirmé qu'il se connecte et voit ce qu'il attend.
- [ ] Date de livraison et version déployée notées.
- [ ] Prévoir un point à J+7 et à J+30 : consulter les incidents du cabinet dans la console.
