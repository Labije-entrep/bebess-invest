# Lot 01c — Finitions du portefeuille, import et cloisonnement

Quatre points courts, tous issus du lot 01b. Le premier est le seul urgent.

## 1. L'import CSV écrit en aveugle sur le premier portefeuille

`appliquerImport` ne connaît pas les portefeuilles : il écrit tout sur le premier du
viewer. Pour un client à plusieurs entités, importer le relevé de la SCI verse ses
lignes dans la holding, sans message et sans trace. C'est une corruption silencieuse
qui mélange le patrimoine de deux entités distinctes.

- Ajoute une colonne `portefeuille` au format d'import, facultative.
- Si elle est absente et que le viewer n'a **qu'un** portefeuille, écris dessus :
  rien ne change pour l'immense majorité des cas.
- Si elle est absente et que le viewer en a **plusieurs**, **refuse la ligne** avec
  un message qui nomme le viewer et liste ses portefeuilles. Ne devine jamais.
- Si elle est présente, elle doit correspondre au libellé d'un portefeuille de ce
  viewer, comparé sans tenir compte de la casse ni des espaces de bord, comme pour
  les classes d'actifs. Sinon, refus avec la liste des libellés admis.
- Mets à jour le gabarit d'import et l'aide affichée à l'écran.

## 2. Le pilote `console` doit échouer bruyamment hors du poste de développement

Le retrait de la garde `import.meta.env.DEV` était nécessaire pour éprouver la
connexion sur un build, mais il laisse une porte : `MAIL_DRIVER=console` posé par
erreur en production écrirait des liens de connexion **non encore utilisés** dans les
journaux de Cloudflare.

Fais échouer le pilote `console` quand l'hôte de la requête n'est ni `localhost` ni
`127.0.0.1` : lève une erreur explicite au lieu d'écrire le lien. Une production mal
configurée n'enverra alors plus aucun courriel — panne visible et sans fuite — au
lieu de fuir silencieusement. Dis-le dans `DEPLOIEMENT.md`.

## 3. Archiver un portefeuille

Tu as refusé la suppression d'un portefeuille non vide, et tu as eu raison : on
n'efface pas un historique de performance. Mais il manque la sortie correspondante.

Ajoute `archive` sur `portefeuille`. Un portefeuille archivé disparaît du sélecteur
du viewer, de la vue « Tout » et des totaux, reste consultable par le gestionnaire,
et ne peut pas être la cible d'un import ou d'un arrêté. Le dernier portefeuille
actif d'un viewer ne s'archive pas.

## 4. Un deuxième locataire dans le seed

`seeds/demo.sql` n'en contient qu'un, ce qui rend le test de cloisonnement
impossible à jouer — or les lots 07 et 10 exigent de le rejouer.

Ajoute un second cabinet avec son propre gestionnaire, un viewer, un portefeuille et
quelques lignes. Puis joue les six cas : lecture et écriture croisées sur un viewer,
un portefeuille, une enveloppe, un point, un contenu de site, un document. Aucun ne
doit aboutir. Note le résultat dans `ETAT.md`.

## Vérification

Un CSV sans colonne `portefeuille` pour Claire doit être refusé en nommant ses deux
portefeuilles ; le même pour Thomas doit passer. Le pilote `console` appelé avec un
hôte autre que `localhost` doit lever. Un portefeuille archivé doit sortir du total.
