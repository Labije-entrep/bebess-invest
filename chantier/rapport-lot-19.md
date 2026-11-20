# Rapport — lot 19 : la route des notes, le bon d'installation, et ce que le banc ne dit pas

Date : 2026-11-20. Branche : `claude/lot-19-notes-404-bon-installation`. Un seul commit. `astro check` : 0 erreur.
`npm test` : **123 tests, 123 verts, aucun `todo`**, environ 1,3 s (112 avant ce lot : +11).

## 1. La route des notes suit la règle « 404, jamais 403 »

`src/pages/gestionnaire/notes/[id].astro` redirigeait en 302 vers la liste quand la note était inconnue ou d'un autre cabinet. Elle répond
maintenant 404 (`Astro.rewrite('/404')`, comme la fiche d'un contact), en lecture et en écriture. Rien ne fuyait avant ; la règle n'a plus
d'exception. Le test `todo` du lot 18 est devenu un test ordinaire, plus complet : 6 sens (A→B, A→C, …) × GET et POST, la réponse est
identique à celle d'une note inconnue, la note visée n'est pas modifiée, et la note du cabinet lui-même s'ouvre toujours.

## 2. Le bon d'installation

Le bon à facturer fait le pont entre « je n'ai pas d'outil de facturation » et « je ne dois pas oublier de facturer » : depuis la
correction du lot 18, rien ne rappelait plus qu'un cabinet doit ses frais d'installation. `bon_a_facturer.type` admet `installation`.

| Règle demandée | Où elle est tenue |
| --- | --- |
| Posé une seule fois, à la mise en production, si les frais sont non nuls | `genererBonsInstallation` (`facturation.ts`), cinquième temps de `genererBons` : contrat en cours (essai, actif, suspendu) avec une date de mise en production et des frais > 0. |
| Un seul bon d'installation par contrat | **La base** : index unique partiel `idx_bon_installation (contrat_id) WHERE type = 'installation'`, tous statuts confondus. Rejoué trois fois, ou après annulation, ou après correction de la date de mise en production : toujours un seul. |
| Une seule ligne, sans récurrent, sans remise | `calculerInstallation` (`tarif.ts`, pur) ; et **la base** : contrôle `type <> 'installation' OR (recurrent_ht = 0 AND remise_taux = 0 AND remise_montant = 0 AND total_ht > 0)`. |
| Il apparaît dans « les bons à émettre » | C'est un brouillon comme les autres : `bonsParStatut('brouillon')`, la console (colonnes Type : « Installation », date d'un jour), la page du bon (« Bon à facturer d'installation », sans accès facturables ni sous-total), « Mon abonnement » une fois émis. L'incident `bon_a_emettre` prévient l'éditeur, une seule fois. |
| Frais nuls (cabinet fondateur) : aucun bon | `calculerInstallation` rend `null` ; et la base refuse un total nul. Éprouvé avec la vraie fonction `poserStatutFondateur`. |
| Rejoué, pas de second bon | Test : trois passes, un bon, un événement, un incident. |

Il est numéroté, émis, annulé (avoir) par les mêmes fonctions que les autres. Un brouillon suit les frais du contrat (frais corrigés
avant l'émission) ; un bon émis ne bouge plus. Le bon périodique, lui, ne porte toujours pas les frais (test : deux périodes, avec une
remise de 25 %, total = récurrent moins la remise).

### Une régression évitée, trouvée en écrivant les tests

`genererBons` pose le bon de la période en cours d'un contrat qui n'a « encore aucun bon ». Avec un bon d'installation posé dès l'essai,
cette condition aurait été fausse à la conversion en contrat : **le premier bon périodique n'aurait jamais été posé** (seul le bon de
l'anniversaire suivant l'aurait été). La condition ignore désormais le bon d'installation. Un test le couvre (essai → actif, première passe
plus d'un mois après le début de service), et le sabotage correspondant est attrapé.

### Migration 0014

