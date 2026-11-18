# Lot 00 — Préalable : fusion et correctifs de saisie

Prérequis : **P1**.

## 1. La fusion

Vérifie que `main` porte bien le lot 6 du portail. Si ce n'est pas le cas,
arrête-toi : c'est une opération humaine (`git merge --ff-only`), pas la tienne.

## 2. Cinq correctifs sur la saisie du gestionnaire

Tu modifies des écrans existants, tu n'en crées pas de parallèles.

### 2.1 Défaut à corriger en premier — versements cumulés

`src/lib/gestion.ts`, `enregistrerPoint()` : un champ vide vaut `0`. Comme la
performance calcule `flux = versements(n) − versements(n−1)`, un champ laissé vide
produit un flux négatif énorme et une performance fausse de plusieurs dizaines de
points, affichée au client final.

- Un champ vide signifie « inchangé depuis le point précédent », et zéro seulement
  s'il n'existe aucun point antérieur.
- Dans le formulaire de l'onglet Historique, préremplis le champ avec la valeur du
  dernier point et rappelle cette valeur dans l'aide.
- Renomme le libellé en « Versements cumulés nets (apports moins retraits) ».
- Avant enregistrement, affiche la performance du mois que le point implique.
  Au-delà de ±20 %, demande une confirmation explicite plutôt que de refuser : une
  vraie variation forte doit rester saisissable.

### 2.2 Un seul écran « Nouvel arrêté »

Aujourd'hui un arrêté mensuel oblige à passer par l'onglet Enveloppes, puis Lignes,
puis Historique, et c'est au troisième qu'on oublie les versements.

Fais un écran unique : une date, les enveloppes et les lignes préremplies avec leurs
valeurs actuelles, modifiables, et le point du mois dans le même formulaire. À
l'enregistrement, une seule transaction écrit `arrete_le` sur les enveloppes et les
lignes, et le point à cette date. `valeur_cents` du point est proposée comme la somme
des enveloppes et reste modifiable. Si un point existe déjà à cette date, charge-le
pour modification. Les onglets existants restent pour les corrections ponctuelles.

### 2.3 Fraîcheur réelle, et non la plus récente

`viewersResumes()` prend `MAX(arrete_le)` sur les enveloppes : un portefeuille dont
une ligne date de mai s'affiche comme à jour. Prends la plus **ancienne** date
d'arrêté parmi les lignes et les enveloppes, et joins-y la date du dernier point.
Garde `seuilArrete(45)`.

Même correction côté viewer : `src/pages/espace/index.astro` utilise `plusRecent()`
pour « Arrêté au » et « Dernière synchronisation ». La plus ancienne est la seule
honnête.

### 2.4 Dates d'arrêté par ligne côté viewer

`src/pages/espace/portefeuille.astro` n'a pas de colonne de date. Ajoute-la, formatée
avec `arrete()`. Aucune valorisation ne s'affiche sans sa date.

### 2.5 Bandeau de rappel sur `/gestionnaire`

La colonne « Arrêté au » signale déjà les périmés, mais seulement si on lit le
tableau. Ajoute en haut un bandeau listant les viewers au-delà du seuil, avec un lien
vers leur nouvel arrêté. Calculé au chargement. Pas de tâche planifiée, pas de mail.

## Vérification

Cas précis à éprouver pour 2.1 : point à 800 000 € avec 500 000 € de versements, puis
point à 820 000 € en laissant le champ vide. La performance affichée doit être de
**+2,5 %** et non de +65 %.
