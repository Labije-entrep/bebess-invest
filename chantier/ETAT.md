# État du chantier

Mis à jour par l'agent à la fin de chaque session. Une ligne par lot.

## Prérequis humains

Un lot dont le prérequis n'est pas coché ne démarre pas.

- [x] **P1** — `main` est à jour : `git checkout main && git merge --ff-only claude/work-rules-product-charter-509832`
- [ ] **P2** — Scaleway TEM configuré, domaine vérifié, SPF, DKIM, DMARC posés, un lien de connexion reçu sur une adresse Outlook professionnelle
- [ ] **P3** — Jeton d'API Cloudflare en secret du Worker (nécessaire au lot 10 pour les domaines personnalisés)
- [ ] **P4** — Cron Trigger activé sur le Worker (nécessaire au lot 12)

## Lots

| Lot | Titre | Prérequis | Statut | Commit |
| --- | --- | --- | --- | --- |
| 00 | Préalable : fusion et correctifs de saisie | P1 | fait | 6785f12 |
| 01 | Socle de données et listes de référence | P1 | fait | 3a8c238 |
| 01b | Correctif : espace viewer sur tous ses portefeuilles | — | à faire | |
| 02 | API JSON et synchronisation | — | à faire | |
| 03 | Module de suivi : la liste des contacts | — | à faire | |
| 04 | Module de suivi : la fiche | — | à faire | |
| 05 | Kanban et parcours | — | à faire | |
| 06 | Actus, bibliothèque, cours | — | à faire | |
| 07 | La passerelle | P2 | à faire | |
| 08 | Fichiers et exports | — | à faire | |
| 09 | Paramétrage par cabinet | — | à faire | |
| 10 | Espace super admin | P3 | à faire | |
| 11 | Contrat, rôles et journal | — | à faire | |
| 12 | Compteurs, essai et bons à facturer | P4 | à faire | |
| 13 | Écrans d'abonnement et console | — | à faire | |

Statuts : `à faire`, `en cours`, `fait`, `bloqué`.

## Journal des sessions

Une entrée par session terminée : lot, date, ce qui a été vérifié, ce qui ne l'a pas
été, ce qui a dû changer hors périmètre.

### Lot 00 — 2026-11-18

- **Constat** : `main` porte bien le lot 6 du portail (la branche `claude/work-rules-product-charter-509832` y est fusionnée). Les cinq correctifs 2.1 à 2.5 étaient déjà dans le code (commits 4c39db3, fda06f8, 7d4af1e, 6cce16d, 92ace3d, entrés avec la fusion). Aucun code écrit dans ce lot : relu chaque point contre la demande, et il y répond.
- **Vérifié** : `npm ci` puis `npm run build` passent. `perfDuMois()` (bundlée avec esbuild et exécutée) : point à 800 000 € avec 500 000 € versés, puis 820 000 € avec versements inchangés → 250 centièmes de point (+2,5 %) ; avec l'ancien défaut (versements à 0) on obtenait 6500 (+65 %).
- **Poids du paquet du Worker** : `dist/_worker.js` = 976 Ko.
- **Non vérifié** : rendu des écrans (Nouvel arrêté, aperçu avec confirmation à ±20 %, bandeau, colonne de dates du viewer) sous `wrangler dev` avec la CSP à nonce ; fraîcheur (MIN) sur une base locale avec données ; transaction unique de `enregistrerArrete` sur D1 réel.
- **Hors périmètre** : `ETAT.md` copié depuis le checkout local (P1 coché là mais non commité) vers le worktree. `npm ci` lancé dans le worktree (dépendances déjà déclarées, aucune ajoutée). Le dossier `chantier/maquettes/` n'existe dans aucune branche ni dans le checkout local : à ajouter avant les lots d'interface. Remarque pour plus tard : `src/lib/espace.ts:209` contient une couleur littérale (`#7C8AA0`), contraire à la charte.

### Lot 01 — 2026-11-18

- **Fait** : `migrations/0003_suivi.sql` = `20-schema.sql` tel quel, puis `enveloppe`, `point`, `cible` recréées avec `portefeuille_id` (`UNIQUE(portefeuille_id, date)` sur `point`). `src/lib/listes.ts`, `version.ts`, `listes-defaut.ts` (valeurs de `chantier/21-listes-defaut.md`, reprises telles quelles). `db.ts`, `gestion.ts`, `cloisonnement.ts` raccordés ; `seeds/demo.sql` : 3 membres, listes par défaut, un portefeuille par viewer, un second (« Holding familiale », vide) pour Claire.
- **Vérifié** (base locale vierge, `wrangler pages dev` sur `npm run build`) : les 3 migrations + le seed s'appliquent sans violation de clé étrangère (`PRAGMA foreign_key_check` vide). `/espace` (4 pages) et `/gestionnaire` (accueil, 7 onglets d'un viewer, import) répondent 200. Nouvel arrêté sur Thomas : aperçu puis confirmation → point écrit sur `pf_thomas`. Classe invalide (cibles) et statut invalide (mouvement) refusés avec la liste des valeurs admises ; statut valide accepté. Création d'un viewer → portefeuille « Patrimoine » créé avec lui.
- **Poids** : `dist/_worker.js` = 980 Ko.
- **Non vérifié** : le clic sur le lien magique (la sortie du mail « console » n'apparaît pas dans le journal de `wrangler pages dev` ; `POST /connexion` répond 302 et un jeton est bien écrit). Les sessions de test ont été insérées à la main dans la base locale. Pas de contrôle de types (`astro check` demande `@astrojs/check`, non installé, non ajouté). Rendu visuel des écrans, CSP à nonce dans un navigateur. Test de cloisonnement à six cas (prévu après les lots 07 et 10).
- **Changé dans le portail** : (1) les requêtes sur `enveloppe`/`point`/`cible` passent par le **premier portefeuille du viewer** (`PORTEFEUILLE_DU_VIEWER` dans `db.ts`, `ORDER BY ordre, id`) : le portail n'affiche et n'écrit que celui-là ; le second portefeuille de Claire n'apparaît donc pas encore côté viewer (à trancher quand le module de suivi le traitera). Les signatures publiques (`enveloppesDuViewer(db, viewerId)`, etc.) sont inchangées, les pages n'ont pas bougé sauf une. (2) `CLASSES` et `STATUTS` ne sont plus des constantes : classes d'actif et statuts de mouvement sont lus dans `liste_valeur` (`optionsDe`, `validateurDe`), y compris à l'import CSV ; `viewers/[id].astro` les charge. (3) `cloisonnement.ts` : enveloppe, cible, point et ligne remontent au tenant via `portefeuille`. (4) `creerViewer` écrit utilisateur et portefeuille « Patrimoine » dans un seul `batch`.
- **Hors périmètre / à signaler** : `incrementerVersion` n'est appelée par aucune écriture du portail (elle est pour le module de suivi). Colonne `membre.couleur` : format non précisé, le seed y met des hex de la palette de la charte. Si `liste_valeur` est vide pour un cabinet (hors seed), les formulaires du gestionnaire n'offrent plus aucune classe/statut ; `requetesListesDefaut(db, tenantId)` est prête pour la création d'un cabinet, mais aucun code de création de cabinet n'existe encore. Couleurs littérales rencontrées (non modifiées) : `src/lib/espace.ts:114` (palette des classes, conforme à la charte mais en dur), `:208` (`#DCBF88`) et `:209` (`#7C8AA0`).
