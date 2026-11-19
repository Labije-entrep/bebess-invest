# Rapport — lot 16 : l'essai ouvre tout, les écrans suivent leur module

Date : 2026-11-19. Branche : `claude/lot-16-essai-modules-6836b0`. Un commit de code, un commit de rapport. `astro check` : 0 erreur.

## Objet

Le lot 15 a branché les drapeaux de modules sur les écrans. Deux conséquences restaient à corriger : un prospect en essai pouvait se voir
refuser un module (la spécification tarifaire dit « produit entier, aucune fonctionnalité bridée »), et deux écrans d'édition du site
restaient ouverts sans Site vitrine alors que rien de ce qu'on y écrit n'est servi ailleurs que sur le site public.

## Ce qui change

### 1. L'essai n'est jamais amputé (`src/lib/modules.ts`)

La règle est posée dans `modulesDuTenant`, et nulle part ailleurs :

| Statut du contrat | Effet |
| --- | --- |
| absent | tout ouvert (avant-vente, cabinet de l'éditeur) |
| `brouillon`, `essai` | tout ouvert, quels que soient les drapeaux |
| `actif`, `suspendu` | les drapeaux font foi |
| `resilie`, `essai_non_converti` | hors de ce fichier : le calendrier de sortie s'applique, rien n'est changé |

Quand l'essai devient contrat, les drapeaux reprennent la main : un module non pris se ferme à ce moment-là. L'écran du contrat dans la
console (`ContratCabinet.astro`) le dit pendant l'essai et le brouillon, en nommant ce qui se fermera d'après les drapeaux du cabinet.

### 2. Les écrans de contenu suivent le module Site vitrine

- `/gestionnaire/contenus` et `/gestionnaire/notes` répondent **404** sans le module ; leurs entrées de menu disparaissent ; les données
  restent en base (`ROUTES_SITE_CONTENU`, `estRouteContenu`, `middleware.ts`, `Gestion.astro`).
- Sur une actu, le bouton « Créer la note de marché » est **désactivé avec sa raison écrite à côté**. L'actu reste éditable : elle
  appartient au module de suivi.
- Non demandé, ajouté : la route `/gestionnaire/passerelle/note/[id]` refuse aussi (retour `note_site_ferme`, message affiché), pour qu'un
  POST direct ne crée pas une note sans lecteur ; une note déjà née d'une actu n'est plus liée vers un écran en 404, une phrase la mentionne.

## Vérification

- `astro check` : 0 erreur (150 fichiers).
- `modulesDuTenant` exécutée avec une fausse base, six cas : sans contrat, brouillon 0/0 et essai 0/0 → tout ouvert ; actif 0/0 → tout fermé ;
  actif Pilotage seul → site fermé ; suspendu Site seul → suivi fermé. Les routes de contenu : `/gestionnaire/notes/abc` et
  `/gestionnaire/contenus` reconnues, `/gestionnaire/actus` et `/gestionnaire/notesx` non.
- **Non exécuté** : le middleware réel, les écrans dans un navigateur, D1 et Cloudflare. Les 404 de `/gestionnaire/notes` et
  `/gestionnaire/contenus`, le menu masqué, et le bouton désactivé sont établis par lecture du code, pas par une requête.
  Le banc du lot 15 (SQLite en mémoire, middleware réel) ne figure pas dans le dépôt : je ne l'ai pas rejoué.

## Choix à relire

1. Le brouillon compte comme l'essai (tout ouvert), conformément à la consigne.
2. Les statuts `resilie` et `essai_non_converti` ne sont pas dans `STATUTS_EN_COURS` : `modulesDuTenant` ne trouve alors aucun contrat « en
   cours » et renvoie tout ouvert. C'est le comportement du lot 15, inchangé ; le calendrier de sortie décide du reste.
3. Le choix 3 du rapport du lot 15 (écrans d'édition du site ouverts sans Site vitrine) est levé par ce lot.
4. Les exports CSV restent ouverts sans module, comme au lot 15.

## Mise en service

Aucune migration, aucun redéploiement du Worker de traitement. Déployer le site suffit.
Avant la signature d'un cabinet en essai, vérifier ses drapeaux sur sa fiche de contrat : c'est à ce moment qu'ils ferment des écrans.
