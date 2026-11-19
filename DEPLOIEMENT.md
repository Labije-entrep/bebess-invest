# Déploiement

Prérequis : Node 20, un compte Cloudflare (`npx wrangler login`).

```bash
npm install
npx wrangler d1 create bebess                                  # reporter database_id dans wrangler.toml
npx wrangler r2 bucket create bebess-fichiers                  # fichiers : ne PAS activer le domaine public ni r2.dev
npx wrangler d1 migrations apply bebess --local                # migrations, base locale
npx wrangler d1 execute bebess --local --file=seeds/demo.sql   # jeu de démonstration, local seulement
npm run dev                                                    # http://localhost:4321
npm run build && npx wrangler pages dev dist --binding MAIL_DRIVER=console   # contrôle du build, http://localhost:8788
npx wrangler d1 migrations apply bebess --remote               # migrations, base de production
npx wrangler secret put SCW_SECRET_KEY                         # idem SCW_PROJECT_ID, MAIL_FROM
npx wrangler pages deploy dist --project-name bebess           # déploiement (après npm run build)
```

- Variables d'environnement : `MAIL_DRIVER=scaleway` (et `SCW_REGION` si autre que `fr-par`) sous `[vars]` dans `wrangler.toml` ; les clés (`SCW_SECRET_KEY`, `SCW_PROJECT_ID`, `MAIL_FROM`) en secrets, comme ci-dessus.
- Ne jamais lancer `seeds/demo.sql` avec `--remote` : données fictives.
- Sous `npm run dev`, `MAIL_DRIVER` vaut `console` : le lien de connexion s'affiche dans le terminal. Sur un build servi par `wrangler pages dev`, le pilote par défaut est `scaleway` : ajouter `--binding MAIL_DRIVER=console` pour lire le lien. Ne jamais poser `MAIL_DRIVER=console` en production : le pilote `console` lève une erreur dès que l'hôte de la requête n'est ni `localhost` ni `127.0.0.1`. Posé par erreur en production, il n'envoie donc plus aucun courriel (panne visible, journalisée sans le lien) au lieu d'écrire des liens de connexion encore valables dans les journaux de Cloudflare.
- Premier tenant de production : `npx wrangler d1 execute bebess --remote --command "INSERT INTO tenant (id, nom, domaine, cree_le) VALUES ('tnt_1', 'Nom', 'www.exemple.fr', '2026-01-01T00:00:00Z')"`.
- Console de l'éditeur (`/admin`, rôle éditeur) : elle crée un cabinet sans SQL (le « premier tenant » ci-dessus ne sert plus qu'à amorcer le compte éditeur). Domaines personnalisés (Cloudflare for SaaS), appelés côté serveur seulement : `npx wrangler secret put CF_API_TOKEN` (jeton limité à la zone, droit « SSL and Certificates : Edit »), puis sous `[vars]` : `CF_ZONE_ID` (la zone qui porte les « custom hostnames ») et `CF_CNAME_CIBLE` (l'origine de repli que le cabinet vise par CNAME). Sans le jeton, la console le dit sur la fiche du cabinet et tout le reste fonctionne : les noms d'hôte se déclarent, mais rien n'est validé chez Cloudflare. Un nom d'hôte n'ouvre un cabinet qu'une fois validé. Pour un essai local, `CF_API_URL` remplace l'adresse de l'API.
- Le premier cabinet créé par la console reçoit son lien de première connexion par le pilote de mail : en local, utiliser l'hôte `127.0.0.1` (le pilote `console` refuse tout autre hôte) et `--binding MAIL_DRIVER=console`.
- Traitement quotidien (lot 12) : un Worker à part, `wrangler.cron.toml`, avec UN Cron Trigger (`0 3 * * *`, 03:00 UTC). Il ne peut pas vivre dans `wrangler.toml` : le site est un projet Pages, et Pages n'accepte pas de Cron Trigger. À faire une fois, côté Cloudflare : reporter `database_id` et `CF_ZONE_ID` dans `wrangler.cron.toml`, `npx wrangler deploy -c wrangler.cron.toml`, puis les secrets du Worker (`npx wrangler secret put SCW_SECRET_KEY -c wrangler.cron.toml`, idem `SCW_PROJECT_ID`, `MAIL_FROM`, `CF_API_TOKEN` : ce sont les quatre courriels de l'essai et la libération du domaine au J+75), puis `npx wrangler d1 migrations apply bebess --remote` (migrations 0010 et 0011). En local, `npx wrangler d1 migrations apply bebess --local -c wrangler.cron.toml` crée la même base que `npm run dev` ; ajouter `--var MAIL_DRIVER:console` à `wrangler dev` pour que les quatre courriels de l'essai s'écrivent dans la console. Dans le tableau de bord : Workers & Pages → `bebess-traitement` → Settings → Triggers doit montrer le cron ; Settings → Variables doit montrer `DB` et `FICHIERS`. Essai : `npx wrangler dev -c wrangler.cron.toml --test-scheduled`, puis `curl "http://localhost:8787/__scheduled"`. Le traitement est idempotent : le rejouer à la main ne duplique rien.
- Les seuls courriels automatiques du produit vers un cabinet sont les quatre de l'essai (J+38, J+45, J+68, et l'avis tardif qui remplace J+68 quand aucun avis n'est jamais parti). Le reste — bon à émettre, remise à revoir, suppression en attente — arrive à l'éditeur dans les incidents de la console (`/admin/incidents`), jamais par courriel.
