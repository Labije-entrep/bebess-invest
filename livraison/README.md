# Labije Cab : kit de livraison

Ce dossier réunit ce qu'il faut pour **livrer un cabinet** et pour **essayer Labije Cab hors de Cloudflare**. Il est écrit pour être lu par quelqu'un qui n'a pas construit l'outil. Chaque document est un premier jet, à ajuster après la recette.

| Document | Pour qui | À quoi il sert |
| --- | --- | --- |
| [`DOSSIER-LIVRAISON-PRODUCTION.md`](DOSSIER-LIVRAISON-PRODUCTION.md) | L'éditeur | **Le dossier de mise en production** : acteurs, architecture, choix des adresses, prérequis, procédure pas à pas, exploitation, points ouverts. |
| [`MODE-EMPLOI-GESTIONNAIRE.md`](MODE-EMPLOI-GESTIONNAIRE.md) | Le cabinet (gestionnaire associé) | Le mode d'emploi remis avec l'accès : tableau de bord, clients, suivi, contenus du site public, notes, réglages. |
| [`CHECKLIST-LIVRAISON-CABINET.md`](CHECKLIST-LIVRAISON-CABINET.md) | L'éditeur | La liste à cocher pour mettre un cabinet en service, du contrat à la remise des accès. |
| [`modops/`](modops/) | Le cabinet (gestionnaire) | Trois fiches d'une page à garder sous la main : créer un client, remplir un client, paramétrer son site. Versions Word dans le dossier de livraison. |
| [`pc-test/PROCEDURE-WINDOWS.md`](pc-test/PROCEDURE-WINDOWS.md) | L'éditeur | Essayer le produit sur un PC Windows, accessible à distance. **Test seulement**, jamais pour un cabinet réel. |
| [`pc-test/session-de-test.mjs`](pc-test/session-de-test.mjs) | L'éditeur | Outil de test : ouvre une session sans courriel sur la base **locale** du PC. Ne touche jamais une base distante. |

## Ce que le kit ne contient pas encore

- Le contrat d'abonnement, le DPA et les conditions générales : à rédiger avec un juriste.
- Une procédure de sauvegarde et de restauration de la production.
- Un mode d'emploi du client final (l'espace client) : il se découvre sans guide, mais un feuillet d'une page serait utile.
