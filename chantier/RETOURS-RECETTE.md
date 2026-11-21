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

| 2026-11-21 | 12 | **Deux saisies qui peuvent diverger sans alerte.** L'onglet « Historique » n'écrit que le point ; les enveloppes et lignes (qui alimentent l'encours du tableau de bord) ne bougent pas. Constaté : point au 21/11 à 155 000 € et enveloppe à 150 000 €, encours du tableau de bord à 150 000 €. | Avertir quand le dernier point diffère de la somme des enveloppes ; ou proposer, à l'enregistrement d'un point au jour de l'arrêté, de resynchroniser. |
| 2026-11-21 | 12 | **La performance mensuelle ne se lit pas dans l'historique du gestionnaire.** Elle n'apparaît qu'à l'aperçu avant confirmation d'un point ; la liste des points montre les valeurs sans la performance de chaque mois. | Colonne « performance du mois » dans la liste de l'onglet Historique. |
| 2026-11-21 | 12 | **L'ordre de saisie d'un client promu n'est pas guidé.** Il faut créer l'enveloppe (avec valorisation et date d'arrêté) avant le premier arrêté, et le point d'historique se crée dans un autre onglet. | Message guidé « premier arrêté » sur un client sans enveloppe. |

| 2026-11-21 | 12 | **Dernière performance absente du tableau de bord du gestionnaire.** La liste des viewers montre l'encours et la date d'arrêté, pas la performance du dernier mois ; elle ne se lit qu'à l'aperçu d'un point ou côté client. | Colonne « Perf. du mois » dans la liste des viewers du tableau de bord (et dans la liste des points de l'onglet Historique), avec les mêmes règles que l'espace client : tiret si non calculable. |

**Pris en charge (session « retours de recette », 2026-11-21, branche `develop`)** : performance du mois dans le tableau de bord du gestionnaire et dans l'onglet Historique ; avertissement quand le dernier point diffère de la somme des enveloppes ; parcours guidé « premier arrêté » ; correction de `RECETTE-E2E.md` (étapes 1, 4, 6, 12, 21-22, ajout de 9bis et 12 bis) ; déploiement en Worker au lieu de Pages (`wrangler.toml`, `DEPLOIEMENT.md`, `RECETTE.md`, modèles de recette). Les trois retours du 2026-11-21 (étape 12) et les quatre écarts du scénario sont donc traités. Reste à arbitrer : la mise en forme assistée des actus (décision ferme : aucune IA).

**Pris en charge** : glisser-déposer et déplacement libre (sauter un statut, reculer), kanban et parcours. Session dédiée, 2026-11-20.

## Écarts du scénario de recette (à corriger dans `RECETTE-E2E.md`)

| Étape | Écart |
| --- | --- |
| 1 | Les quatre prix ne se saisissent pas à la création du cabinet : ils se posent sur la fiche, dans « 1. Formule et prix ». |
| 4 | Le lien de première connexion ne peut pas être ouvert en recette sans courriel. |
| 6 | Les paragraphes se saisissent dans « Texte (paragraphes séparés par une ligne vide) », pas dans « Description (balise meta) ». Le cabinet doit avoir le module Site vitrine actif, sinon la page répond 404. |
| 21-22 | Il faut un second nom d'hôte joignable pour jouer le cloisonnement. |
