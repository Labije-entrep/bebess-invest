# Lot 01b — Correctif : l'espace viewer sur tous ses portefeuilles

Le lot 01 a raccordé le portail au niveau portefeuille par un raccourci :
`src/lib/db.ts` ligne 67, `PORTEFEUILLE_DU_VIEWER` ne retient que le premier
(`ORDER BY ordre, id LIMIT 1`). Les enveloppes, les cibles et les points sont lus
avec ce filtre. Un viewer qui a deux portefeuilles voit donc une valorisation
incomplète, une répartition partielle et une performance qui n'est pas la sienne,
sans aucun signe que quelque chose manque.

C'est un chiffre faux affiché à un client final. Rien d'autre n'est prioritaire
dans ce lot.

## 1. Lire tous les portefeuilles

Supprime `PORTEFEUILLE_DU_VIEWER`. Les enveloppes, lignes, cibles et points se
lisent sur **l'ensemble** des portefeuilles du viewer, par
`portefeuille_id IN (SELECT id FROM portefeuille WHERE viewer_id = ? AND tenant_id = ?)`.
Le filtre par locataire ne disparaît nulle part.

## 2. Un sélecteur, seulement s'il y a de quoi choisir

Dans `/espace`, quand le viewer a **plus d'un** portefeuille : un sélecteur avec
« Tout » en premier, puis un libellé par portefeuille. Avec un seul portefeuille,
aucun sélecteur ne s'affiche et l'écran est strictement celui d'aujourd'hui.

Le choix vaut pour les quatre pages de l'espace et se transmet par le chemin ou un
paramètre, jamais par un état en mémoire : un lien partagé doit rouvrir la même vue.

## 3. Performance consolidée

Sur « Tout », additionne les valeurs et les versements cumulés à chaque date, puis
enchaîne sur ces totaux avec `performanceEnchainee`. **Ne moyenne jamais des
performances.**

Les portefeuilles n'ont pas forcément les mêmes dates de point. Règle à appliquer,
sans l'inventer autrement : pour chaque date de l'union des dates, un portefeuille
sans point à cette date compte pour sa **dernière valeur connue** reportée, et pour
**zéro** avant son premier point. Un portefeuille ouvert en juin ne doit donc pas
faire apparaître un versement fictif en juin.

## 4. Les cibles ne se consolident pas

Les cibles sont définies par portefeuille. Sur « Tout », affiche la répartition
réelle **sans** comparaison aux cibles, avec une ligne : « Les cibles sont définies
par portefeuille. » Sur un portefeuille donné, la comparaison est celle
d'aujourd'hui.

N'invente pas une cible consolidée pondérée : ce serait un objectif que personne
n'a fixé.

## 5. Le gestionnaire doit pouvoir alimenter le second

Aujourd'hui rien ne permet de saisir sur un autre portefeuille que le premier, ce
qui est la raison pour laquelle le second de Claire est resté vide.

Sur la fiche viewer de `/gestionnaire` : lister les portefeuilles, en créer,
renommer, réordonner, choisir leur type dans la liste `type_portefeuille`. L'écran
« Nouvel arrêté » prend le portefeuille concerné en tête de formulaire. Un viewer
garde toujours au moins un portefeuille : le dernier ne se supprime pas.

## 6. Deux dettes de vérification du lot 01

- **Le parcours de connexion n'a jamais été éprouvé de bout en bout.** Les sessions
  avaient été insérées à la main. Fais-le pour de vrai : demande de lien, lecture du
  jeton dans la sortie du pilote `console`, ouverture du lien, confirmation, session
  posée, accès à `/espace`. Si la sortie du mail n'apparaît pas, c'est un défaut à
  corriger, pas à contourner.
- **`astro check` n'a jamais tourné**, faute de `@astrojs/check`. Installe-le en
  dépendance de développement et fais passer le contrôle. Signale ce qu'il trouve
  sans corriger ce qui sort de ce lot.

## Vérification

Claire, deux portefeuilles aux dates de point différentes : son total sur « Tout »
doit être la somme des deux, et sa performance consolidée doit tomber juste sur un
calcul refait à la main sur trois mois. Un viewer à un seul portefeuille ne doit
voir aucun changement, sélecteur compris.
