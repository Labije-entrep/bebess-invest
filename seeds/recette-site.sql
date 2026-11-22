-- Site public de recette : contenu du site d'origine (version initiale, src/data/fr/cabinet.yaml) reporté dans les pages du cabinet `tnt_demo`.
-- Les champs « A COMPLETER » de l'original sont remplacés par des valeurs FICTIVES, marquées « (exemple) ». À jouer en recette seulement ; remplace les pages et les réglages d'identité de `tnt_demo`.

DELETE FROM page_contenu WHERE tenant_id = 'tnt_demo';
INSERT INTO page_contenu (id, tenant_id, cle, langue, titre, contenu_json, maj_le) VALUES
  ('pc_site_accueil', 'tnt_demo', 'accueil', 'fr', 'Conseil en gestion de portefeuilles',
   '{"description":"Cabinet indépendant de conseil et de suivi de portefeuilles d''actifs. Méthode écrite, reporting trimestriel, premier échange sans engagement.","eyebrow":"Conseil & suivi de portefeuilles","titre":"La discipline avant la promesse.","mot_accent":"avant","intro":"BeBess''Invest accompagne un nombre volontairement restreint de clients dans la construction, le suivi et l''arbitrage de leurs portefeuilles d''actifs. Un interlocuteur unique, une méthode écrite, des comptes rendus à date fixe.","cta_primaire":"Demander un premier échange","cta_secondaire":"Découvrir la méthode","preuves":["Indépendance : aucun réseau bancaire, aucun produit maison imposé.","Conservation des fonds : vos avoirs restent chez votre dépositaire, je ne détiens aucun fonds.","Cadre réglementaire : conseiller en investissements financiers, ORIAS n° 00 000 000 (exemple).","Assurance : responsabilité civile professionnelle souscrite (exemple)."],"missions":[{"etiquette":"Cadrage","titre":"Comprendre avant d''allouer","texte":"Inventaire des actifs, horizon réel de chaque poche, contraintes fiscales et familiales, tolérance au risque exprimée en euros et non en adjectifs. Le cadrage est écrit et signé avant tout arbitrage."},{"etiquette":"Allocation","titre":"Construire l''architecture","texte":"Répartition stratégique entre poches de liquidité, de rendement et de croissance, puis sélection des supports : indiciel, gestion active, non coté, immobilier. Chaque choix est motivé par écrit, frais compris."},{"etiquette":"Suivi","titre":"Tenir la ligne dans le temps","texte":"Point trimestriel, rééquilibrage documenté, alerte en cas d''écart significatif avec le cadrage initial. L''absence de mouvement est aussi une décision : elle est justifiée comme les autres."}],"positionnement":{"eyebrow":"Positionnement","titre":"Un interlocuteur, une méthode écrite","p1":"Notaire, expert-comptable, avocat, banquier : j''assure la cohérence entre les décisions patrimoniales et le reste de votre organisation, et je consolide les positions éparpillées.","p2":"Le cabinet s''adresse aux cadres et professions libérales, aux dirigeants qui préparent une cession et aux familles qui veulent transmettre sans casse."},"citation":{"texte":"Certains montages sont bons pour celui qui les vend. Si votre situation ne justifie rien, je vous le dis et nous en restons là.","source":"Dire non fait partie du conseil"},"faq":[{"question":"Qui détient mon argent ?","reponse":"Pas moi. Vos avoirs restent déposés chez l''établissement teneur de compte ou l''assureur, à votre nom. Mon rôle est de conseiller et d''arbitrer dans ce cadre, jamais d''encaisser vos fonds."},{"question":"À partir de quel montant est-ce pertinent ?","reponse":"En dessous d''un certain encours, les honoraires pèsent plus que le gain attendu : je vous le dirai franchement lors du premier échange. Ordre de grandeur indicatif : à partir de 150 000 € (exemple)."},{"question":"Comment êtes-vous rémunéré ?","reponse":"Honoraires de conseil et frais sur encours, détaillés au document d''entrée en relation remis avant toute signature. Aucune rétrocession n''est conservée (exemple)."},{"question":"Puis-je partir quand je veux ?","reponse":"Oui, avec un préavis de trente jours selon la lettre de mission. Les enveloppes restent les vôtres : vous récupérez la main sans transfert d''actifs imposé."},{"question":"Que se passe-t-il si les marchés baissent fortement ?","reponse":"Le scénario a été chiffré avec vous au moment du cadrage, en euros sur votre propre portefeuille. En cas de baisse marquée, je reprends ce document avec vous plutôt que d''improviser une réaction. Les investissements présentent un risque de perte en capital, et aucune allocation ne l''annule."}],"final":{"eyebrow":"Premier échange","titre":"Quarante-cinq minutes, sans engagement","texte":"Nous faisons le point sur votre situation et je vous dis si, et comment, je peux être utile. Réponse sous deux jours ouvrés.","cta":"Prendre contact"}}', '2026-11-22'),
  ('pc_site_approche', 'tnt_demo', 'approche', 'fr', 'Méthode et honoraires',
   '{"description":"Cadrage, allocation, mise en œuvre et suivi trimestriel : la méthode en quatre temps, et la grille d''honoraires affichée.","eyebrow":"Méthode et honoraires","titre":"Une méthode en quatre temps","intro":"Chaque mission suit les mêmes étapes, et chaque étape produit un document écrit. Les honoraires sont affichés avant la première rencontre.","piliers":[{"titre":"1. Entretien de cadrage","texte":"Inventaire complet : comptes titres, assurance-vie, PER, immobilier, participations, crédits en cours. Nous fixons les horizons et les montants plancher dont vous devez disposer à chaque échéance. Durée : une à deux séances."},{"titre":"2. Note d''allocation","texte":"Un document écrit qui pose la répartition cible, les supports retenus, les frais réels de chaque ligne et les scénarios de baisse envisagés. Vous le signez, ou vous demandez qu''on le reprenne."},{"titre":"3. Mise en œuvre","texte":"Ouverture ou transfert des enveloppes, arbitrages étalés dans le temps quand les montants le justifient, et consolidation des positions existantes dans un tableau unique."},{"titre":"4. Suivi trimestriel","texte":"Un compte rendu écrit tous les trois mois : performance nette de frais, écarts par rapport à la cible, mouvements proposés. Un point annuel plus long remet le cadrage à jour."},{"titre":"Honoraires : mission de cadrage","texte":"950 € HT, forfait (exemple). Facturé une fois, indépendamment de la suite donnée. Vous repartez avec la note, même si vous ne confiez rien."},{"titre":"Honoraires : suivi de portefeuille","texte":"0,80 % HT des encours par an (exemple). Prélevé selon une périodicité définie au mandat, détaillé sur chaque compte rendu trimestriel."},{"titre":"Honoraires : rétrocessions","texte":"Aucune rétrocession conservée (exemple). Le détail des commissions éventuellement perçues des producteurs figure au document d''entrée en relation."},{"titre":"Conviction I : les frais se disent d''abord","texte":"Un rendement annoncé brut de frais n''est pas un rendement. Toute proposition chiffrée que je remets est nette."},{"titre":"Conviction II : écrit, donc opposable","texte":"Ce qui n''est pas écrit n''engage personne. Cadrage, allocation, arbitrages : tout passe par un document daté."},{"titre":"Conviction III : dire non fait partie du conseil","texte":"Certains montages sont bons pour celui qui les vend. Si votre situation ne justifie rien, je vous le dis et nous en restons là."}],"final":{"titre":"Parlons de votre situation","texte":"Le premier échange dure quarante-cinq minutes et ne vous engage à rien.","cta":"Prendre contact"}}', '2026-11-22'),
  ('pc_site_parcours', 'tnt_demo', 'parcours', 'fr', 'Parcours du fondateur',
   '{"description":"Le parcours, les certifications et les principes de travail du fondateur de BeBess''Invest.","eyebrow":"Parcours","titre":"Parcours du fondateur","intro":"Vingt ans de gestion et d''analyse en établissement, puis le choix de l''indépendance pour appliquer sans contrainte la méthode décrite sur ce site. Les éléments ci-dessous sont des exemples de démonstration.","etapes":[{"titre":"2026 → · Fondateur, BeBess''Invest","texte":"Création du cabinet pour appliquer, sans contrainte de réseau ni de produit maison, la méthode décrite dans la page Approche."},{"titre":"2016–2026 · Responsable de la gestion privée, banque régionale (Lyon)","texte":"Encadrement d''une équipe de six conseillers et d''environ 400 familles. Ce qui en reste de transposable : la discipline du compte rendu écrit."},{"titre":"2009–2016 · Analyste puis gérant, société de gestion (Paris)","texte":"Gestion de mandats diversifiés et sélection de fonds. Un chiffre porte plus qu''un adjectif : encours suivis supérieurs à 300 millions d''euros."},{"titre":"2009 · Formation","texte":"Master en finance, certification professionnelle AMF (exemple)."}]}', '2026-11-22'),
  ('pc_site_contact', 'tnt_demo', 'contact', 'fr', 'Contact',
   '{"description":"Demander un premier échange de quarante-cinq minutes, sans engagement. Réponse sous deux jours ouvrés.","eyebrow":"Contact","titre":"Demander un premier échange","intro":"Quarante-cinq minutes pour faire le point, sans engagement. Réponse sous deux jours ouvrés.","destinataire":"contact@bebess-invest.fr","coordonnees":{"adresse":"12 rue de la Paix\n75002 Paris (exemple)","telephone":"+33 1 23 45 67 89 (exemple)","horaires":"Du lundi au vendredi, de 9 h à 18 h"},"confirmation":{"titre":"Message bien reçu","texte":"Merci : je vous réponds sous deux jours ouvrés."}}', '2026-11-22'),
  ('pc_site_notes', 'tnt_demo', 'notes', 'fr', 'Notes de marché',
   '{"description":"Une note courte par mois sur la gestion de portefeuille, les frais et la fiscalité de l''épargne. Sans jargon et sans prédiction.","eyebrow":"Notes de marché","titre":"Une note par mois, une seule question","intro":"Sur la gestion de portefeuille, les frais et la fiscalité de l''épargne. Sans jargon et sans prédiction.","vide":"Aucune note n''est publiée pour l''instant."}', '2026-11-22'),
  ('pc_site_mentions', 'tnt_demo', 'mentions', 'fr', 'Mentions légales',
   '{"description":"Mentions légales, statut réglementaire, assurance et traitement des données personnelles.","eyebrow":"Informations légales","titre":"Mentions légales","sections":[{"titre":"Éditeur du site","texte":"BeBess''Invest SAS au capital de 10 000 €, RCS Paris 000 000 000 (exemple).\n\nDirecteur de la publication : le fondateur."},{"titre":"Statut réglementaire","texte":"Conseiller en investissements financiers, immatriculé à l''ORIAS sous le n° 00 000 000 (exemple), adhérent d''une association professionnelle agréée par l''AMF.\n\nResponsabilité civile professionnelle et garantie financière souscrites conformément à la réglementation (exemple)."},{"titre":"Données personnelles","texte":"Les données saisies dans le formulaire de contact sont utilisées pour répondre à votre demande et conservées trois ans au plus.\n\nVous disposez d''un droit d''accès, de rectification et d''effacement : écrivez à contact@bebess-invest.fr."},{"titre":"Hébergement","texte":"Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, États-Unis."},{"titre":"Avertissement sur les risques","texte":"Les investissements présentent un risque de perte en capital. Les performances passées ne préjugent pas des performances futures."}]}', '2026-11-22');

