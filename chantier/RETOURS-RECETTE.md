# Retours de recette

Ce qui a été observé en déroulant `RECETTE-E2E.md` et qui n'est pas un défaut bloquant : des évolutions possibles, à arbitrer plus tard. Une ligne par retour, avec la date et l'étape où il a été constaté.

## Évolutions possibles

| Date | Étape | Retour | Pistes |
| --- | --- | --- | --- |
| 2026-11-20 | 7-8 | **Kanban : pas de glisser-déposer.** Faire avancer un sujet passe par des boutons, ce qui est moins naturel que sur un kanban courant. | Glisser-déposer des cartes entre colonnes, en gardant les boutons pour le clavier et le tactile. |
| 2026-11-20 | 7-8 | **Pas de retour en arrière.** Un sujet ou un contact avancé d'un statut ou d'une étape ne peut pas être reculé. Une erreur de clic ne se corrige donc pas. | Bouton « ← » symétrique, ou glisser-déposer dans les deux sens. |
| 2026-11-20 | 7 | **Étape non saisie à la création d'un contact.** Il a fallu aller dans la vue Parcours pour poser « Premier contact ». **Décision : on garde ce fonctionnement** (on identifie d'abord un contact, sans étape, puis on le place dans le parcours). Rien à faire. | — |

| 2026-11-20 | 9 | **Cours de marché : pas de récupération quotidienne.** Ils ne sont tirés que lorsqu'on ouvre l'écran Actus (récupération paresseuse), par l'API Alpha Vantage et une clé (`COURS_API_KEY`), absente en recette. Pas de scraping, pas de tâche planifiée. | Récupérer chaque jour dans le Worker `bebess-traitement` (Cron déjà prévu), pour CAC, S&P 500, Nasdaq, EUR/USD, Brent ; ou autre source sans clé payante. |
| 2026-11-20 | 9 | **Écran Actus plus pauvre que la v0.** La v0 affichait un bloc « Marchés » avec courbes sur 1 semaine / 1 mois / 3 mois, comparaison en base 100 et repères d'actu sur la courbe ; la v0 pouvait aussi mettre en forme une note collée par IA (titre, faits, « à dire », mots-clés). Ici : valeur et variation du jour seulement, texte d'origine conservé sans mise en forme automatique. | Historique et courbes (la table `cours` garde déjà un cours par jour) ; mise en forme assistée à arbitrer (décision de produit). |

**Pris en charge** : glisser-déposer et déplacement libre (sauter un statut, reculer), kanban et parcours. Session dédiée, 2026-11-20.

## Écarts du scénario de recette (à corriger dans `RECETTE-E2E.md`)

| Étape | Écart |
| --- | --- |
| 1 | Les quatre prix ne se saisissent pas à la création du cabinet : ils se posent sur la fiche, dans « 1. Formule et prix ». |
| 4 | Le lien de première connexion ne peut pas être ouvert en recette sans courriel. |
| 6 | Les paragraphes se saisissent dans « Texte (paragraphes séparés par une ligne vide) », pas dans « Description (balise meta) ». Le cabinet doit avoir le module Site vitrine actif, sinon la page répond 404. |
| 21-22 | Il faut un second nom d'hôte joignable pour jouer le cloisonnement. |
