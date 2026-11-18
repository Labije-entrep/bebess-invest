# Lot 11 — Contrat, rôles et journal

Tu implantes le socle du modèle tarifaire. Aucun écran dans ce lot.

## 1. Rôles

Remplace l'énumération de `utilisateur.role` par :
`editeur`, `associe`, `collaborateur`, `lecture`, `support_editeur`, `viewer`.

- `associe` et `collaborateur` ont les droits de l'actuel `gestionnaire` ; `associe`
  seul accède aux réglages et à la page d'abonnement.
- `lecture` voit tout ce que voit un `collaborateur` et n'écrit rien.
- `support_editeur` se comporte comme un `associe` mais n'est jamais compté ni
  affiché dans la liste des accès du cabinet.

Mets à jour le middleware, les gardes de routes et les seeds.

## 2. Unicité des adresses

`utilisateur.email` passe de `UNIQUE` global à `UNIQUE(tenant_id, email)`.

C'est bloquant : sans cette correction, le compte de support de l'éditeur ne peut pas
exister dans un deuxième cabinet. Vérifie que la demande de lien de connexion résout
bien le couple locataire + adresse, et jamais l'adresse seule.

## 3. Dossier client

Ajoute sur `utilisateur` de rôle viewer : `statut` ∈ `brouillon`, `publie`,
`archive`, par défaut `brouillon`, et `publie_le`. Le passage à `publie` se fait quand
le lien de première connexion est envoyé. Les portefeuilles sont les entités du
dossier : un dossier compte pour un, quel que soit leur nombre.

## 4. Contrat

Une table `contrat`, un seul actif par locataire : `statut`, dates, `periodicite`, les
quatre prix unitaires recopiés, les deux booléens de module, `acces_inclus`,
`frais_installation`, `tarif_gele_jusqu_au`, les deux taux de remise, motif et date de
revue, `dpa_signe_le`, `preavis_recu_le`.

Trois règles dures, à faire respecter par le code et pas par la convention :

- les prix sont lus **sur le contrat**, jamais dans une grille globale ;
- toute modification d'un prix unitaire est refusée tant que `tarif_gele_jusqu_au`
  est dans le futur ;
- poser `date_mise_en_production` est refusé si `dpa_signe_le` est vide.

## 5. Journal

Une table `evenement` horodatée, en écriture seule. À journaliser : création,
suppression, suspension et changement de rôle d'un accès ; activation et désactivation
d'un module ; publication et archivage d'un dossier ; mise en production ;
modification d'un prix ; saisie et modification d'une remise ; création et validation
d'un parrainage ; tout accès de l'éditeur aux données d'un cabinet. Rien n'efface une
ligne de ce journal.

En cas de litige sur le nombre d'accès, le journal tranche ; et s'il est muet, la
décision va au cabinet. C'est cette règle qui oblige à le soigner.

## Vérification

Créer le même compte de support dans deux cabinets ; modifier un prix sur un contrat
gelé doit être refusé ; poser une mise en production sans DPA doit être refusé. Note
dans `ETAT.md` ce que la scission des rôles a cassé ailleurs.
