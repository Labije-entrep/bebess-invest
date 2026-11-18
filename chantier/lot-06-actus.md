# Lot 06 — Actus, bibliothèque, cours

**Aucune IA nulle part dans ce lot.** Les chiffres sont récupérés bruts et mis en
forme ; les mots sont écrits par un associé.

## Cours

`src/lib/cours.ts` récupère les cours côté serveur, jamais depuis le navigateur, et
les range dans la table `cours`, qui est globale.

- **Récupération paresseuse** : à l'ouverture de la vue Actus, si le cours du jour
  d'un symbole manque, va le chercher. Pas de tâche planifiée.
- Un appel par symbole et par jour au maximum. La clé gratuite du fournisseur
  autorise vingt-cinq requêtes par jour : cinq symboles par défaut (CAC 40, S&P 500,
  Nasdaq 100, EUR/USD, Brent), les symboles suivis étant un réglage du cabinet. Si la
  liste d'un cabinet dépasse le budget, n'en récupère pas plus et consigne la raison.
- Tout échec écrit une ligne dans `incident` et n'interrompt rien : la vue affiche la
  dernière valeur connue avec sa date.

## Actus

Une fiche par jour, unique par cabinet et par date.

- L'éditeur s'ouvre avec le bloc Chiffres **déjà rempli** depuis la table `cours` :
  libellé, valeur, variation, sens, formatés, non modifiables, avec leur date.
- Les champs résumé, faits marquants, « à dire aux clients » et mots-clés sont saisis
  à la main. Le texte d'origine collé est conservé tel quel dans `brut`.
- Le bouton de publication vers le portail arrive au lot 07 : désactivé ici.

## Bibliothèque

Titre, lien, catégorie prise dans la liste de référence, type, résumé. Recherche sur
l'ensemble. C'est la bibliothèque interne du cabinet, sans rapport avec la table
`document` des viewers : ne les mélange pas.

## Vérification

Ouvrir la vue deux fois dans la journée ne doit déclencher qu'une seule série
d'appels. Couper la clé d'API et vérifier que la page s'affiche quand même, avec les
dernières valeurs connues et une ligne dans `incident`.
