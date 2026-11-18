# Lot 04 — Module de suivi : la fiche

`maquettes/Suivi-Fiche.html` fait foi. Trois blocs dans la colonne principale :

1. **En-tête** : nom, structure, courriel, téléphone, types ; puis en charge, binôme,
   apporté par (lien vers l'autre fiche), prochaine relance. Modifiable en place.
2. **Sujets** : texte, statut, échéance. Un clic sur le statut le fait avancer dans
   l'ordre à faire, en cours, en attente, fait. Un sujet créé depuis le portail
   affiche sa provenance, lue dans la colonne `origine`.
3. **Échanges** : date, type, ce qui s'est dit. Ajout en place. Au-dessus du champ de
   note, une mention brève : ces notes sont communicables à la personne concernée.

## Le panneau Portail

La colonne de droite, en lecture seule pour ce lot : portefeuilles du viewer
rattaché, total, date du dernier arrêté, performance pondérée par le temps, dernière
visite, et la répartition réelle comparée aux cibles avec le trait de cible par
classe. Les boutons d'action viennent au lot 07 : pose-les désactivés.

Pour un contact sans viewer, le panneau affiche l'encart « non rattaché » de la
maquette, bouton désactivé lui aussi.

## Performance consolidée

Si le viewer a plusieurs portefeuilles, additionne les valeurs et les versements
cumulés à chaque date, puis enchaîne sur ces totaux. **Ne moyenne jamais des
performances.**

## Vérification

Un viewer à deux portefeuilles ; le total et la performance consolidée recalculés à
la main sur trois mois doivent tomber juste.
