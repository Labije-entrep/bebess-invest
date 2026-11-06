# Mise en service — procédure complète

À suivre dans l'ordre. Comptez une heure trente la première fois, dont une
bonne partie en attente de propagation DNS.

Les étapes 1 et 2 se font seules. L'étape 3 met le site en ligne. Les étapes 4
à 6 l'activent réellement. L'étape 7 est la vie courante.

---

## 0. Ce qu'il faut avoir sous la main

| Élément | Où | Coût |
|---|---|---|
| Un compte GitHub | github.com | gratuit |
| Un compte Cloudflare | cloudflare.com | gratuit |
| Le nom de domaine | OVH, Gandi, ou Cloudflare | 12 à 15 € / an |
| Un compte Formspree | formspree.io | gratuit jusqu'à 50 messages / mois |
| Node 18.20 ou plus récent | `node -v` pour vérifier | — |

Budget de fonctionnement : le domaine, et rien d'autre. Environ 1 € par mois.

---

## 1. Démarrer en local

```bash
unzip bebess-invest.zip
cd bebess-invest
npm install          # une minute
npm run dev          # http://localhost:4321
```

Le site tourne. Modifiez une valeur dans `src/data/fr/cabinet.yaml` et
enregistrez : la page se recharge seule. C'est votre boucle de travail pendant
toute la phase de collecte des contenus.

Pour contrôler le résultat final avant de publier :

```bash
npm run build        # génère dist/
npm run preview      # relit dist/ comme en production
```

---

## 2. Connecter le dépôt

```bash
cd bebess-invest
git init
git add .
git commit -m "Version initiale du site BeBess'Invest"
```

Créez le dépôt sur GitHub — `bebess-invest`, privé — puis :

```bash
git remote add origin git@github.com:VOTRE-COMPTE/bebess-invest.git
git branch -M main
git push -u origin main
```

### Le point qui décide de vos rôles

Pour que votre client ne puisse pas publier sans vous, `main` doit exiger une
pull request. **Sur un dépôt privé d'un compte personnel gratuit, cette
protection n'est pas disponible** : elle suppose un forfait GitHub Pro.

Trois options :

| Option | Coût | Ce que ça donne |
|---|---|---|
| **GitHub Pro** | ~4 $ / mois | *Settings → Branches → Add rule* sur `main` : « Require a pull request before merging » + « Require approvals ». Le plus simple. |
| **Open Authoring** | gratuit | Le client n'est pas collaborateur du tout : il travaille depuis un fork et ne peut techniquement rien écrire chez vous. Ajoutez `open_authoring: true` sous `backend:` dans `public/admin/config.yml`. |
| **Dépôt public** | gratuit | La protection de branche redevient disponible. Le code n'a aucun secret — les clés d'authentification vivent dans le Worker — mais le dépôt est visible de tous. À proposer au client, pas à décider pour lui. |

Tant que la question n'est pas tranchée, n'invitez personne : vous restez seul
contributeur et rien ne peut partir en ligne par accident.

---

## 3. Héberger et déployer

1. Cloudflare → **Workers & Pages** → *Create* → **Pages** → *Connect to Git*.
2. Autorisez GitHub, choisissez le dépôt.
3. Réglages de build :

   | Champ | Valeur |
   |---|---|
   | Framework preset | Astro |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Variable d'environnement | `NODE_VERSION` = `20` |

4. *Save and Deploy*. Deux minutes plus tard, le site est en ligne sur une
   adresse en `.pages.dev`.

À partir de maintenant, **chaque fusion sur `main` reconstruit et met en ligne
automatiquement**. Vous ne déployez plus jamais à la main. Chaque pull request
ouverte reçoit en prime sa propre adresse de prévisualisation : vous voyez le
rendu d'une note avant de l'accepter.

### Brancher le domaine

Dans le projet Pages → *Custom domains* → *Set up a domain* → `www.bebess-invest.fr`.

- **Domaine chez OVH ou Gandi** : Cloudflare affiche un enregistrement CNAME à
  créer chez le registrar. Comptez de dix minutes à quelques heures.
- **Domaine transféré chez Cloudflare** : tout se règle en un clic.

Ajoutez aussi le domaine nu `bebess-invest.fr` et faites-le rediriger vers
`www`, afin que les deux adresses fonctionnent.

