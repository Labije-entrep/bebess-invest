# Rapport — lot 20 : signer le contrat, les paragraphes, la recette jouable

Date : 2026-11-20. Branche : `claude/lot-20-signature-paragraphes-recette`. Un commit de lot (code, tests, rapport). `astro check` : 0 erreur.
`npm test` : **150 tests, 150 verts, aucun `todo`**, environ 1,7 s (123 avant ce lot : +27).

**Le lot 19 n'était pas dans `main`.** Sa branche n'avait jamais été poussée ni mergée : `main` n'avait ni la route des notes en 404, ni le bon
d'installation, ni la migration 0014. Ce lot est donc construit dessus, et la PR porte les deux commits (lot 19, puis lot 20). Le rapport du lot 19
(`chantier/rapport-lot-19.md`) arrive avec elle.

## 1. Passer un contrat de l'essai à l'actif

`contratsActifs` ne retient que `statut = 'actif' AND debut_le IS NOT NULL`, et rien n'écrivait jamais ces deux valeurs : aucun cabinet réel ne
pouvait être facturé. `signerContrat` (`contrat.ts`) pose `date_signature`, `debut_le` et `statut = 'actif'` en **une écriture**, avec son
événement `contrat_signe` (acteur, contrat, date de signature, début de service, fin d'essai, statut avant et après). La console a son action
« Signer le contrat » (fiche du contrat, rubrique « 5. Démarrage », visible pendant l'essai ; route `POST /admin/cabinets/<id>/contrat`,
`action=signature`, éditeur seulement).

| Règle | Code de refus |
| --- | --- |
| Pas de DPA signé (vérifié en premier, comme la mise en production ; la base le garantit aussi : un essai sans DPA ne peut pas exister) | `dpa_manquant` |
| Statut autre que `essai` (brouillon, actif, suspendu) ; un contrat sorti (résilié, essai non converti) n'est plus « en cours » | `pas_en_essai`, `aucun_contrat` |
| Date absente, illisible, future, ou antérieure à la mise en production | `signature_manquante`, `date_invalide`, `signature_future`, `signature_anterieure` |
| Date différente de celle que le contrat porte déjà (le statut fondateur la pose, et son gel se calcule dessus) : on la reprend, on ne la change pas | `signature_differente` |

### ⚠ Décision à confirmer : quelle date de début de service ?

Vous demandiez de ne pas trancher seul. **Retenu : la fin d'essai (`date_fin_essai`, mise en production + 45 jours), quelle que soit la date de
signature — sauf si la signature tombe après elle, auquel cas c'est la date de signature.**

- *Pourquoi.* La spécification dit : « Signature : la facture annuelle est émise, date_anniversaire = le 45ᵉ jour ». L'essai est « gratuit,
  produit entier, 45 jours » : le cabinet qui signe le 10ᵉ jour ne doit pas payer les 35 jours qu'il lui reste d'essai. Le début de service est la
  date anniversaire, d'où partent tous les bons (`periodesDebutant`), le calendrier de résiliation (lot 17) et la validation des parrainages
  (six mois de service payant).
- *Le cas limite.* Une signature **après** la fin d'essai (le lendemain, avant que le traitement ait passé le contrat en « essai non converti »)
  démarre à la signature : on ne facture pas une période écoulée avant que le contrat existe.
- *L'autre choix possible* : `debut_le` = date de signature (la facturation démarre dès la signature). Il suffit de remplacer, dans `signerContrat`,
  `const debut = signature > finEssai ? signature : finEssai;` par `const debut = signature;` ; deux tests l'établissent et casseront, ce qui est voulu.
- **Conséquence à connaître** : un contrat `actif` ne bénéficie plus de l'ouverture de l'essai (lot 16). Signer le 10ᵉ jour **ferme tout de suite**
  les modules non pris, alors que la facturation ne démarre que le 45ᵉ. L'écran de la fiche le dit. Si vous voulez que les modules restent
  ouverts jusqu'à `debut_le`, c'est une règle de plus dans `modulesDuTenant` (statut `actif` et `debut_le` dans le futur → tout ouvert) ; je ne l'ai pas
  posée : elle change la table de vérité du lot 16, c'est à vous de la décider.

### Vérification demandée

- **Un cabinet créé, mis en production, signé : le traitement quotidien produit son bon** — test de bout en bout, sans une ligne de SQL de décor :
  `creerCabinet` (avec raison sociale, SIREN, adresse et contact de facturation), `appliquerContrat` (formule avec la grille, DPA, mise en production,
  signature), puis `traitementQuotidien`. Résultat : un bon de période de 948 € pour **ce** cabinet (2026-12-16 → 2027-12-16), un bon d'installation de
  1 200 € à part, aucun bon pour un autre cabinet ; `bonComplet` donne les **quatre identifiants** et `manque = []`.
- **Le premier bon périodique est bien posé**, y compris quand la période a commencé depuis plus d'un mois et que le bon d'installation est déjà là
  (c'est la condition « aucun bon encore » du lot 19 : le test passe par le chemin du « premier bon », le sabotage correspondant est attrapé).
- **Signer sans DPA** : refusé (`dpa_manquant`), rien n'est écrit. **Signer un contrat déjà actif** : refusé (`pas_en_essai`), un seul événement.
- Un contrat signé avant J+38 ne reçoit plus aucun des courriels de l'essai, n'est pas suspendu à J+45 ni supprimé à J+75.
- Un module activé après la signature produit son bon complémentaire au prorata (20/01/2027 → 16/12/2027 : 11 mois, 539 €) : la chaîne que le
  seed seul avait montrée est maintenant éprouvée sur un contrat créé par les écrans.

## 2. Les paragraphes ne se perdent plus

Un `<textarea>` envoie `\r\n` ; `paragraphes` coupait sur `/\n{2,}/`. Correction aux **deux bouts** : `sansRetourChariot` est appliqué
**à l'enregistrement** (`enregistrerPage` normalise tout ce qu'un contenu porte, titre compris, chaînes, listes et groupes imbriqués ; `lireFormulaire`
aussi) — la base ne reçoit plus jamais de `\r`, quel que soit l'appelant — **et à l'affichage** (`paragraphes`), parce que le défaut est déjà en base et
se corrigerait sinon seulement à la prochaine saisie. Testé avec `\r\n\r\n`, `\r\r`, plusieurs lignes vides, de bout en bout par la route
`/gestionnaire/contenus/mentions` (trois paragraphes saisis, trois paragraphes relus, aucun `\r` en base), et sur un contenu déjà en base avec des `\r\n`.

*Resté hors du lot (même défaut, ailleurs, non demandé)* : `actus.astro` et `notes/[id].astro` ne normalisent que `\r\n` (pas un `\r` seul) ;
la bibliothèque (`bibliotheque.astro`) et les notes de contact ne normalisent rien. Aucun n'est découpé en paragraphes par `paragraphes`.

## 3. Une recette jouable

- **`*.localhost`** : `estHoteLocal` (`mail.ts`) accepte `localhost`, `127.0.0.1` et tout nom en `.localhost` (suffixe ancré : `localhost.evil.com`,
  `cabinet3.local`, `xlocalhost` restent refusés). Le lien d'export de l'essai suit la même convention (`http` sur `*.localhost`). Test : un cabinet créé sur
  `cabinet3.localhost` reçoit son lien (`http://cabinet3.localhost:4321/connexion/…`), qui ouvre le cabinet ; sur un domaine public, le pilote
  console lève, rien n'est écrit dans les journaux et l'incident est visible. **Production inchangée.**
- **`seeds/demo.sql`** : vingt cours fictifs (cinq symboles par défaut × quatre séances, au format du fournisseur) — une fiche d'actu affiche les
  derniers cours connus à sa date **sans clé d'API**, sans appel sortant ; le second cabinet reçoit les neuf listes complètes (les mêmes valeurs, valeurs
  terminales et marqueurs que le premier), un membre, un contact, un sujet, un échange et un second rapport (catégorie de sa liste, clé R2 préfixée
  par son identifiant). Test : le seed s'applique sur les 14 migrations, les deux cabinets ne se voient pas, un viewer se crée sur le second.
