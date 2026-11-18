# Lot 08 — Fichiers et exports

## R2

Ajoute le binding et `src/lib/fichiers.ts`. **Règle absolue** : aucun objet n'est
servi par une URL publique de R2. Tout passe par une route du Worker qui vérifie la
session, le locataire et le rôle avant de répondre. La clé d'un objet commence par
l'identifiant du locataire.

Trois usages :

- **Les rapports des viewers.** La table `document` existe depuis le lot 1 du portail
  mais aucun envoi n'a jamais été implémenté, alors que l'onglet Rapports les promet.
  Le gestionnaire dépose un PDF pour un portefeuille, le viewer le télécharge. Limite
  de taille explicite, type vérifié sur le contenu et pas sur l'extension.
- Les logos des contacts.
- Le logo du cabinet, utilisé par le site et l'espace.

## Exports

Produits par le serveur, en CSV, un fichier par jeu :

- Le suivi : contacts, sujets, échanges, actus.
- **Un contact seul**, avec ses sujets, ses échanges et ses notes : c'est la réponse à
  une demande d'accès RGPD, et elle doit tenir en un clic.
- Un locataire entier, toutes tables, pour une fin de contrat.

Pas de générateur de classeur Excel dans le Worker : le poids du paquet est déjà un
sujet et le CSV suffit.

## Vérification

Télécharger un document avec la session d'un viewer d'un autre cabinet doit répondre
`404`. Un export de contact doit contenir ses échanges.
