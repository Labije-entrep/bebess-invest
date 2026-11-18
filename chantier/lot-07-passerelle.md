# Lot 07 — La passerelle

Prérequis : **P2** (les liens de connexion arrivent réellement).

Quatre ponts, tous commandés par un geste humain. Rien ne se déclenche tout seul.

1. **Promotion.** Sur une fiche sans viewer, le bouton crée en une transaction :
   l'utilisateur de rôle viewer à partir du nom, du prénom et de l'adresse du
   contact ; sa fiche ; un portefeuille « Patrimoine » ; puis pose
   `contact.viewer_id` et envoie le lien de première connexion par `mail.ts`. Si
   l'envoi échoue, le rattachement reste fait et l'écran le dit. Un contact sans
   adresse ne peut pas être promu : explique-le au lieu de désactiver le bouton sans
   raison.

2. **Avoirs dérivés.** Dès qu'un contact porte un `viewer_id`, `avoirs_cents` et
   `avoirs_le` ne sont plus saisissables et sont calculés : somme des enveloppes de
   tous ses portefeuilles, date du dernier arrêté. Les valeurs saisies avant le
   rattachement restent en base mais ne sont plus affichées.

3. **Écart d'allocation en sujet.** Le panneau Portail utilise `ecartAllocation`, qui
   existe depuis le lot 3 du portail. Si un écart dépasse le seuil du cabinet
   (`reglage.seuil_ecart_bp`), le bouton crée un sujet sur le contact, dont le texte
   nomme la classe, le réel et la cible, et dont `origine` vaut
   `ecart:<classe>:<date d'arrêté>`. Deux clics ne créent pas deux fois le même
   sujet : si un sujet ouvert porte déjà cette origine, ouvre-le.

4. **Arrêté périmé en sujet.** Même mécanisme quand le dernier arrêté d'un
   portefeuille dépasse `seuil_arrete`, avec `origine` = `arrete:<portefeuille>:<date>`.

5. **Note publiée.** Sur une actu, un bouton crée une `note_marche` à partir du titre
   et du champ « à dire aux clients », non publiée, et range son identifiant dans
   `actu.note_marche_id`. La publication reste un second geste, dans l'écran des
   notes. **Aucune reformulation** : le texte est repris mot pour mot.

Active les boutons posés désactivés aux lots 04 et 06.

## Vérification

Promouvoir un contact, vérifier que le viewer reçoit son lien et voit son espace
vide ; créer deux fois le sujet d'écart et constater qu'il n'y en a qu'un. Puis
rejoue le test de cloisonnement à six cas.