- **Grille standard** : `GRILLE_STANDARD` (`contrat.ts`, 7900 / 4900 / 3900 / 2500 centimes) préremplit les quatre prix du formulaire d'ouverture.
  *Ce n'est pas un tarif* : tous les prix se lisent sur le contrat. Elle ouvre un contrat telle quelle (testé).

## Ce que ce lot ne vérifie pas

Le gabarit HTML n'étant pas rendu, **le formulaire « Signer le contrat » et le préremplissage des prix ne sont éprouvés que par lecture du source du
gabarit** (le code y est), pas par un affichage. Le reste de la liste de `tests/LISEZMOI.md` s'applique (Astro, D1 et Cloudflare réels, Cron réel,
navigateur réel, concurrence réelle, horloge).

## Preuve que les tests voient

20 sabotages, un à la fois : DPA non exigé, statut non exigé, début de service = signature, début = fin d'essai même en signature tardive, `debut_le`
non posé, signature future ou antérieure à la production acceptée, date d'un fondateur modifiable, action absente de la console, normalisation retirée
(enregistrement, formulaire, affichage), `.local` accepté, suffixe non ancré, `*.localhost` refusé, prix non préremplis, formulaire absent, un prix de la
grille changé, un cours et une valeur de liste retirés du seed. **20 sur 20 attrapés.**

## Choix à relire

1. **La date de début de service** (voir plus haut) — la décision est vôtre.
2. **Les modules se ferment dès la signature**, avant le début de service (conséquence du statut `actif`, lot 16).
3. **Le message de `dpa_manquant`** dit désormais « La mise en production et la signature du contrat exigent… » ; celui de `signature_manquante` n'est plus propre
   au statut fondateur.
4. **Le DPA se contrôle avant le statut** : un brouillon sans DPA répond « DPA manquant » (ce qu'il faut régler en premier), non « pas en essai ».

## Mise en service

Aucune migration nouvelle dans ce lot (la 0014 vient du lot 19, avec la PR). Redéployer le site et le Worker de traitement. Le seed ne se rejoue
qu'en local (`wrangler d1 execute bebess --local --file=seeds/demo.sql`) ; sur une base locale existante, repartir d'une base neuve pour récupérer
les ajouts du second cabinet. Avant de signer un cabinet réel : identité de facturation complète (SIREN, adresse, contact) dans « Facturation » de la fiche,
sans quoi le bon porte la mention de ce qui manque et ne s'émet pas sans confirmation.
