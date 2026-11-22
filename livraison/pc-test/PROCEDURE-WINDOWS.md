# Essayer Labije Cab sur un PC Windows, accessible à distance

**Test seulement.** Cette procédure sert à vérifier que Labije Cab tourne hors de Cloudflare et à le montrer à distance pendant quelques heures. Elle ne convient **pas** à un cabinet réel : le PC doit rester allumé, il n'y a pas de sauvegarde automatique, et la machine devient responsable de la sécurité des données. Utilisez uniquement les données **fictives** des jeux de démonstration.

## Ce qui a été vérifié, et ce qui ne l'a pas été

| Étape | Vérifié ? |
| --- | --- |
| Construire le site, créer la base locale, charger les jeux de démonstration, servir le site avec `wrangler dev`, ouvrir une session avec `session-de-test.mjs` | Oui, **sur macOS**, avec les mêmes commandes. |
| Les mêmes commandes **sous Windows 11** (installation des outils, chemins, PowerShell) | **Non** : c'est ce que ce test doit éprouver. |
| Le tunnel Cloudflare rapide (`cloudflared`) et l'accès par l'adresse IP | **Non**, jamais essayé. |

Si une étape échoue, copiez le message exact dans la conversation : il servira à corriger cette procédure.

## 0. Votre PC : faut-il de la place ?

Non, 280 Go suffisent largement. Le projet complet avec ses dépendances occupe environ 1 Go, la base de test quelques mégaoctets. Vérifiez seulement qu'il reste **au moins 5 Go libres** sur le disque C: (Paramètres › Système › Stockage). Un stockage dédié n'est pas utile pour un test ; pour sauvegarder la base, copiez son dossier sur une clé USB ou un autre disque (voir la section 9). Avec 16 Go de mémoire, aucune limite à prévoir.

## 1. Installer les outils (une seule fois)

Ouvrez **PowerShell** (menu Démarrer, tapez « PowerShell »), puis :

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Cloudflare.cloudflared -e
```

**Fermez PowerShell et rouvrez-le**, puis vérifiez :

```powershell
git --version
node -v
cloudflared --version
```

**Preuve :** `node -v` affiche **v22.18 ou plus** (la version LTS actuelle convient). Si `node -v` affiche un numéro plus ancien, dites-le-moi avant de continuer.

## 2. Récupérer le code

On essaie la version de **production** : la branche `master`. (`develop` est la branche d'intégration, qui peut contenir des évolutions pas encore validées.)

```powershell
cd $HOME
git clone https://github.com/Labije-entrep/labije-cab.git
cd labije-cab
git checkout master
npm install
```

**Preuve :** `npm install` se termine sans erreur (des avertissements sont normaux).

## 3. Construire le site

```powershell
npm run build
```

**Preuve :** la dernière ligne annonce « Complete! », et le dossier `dist` existe.

## 4. Créer la base de test et la remplir

```powershell
npx wrangler d1 migrations apply labije-cab --local
npx wrangler d1 execute labije-cab --local --file=seeds/demo.sql
npx wrangler d1 execute labije-cab --local --file=seeds/recette-suivi.sql
npx wrangler d1 execute labije-cab --local --file=seeds/recette-cours.sql
npx wrangler d1 execute labije-cab --local --file=seeds/recette-site.sql
```

Wrangler peut demander s'il peut envoyer des statistiques d'usage : répondez comme vous voulez. Aucune connexion à un compte Cloudflare n'est nécessaire.

**Preuve :** la première commande affiche 18 migrations (0001 à 0018) cochées, les suivantes n'affichent pas d'erreur. La base est dans le dossier `.wrangler\state`.

Ces jeux contiennent **deux cabinets fictifs** et des clients fictifs. Le premier cabinet (`tnt_demo`) est configuré pour l'adresse `localhost`.

## 5. Premier essai, sur le PC lui-même

Dans PowerShell, laissez ce serveur tourner :

```powershell
npx wrangler dev --port 8787 --var MAIL_DRIVER:console
```

Attendez « Ready on http://localhost:8787 », puis ouvrez **http://localhost:8787** dans le navigateur.

**Preuve :** le site public s'affiche : « La discipline *avant* la promesse ».

Pour vous connecter à un compte, deux possibilités :
- **Par courriel simulé.** Allez sur `http://localhost:8787/connexion`, saisissez `gestionnaire@demo.local`, cliquez sur « Recevoir un lien » : le lien s'affiche **dans la fenêtre PowerShell du serveur**. Copiez-le dans le navigateur, puis confirmez. Cela ne marche que sur `localhost`.
- **Par une session de test** (marche aussi à distance, voir plus bas). Ouvrez une **seconde** fenêtre PowerShell :

