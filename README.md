# BeBess'Invest — site vitrine bilingue

Site statique construit avec **Astro**, en français et en anglais. Les contenus
vivent dans des fichiers versionnés et se modifient de trois façons : à la main
dans l'éditeur de code, depuis le CMS en ligne, ou par pull request.

---

## 1. Démarrer

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # génère dist/
npm run preview    # relit dist/ comme en production
```

Node 18.20 ou plus récent.

---

## 2. Les deux langues

| Langue | Adresse | Pages |
|---|---|---|
| Français | `/` | `/approche` · `/parcours` · `/notes` · `/contact` · `/mentions-legales` |
| Anglais | `/en` | `/en/approach` · `/en/about` · `/en/insights` · `/en/contact` · `/en/legal` |

Les adresses anglaises sont en anglais, pas des copies des adresses françaises :
c'est ce que lisent les moteurs de recherche et les visiteurs internationaux.
Elles se modifient dans `src/i18n/config.ts`, qui sert de table de routage.

### La règle de repli

Le fichier anglais `src/data/en/cabinet.yaml` ne contient **que les champs à
traduire**. Tout champ absent reprend la valeur française. C'est volontaire :
le numéro de téléphone, l'adresse e-mail, le numéro ORIAS et le RCS ne doivent
exister qu'à un seul endroit, sinon ils divergeront tôt ou tard. N'ajoutez
jamais ces champs au fichier anglais.

### Publier la version anglaise

Tant que `src/data/site.yaml` porte `en: publie: false` :

- les pages anglaises se construisent et restent consultables pour relecture,
- elles portent une balise `noindex`, donc Google les ignore,
- elles sont absentes du `sitemap.xml`,
- le sélecteur de langue reste masqué sur le site français.

Passez à `true` quand les textes sont prêts. Ce réglage est volontairement hors
du CMS : mettre en ligne une version anglaise à moitié écrite est exactement ce
qu'on cherche à éviter, et cette décision vous revient.

### Ce qui reste en français

Les mentions légales anglaises portent automatiquement la phrase indiquant que
la version française fait foi. Le statut ORIAS, l'adhésion à l'association
agréée AMF et l'avertissement sur les risques relèvent du droit français : leur
traduction est informative, et sa formulation doit être validée au même titre
que la version française.

---

## 3. Où se trouvent les contenus

| Fichier | Contient | Qui l'édite |
|---|---|---|
| `src/data/fr/cabinet.yaml` | Toutes les informations du cabinet en français | Vous, ou le client via le CMS |
| `src/data/en/cabinet.yaml` | Uniquement les champs traduits en anglais | Le client via le CMS |
| `src/data/fr/seo.yaml` et `en/seo.yaml` | Titres et descriptions affichés dans Google | Vous |
| `src/content/notes/fr/*.md` et `notes/en/*.md` | Une note de marché par fichier | Le client via le CMS |
| `src/data/site.yaml` | Publication de la version anglaise | Vous seul |
| `src/i18n/config.ts` | Adresses des pages et libellés d'interface | Vous seul |
| `src/styles/site.css` | Charte graphique — variables en tête de fichier | Vous seul |

Les libellés d'interface — menu, boutons, intitulés de sections, champs du
formulaire — sont déjà traduits dans `src/i18n/config.ts`. Ce n'est pas du
contenu éditorial, le client n'a pas à s'en occuper.

### Le marqueur « A COMPLETER »

Toute valeur commençant par `A COMPLETER` s'affiche sur le site **soulignée en
doré**. La recette consiste à parcourir les pages et à faire disparaître tout
le doré. Le marqueur est retiré automatiquement là où il ne peut pas être mis
en valeur : balise `<title>`, description pour Google, données structurées,
options du formulaire. Pensez donc à relire aussi les deux fichiers `seo.yaml`,
dont le contenu ne se voit pas à l'écran.

### Ajouter une note à la main

Créez `src/content/notes/fr/2026-11-mon-sujet.md` :

```markdown
---
titre: "Le titre de la note"
date: 2026-11-12
chapeau: "Deux phrases : ce que le lecteur va y trouver."
description: "155 caractères pour Google. Facultatif."
publie: true
---

Le corps de la note en Markdown.
```

L'URL devient `/notes/2026-11-mon-sujet`, et `/en/insights/<slug>` pour une
note placée dans `notes/en/`. Mettre `publie: false` garde la note hors du site
tout en la conservant dans le dépôt. Les deux langues sont indépendantes : une
note peut exister en français seulement.

---

## 4. Le CMS et la répartition des rôles

L'interface est servie à l'adresse `/admin` et repose sur **Sveltia CMS**
(compatible avec la configuration de Decap CMS, dont il est un remplaçant
direct). Aucune base de données : chaque enregistrement écrit dans le dépôt Git.

### Le circuit

```
Le client écrit dans /admin
        │
        ▼
  Pull request automatique          ← il ne peut pas fusionner
        │
        ▼
  Vous relisez et fusionnez
        │
        ▼
  Cloudflare reconstruit et met en ligne   (1 à 2 minutes)
```

C'est le mode *editorial workflow*, activé dans `public/admin/config.yml`.
Chaque entrée obtient sa branche et sa pull request, avec trois états :
brouillon, en relecture, prêt à publier.

Les notes de marché sont déclarées bilingues : le CMS affiche le français et
l'anglais côte à côte dans le même formulaire, ce qui évite de publier dans une
langue et d'oublier l'autre. Les informations du cabinet apparaissent en deux
entrées distinctes, *Informations du cabinet (français)* et *Cabinet
information (English)*, la seconde ne reprenant que les champs à traduire.

### Mise en place, une seule fois

1. **Dépôt GitHub.** Créez-le sous votre compte : vous en êtes propriétaire.
   Renseignez `repo:` dans `public/admin/config.yml`.
2. **Protégez `main`.** *Settings → Branches → Add rule* sur `main` :
   cochez « Require a pull request before merging » et « Require approvals ».
   C'est cette règle, et elle seule, qui empêche le client de publier seul.
3. **Invitez le client** en *Collaborator* avec le rôle **Write**. Il lui faut
   un compte GitHub gratuit, seul prérequis technique de son côté.
4. **Authentification.** Déployez le Worker [Sveltia CMS Authenticator](https://github.com/sveltia/sveltia-cms-auth)
   sur Cloudflare, créez une *OAuth App* GitHub dont l'URL de rappel pointe vers
   ce Worker, puis reportez l'adresse du Worker dans `base_url:`.
5. **Vérifiez** : connectez-vous à `https://<le-site>/admin`, modifiez une
   virgule, enregistrez, et contrôlez qu'une pull request apparaît bien.

### Deux limites à connaître

- Quand le CMS enregistre un fichier YAML, il le réécrit et **les commentaires
  disparaissent**. Les explications utiles doivent vivre dans les libellés et
  les `hint:` de `config.yml`, pas dans le YAML.
- Le script du CMS est chargé depuis un CDN sans numéro de version figé.
  Dès la recette terminée, épinglez la version dans `public/admin/index.html`.

### Si le client ne veut pas de compte GitHub

Deux solutions de repli. Soit vous restez seul contributeur et il vous envoie
ses textes — le plus simple, et à raison d'une note par mois, le plus réaliste.
Soit vous passez à un CMS hébergé à connexion par e-mail (Sanity, Storyblok),
au prix d'une dépendance externe et d'un webhook de reconstruction.

---

## 5. Mise en ligne

### Cloudflare Pages, recommandé

1. Poussez le dépôt sur GitHub.
2. Cloudflare → *Workers & Pages* → *Create* → *Pages* → *Connect to Git*.
3. Build command `npm run build`, dossier de sortie `dist`.
4. Ajoutez le domaine dans *Custom domains*.

Chaque fusion sur `main` déclenche une reconstruction. Les pull requests
ouvertes obtiennent une URL de prévisualisation : vous voyez le rendu d'une
note avant de l'accepter. Gratuit à cette échelle, HTTPS automatique, pas de
serveur à maintenir. Netlify fonctionne à l'identique.

### Avant la première mise en ligne

- `astro.config.mjs` : remplacez `site:` par le domaine réel. Le sitemap, les
  URL canoniques, les liens `hreflang` et les balises de partage en dépendent.
- `public/robots.txt` : même domaine dans la ligne `Sitemap:`.
- `public/admin/config.yml` : `repo:`, `base_url:`, `site_url:`.
- `cabinet.yaml` → `contact.endpointFormulaire` : créez un formulaire sur
  [Formspree](https://formspree.io) et collez son URL. Tant qu'elle est vide,
  le formulaire refuse l'envoi et l'explique. Le champ caché `langue` indique
  dans quelle langue le visiteur a écrit.
- Ajoutez `public/og.png` (1200 × 630) : c'est l'image qui s'affiche quand le
  lien circule sur LinkedIn ou WhatsApp. Elle compte davantage que le
  classement Google pour ce site.
- Faites relire les mentions légales, dans les deux langues, par l'association
  professionnelle ou un avocat.

---

## 6. Référencement

En place : `title` et `description` par page et par langue, URL canoniques,
liens `hreflang` réciproques avec `x-default` sur le français, balises de
partage, `sitemap-index.xml` généré au build, `robots.txt`, données structurées
`FinancialService` sur toutes les pages, `FAQPage` sur l'accueil et `Article`
sur chaque note.

Restent à faire, hors code : créer la fiche Google Business Profile — c'est elle
qui ramène du local, pas le site — et déclarer le site dans la Search Console.

Aucun cookie n'est déposé : pas de Google Analytics, donc pas de bandeau de
consentement. Si une mesure d'audience devient nécessaire, Plausible ou Umami
se branchent sans cookie et sans bandeau.

---

## 7. Dépannage

| Symptôme | Cause probable |
|---|---|
| Du doré souligné partout | Normal : ce sont les `A COMPLETER` restants |
| La version anglaise n'apparaît pas dans le menu | `en: publie: false` dans `src/data/site.yaml` |
| Du français sur une page anglaise | Le champ manque dans `src/data/en/cabinet.yaml`, il est donc repris du français |
| Le CMS affiche « Not Found » à la connexion | `repo:` ou `base_url:` mal renseigné |
| L'enregistrement échoue sur l'ouverture de la PR | Le jeton GitHub n'a pas la permission *Pull requests* |
| Le formulaire refuse l'envoi | `endpointFormulaire` est vide |
| Les polices ne se chargent pas en local | Normal hors connexion : elles viennent de Google Fonts |
