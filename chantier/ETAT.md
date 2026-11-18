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
| 00 | Préalable : fusion et correctifs de saisie | P1 | fait | 8e11341 |
| 01 | Socle de données et listes de référence | P1 | à faire | |
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
