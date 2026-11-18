# Lot 13 — Écrans d'abonnement et console

## Côté cabinet : « Mon abonnement »

Dans les réglages, visible du **seul** rôle `associe`. Sept blocs, dans cet ordre :

1. La formule en mots, la périodicité, la date de prochain renouvellement.
2. Le montant détaillé : une ligne par poste avec quantité × prix unitaire, la remise
   sur sa propre ligne avec son motif en clair, le total annuel HT et son équivalent
   mensuel.
3. Les accès : « N accès actifs, 3 inclus » puis la liste nominative avec les rôles.
   Cette liste existe pour que le cabinet fasse le ménage avant la date anniversaire :
   ne la cache pas derrière un dépliant.
4. La phrase de dépassement, seulement si les accès actifs dépassent les inclus.
5. Les espaces clients : le nombre publié, suivi de « illimités, non facturés ».
6. Les parrainages : nombre validé, remise obtenue, la règle en une phrase.
7. Les factures : la liste des PDF, en lecture seule.

Puis une ligne de contact humain, puisqu'il n'y a aucun libre-service.

Phrase affichée **une seule fois** à la création du 4ᵉ accès et au-delà, dans la
confirmation, avec la date du contrat, texte exact :

> Cet accès est actif immédiatement et gratuit jusqu'au 14/03/2027. À partir de cette
> date, les accès au-delà du troisième sont facturés 25 € HT par mois.

## Ce que cette page ne contient pas

Et que tu ne dois pas ajouter par réflexe : aucun bouton de changement d'offre, de
résiliation ou de moyen de paiement ; **aucune jauge**, aucune barre de progression,
aucun pourcentage — une jauge sous-entend un plafond et il n'y en a aucun ; aucun
graphique d'usage ni projection de coût ; aucune fenêtre modale, aucune bannière
persistante, aucun compte à rebours. Les nombres s'affichent en chiffres.

## Côté éditeur, dans la console du lot 10

- **Les bons à émettre**, triés par date, avec leur montant, et le bon imprimable
  portant tout ce qu'il faut pour taper la facture : raison sociale, SIREN, adresse et
  contact de facturation, période, lignes, remise et motif, total HT, taux et montant
  de TVA, total TTC, numéro attribué.
- Les contrats : prix, modules, remises, gel de tarif, dates.
- Les remises dont la date de revue est passée.
- Les parrainages et leur statut.
- Le journal d'événements d'un cabinet.
- Le total de noms de domaine consommés.
- **La suspension d'un cabinet** : action explicite, motif obligatoire, horodatée.
  Elle rend les accès cabinet inopérants et **laisse** les espaces des clients finaux
  en ligne. Ne jamais inverser cette règle : les clients finaux ne sont pas partie au
  litige commercial.

Aucune suspension automatique nulle part, pour aucun motif, impayé compris.

## Vérification

La page d'abonnement avec une session `collaborateur` doit répondre `404` ; un cabinet
suspendu doit laisser ses clients finaux consulter leur espace.
