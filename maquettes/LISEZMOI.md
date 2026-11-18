# Maquettes de référence

Ces fichiers sont la référence visuelle du produit. Ils ne sont **pas** construits
par Astro (le dossier est hors de `src/` et de `public/`) et ne doivent jamais être
importés par du code applicatif.

Ouvrez-les dans un navigateur pour lire la mise en page, les espacements, les
tailles et les couleurs exactes. Les styles sont en ligne dans chaque fichier.

## Règles

- **Ne recopiez aucun lien externe depuis ces fichiers.** Dans le produit, les
  polices viennent de `@fontsource` et aucune requête du navigateur ne sort du
  domaine. Les maquettes s'affichent avec les polices système ; c'est normal et
  sans conséquence sur la mise en page.
- Les couleurs des maquettes sont écrites en dur. Dans le produit elles viennent
  **toujours** des jetons de `src/styles/app.css`, jamais d'une valeur littérale.
- Les données affichées sont fictives.

## Quelle planche pour quel écran

| Fichier | Écran |
| --- | --- |
| `Main.html` | Site vitrine — accueil |
| `Site-Approche.html` | Site vitrine — approche |
| `Portail-Connexion.html` | Connexion par lien |
| `Portail-Tableau.html` | Espace client — tableau de bord |
| `Portail-Portefeuille.html` | Espace client — portefeuille |
| `Portail-Ordres.html` | Espace client — mouvements |
| `Portail-Rapports.html` | Espace client — stratégie et rapports |
| `Portail-Mobile.html` | Espace client — mobile (390 px) |
| `Admin-Conseiller.html` | Espace gestionnaire — tableau de bord |
| `Suivi-Clients.html` | Module de suivi — liste des contacts |
| `Suivi-Fiche.html` | Module de suivi — fiche et passerelle |

## Écrans sans maquette

Il n'y a pas de planche pour la page « Mon abonnement » du cabinet ni pour la
console de l'éditeur (lots 10 à 13). Leur disposition est décrite en toutes
lettres dans les prompts correspondants : suivez-la, et reprenez la grammaire
visuelle de `Admin-Conseiller.html` pour l'en-tête, les indicateurs et les tableaux.