SQLite ne change pas un CHECK en place : `bon_a_facturer` est reconstruite (copie, DROP, recréation, recopie), comme 0008 et 0009. Les trois
index et les quatre déclencheurs sont recréés à l'identique, plus l'index des installations. La période d'un bon d'installation est un jour
(début = fin) : le contrôle des dates est assoupli pour ce seul type. `migration.test.ts` l'éprouve **sur une base qui a déjà ses bons, un
bon émis numéroté et un avoir** : aucune ligne ne change, `PRAGMA foreign_key_check` est vide, les gardes jouent encore (numéro définitif,
bon émis figé, pas de suppression, transitions de statut, avoir immuable, collision de numéro). Le banc sait pour cela s'arrêter à une
migration donnée (`baseNeuve('0013')`).

## 3. Ce que le banc ne couvre pas, dans `tests/LISEZMOI.md`

Une section en tête du fichier, titrée « Ce que « tous les tests sont verts » ne dit PAS », sous forme de tableau : le gabarit HTML des pages,
Astro lui-même (doublures), D1 réel, Cloudflare réel, le Cron réel, un navigateur réel, la concurrence réelle de deux transactions, l'horloge
(`date('now')` lu par SQLite), et la lecture des en-têtes `.astro` par expression régulière. Chaque ligne dit ce qui reste à vérifier et
comment. La section « Écarts connus » dit qu'il n'y en a plus, et que tout `todo` futur doit y figurer.

## Preuve que les tests voient

11 sabotages du code, un à la fois, chacun suivi de `npm test` : frais qui reviennent dans le bon périodique, test d'existence retiré (un bon
par passe), bon à zéro euro, installation posée pour un cabinet sorti, bon d'installation qui dispense du premier bon de période, route des
notes qui redirige de nouveau, index d'unicité, déclencheur et contrôle de la migration retirés. **Tous attrapés** (un sabotage a d'abord
survécu — le test passait par un autre chemin —, le test a été corrigé). Deux autres changements sont *équivalents* : retirer la condition
`frais > 0` de la requête, ou la condition « pas annulé » de la lecture, ne change rien, car `calculerInstallation` et l'index unique de la base
tiennent la même règle : une défense à deux niveaux, voulue.

## Choix à relire

1. **Rattrapage des contrats déjà en production.** Le traitement pose le bon d'installation pour *tout* contrat en cours avec une date de
   mise en production et des frais > 0, y compris un contrat actif depuis des mois dont la facture d'installation a déjà été tapée à la main.
   À la première passe après déploiement, un brouillon « Installation » apparaîtra dans la console pour chacun : **l'éditeur l'annule**
   (un bon annulé ne se recrée pas). Pour les lister avant de déployer :

   ```sql
   SELECT c.id, t.nom, c.statut, c.date_mise_en_production, c.frais_installation FROM contrat c JOIN tenant t ON t.id = c.tenant_id
    WHERE c.statut IN ('essai','actif','suspendu') AND c.date_mise_en_production IS NOT NULL AND c.frais_installation > 0;
   ```
2. **Posé dès l'essai**, comme demandé (« à la mise en production »), pas à la conversion en contrat. Un essai non converti laisse donc un
   bon d'installation à émettre ou à annuler : c'est à l'éditeur de décider. Les contrats `resilie` et `essai_non_converti` n'en reçoivent pas de
   nouveau.
3. **Frais mis à zéro après la pose** (statut fondateur posé après la mise en production) : le brouillon déjà posé garde son ancien montant ; il
   n'est pas annulé d'office, un bon ne s'annule pas sans geste. L'éditeur l'annule.
4. **Une date de mise en production corrigée** ne déplace pas le bon (il garde sa date d'origine) et n'en crée pas un second.
5. **La migration reconstruit une table de production.** Elle est atomique (D1 applique une migration dans une transaction) ; faire un
   `npx wrangler d1 export` avant, par prudence, comme pour 0008 et 0009.

## Mise en service

- Appliquer la migration : `npx wrangler d1 migrations apply bebess --remote` (0014).
- Redéployer le site **et** le Worker de traitement (`npx wrangler deploy -c wrangler.cron.toml`) : c'est lui qui pose le bon d'installation.
- Avant, lister les contrats concernés (requête ci-dessus) pour savoir quels brouillons annuler.
