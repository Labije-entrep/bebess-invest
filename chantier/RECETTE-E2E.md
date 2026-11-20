# Scénario de recette de bout en bout

Parcours nominal à dérouler après chaque déploiement. Il ne cherche pas les cas
limites — ceux-là sont dans `npm test` — il vérifie que les pièces sont reliées.

Trente à quarante minutes. **S'arrêter au premier échec** et le signaler : un
scénario qui continue après une rupture ne prouve plus rien. Noter à chaque étape
ce qui est observé, pas seulement « OK ».

**Environnement** : la recette (`RECETTE.md`), jamais la production. À défaut, le
local — en disant alors clairement ce que ce périmètre ne prouve pas : Cron réel,
R2 réel, domaines personnalisés, courriel réel, cours réels.

**Avant de commencer** : l'adresse de support doit être configurée dans les
réglages éditeur, sans quoi le compte de support du cabinet ne sera pas créé.

---

## A. Le cabinet
1. Session éditeur, `/admin`. Créer un cabinet : nom, hôte, SIREN valide, adresse
   et contact de facturation, thème. Les quatre prix sont obligatoires : poser la
   grille standard — 79, 49, 39 et 25 € — soit 7900, 4900, 3900, 2500 centimes.
2. Poser le DPA, puis la mise en production. → contrat en **essai**, fin à +45 j.
3. **Signer le contrat** → statut **actif**, début de service posé. Sans cette
   étape, aucun bon ne peut être produit.

## B. Le gestionnaire
4. Ouvrir le lien reçu, confirmer, arriver sur `/gestionnaire`. C'est le chemin le
   plus critique du produit : s'il échoue, tout s'arrête ici.
5. Réglages : les neuf listes sont peuplées. Renommer un libellé, créer un membre.
6. Contenus : remplir l'accueil et les mentions légales, **avec au moins deux
   paragraphes séparés par une ligne vide**. Ouvrir le site public → les
   paragraphes doivent être séparés.

## C. Le suivi
7. Créer un contact prospect : étape, sujet, échange.
8. Parcours : le faire avancer d'une étape. Kanban : porter le sujet au statut
   terminal, vérifier que « sujets ouverts » diminue.
9. Actus : le bloc Chiffres se remplit depuis les cours — sauf si aucune clé de
   cours n'est configurée, auquel cas l'écran doit le dire. Saisir un résumé et un
   « à dire aux clients ».

## D. La passerelle et l'espace client
10. Promouvoir le contact en viewer → viewer, fiche, portefeuille « Patrimoine »,
    lien envoyé.
11. Ouvrir le lien du viewer dans une autre session : espace vide.
12. Gestionnaire : saisir un arrêté complet en laissant les versements cumulés
    vides. La performance doit être vraisemblable, jamais un nombre à deux chiffres
    venu de nulle part.
13. Viewer : valorisation, répartition, date d'arrêté.
14. Poser des cibles créant un écart au-delà du seuil, créer le sujet d'écart
    depuis le panneau Portail : il porte sa provenance.
15. **Créer** la note depuis l'actu — c'est un brouillon — **puis la publier**
    depuis l'écran des notes. Elle paraît sur le site public, au mot près.

## E. Les fichiers
16. Déposer un PDF de rapport sur le portefeuille, le télécharger côté viewer.
17. Déposer un fichier dont l'extension ment sur le contenu : refusé.

## F. L'abonnement
18. Créer un quatrième accès : la phrase de dépassement s'affiche une seule fois,
    avec la bonne date, et pas au rechargement.
19. « Mon abonnement » en session associé : formule, montant, accès facturables,
    « illimités, non facturés ». **Aucune jauge**, aucun bouton de changement
    d'offre. En session collaborateur : refusé.
20. Déclencher le traitement quotidien : un bon est produit **pour ce cabinet**,
    avec raison sociale, SIREN, adresse et contact de facturation.

## G. Le cloisonnement
21. Session du gestionnaire de A sur une page, une route d'API et un rapport de B :
    **404**, jamais 403, jamais de donnée. Idem dans l'autre sens, et avec une
    session de viewer.
22. Cookie de A rejoué sur l'hôte de B : la session est ignorée et la requête est
    traitée comme anonyme — 302 vers la connexion pour une page, 401 pour l'API.
    C'est le comportement voulu : un 404 confirmerait à un porteur de cookie volé
    que son cookie est valide. Attendu : **aucune donnée, jamais de 403**.

---

## Ce qu'un agent ne peut pas faire à votre place
- Regarder les quatre thèmes sombres sur le tableau de bord d'un viewer.
- Ouvrir le parcours de connexion dans **Safari**.
- Lire un vrai courriel reçu chez Scaleway, pas dans une console.
- Juger si les mentions légales sont exactes.
