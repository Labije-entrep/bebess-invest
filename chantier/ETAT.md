# État du chantier

Mis à jour par l'agent à la fin de chaque session. Une ligne par lot.

## Prérequis humains

Un lot dont le prérequis n'est pas coché ne démarre pas.

- [ ] **P1** — `main` est à jour : `git checkout main && git merge --ff-only claude/work-rules-product-charter-509832`
- [ ] **P2** — Scaleway TEM configuré, domaine vérifié, SPF, DKIM, DMARC posés, un lien de connexion reçu sur une adresse Outlook professionnelle
- [ ] **P3** — Jeton d'API Cloudflare en secret du Worker (nécessaire au lot 10 pour les domaines personnalisés)
- [ ] **P4** — Cron Trigger activé sur le Worker (nécessaire au lot 12)

## Lots

| Lot | Titre | Prérequis | Statut | Commit |
| --- | --- | --- | --- | --- |
| 00 | Préalable : fusion et correctifs de saisie | P1 | à faire | |
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
