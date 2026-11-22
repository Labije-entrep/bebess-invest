# Labije Cab : checklist de livraison d'un cabinet

À dérouler à chaque nouveau cabinet, dans l'ordre. Une case se coche quand la **preuve** est obtenue.

## 0. Avant de commencer
- [ ] Le cabinet a signé le **DPA** (sans date de DPA, la console refuse la mise en production).
- [ ] Vous disposez de : raison sociale, SIREN, adresse de facturation, contact de facturation, adresse e-mail du premier gestionnaire, thème choisi.
- [ ] Les **modules** souscrits sont connus : le socle est obligatoire, Pilotage et Site vitrine sont optionnels. Il n'existe pas d'offre « site seul ».
- [ ] La formule : annuelle (engagement de 12 mois) ou mensuelle, les accès inclus (3 par défaut), les frais d'installation.
- [ ] Le **nom d'hôte** du cabinet (par exemple `patrimoine.cabinet.fr`) et la personne qui peut poser un enregistrement CNAME chez son hébergeur DNS.

- [ ] **Identité de la plateforme renseignée** dans la console `/admin/reglages` (rubrique « Identité de la plateforme » : raison sociale, forme juridique, capital, SIREN, siège, directeur de la publication, contact, hébergeur). La console avertit quand elle est incomplète ; la page publique `/plateforme` de chaque cabinet n'affiche que les lignes renseignées. Les textes de cette page sont provisoires, à faire valider par un juriste.
- [ ] **Preuve** : la page `/plateforme`, ouverte sur l'hôte du cabinet sans être connecté, affiche l'identité de la société éditrice.

## 1. Créer le cabinet (console de l'éditeur)
- [ ] Console `/admin` › Nouveau cabinet : nom, nom d'hôte, premier gestionnaire, SIREN, adresse, contact de facturation, thème.
- [ ] **Preuve** : la fiche du cabinet s'ouvre, « Cabinet créé » est affiché, l'associé figure dans les accès.

## 2. Poser le contrat
- [ ] Rubrique « 1. Formule et prix » : périodicité, quatre prix en euros HT (grille standard : 79, 49, 39 et 25 €), accès inclus, frais d'installation. Cliquer sur « Ouvrir le contrat ».
- [ ] Rubrique « 2. Modules » : activer Pilotage et Site vitrine selon la commande. **Pendant l'essai tout est ouvert ; à la signature un module non activé se ferme.**
- [ ] Rubrique « 5. Démarrage » : date du DPA, puis mise en production (début de l'essai de 45 jours).
- [ ] À la fin de l'essai, **« Signer le contrat »** : le contrat devient actif, le bon d'installation est posé s'il y a des frais.
- [ ] **Preuve** : statut « Actif », date de début de service posée.

## 3. Choisir et brancher l'adresse du cabinet

Principe : **les visiteurs cherchent le cabinet par son nom**, donc l'adresse du site public doit rappeler le cabinet, pas l'éditeur. L'adresse de l'espace client peut rappeler l'éditeur, qui y est clairement indiqué. Le produit reconnaît le cabinet par le **nom d'hôte** de l'adresse ; un même cabinet peut avoir plusieurs adresses.

- [ ] Choisir le montage avec le cabinet :
  - **Montage 3, tout chez l'éditeur** : `cabinet.<domaine de l'éditeur>`. Immédiat, sans rien configurer chez le cabinet : c'est le choix du **pilote**.
  - **Montage 1, tout chez le cabinet** : `www.cabinet.fr` pour le site et la connexion. Cible à terme.
  - **Montage 2, site chez le cabinet, espace chez l'éditeur** : le site à son nom, ses clients sur l'adresse de l'éditeur.
- [ ] **Montage 3** : saisir `cabinet.<domaine de l'éditeur>` comme nom d'hôte à la création du cabinet. Rien d'autre.
- [ ] **Montages 1 et 2** : le sous-domaine de l'éditeur reste l'hôte d'origine ; dans la rubrique « Domaines » de la fiche, déclarer le nom d'hôte du cabinet ; la console affiche l'enregistrement **CNAME** à poser.
- [ ] Le cabinet (ou son prestataire) pose cet enregistrement CNAME chez son hébergeur de noms de domaine, et garde son site actuel sur une autre adresse tant que la bascule n'est pas décidée.
- [ ] **Preuve** : le nom d'hôte est « validé » dans la console (nécessite le jeton Cloudflare de la plateforme), et le site s'ouvre en https à cette adresse. Un nom non validé n'ouvre rien.
- [ ] **Poser les adresses** (fiche du cabinet › « Domaines » › « Adresses du cabinet ») une fois le nom validé : « Adresse du site public » = `www.cabinet.fr` (montages 1 et 2) ; « Adresse de connexion et d'espace » = `www.cabinet.fr` (montage 1 seulement). Tant que rien n'est choisi, tout reste à l'hôte d'origine, sans redirection.
- [ ] Prévenir le cabinet : **changer l'adresse de connexion et d'espace déconnecte ses clients et gestionnaires** (la session est liée à l'adresse) ; la console le rappelle avant l'enregistrement. À choisir une fois pour toutes, avant l'ouverture aux clients.
- [ ] **Contrôler** : l'ancienne adresse (celle de l'éditeur) redirige vers le site du cabinet (page publique) et vers l'adresse de connexion choisie (`/connexion`) ; un courriel de lien de connexion porte la bonne adresse ; la canonique des pages publiques est celle du site du cabinet.

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