INSERT OR REPLACE INTO reglage (tenant_id, cle, valeur) VALUES
  ('tnt_demo', 'nom_affiche', 'BeBess''Invest'),
  ('tnt_demo', 'theme', 'maison'),
  ('tnt_demo', 'raison_sociale', 'BeBess''Invest SAS (exemple)'),
  ('tnt_demo', 'orias', '00 000 000 (exemple)'),
  ('tnt_demo', 'statut_reglementaire', 'Conseiller en investissements financiers, adhérent d''une association professionnelle agréée par l''AMF (exemple).'),
  ('tnt_demo', 'association', 'Association professionnelle agréée par l''AMF, adhérent n° 0000 (exemple).'),
  ('tnt_demo', 'mediateur', 'Médiateur de la consommation compétent : coordonnées communiquées au document d''entrée en relation (exemple).'),
  ('tnt_demo', 'hebergeur', 'Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, États-Unis.'),
  ('tnt_demo', 'contact_rgpd', 'contact@bebess-invest.fr');

INSERT OR REPLACE INTO note_marche (id, tenant_id, slug, langue, titre, chapeau, corps_md, date, publiee) VALUES
  ('nm_site_pourquoi-ne-pas-securise', 'tnt_demo', 'pourquoi-ne-pas-securiser-apres-une-baisse', 'fr', 'Pourquoi je ne recommande presque jamais de « sécuriser » après une baisse',
   'Le réflexe est compréhensible et il coûte cher. Démonstration sur un portefeuille de 400 000 €.',
   'Une baisse de 15 % fait mal, et l''envie de « tout mettre à l''abri » est naturelle. Elle transforme pourtant une perte latente en perte définitive.

## Le réflexe et son coût

Prenons un portefeuille de 400 000 € investi à 60 % en actions. Après une baisse de 20 % des actions, il vaut environ 370 000 €. Vendre les actions pour se mettre à l''abri fige cette perte de 30 000 € : le portefeuille ne profitera plus du rebond.

- Les rebonds sont rapides et rarement annoncés.
- Manquer les meilleures séances coûte plus que de subir les pires.

## Ce qu''il faut en retenir

La bonne réponse se prépare **avant** la baisse : un scénario chiffré en euros, signé au moment du cadrage. Il suffit alors de le relire.

> Les investissements présentent un risque de perte en capital. Cette note est un commentaire général et ne constitue pas un conseil personnalisé.', '2026-10-14', 1),
  ('nm_site_les-frais-se-disent-d-ab', 'tnt_demo', 'les-frais-se-disent-d-abord', 'fr', 'Les frais se disent d''abord',
   'Un rendement brut de frais n''est pas un rendement. Comment lire une proposition chiffrée.',
   'Deux supports affichent le même rendement brut de 5 % par an. L''un coûte 0,3 % de frais annuels, l''autre 2,2 %.

## L''écart sur vingt ans

Sur 100 000 € placés vingt ans, la différence de frais représente plusieurs dizaines de milliers d''euros, sans qu''aucune ligne de relevé ne l''indique clairement.

## Trois questions à poser

- Quels sont **tous** les frais : entrée, gestion, supports, arbitrage ?
- Quelle part revient à celui qui vous propose le produit ?
- Le rendement présenté est-il net de ces frais ?

> Les performances passées ne préjugent pas des performances futures. Cette note est un commentaire général.', '2026-09-30', 1),
  ('nm_site_assurance-vie-et-transmi', 'tnt_demo', 'assurance-vie-et-transmission', 'fr', 'Assurance-vie : ce qu''elle change vraiment pour la transmission',
   'Un cadre fiscal avantageux, à condition d''en connaître les limites.',
   'L''assurance-vie reste l''enveloppe de transmission la plus utilisée. Ses avantages ne sont pas illimités.

## Ce que la clause bénéficiaire règle

Les capitaux désignés par la clause bénéficiaire sortent de la succession au sens civil, dans les limites prévues par la loi. Une clause mal rédigée peut produire l''inverse de l''effet recherché.

## À vérifier chaque année

- que la clause correspond encore à votre situation familiale ;
- que les bénéficiaires sont identifiables sans ambiguïté ;
- que le contrat est cohérent avec le reste de votre organisation patrimoniale.

> Cette note est un commentaire général et ne constitue pas un conseil personnalisé : la fiscalité dépend de chaque situation.', '2026-08-31', 1);

-- Le site public n'existe que si le module Site vitrine est actif : le jeu de démonstration l'avait désactivé.
UPDATE contrat SET module_site = 1 WHERE tenant_id = 'tnt_demo';