Enfin, remplacez le domaine dans `astro.config.mjs` et dans
`public/robots.txt`, puis poussez : le sitemap et les liens entre versions
linguistiques en dépendent.

---

## 4. Activer le formulaire

1. Créez un formulaire sur [formspree.io](https://formspree.io), pointant vers
   l'adresse e-mail professionnelle du client.
2. Copiez l'URL fournie dans `contact.endpointFormulaire`
   (`src/data/fr/cabinet.yaml`).
3. Poussez, attendez la reconstruction, envoyez-vous un message de test.

Tant que le champ est vide, le formulaire refuse l'envoi et l'explique à
l'écran. Un champ caché transmet la langue du visiteur, ce qui permet de
répondre dans la bonne.

Pour la prise de rendez-vous, créez un lien sur cal.com et renseignez
`contact.lienRendezVous` : un bouton apparaît alors sur la page Contact.

---

## 5. Activer le CMS

1. **OAuth App GitHub** : *Settings → Developer settings → OAuth Apps → New*.
   - Homepage URL : `https://www.bebess-invest.fr`
   - Authorization callback URL : `https://<votre-worker>.workers.dev/callback`
   - Notez le *Client ID* et générez un *Client Secret*.
2. **Worker d'authentification** : déployez
   [sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth) sur
   Cloudflare Workers, puis ajoutez-y trois variables chiffrées :
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, et `ALLOWED_DOMAINS` avec votre
   domaine.
3. **Configuration** : dans `public/admin/config.yml`, renseignez `repo:`,
   `base_url:` (l'adresse du Worker) et `site_url:`.
4. **Test** : ouvrez `https://www.bebess-invest.fr/admin`, connectez-vous,
   modifiez une virgule, enregistrez. Une pull request doit apparaître sur
   GitHub. Si c'est le cas, le circuit fonctionne de bout en bout.
5. **Épinglez la version** du script dans `public/admin/index.html`, pour
   qu'une mise à jour amont ne change rien sans prévenir.

---

## 6. Activer la version anglaise

À faire seulement quand les textes anglais sont écrits et relus :

```yaml
# src/data/site.yaml
  en:
    publie: true
```

Poussez. Le sélecteur de langue apparaît, les pages anglaises entrent dans le
sitemap et perdent leur `noindex`. L'opération est réversible à tout moment.

---

## 7. Maintenir

### La vie courante

Rien de périodique n'est obligatoire. Le site est constitué de fichiers HTML
posés sur un serveur : il ne se dégrade pas, ne se fait pas pirater, et ne
réclame aucune mise à jour de sécurité. C'est tout l'intérêt du choix
technique.

| Quand | Quoi |
|---|---|
| À chaque contribution du client | Relire la pull request, regarder l'aperçu, fusionner |
| À chaque information reçue | Retirer le marqueur `A COMPLETER` correspondant |
| Une à deux fois par an | `npm update` en local, `npm run build`, vérifier, pousser |
| Après chaque mise en ligne | Vérifier que la page modifiée s'affiche bien |

### Revenir en arrière

Dans Cloudflare Pages → *Deployments*, chaque build passé est conservé :
*Rollback to this deployment* remet le site en l'état en quelques secondes.
Côté contenus, l'historique Git garde trace de chaque modification, avec son
auteur et sa date.

### Sauvegardes

Le dépôt GitHub *est* la sauvegarde : il contient le site, ses contenus et tout
son historique. Un `git clone` sur une autre machine suffit à tout récupérer.

### Surveillance

Aucune sonde n'est nécessaire. Si vous voulez être prévenu d'une indisponibilité,
UptimeRobot surveille gratuitement une adresse toutes les cinq minutes.

---

## Résumé en une page

```
  Poste de travail            GitHub                Cloudflare Pages
 ┌──────────────┐          ┌──────────┐            ┌───────────────┐
 │ npm run dev  │  push    │   main   │  webhook   │  npm run build│
 │ édition YAML │ ───────► │          │ ─────────► │   → en ligne  │
 └──────────────┘          └────▲─────┘            └───────────────┘
                                │ fusion
                           ┌────┴─────┐
                           │   PR     │
                           └────▲─────┘
                                │ enregistrement
                         ┌──────┴───────┐
                         │ /admin (CMS) │  ← le client
                         └──────────────┘
```
