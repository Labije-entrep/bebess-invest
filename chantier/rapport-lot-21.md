# Rapport — lot 21 : deux défauts du bon d'installation, trouvés en vérifiant la signature

Date : 2026-11-20. Branche : `claude/lot-21-verifs-signature`. Un seul commit. `astro check` : 0 erreur.
`npm test` : **139 tests, 139 verts, aucun `todo`** (135 sur `main` avant ce lot : +4).

## Ce qui s'est passé

Le prompt de ce lot (signer le contrat, les paragraphes, la recette jouable) a été traité **deux fois, en parallèle** : une autre session l'a livré
et mergé dans `main` (PR #25, « Lot 19 : signer le contrat, bon d'installation, solde de la recette », puis PR #26) pendant que je construisais le
même travail. Au moment de créer la PR, la mienne était en conflit sur 13 fichiers avec du code équivalent déjà en production. **Je ne l'ai pas
mergée** : écraser un travail déjà intégré par une variante n'apporte rien, et la mienne contenait en plus un lot 19 jamais poussé (route des notes,
migration 0014) qui est lui aussi dans `main`, sous une autre forme. La PR #27 est fermée sans merge, sa branche reste disponible.

Ce que ces deux travaux ont de commun, et que j'ai vérifié sur `main` : la signature (DPA exigé, refusée hors essai, `debut_le = max(signature, fin d'essai)`,
journalisée), les paragraphes (`\r\n` normalisé à l'enregistrement et à l'affichage, notes comprises), `*.localhost`, le seed (cours, second cabinet), la grille
préremplie, la route des notes en 404. Je les ai attaqués par 14 sabotages du code de `main` (signature, paragraphes, courriel, grille, route des notes, seed) : **tous attrapés** par ses tests (un sabotage mal posé a dû être refait). Ils sont solides.

Ce qui manquait, c'est la dernière demande du prompt : **« vérifie ensuite que le premier bon périodique est bien posé »**. Elle a trouvé deux défauts.

## Défaut 1 — le bon d'installation masque le premier bon périodique

`genererBons` pose le bon de la période **en cours** d'un contrat qui n'a « encore aucun bon » (une mise en service tardive ne doit pas rester sans facture).
Depuis que la signature pose un bon d'installation, tout contrat à frais en a un : la condition ne se déclenchait plus jamais. Le premier bon périodique
n'existait alors que si la passe du traitement tombait dans les 30 jours **avant** la date anniversaire. Un contrat signé le jour de la fin d'essai, vu pour
la première fois six semaines plus tard, restait sans bon périodique. **Corrigé** : la condition ignore le bon d'installation (`facturation.ts`).

## Défaut 2 — le bon d'installation est écrasé par le premier bon périodique

Plus grave, trouvé en écrivant le test du défaut 1. Daté du jour de la signature, le bon d'installation portait **la même clé** (contrat, début de
période) que le premier bon périodique chaque fois que le contrat est signé le jour de la fin d'essai ou après (`debut_le` = jour de signature). `poserBon`
cherchait « le bon de cette période », trouvait le bon d'installation, le prenait pour le sien et le **réécrivait** : 948 € au lieu de 1 200 €, une période d'un
an, toujours typé « installation ». Les frais d'installation disparaissaient du produit sans aucune erreur, et le bon périodique n'était jamais créé.

**Corrigé** : (1) le bon d'installation est daté du jour de la **mise en production** (`signerContrat`), qui précède `debut_le` d'au moins 45 jours : sa clé ne peut plus
coïncider avec celle d'un bon de période ou d'un bon complémentaire ; c'est aussi ce que le prompt du lot demandait (« à la mise en production »). (2) `poserBon` ne
reprend plus jamais le bon d'un autre type (`AND type = ?`) : même si une clé coïncidait, un bon d'installation ne serait pas réécrit.
**Données à vérifier** : aucun cabinet réel n'a pu être signé avant le lot 19 (c'était le défaut bloquant), donc rien en production. Sur une base de recette où la 0014
a déjà été appliquée et des contrats signés, chercher un bon d'installation déjà écrasé, et le remplacer à la main (annuler, refaire signer sur un contrat de test) :

```sql
SELECT id, tenant_id, statut, periode_debut, periode_fin, recurrent_ht, total_ht FROM bon_a_facturer
 WHERE type = 'installation' AND (recurrent_ht > 0 OR periode_fin <> periode_debut);   -- doit être vide
```

## Tests ajoutés (`tests/signature.test.ts`)

- le bon d'installation ne masque pas le premier bon périodique : posé même quand la période a commencé depuis plus d'un mois ;
- l'ordre inverse : le premier bon périodique d'abord, aucun doublon ni disparition ensuite ;
- signé le jour même du début de service : le bon d'installation reste intact (1 200 €, une ligne, un jour, même identifiant), le bon périodique est un autre bon ;
- `poserBon` ne reprend jamais le bon d'un autre type (un bon d'installation « mal daté » n'est pas réécrit) ;
- l'ancien test de date du bon d'installation attend désormais le jour de la mise en production.

Les trois sabotages correspondants (condition « aucun bon » sans le filtre, recherche de `poserBon` sans le type, bon daté de la signature) sont attrapés.

## Vérification demandée par le prompt, sur `main` corrigé

| Demande | Résultat |
| --- | --- |
| Un cabinet créé, mis en production, signé : le traitement produit un bon pour lui, quatre identifiants, bon d'installation distinct | oui (`signature.test.ts`, chaîne `creerCabinet` → contrat → production → signature → traitement) ; avec 1 200 € de frais, deux bons distincts, 948 € et 1 200 € |
| Signer sans DPA : refusé ; signer un contrat déjà actif : refusé | oui |
| Mentions légales à trois paragraphes → trois paragraphes | oui (`contenus.test.ts`) |
| Cabinet sur `cabinet3.localhost` : lien reçu | oui (`environnement.test.ts`) |

## À confirmer / à relire

1. **Les modules se ferment dès la signature**, avant le début de service : un contrat `actif` ne profite plus de l'ouverture de l'essai (lot 16). Signer le 10ᵉ jour
   ferme les modules non pris alors que la facturation ne démarre que le 45ᵉ. C'est la conséquence de la règle posée, pas un défaut du lot ; si vous voulez que les
   modules restent ouverts jusqu'à `debut_le`, c'est une règle de plus dans `modulesDuTenant`.
2. **Le bon d'installation est créé à la signature** (choix de `main`) mais **daté de la mise en production** (ce lot). La date affichée dans la console est donc celle de
   la mise en production.
3. **Process** : deux sessions ont reçu le même prompt. Avant de lancer un lot, vérifier que `main` ne l'a pas déjà reçu (`git log origin/main`).

## Mise en service

Aucune migration nouvelle (la 0014 de `main` est inchangée, hors son commentaire). Redéployer le site et le Worker de traitement (`facturation.ts`).
