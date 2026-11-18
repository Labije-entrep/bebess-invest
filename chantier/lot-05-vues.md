# Lot 05 — Kanban et parcours

Les deux vues manquantes du basculement, sur les données déjà chargées par
`/api/suivi/etat`. Aucun nouveau point d'entrée.

**Kanban** : une colonne par statut de sujet, dans l'ordre de la liste de référence.
Chaque carte porte le sujet, le contact et l'échéance. Faire avancer un sujet se fait
par un bouton sur la carte, pas par glisser-déposer : c'est accessible au clavier et
il n'y a rien à déboguer.

**Parcours** : une colonne par étape de prospection, les contacts de type prospect
rangés dedans, avec leurs avoirs estimés et le total par colonne. Les étapes viennent
de la liste de référence : si un cabinet en définit quatre, il y a quatre colonnes.

Les filtres par membre et la recherche s'appliquent aux deux vues. La vue choisie est
retenue dans `localStorage`, dans un `try/catch`.

## Vérification

Un cabinet dont les listes d'étapes et de statuts diffèrent des valeurs par défaut
doit produire le bon nombre de colonnes.
