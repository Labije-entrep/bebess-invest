# Orchestration du chantier

Lis ce fichier **en entier** au début de chaque session. Il remplace tout prompt collé.

## Ce que tu fais, à chaque session

1. Lis `ETAT.md`. Prends le **premier** lot dont le statut n'est pas `fait`.
2. Si la case de prérequis de ce lot n'est pas cochée dans `ETAT.md`, **arrête-toi**
   et dis lequel manque. Ne commence pas.
3. Lis `10-regles.md`. Elles s'appliquent à tout ce que tu écris.
4. Lis `lot-NN-*.md`, **et lui seul**. Ne lis pas les autres lots : ils décrivent un
   futur qui n'est pas le tien et ils te feraient anticiper.
5. Fais le travail. Vérifie une fois, en local, ce que le lot demande de vérifier.
6. Un seul commit, message `Lot NN : <titre du lot>`.
7. Mets `ETAT.md` à jour : statut, empreinte du commit, ce que tu as vérifié, ce que
   tu n'as **pas** pu vérifier, et ce que tu as dû changer en dehors du périmètre.
8. **Arrête-toi.** Ne commence jamais le lot suivant dans la même session.

## Règles de l'orchestration

- **Un lot = une session = un commit.** Jamais deux lots d'affilée. La relecture
  humaine entre deux lots a rattrapé un défaut à chaque fois ; elle fait partie du
  procédé, pas des formalités.
- **N'invente jamais.** Ni un schéma, ni une table, ni un seuil, ni un prix, ni un
  libellé. Si une information manque, arrête-toi et demande-la. Un lot a déjà été
  perdu parce qu'un agent a écrit son propre schéma faute de l'avoir trouvé.
- **Tu ne modifies aucun fichier de `chantier/`**, sauf `ETAT.md`.
- Si un lot te paraît contredire un lot déjà fait, ou contredire le code existant,
  **arrête-toi et dis-le**. Ne tranche pas seul.
- Les maquettes de `maquettes/` sont la référence visuelle. Lis
  `maquettes/LISEZMOI.md` avant de t'en servir.
- Tout ce qui touche la base se fait en local. Aucune commande vers la production.

## Où sont les choses

| Fichier | Rôle |
| --- | --- |
| `ETAT.md` | L'avancement. Le seul fichier que tu écris ici. |
| `10-regles.md` | Règles communes et charte. À lire à chaque session. |
| `20-schema.sql` | Le schéma du lot 01. À utiliser tel quel, sans l'adapter. |
| `lot-NN-*.md` | Le travail d'un lot. Un seul par session. |
| `maquettes/` | La référence visuelle, en lecture seule. |
