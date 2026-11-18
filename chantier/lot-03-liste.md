# Lot 03 — Module de suivi : la liste des contacts

Crée la page `/gestionnaire/suivi`. Elle sert une coquille rendue au serveur et un
module rendu côté client qui parle à `/api/suivi`. Pas de bibliothèque d'interface :
du JavaScript écrit à la main, un seul fichier de module.

`maquettes/Suivi-Clients.html` fait foi pour la mise en page. Elle contient :

- Huit indicateurs cliquables qui filtrent la liste : vus aujourd'hui, sujets
  ouverts, en cours, en attente, en retard, à rappeler sous N jours, sans échange
  depuis N jours, avoirs suivis. Les seuils N viennent de la table `reglage`.
- Une recherche sur le nom, la structure et le texte des sujets.
- Un filtre par membre, un basculement liste / kanban / parcours, les deux dernières
  vues renvoyant à un écran vide pour l'instant.
- La liste : contact, types, en charge, avoirs, dernier échange, relance, sujets.

## Comportement, non négociable

- **Édition optimiste.** L'affichage change d'abord, l'envoi suit dans une file par
  contact, avec une reprise en cas d'échec réseau et un marqueur visible quand une
  écriture n'est pas passée. Rien ne disparaît sans que l'utilisateur le sache.
- Interrogation de `/api/suivi/version` toutes les dix secondes ; si elle a changé,
  recharge `/api/suivi/etat`. Suspends l'interrogation quand l'onglet est caché.
- Les avoirs d'un contact rattaché à un viewer viennent de ses portefeuilles et
  portent la date du dernier arrêté ; ils ne sont pas saisissables. Une date au-delà
  du seuil s'affiche en `--alerte`.

Accessibilité : navigation au clavier complète, focus visible, les indicateurs sont
des boutons avec `aria-pressed`.

## Vérification

Créer, modifier et archiver un contact ; couper le réseau en cours d'édition et
vérifier que la modification repart ensuite.
