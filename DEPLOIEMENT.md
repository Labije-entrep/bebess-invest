# Déploiement

Prérequis : Node 20, un compte Cloudflare (`npx wrangler login`).

```bash
npm install
npx wrangler d1 create bebess                                  # reporter database_id dans wrangler.toml
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
