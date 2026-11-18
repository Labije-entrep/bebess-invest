# Lot 09 — Paramétrage par cabinet

## Thèmes

Définis cinq jeux de jetons complets dans `src/styles/app.css`, chacun sous
`:root[data-cabinet-theme="<nom>"]` : maison, nuit, foret, pierre, clair. Chacun
redéfinit **tous** les jetons existants, en clair comme en sombre. Aucun composant ne
change.

Vérifie le contraste de chaque thème sur le texte courant, le texte secondaire et les
deux couleurs sémantiques, et note les rapports obtenus dans `ETAT.md`.

**Pas de sélecteur de couleur libre, nulle part.** Le choix porte sur des
combinaisons déjà validées, pas sur des valeurs.

Le thème est lu dans `reglage` et posé par le serveur sur la balise racine, pour le
site public, l'espace viewer et le module.

## Écrans de réglage

Sous `/gestionnaire/reglages`, réservés au gestionnaire :

- **Listes** : ajouter, renommer, réordonner, désactiver une valeur. Une valeur
  utilisée ne se supprime jamais, elle se désactive : elle disparaît des choix et
  reste lisible sur les fiches anciennes.
- **Seuils** : sans échange, relance, arrêté périmé, écart d'allocation. Avec leur
  valeur par défaut rappelée.
- **Membres** : nom, initiale, couleur prise dans la palette des graphiques, actif.
- **Identité** : nom affiché, logo, thème, symboles de marché suivis.
- **Mentions légales** : raison sociale, numéro ORIAS, statut réglementaire,
  association agréée, médiateur, hébergeur, contact RGPD. Ces champs alimentent la
  page de mentions du site public, qui ne doit plus contenir aucun texte en dur.

## Vérification

Changer de thème et recharger les trois surfaces ; désactiver une classe d'actif
utilisée et vérifier qu'elle reste affichée sur les lignes existantes tout en
disparaissant des listes déroulantes.
