# Lot 10 — Espace super admin

Prérequis : **P3** pour la partie domaines.

La route `/admin`, réservée au rôle éditeur, qui n'a jamais rien servi jusqu'ici.

1. **Créer un cabinet**, en une transaction : le locataire, ses listes de référence
   par défaut, son thème, sa ligne de version, son premier gestionnaire et le lien de
   première connexion envoyé. Aucun SQL à écrire à la main, jamais.

2. **Domaines.** La table `domaine` porte les noms d'hôte d'un cabinet. L'écran permet
   d'en déclarer un, affiche l'enregistrement CNAME que le cabinet doit poser, et
   l'état de validation. L'appel à l'API Cloudflare for SaaS se fait côté serveur avec
   un jeton en secret ; si le jeton manque, l'écran le dit clairement au lieu
   d'échouer en silence.

3. **Incidents.** La liste des lignes de la table `incident`, par cabinet, avec leur
   date : import en échec, mail refusé, cours indisponible.

4. **Sortie.** L'export complet d'un locataire, et la suspension d'un cabinet, qui
   bloque les connexions sans rien effacer.

Aucune de ces pages n'est accessible à un gestionnaire : vérifie-le explicitement avec
une session de chaque rôle.

Il n'y a pas de maquette pour ces écrans. Reprends la grammaire visuelle de
`maquettes/Admin-Conseiller.html` : en-tête, indicateurs, tableaux.

## Vérification

Créer un deuxième cabinet de bout en bout, s'y connecter avec son gestionnaire,
constater qu'il ne voit aucune donnée du premier. Puis rejoue le test de cloisonnement
à six cas.
