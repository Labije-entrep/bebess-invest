# Rapport — lot 15 : le fondateur, la signature, et ce que les modules ouvrent

Date : 2026-11-19. Branche : `claude/lot-15-fondateur-signature-3fd582`. Un seul commit. `astro check` : 0 erreur.

## Objet

Le lot 14 a branché l'écriture du contrat sur la console. Il a laissé trois choses : un statut fondateur reconnu à un texte littéral, une
date de signature jamais implémentée, et des drapeaux de modules qui ne conditionnaient aucun écran. Ce lot les corrige, et fait respecter
la règle de la spécification selon laquelle une désactivation ne prend effet qu'à la date anniversaire.

## Ce qui change

### Migration 0012 (quatre colonnes nullables de `contrat`, dates ISO)

| Colonne | Rôle |
| --- | --- |
| `fondateur_le` | le jour où le statut fondateur a été posé ; null = pas fondateur |
| `date_signature` | la date de signature du contrat |
| `module_pilotage_fin_le`, `module_site_fin_le` | date d'effet d'une désactivation demandée |

Reprise : les contrats marqués fondateurs par le lot 14 reçoivent `fondateur_le` et `date_signature` relus dans l'événement
`statut_fondateur` du journal (à défaut, la date de dernière modification) ; leur `remise_motif`, qui ne servait que de marque, est vidé.

### 1. Le statut fondateur devient une donnée (`contrat.ts`, `contrat-ecran.ts`)

- `estFondateur` lit `fondateur_le` ; `compterFondateurs` fait un `COUNT(fondateur_le)` ; `MOTIF_FONDATEUR` n'est plus qu'un libellé d'affichage.
- Le refus `fondateur_remise` disparaît : le statut ne pose aucun pourcentage et ne touche plus à `remise_motif`. Un fondateur peut recevoir
  une remise commerciale, avant comme après.
- Nouvelle action de console `retirerStatutFondateur` : journalisée (`statut_fondateur_retire`), elle n'efface que `fondateur_le`. Le gel
  posé, les frais d'installation et la date de signature ne bougent pas : un gel ne se raccourcit jamais.

### 2. La date de signature

Le bouton fondateur demande la date (le champ reprend celle du contrat), la pose avec le statut et calcule le gel à signature + 24 mois. Il ne
devine plus rien depuis le DPA ou le début. Sans date, ni saisie ni portée par le contrat : refus `signature_manquante`, avec son motif à l'écran.
Une signature qui raccourcirait un gel existant reste refusée et journalisée.

### 3. Ce que les modules ouvrent (`src/lib/modules.ts`, `middleware.ts`, `Gestion.astro`)

- **Sans Pilotage** : `/gestionnaire/suivi` (liste, fiche, et les vues kanban et parcours), `/gestionnaire/actus`, `/gestionnaire/bibliotheque`,
  `/gestionnaire/passerelle`, `/api/suivi`, les logos de contact répondent **404** (jamais 403). Les entrées de menu correspondantes disparaissent.
- **Sans Site vitrine** : la racine de l'hôte redirige vers `/connexion` ; les autres pages publiques (`/approche`, `/parcours`, `/notes`,
  `/contact`, `/mentions-legales`, `/en/*`, `/sitemap.xml`) répondent 404. `/connexion` et `/robots.txt` restent servis : c'est le niveau 0
  de l'offre, le cabinet garde son site et n'héberge ici que l'espace client.
- Rien n'est supprimé ni masqué en base. Ce n'est pas la règle « rien n'est jamais bloqué » (quotas, coupures en cours de période) : c'est la
  livraison d'un module non acheté.
- Le middleware ne lit le contrat que sur les chemins concernés (menu du personnel, routes du suivi, pages publiques).

### 4. La désactivation prend effet à la date anniversaire

- Désactiver **n'abaisse plus le drapeau** : l'écriture enregistre `module_*_fin_le` = la prochaine date anniversaire (événement
  `module_desactivation_programmee`). La fiche affiche « effet le JJ/MM/AAAA » ; le bouton devient « Annuler la désactivation », possible
  tant que la date n'est pas atteinte (`effet_atteint` ensuite).
- Activer reste immédiat, avec son bon complémentaire au prorata.
- **Cinquième travail du traitement quotidien** (`basculerModulesEchus`) : baisse le drapeau des modules échus, efface la date d'effet, écrit
  `module_desactive` (acteur : le système). Idempotent dans la base : chaque écriture est conditionnée à l'état qu'elle quitte.
- Conséquences facturation : le bon d'une période qui commence à la date d'effet (posé 30 jours avant) ne porte déjà plus le module
  (`genererBons`) ; « Mon abonnement » calcule son prochain bon sans lui ; la fiche et la console de facturation affichent « jusqu'au JJ/MM/AAAA ».
  Les bons complémentaires, qui lisent seulement `module_active` / `module_desactive`, ne sont pas perturbés par l'intention.

## Vérification (banc SQLite en mémoire, migrations 0001 à 0012, middleware réel, session d'associé)

| Cas demandé | Résultat |
| --- | --- |
| Fondateur qui reçoit ensuite une remise commerciale | accepté |
| Retrait du statut depuis la console | statut levé, gel conservé (2028-11-01), événement écrit |
| Bouton fondateur sans date de signature | refusé : `signature_manquante`, rien posé |
| Cabinet sans Pilotage | suivi, fiche, actus, bibliothèque, API, passerelle, logos : 404 ; menu masqué ; données toujours en base ; module repris, tout revient |
| Cabinet sans Site vitrine | `/` → 302 `/connexion` ; autres pages publiques 404 ; `/connexion` et `/robots.txt` servis |
| Désactiver Pilotage | drapeau à 1, effet le 14/03/2027, annulable ; bon du 14/03/2027 sans la ligne Pilotage ; veille : rien ; jour J : basculé ; rejoué deux fois : rien de plus |

Aussi vérifiés : la reprise d'un fondateur du lot 14 par la migration, un double retrait refusé, une signature plus ancienne refusée,
l'annulation refusée le jour de l'effet. Non testé : D1 et Cloudflare réels, navigateur.

## Choix à relire

1. **Un cabinet sans contrat en cours garde tout ouvert** (état d'avant le contrat, et celui du cabinet de l'éditeur). Seuls les drapeaux d'un
   contrat en cours ferment des écrans. À inverser si l'on préfère « rien d'acheté, rien d'ouvert ».
2. **Un contrat sans date anniversaire** (pas de début de service, ou début à venir) désactive un module tout de suite : aucune période n'est
   facturée, il n'y a rien à attendre.
3. Les écrans d'édition du site (`/gestionnaire/contenus`, `/gestionnaire/notes`) restent ouverts sans Site vitrine : le lot ne demande que
   de ne pas servir les pages publiques.
4. Les exports CSV (contacts, sujets, échanges, actus) restent ouverts sans Pilotage : c'est la sortie des données du cabinet.

## Mise en service

- Appliquer la migration : `npx wrangler d1 migrations apply bebess --remote` (0012).
- Redéployer le Worker `bebess-traitement` (`npx wrangler deploy -c wrangler.cron.toml`) : sans cela, les désactivations programmées ne
  basculeront jamais.
- Avant de fermer des écrans, vérifier sur chaque cabinet existant que les drapeaux `module_pilotage` / `module_site` de son contrat reflètent
  bien ce qu'il a acheté : ils conditionnent désormais ce qu'il voit.
