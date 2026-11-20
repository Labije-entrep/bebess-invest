# Rapport — lot 17 : la sortie d'un contrat résilié

Date : 2026-11-20. `astro check` : 0 erreur. `npm test` : 27 tests, dont 2 nouveaux (règle des 30 jours).

## Objet

Le statut `resilie` existait et rien ne le regardait : `modules.ts`, ne trouvant aucun contrat « en cours », rouvrait tout. Un cabinet qui
résiliait gardait l'accès complet, indéfiniment.

## Ce qui change

1. **La résiliation prend effet à la date anniversaire** (`tarif.ts` `dateEffetPreavis`, `contrat.ts` `enregistrerPreavis` / `annulerPreavis`).
   Préavis reçu au moins 30 jours avant l'anniversaire (30 pile suffisent) : effet à cette date. Sinon : reconduction de douze mois, effet à
   l'anniversaire suivant. Aucun remboursement au prorata. Le contrat reste `actif` jusque-là ; le traitement quotidien le passe en `resilie`.
   La date d'effet est calculée une fois et stockée (migration `0013`, colonne `resiliation_effet_le`, à côté de `preavis_recu_le`).
   Annulable depuis la console tant que la date n'est pas atteinte (le jour même, elle l'est). Journalisé : `preavis_enregistre`,
   `preavis_annule`, `contrat_resilie`.
2. **Le calendrier de sortie réutilise celui de l'essai** (`essai.ts`, généralisé, pas réécrit). Tout se compte depuis une date de fin
   (J+45 d'un essai, date d'effet d'une résiliation). Résiliation : J accès du cabinet et viewers coupés + courriel (suppression à J+30, lien
   d'export) ; J+23 courriel « dans une semaine » ; J+30 suppression réelle par `purge.ts`, inchangé dans son contenu. Les clés du registre
   des envois de l'essai sont inchangées. Les courriels sont désormais **six** (quatre + deux) : les seuls envois automatiques du produit.
3. **Modules** (`modules.ts`) : `resilie` et `essai_non_converti`, sans nouveau contrat en cours, ferment tout (`TOUT_FERME`). Avant ce lot,
   `essai_non_converti` rouvrait tout lui aussi.
4. **Console** (`ContratCabinet.astro`, rubrique « 7. Résiliation ») : enregistrer un préavis avec sa date, voir la date d'effet calculée et
   le message de reconduction, annuler. Sur un contrat déjà résilié : date d'effet, jour de suppression, ou « données supprimées ».

Aussi : `auth.ts` coupe viewers et personnel pour les deux statuts de sortie ; le middleware dit « contrat résilié » ou « essai terminé » à
l'associé, qui garde l'export ; la facturation ne pose plus de bon pour une période qui commencerait à la date d'effet.

## Choix à relire

- **Engagement de douze mois, quelle que soit la périodicité de facturation** : un contrat mensuel a lui aussi une date anniversaire annuelle.
- **Préavis admis sur `actif` et `suspendu`** ; refusé en brouillon/essai (l'essai non converti se clôt seul), sans date de début de service,
  si un préavis existe déjà (annuler d'abord), pour une réception future, et si la date d'effet calculée est déjà passée ou tombe
  aujourd'hui (presque toujours une faute de saisie, et la suite supprime des données).
- **Bon déjà posé avant le préavis** : rien n'est annulé d'office (un bon annulé ne se rouvre pas, et le préavis s'annule). Une ligne dans
  les incidents de la console (`bon_apres_resiliation`) demande de l'annuler, ou de faire un avoir s'il est émis.
- La garde « un avis au moins une semaine avant la suppression » de l'essai vaut aussi ici (avis tardif, puis suppression 7 jours après).

## Vérification (une fois, en local)

D1 et R2 locaux, migrations 0001 à 0013, courriels capturés, traitement rejoué trois fois chaque jour : 70 contrôles, tous verts.
Préavis à 40 jours → effet à l'anniversaire ; à 20 jours → reconduction, dite à l'écran. J : cabinet et viewers coupés, associé garde
l'export (HTTP : page « contrat résilié », export 200, suivi 403, site public renvoyé à la connexion). J+30 : suppression réelle (base,
R2), le voisin dont l'identifiant commence pareil (`cab-1` / `cab-10`) intact ; raison sociale, contrat, factures et journal conservés.
Un seul courriel par jalon, une seule suppression. L'essai non converti se comporte comme avant.