```powershell
cd $HOME\labije-cab
node livraison\pc-test\session-de-test.mjs --lister
node livraison\pc-test\session-de-test.mjs usr_gestionnaire
```

Le script affiche une ligne `document.cookie = ...`. Dans le navigateur, sur le site, ouvrez la console (touche **F12**, onglet « Console »), collez cette ligne et validez : vous êtes connecté. Comptes utiles : `usr_gestionnaire` (associé), `usr_collab` (collaborateur), `usr_claire` (client), `usr_editeur` (éditeur, pour `/admin`).

## 6. L'accès à distance, option A (recommandée) : un tunnel Cloudflare

Un tunnel relie votre PC à Internet **sans rien ouvrir sur votre box** et donne une adresse en `https`. Il n'exige ni compte ni nom de domaine. Il ne remplace pas l'adresse IP : vous n'avez pas à la communiquer, ni à modifier la box.

1. Laissez le serveur de la section 5 en marche. Ouvrez une **seconde** fenêtre PowerShell :

```powershell
cloudflared tunnel --url http://localhost:8787
```

2. Après quelques secondes, une adresse du type `https://mots-au-hasard.trycloudflare.com` s'affiche. **Notez-la** (sans le `https://`).
3. Le produit reconnaît le cabinet par le nom d'hôte de la requête : il faut donc lui dire que votre tunnel est l'adresse du cabinet de démonstration. Dans une **troisième** fenêtre :

```powershell
cd $HOME\labije-cab
npx wrangler d1 execute labije-cab --local --command "UPDATE tenant SET domaine = 'mots-au-hasard.trycloudflare.com' WHERE id = 'tnt_demo'"
```

(remplacez par votre adresse notée). **Cette adresse change à chaque démarrage du tunnel : refaites cette commande à chaque fois.** Pour revenir à l'essai local, remettez `localhost` à la place.

4. Ouvrez l'adresse du tunnel depuis un autre appareil (votre téléphone en 4G, le PC d'un proche).

**Preuve :** le site public s'affiche à distance.

