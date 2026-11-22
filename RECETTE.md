# Labije Cab : environnement de recette

Un second environnement complet chez Cloudflare, séparé de la production : même
plateforme, mêmes limites, mêmes comportements. C'est le seul « iso-prod » qui
existe pour cette pile — `workerd`, D1, R2, les Cron Triggers et les domaines
personnalisés sont la plateforme, pas des logiciels qu'on installe ailleurs.

À monter **avant** que le premier cabinet travaille en production : le jour où il y
travaille, on ne peut plus éprouver un lot sur sa base.

Tout ce qui suit porte le suffixe `-recette`. Rien n'y touche à la production.

---

## 1. Prérequis

- Node 22.18 ou plus récent — le banc de vérification utilise `node:sqlite` — et
  `npx wrangler login` fait sur le bon compte.
- Le dépôt à jour sur `develop` (la branche d'intégration ; la production se déploie depuis `master`, une fois la recette validée).
- Pour les courriels : soit le pilote `console` (suffisant pour presque tout), soit
  un domaine d'envoi Scaleway distinct de celui de production.

## 2. Les ressources

```bash
cd ~/Dev/Bebess-invest

npx wrangler d1 create bebess-recette          # noter le database_id renvoyé
npx wrangler r2 bucket create bebess-fichiers-recette
```

Ne jamais activer de domaine public ni `r2.dev` sur ce bucket : les objets ne
sortent que par les routes du Worker, après contrôle de session, de locataire et de
rôle.

Le site tourne en recette **comme en production : un Worker Cloudflare qui sert ses
fichiers statiques** (Cloudflare ne crée plus de projet Pages). Deux fichiers de
configuration, à copier depuis les modèles versionnés — ils ne contiennent aucun
identifiant :

```bash
cp wrangler.recette.example.toml       wrangler.recette.toml
cp wrangler.cron.recette.example.toml  wrangler.cron.recette.toml
```

Ouvrir chacune des copies et remplacer `A_REMPLIR` par le `database_id` noté plus haut
(le **même** dans les deux). Les copies sont ignorées par git : elles portent des
identifiants, le dépôt est public, ne les versionnez jamais. **Ne modifiez pas
`wrangler.toml` ni `wrangler.cron.toml`** : ils portent la production.

Les modèles n'ont **pas de bloc R2**, voulu : la recette tourne sans bucket de
fichiers. Dépôt de rapports, logo, factures en PDF et purge des fichiers ne sont donc
pas jouables en recette ; tout le reste l'est. Pour les éprouver, activer R2, créer
`bebess-fichiers-recette` (ci-dessus) et ajouter le bloc `[[r2_buckets]]` indiqué en
commentaire dans le modèle.

Le Worker du traitement (`wrangler.cron.recette.toml`) garde `CF_ZONE_ID` vide tant
qu'on n'éprouve pas les domaines personnalisés : la console le dira et tout le reste
fonctionnera.

## 3. Le schéma et les données

```bash
npx wrangler d1 migrations apply bebess-recette --remote -c wrangler.recette.toml
npx wrangler d1 execute bebess-recette --remote -c wrangler.recette.toml --file=seeds/demo.sql
```

Le seed pose **deux cabinets** — c'est voulu : sans un second locataire, le test de
cloisonnement n'est pas jouable. Il contient un compte `editeur`, deux `associe`,
un `collaborateur`, un `lecture`, deux `support_editeur` et quatre `viewer`, dont un
avec deux portefeuilles aux dates d'arrêté décalées.

`seeds/demo.sql` ne doit **jamais** être exécuté sur la base de production. Il n'est
pas dans `migrations/` précisément pour que `migrations apply` ne puisse pas
l'appliquer par accident.

## 4. Déployer

```bash
npm run build
npx wrangler deploy -c wrangler.recette.toml                 # le site : un Worker avec ses fichiers statiques

npx wrangler deploy -c wrangler.cron.recette.toml            # le traitement quotidien
npx wrangler secret put SCW_SECRET_KEY  -c wrangler.recette.toml        # secrets du Worker du site ; idem SCW_PROJECT_ID, MAIL_FROM
npx wrangler secret put SCW_SECRET_KEY  -c wrangler.cron.recette.toml   # et ceux du traitement
```

`npx wrangler deploy --dry-run -c wrangler.recette.toml` vérifie la configuration sans
rien publier. Le build doit avoir écrit `dist/.assetsignore` (il contient `_worker.js`).

Pour lire les liens de connexion sans configurer Scaleway, poser
`MAIL_DRIVER = "console"` sous `[vars]` du fichier de recette du site (le modèle du
traitement l'a déjà) : le pilote refuse de
s'exécuter hors de `localhost`, donc en recette **aucun courriel ne partira** et la
panne sera visible dans les journaux. C'est le comportement voulu — pour éprouver
un vrai envoi, il faut un domaine Scaleway de recette.

## 5. Vérifier que l'environnement tient debout

```bash
npm run check                                   # astro check : 0 erreur attendu
npm test                                        # tarif, siren, dépassement
npx wrangler dev -c wrangler.cron.recette.toml --test-scheduled
curl "http://localhost:8787/__scheduled"        # le traitement quotidien, à la main
```

Puis, sur le site déployé : se connecter avec `editeur@demo.local` (le pilote
`console` n'envoie aucun lien hors `localhost` : sans courriel réel, poser une session
à la main, voir `chantier/RECETTE-E2E.md` étape 4), ouvrir `/admin`,
vérifier que les deux cabinets du seed apparaissent avec leurs encours et leur date
d'arrêté.

## 6. Remettre à zéro

```bash
npx wrangler d1 execute bebess-recette --remote -c wrangler.recette.toml \
  --command "PRAGMA foreign_keys=OFF"
```

Le plus simple et le plus sûr reste de supprimer la base et de la recréer :

```bash
npx wrangler d1 delete bebess-recette
npx wrangler d1 create bebess-recette          # reporter le nouveau database_id
```

Reprendre alors au point 3. Supprimer la base évite les états intermédiaires qu'un
`DELETE` laisse derrière lui, et c'est l'occasion de vérifier que les migrations
passent bien sur une base vierge — ce qui est exactement ce qui se produira en
production.

---

# 7. Configurer les offres

## La grille

Quatre lignes facturables, pas une de plus. Les montants sont stockés **en centimes**
dans `contrat`, les taux **en centièmes de point** (2500 = 25 %).

| Ligne | Colonne | Mensuel HT | En base | Annuel HT |
| --- | --- | --- | --- | --- |
| Socle « Espace client » | `prix_socle` | 79 € | `7900` | 948 € |
| Module « Pilotage » | `prix_pilotage` | 49 € | `4900` | 588 € |
| Module « Site vitrine » | `prix_site` | 39 € | `3900` | 468 € |
| Accès au-delà du 3ᵉ, par accès | `prix_acces_sup` | 25 € | `2500` | 300 € |

Le socle est obligatoire et aucun module ne se vend seul : il n'existe donc que
quatre combinaisons.

| Combinaison | `module_pilotage` | `module_site` | Mensuel | Annuel |
| --- | --- | --- | --- | --- |
| Socle seul | 0 | 0 | 79 € | 948 € |
| Socle + Site vitrine | 0 | 1 | 118 € | 1 416 € |
| Socle + Pilotage | 1 | 0 | 128 € | 1 536 € |
| Socle + Pilotage + Site | 1 | 1 | 167 € | 2 004 € |

**Périodicité.** `periodicite` vaut `annuelle` (défaut) ou `mensuelle`. Le mensuel
coûte +15 %, appliqués **ligne par ligne** et arrondis à l'euro : 79 → 91, 49 → 56,
39 → 45, 25 → 29. Jamais un coefficient sur le total — socle + Pilotage au mois font
147 € et non 147,20 €.

**Accès inclus.** `acces_inclus` vaut 3 par défaut. Seuls les rôles `associe` et
`collaborateur` actifs sont facturés ; `lecture`, `support_editeur` et `viewer` ne le
sont jamais. Les espaces clients sont illimités et ne sont jamais comptés.

**Remises.** `remise_parrainage_taux` est **calculé** par le produit
(`min(50, 25 × parrainages validés)`) : ne l'écrivez pas à la main.
`remise_commerciale_taux` se saisit, avec `remise_motif` et `remise_revue_le`
obligatoires dès qu'il est non nul. Le total est plafonné à 50 % et ne porte que sur
le récurrent, jamais sur les frais d'installation.

## Où cela se règle

À partir du lot 14, tout passe par la console : `/admin`, fiche d'un cabinet, avec
les garde-fous tenus par le code — prix refusés sous gel de tarif, gel qui se
prolonge mais ne se raccourcit pas, mise en production refusée sans
`dpa_signe_le`, remise sans motif refusée.

En attendant, et seulement **en recette**, les ordres SQL ci-dessous. Ne les passez
jamais en production : ils court-circuitent précisément ces garde-fous.

## Jouer les six cas

Le seed pose déjà un contrat `ctr_demo` sur `tnt_demo` : socle + Pilotage, annuel,
3 accès inclus, gelé jusqu'au 31/12/2027. Chaque cas se joue en le modifiant, puis
en ouvrant « Mon abonnement » avec une session `associe`.

```bash
R="npx wrangler d1 execute bebess-recette --remote -c wrangler.recette.toml --command"
```

**Cas 1 — Socle seul, annuel.** Attendu : 948 € par an.
```bash
$R "UPDATE contrat SET module_pilotage=0, module_site=0, periodicite='annuelle' WHERE id='ctr_demo'"
```

**Cas 2 — Les trois lignes, annuel.** Attendu : 2 004 € par an.
```bash
$R "UPDATE contrat SET module_pilotage=1, module_site=1, periodicite='annuelle' WHERE id='ctr_demo'"
```

**Cas 3 — Les trois lignes, mensuel.** Attendu : 192 € par mois (91 + 56 + 45), et
non 192,05 € : c'est le contrôle de l'arrondi ligne par ligne.
```bash
$R "UPDATE contrat SET periodicite='mensuelle' WHERE id='ctr_demo'"
```

**Cas 4 — Deux accès au-delà des inclus.** Créez deux comptes `collaborateur` depuis
l'onglet Accès, pour arriver à 5 accès facturables. Attendu sur socle + Pilotage
annuel : 1 536 € + 600 € = 2 136 €, et la phrase de dépassement affichée.
À l'inverse, un compte `lecture` supplémentaire ne doit rien changer.

**Cas 5 — Cabinet fondateur.** Attendu : frais d'installation à zéro, prix gelés,
et tout changement de prix refusé tant que la date de gel n'est pas passée.
```bash
$R "UPDATE contrat SET frais_installation=0, tarif_gele_jusqu_au='2028-03-14',
    remise_motif='Cabinet fondateur — co-conception et référence' WHERE id='ctr_demo'"
```

**Cas 6 — Parrain à deux filleuls.** Attendu : remise de 50 %, soit 768 € sur
socle + Pilotage annuel. Ne touchez pas `remise_parrainage_taux` : créez deux
parrainages validés et laissez le traitement quotidien le calculer.
```bash
$R "UPDATE parrainage SET statut='valide', valide_le=date('now') WHERE parrain_tenant_id='tnt_demo'"
npx wrangler dev -c wrangler.cron.recette.toml --test-scheduled &
curl "http://localhost:8787/__scheduled"
```

## Ce qu'il faut regarder à l'écran

Sur « Mon abonnement », avec une session `associe` :

- le nombre affiché est le nombre **facturable**, et la liste montre tous les
  comptes avec leur rôle, en signalant ceux qui ne sont pas facturés. Un nombre qui
  ne correspond pas à la facture est la première cause de contestation ;
- le compte de support de l'éditeur n'apparaît pas ;
- la phrase de dépassement n'apparaît que si les facturables dépassent les inclus ;
- il n'y a **aucune jauge**, aucun pourcentage de consommation, aucun bouton de
  changement d'offre, de résiliation ou de paiement. Une jauge sous-entendrait un
  plafond, et il n'y en a aucun ;
- les espaces clients portent la mention « illimités, non facturés ».

Et dans la console, sur le bon à facturer : raison sociale, SIREN, adresse et
contact de facturation, période, une ligne par poste avec quantité × prix unitaire,
la remise avec son motif, total HT, TVA à 20 %, total TTC, numéro attribué.
