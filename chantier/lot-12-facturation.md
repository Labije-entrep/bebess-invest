# Lot 12 — Compteurs, essai et bons à facturer

Prérequis : **P4** (Cron Trigger activé).

Tables `parrainage` et `bon_a_facturer`. Le bon porte sa clé d'unicité
`(contrat_id, periode_debut)` : c'est elle qui rend le traitement rejouable.

## Calcul du prix

Dans `src/lib/tarif.ts`, fonction pure et testée :

- `acces_facturables` = nombre d'utilisateurs de rôle `associe` ou `collaborateur` en
  statut actif. `lecture`, `support_editeur` et `viewer` ne sont **jamais** comptés.
- Lignes : socle ; Pilotage si actif ; Site vitrine si actif ;
  `max(0, acces_facturables − acces_inclus) × prix_acces_sup`.
- Annuel = mensuel × 12. Mensuel = prix × 1,15 arrondi à l'euro, **ligne par ligne** :
  79 → 91, 49 → 56, 39 → 45, 25 → 29. Jamais un coefficient sur le total.
- Remise appliquée = `min(50, remise_parrainage_taux + remise_commerciale_taux)`, où
  `remise_parrainage_taux = min(50, 25 × parrainages validés)`. Assiette : le récurrent
  seulement, jamais les frais d'installation.
- Prorata d'un module activé en cours de période : mois entiers de la date
  d'activation à la date anniversaire, arrondis au supérieur, sur un bon
  complémentaire.

Cas de test obligatoires, anniversaire au 14/03/2027 :
activation le 20/11/2026 → 4 mois → 196 € ; le 02/03/2027 → 1 mois → 49 €.

## Numérotation

Le numéro `FACT-AAAA-NNNN` est attribué par le produit au passage du bon à `emise`,
**dans la même transaction**, jamais avant et jamais saisi à la main. Séquence unique,
chronologique, sans trou. Un bon annulé après émission garde son numéro :
l'annulation se fait par un avoir, avec sa propre séquence.

## Traitement quotidien

Un Cron Trigger, un seul, idempotent — il doit pouvoir être rejoué dix fois sans rien
dupliquer ni réexpédier. Quatre travaux :

1. Contrats dont la date anniversaire tombe dans 30 jours : lire `acces_facturables`,
   recalculer la remise de parrainage, générer le bon, notifier l'éditeur.
2. Parrainages `en_attente` ayant atteint 6 mois de service payant : passer à `valide`.
3. Contrats en essai : déclencher J+38, J+45, J+68, J+75.
4. Remises dont la date de revue est passée : les lister pour la console.

## Essai

45 jours à compter de `date_mise_en_production`, produit entier, rien de bridé.

- **J+38** : courriel « l'essai se termine dans une semaine ».
- **J+45** : accès cabinet **et** espaces des clients finaux suspendus ; courriel
  annonçant la suppression au J+75 avec le lien d'export.
- **J+68** : courriel « suppression dans une semaine ».
- **J+75** : suppression **réelle**, pas un drapeau. Dossiers, valorisations,
  mouvements, documents, rapports, comptes des clients finaux, comptes du cabinet,
  site et son contenu ; objets R2 effacés ; nom de domaine personnalisé libéré via
  l'API Cloudflare. Conservés : raison sociale, SIREN, contact, historique du contrat,
  facture d'installation, journal expurgé de toute donnée de client final.

Ces quatre courriels sont les **seuls** envois automatiques du produit vers un
cabinet. Aucun autre, sur aucun sujet, et surtout rien sur l'abonnement.

## Export

Une archive ZIP déclenchable par un `associe` sans passer par l'éditeur, à tout moment
et jusqu'au J+75 : CSV et JSON des données structurées, plus les PDF déjà générés.
Réutilise l'export du lot 08.

## Vérification

Rejouer le traitement trois fois de suite sur la même journée — un seul bon, un seul
courriel. Puis les deux cas de prorata ci-dessus, à l'euro.