**Pour se connecter à distance.** Le mode « console » des courriels est refusé hors `localhost` (volontaire). Deux solutions :
- **Session de test** : lancez le script de la section 5 sur le PC, puis donnez le cookie à la personne **par un canal privé** (elle le colle dans la console de son navigateur). Pratique pour vous, peu pour un téléphone.
- **Vrais courriels** : si vous avez un compte Scaleway (domaine d'envoi vérifié), créez à la racine du projet un fichier texte nommé `.dev.vars` contenant :

```
MAIL_DRIVER=scaleway
SCW_SECRET_KEY=votre_cle
SCW_PROJECT_ID=votre_projet
MAIL_FROM=adresse-expediteur@votre-domaine.fr
```

et relancez `npx wrangler dev --port 8787` (sans `--var MAIL_DRIVER:console`). Le lien de connexion arrive alors par courriel, comme en production. C'est aussi l'occasion d'essayer Scaleway avant la mise en production. Ce fichier est ignoré par Git : **ne le partagez jamais**.

**Limites du tunnel rapide :** il est fait pour des essais. Il n'a pas de garantie de disponibilité, et il s'arrête quand vous fermez la fenêtre.

## 7. L'accès à distance, option B : par l'adresse IP, sans nom de domaine

**À ne tenter que si l'option A ne convient pas.** Elle expose directement votre PC sur Internet. Il y a trois obstacles, dont deux peuvent la rendre impossible.

1. **L'adresse IP de votre box** doit être publique. Comparez l'adresse « WAN » ou « Internet » affichée dans la configuration de la box avec celle que donne un site « quelle est mon adresse IP ». Si elles diffèrent, votre fournisseur partage une adresse entre plusieurs clients (CGNAT) : l'accès direct est **impossible**.
2. **L'adresse peut changer** quand la box redémarre. À chaque changement, il faut refaire la commande de la section 6, point 3, avec la nouvelle adresse.
3. **Il faut du `https`.** Le cookie de connexion est marqué « sécurisé » : un navigateur le refuse sur une simple adresse `http://`. Sans nom de domaine, on ne peut utiliser qu'un certificat auto-signé : le navigateur affichera un avertissement à chaque visiteur (« Avancé › continuer »).

Si vous voulez quand même essayer :

1. **Fixer l'adresse du PC dans votre réseau** : dans la configuration de la box, réservez une adresse locale fixe pour ce PC (« bail DHCP statique »).
2. **Ouvrir un port** : dans la box, redirigez le port TCP **8443** vers l'adresse locale du PC, port **8787**.
3. **Autoriser le port dans Windows**, dans PowerShell lancé « en tant qu'administrateur » :

```powershell
New-NetFirewallRule -DisplayName "labije-cab test 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
```

4. **Lancer le serveur en https**, en écoutant sur toutes les interfaces :

```powershell
npx wrangler dev --ip 0.0.0.0 --port 8787 --local-protocol https
```

5. **Dire au produit que votre adresse IP publique est celle du cabinet** :

```powershell
npx wrangler d1 execute labije-cab --local --command "UPDATE tenant SET domaine = '203.0.113.7' WHERE id = 'tnt_demo'"
```

(remplacez par votre adresse IP publique, sans le port).

6. Depuis l'extérieur : `https://203.0.113.7:8443` (avec votre adresse), en acceptant l'avertissement du navigateur.

**Après le test :** supprimez la redirection de port dans la box, et la règle Windows :

```powershell
Remove-NetFirewallRule -DisplayName "labije-cab test 8787"
```

## 8. Garder le PC éveillé pendant un test

Pour que le PC ne se mette pas en veille, dans PowerShell :

```powershell
powercfg /change standby-timeout-ac 0
```

Remettez ensuite la valeur habituelle (par exemple `powercfg /change standby-timeout-ac 30`).

## 9. Sauvegarder, arrêter, nettoyer

- **Sauvegarder** : fermez le serveur (Ctrl+C), puis copiez le dossier `.wrangler\state` du projet sur une clé USB ou un autre disque. C'est toute la base de test.
- **Repartir de zéro** : fermez le serveur, supprimez le dossier `.wrangler\state`, puis refaites la section 4.
- **Arrêter** : Ctrl+C dans la fenêtre du serveur et dans celle du tunnel.

## 10. Quand ça ne marche pas

| Symptôme | Cause probable | Que faire |
| --- | --- | --- |
| `node` n'est pas reconnu | PowerShell n'a pas été rouvert après l'installation | Fermer et rouvrir PowerShell. |
| `npm install` échoue | Version de Node trop ancienne, ou réseau | Vérifier `node -v` (22.18 ou plus). |
| La page d'accueil renvoie « 404 » ou ramène à la connexion | Le nom d'hôte ne correspond à aucun cabinet | Refaire la commande `UPDATE tenant SET domaine = ...` avec l'adresse exacte utilisée dans le navigateur. |
| Les pages du site public répondent 404 | Le module Site vitrine n'est pas actif | `npx wrangler d1 execute labije-cab --local --command "UPDATE contrat SET module_site = 1 WHERE tenant_id = 'tnt_demo'"` |
| Connexion impossible à distance | Courriel non configuré | Utiliser le script `session-de-test.mjs`, ou configurer Scaleway (section 6). |
| Le cookie est refusé | Adresse en `http://` | Utiliser le tunnel (option A) ou le `https` (option B). |
| Le téléchargement d'un rapport PDF ne marche pas | Aucun fichier n'a été déposé dans la base de test | Normal : aucun PDF n'existe dans les jeux de démonstration. Un dépôt marche en local. |

## 11. Quoi vérifier à distance

Reprenez le **mini plan de test du site public** : le visiteur qui navigue, la connexion d'un client à son espace, la connexion du gestionnaire, puis la modification d'un contenu du site. Notez en particulier : la vitesse perçue à distance, le rendu sur téléphone, et tout message d'erreur.
