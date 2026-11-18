# Lot 01 — Socle de données et listes de référence

Prérequis : **P1**. Aucun écran dans ce lot.

## 1. La migration

Crée `migrations/0003_suivi.sql` à partir de `chantier/20-schema.sql`, **tel quel**.
Ne l'adapte pas, ne le complète pas. Si quelque chose te paraît manquer, arrête-toi
et demande.

Dans la même migration, recrée `enveloppe`, `point` et `cible` pour qu'elles portent
`portefeuille_id` au lieu de `viewer_id`. La contrainte des points devient
`UNIQUE(portefeuille_id, date)`. La base est vide : recrée les tables, ne les altère
pas. Reprends leurs colonnes actuelles à l'identique pour le reste.

## 2. Trois modules dans `src/lib`

- `listes.ts` : `valeursDe(db, tenantId, liste)` et
  `valeurValide(db, tenantId, liste, cle)`. Toute écriture qui pose une valeur de
  liste passe par ce validateur. Une valeur absente ou inactive est refusée avec la
  liste des valeurs admises.
- `version.ts` : `incrementerVersion(db, tenantId)`, appelée par toute écriture du
  module, et `versionDe(db, tenantId)`.
- `listes-defaut.ts` : les valeurs par défaut d'un nouveau cabinet — types de
  contact, métiers, étapes, types d'échange, statuts de sujet, catégories de
  documents, classes d'actifs, statuts de mouvement, types de portefeuille.

## 3. Raccordement

Adapte `src/lib/db.ts`, `src/lib/espace.ts` et `src/lib/gestion.ts` aux nouvelles
clés. Un viewer sans portefeuille n'existe pas : en créer un, libellé
« Patrimoine », chaque fois qu'un viewer est créé.

Mets à jour `seeds/demo.sql` : trois membres, les listes par défaut, un portefeuille
par viewer, et un deuxième portefeuille sur un seul viewer pour éprouver le cas.

## Vérification

Le portail doit fonctionner comme avant. Parcours complet — connexion, `/espace`,
`/gestionnaire`, saisie d'un arrêté — sur base locale remise à zéro. Note dans
`ETAT.md` ce que tu as dû changer dans le portail.
