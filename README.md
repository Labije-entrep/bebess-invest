# Labije Cab

**Labije Cab** est un logiciel pour cabinets de gestion de patrimoine, édité par **Labije Software**. Un seul code sert plusieurs cabinets, chacun reconnu par son nom de domaine :

- un **site public** pour le cabinet (six pages dont il administre le contenu) ;
- un **espace gestionnaire** : tableau de bord, clients, enveloppes, lignes et arrêtés, suivi des contacts, actus et notes de marché, réglages ;
- un **espace client** : valorisation, performance, répartition, mouvements, rapports ;
- une **console de l'éditeur** : création des cabinets, contrats, bons de commande, incidents.

Technique : Astro, TypeScript, Cloudflare Workers, base D1, stockage R2, Cron. Aucune IA dans le produit.

> L'ancienne présentation de ce dépôt (site vitrine statique de la version initiale) a été retirée : elle ne décrit plus le produit. Elle reste consultable dans l'historique Git.

## Démarrer en local

Node 22.18 ou plus récent.

```bash
npm install
npm run dev        # http://localhost:4321
npm test           # tests hors ligne
npm run check      # contrôle des types
npm run build      # génère dist/
```

Pour essayer le site construit avec une base locale remplie de données fictives, voir [`livraison/pc-test/PROCEDURE-WINDOWS.md`](livraison/pc-test/PROCEDURE-WINDOWS.md) (les commandes valent aussi sous macOS et Linux) et [`DEPLOIEMENT.md`](DEPLOIEMENT.md).

## Où se trouve quoi

| Dossier ou fichier | Contenu |
| --- | --- |
| `src/` | Le code : pages, composants, bibliothèques métier (`src/lib`), Worker du traitement quotidien (`src/cron.ts`). |
| `migrations/` | Le schéma de la base, numéroté. Une migration ne se défait pas. |
| `seeds/` | Jeux de données **fictifs**, pour la démonstration et la recette. Jamais en production. |
| `tests/` | Les tests (voir `tests/LISEZMOI.md`). |
| `maquettes/` | Références visuelles des écrans. |
| `chantier/` | Journal et règles du chantier de développement, retours de recette. |
| `livraison/` | **Kit de livraison** : dossier de mise en production, checklist d'un cabinet, mode d'emploi du gestionnaire, procédure d'essai sur PC. |
| `DEPLOIEMENT.md`, `RECETTE.md` | Déploiement et environnement de recette. |
| `CONTRAT.md` | Les types et règles du produit. |

## Branches

- `develop` : intégration. Toutes les demandes de fusion y arrivent, tests verts.
- `master` : production, **protégée**. Elle ne reçoit que des fusions de `develop`, après validation de la recette.

## Règles de ce dépôt

Le dépôt est **public** : aucun identifiant, secret, ni donnée réelle de cabinet ou de client n'y figure. Les configurations qui portent un identifiant de base (`wrangler.recette.toml`, `wrangler.prod.toml` et leurs équivalents du traitement) sont ignorées par Git.
