-- Jeu de démonstration : une famille, un tenant. Données fictives.
-- Montants en centimes. Pourcentages en centièmes de point (640 = 6,40 %).
-- Recoupements, pour le viewer usr_claire :
--   lignes -> enveloppe : 45 000 000 + 32 000 000 + 30 000 000 + 20 000 000
--   enveloppes -> dernier point (2026-10-31) : 127 000 000 centimes = 1 270 000 €.

INSERT INTO tenant (id, nom, domaine, cree_le) VALUES
  ('tnt_demo', 'Family office de démonstration', 'localhost', '2023-11-01T09:00:00Z');

-- Rôles du lot 11 : un compte de chacun. L'adresse du support est la MÊME dans les deux cabinets du jeu (unicité par cabinet).
INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le) VALUES
  ('usr_editeur',      'tnt_demo', 'editeur@demo.local',       'Hélène Roussel',  'editeur',         1, '2023-11-01T09:00:00Z'),
  ('usr_gestionnaire', 'tnt_demo', 'gestionnaire@demo.local',  'Antoine Verdier', 'associe',         1, '2023-11-01T09:00:00Z'),
  ('usr_collab',       'tnt_demo', 'collaborateur@demo.local', 'Camille Durand',  'collaborateur',   1, '2024-01-08T09:00:00Z'),
  ('usr_lecture',      'tnt_demo', 'lecture@demo.local',       'Léa Fontaine',    'lecture',         1, '2024-01-08T09:00:00Z'),
  ('usr_support',      'tnt_demo', 'support@editeur.local',    'Support éditeur', 'support_editeur', 1, '2023-11-01T09:00:00Z'),
  ('usr_claire',       'tnt_demo', 'claire@demo.local',        'Claire Marchand', 'viewer',          1, '2023-11-01T09:00:00Z'),
  ('usr_thomas',       'tnt_demo', 'thomas@demo.local',        'Thomas Marchand', 'viewer',          1, '2024-02-15T09:00:00Z');

-- Les viewers du jeu ont déjà reçu leur lien : leurs dossiers sont publiés.
UPDATE utilisateur SET statut = 'publie', publie_le = cree_le WHERE role = 'viewer';

-- Contrat de démonstration. Les quatre prix (79, 49, 39 et 25 €) sont ceux que cite chantier/lot-12-facturation.md ; leur
-- rattachement socle / Pilotage / Site vitrine / accès supplémentaire suit l'ordre des lignes de ce lot. Le gel est posé pour que
-- le refus d'une modification de prix se voie sur le jeu. DPA signé : la mise en production reste possible.
INSERT INTO contrat (id, tenant_id, statut, periodicite, debut_le, prix_socle, prix_pilotage, prix_site, prix_acces_sup,
                     module_pilotage, module_site, acces_inclus, frais_installation, tarif_gele_jusqu_au, dpa_signe_le, cree_le, maj_le)
VALUES ('ctr_demo', 'tnt_demo', 'actif', 'annuelle', '2026-03-14', 7900, 4900, 3900, 2500,
        1, 0, 3, 0, '2027-12-31', '2026-03-01', '2026-03-01T09:00:00Z', '2026-03-01T09:00:00Z');

-- Trois membres de l'équipe du cabinet. couleur : jeton de la palette des graphiques.
INSERT INTO membre (id, tenant_id, nom, initiale, couleur, actif, cree_le) VALUES
  ('mbr_helene',  'tnt_demo', 'Hélène Roussel',  'H', 'serie-1', 1, '2023-11-01T09:00:00Z'),
  ('mbr_antoine', 'tnt_demo', 'Antoine Verdier', 'A', 'serie-2', 1, '2023-11-01T09:00:00Z'),
  ('mbr_camille', 'tnt_demo', 'Camille Durand',  'C', 'serie-4', 1, '2024-01-08T09:00:00Z');

-- Listes de référence par défaut (chantier/21-listes-defaut.md, reprises dans src/lib/listes-defaut.ts).
INSERT INTO liste_valeur (tenant_id, liste, cle, libelle, ordre, actif) VALUES
  ('tnt_demo', 'classe_actif', 'actions', 'Actions', 1, 1),
  ('tnt_demo', 'classe_actif', 'obligations', 'Obligations', 2, 1),
  ('tnt_demo', 'classe_actif', 'immobilier', 'Immobilier', 3, 1),
  ('tnt_demo', 'classe_actif', 'private_equity', 'Private equity', 4, 1),
  ('tnt_demo', 'classe_actif', 'liquidites', 'Liquidités', 5, 1),
  ('tnt_demo', 'statut_mouvement', 'en_preparation', 'En préparation', 1, 1),
  ('tnt_demo', 'statut_mouvement', 'transmis', 'Transmis', 2, 1),
  ('tnt_demo', 'statut_mouvement', 'chez_etablissement', 'Chez l''établissement', 3, 1),
  ('tnt_demo', 'statut_mouvement', 'execute', 'Exécuté', 4, 1),
  ('tnt_demo', 'statut_mouvement', 'archive', 'Archivé', 5, 1),
  ('tnt_demo', 'type_contact', 'client', 'Client', 1, 1),
  ('tnt_demo', 'type_contact', 'prospect', 'Prospect', 2, 1),
  ('tnt_demo', 'type_contact', 'prescripteur', 'Prescripteur', 3, 1),
  ('tnt_demo', 'type_contact', 'partenaire', 'Partenaire', 4, 1),
  ('tnt_demo', 'type_contact', 'interne', 'Interne', 5, 1),
  ('tnt_demo', 'statut_sujet', 'afaire', 'À faire', 1, 1),
  ('tnt_demo', 'statut_sujet', 'encours', 'En cours', 2, 1),
  ('tnt_demo', 'statut_sujet', 'attente', 'En attente', 3, 1),
  ('tnt_demo', 'statut_sujet', 'fait', 'Fait', 4, 1),
  ('tnt_demo', 'etape', 'contact', 'Premier contact', 1, 1),
  ('tnt_demo', 'etape', 'rdv', 'RDV', 2, 1),
  ('tnt_demo', 'etape', 'proposition', 'Proposition', 3, 1),
  ('tnt_demo', 'etape', 'signe', 'Signé', 4, 1),
  ('tnt_demo', 'etape', 'perdu', 'Perdu', 5, 1),
  ('tnt_demo', 'type_echange', 'rdv', 'RDV', 1, 1),
  ('tnt_demo', 'type_echange', 'tel', 'Appel', 2, 1),
  ('tnt_demo', 'type_echange', 'visio', 'Visio', 3, 1),
  ('tnt_demo', 'type_echange', 'mail', 'E-mail', 4, 1),
  ('tnt_demo', 'metier', 'notaire', 'Notaire', 1, 1),
  ('tnt_demo', 'metier', 'avocat', 'Avocat', 2, 1),
  ('tnt_demo', 'metier', 'expert_comptable', 'Expert-comptable', 3, 1),
  ('tnt_demo', 'metier', 'banquier', 'Banquier', 4, 1),
  ('tnt_demo', 'metier', 'assureur', 'Assureur', 5, 1),
  ('tnt_demo', 'metier', 'agent_immobilier', 'Agent immobilier', 6, 1),
  ('tnt_demo', 'metier', 'cgp', 'Conseiller en gestion de patrimoine', 7, 1),
  ('tnt_demo', 'metier', 'commissaire_comptes', 'Commissaire aux comptes', 8, 1),
  ('tnt_demo', 'metier', 'autre', 'Autre', 9, 1),
  ('tnt_demo', 'categorie_doc', 'reglementaire', 'Réglementaire', 1, 1),
  ('tnt_demo', 'categorie_doc', 'modeles', 'Modèles et contrats', 2, 1),
  ('tnt_demo', 'categorie_doc', 'juridique', 'Juridique', 3, 1),
  ('tnt_demo', 'categorie_doc', 'fiscal', 'Fiscal', 4, 1),
  ('tnt_demo', 'categorie_doc', 'autre', 'Autre', 5, 1),
  ('tnt_demo', 'type_portefeuille', 'personne', 'Personne physique', 1, 1),
  ('tnt_demo', 'type_portefeuille', 'holding', 'Holding', 2, 1),
  ('tnt_demo', 'type_portefeuille', 'sci', 'SCI', 3, 1),
  ('tnt_demo', 'type_portefeuille', 'assurance_vie', 'Assurance-vie', 4, 1),
  ('tnt_demo', 'type_portefeuille', 'autre', 'Autre', 5, 1);

-- Valeurs terminales (migration 0005) : le sujet « fait » est clos, l'étape « perdu » sort du parcours.
UPDATE liste_valeur SET terminal = 1
 WHERE tenant_id = 'tnt_demo' AND ((liste = 'statut_sujet' AND cle = 'fait') OR (liste = 'etape' AND cle = 'perdu'));

-- Marqueurs de liste (migration 0006) : le rôle que le code attend d'une valeur, posé sur la valeur du cabinet.
UPDATE liste_valeur SET marqueur = 'parcours'   WHERE tenant_id = 'tnt_demo' AND liste = 'type_contact'      AND cle = 'prospect';
UPDATE liste_valeur SET marqueur = 'client'     WHERE tenant_id = 'tnt_demo' AND liste = 'type_contact'      AND cle = 'client';
UPDATE liste_valeur SET marqueur = 'en_cours'   WHERE tenant_id = 'tnt_demo' AND liste = 'statut_sujet'      AND cle = 'encours';
UPDATE liste_valeur SET marqueur = 'en_attente' WHERE tenant_id = 'tnt_demo' AND liste = 'statut_sujet'      AND cle = 'attente';
UPDATE liste_valeur SET marqueur = 'clos'       WHERE tenant_id = 'tnt_demo' AND liste = 'statut_mouvement'  AND cle IN ('execute', 'archive');
UPDATE liste_valeur SET marqueur = 'defaut'     WHERE tenant_id = 'tnt_demo' AND liste = 'type_portefeuille' AND cle = 'personne';

-- Un portefeuille par viewer ; Claire en a un second, vide, pour éprouver le cas.
INSERT INTO portefeuille (id, tenant_id, viewer_id, libelle, type, ordre, cree_le) VALUES
  ('pf_claire',   'tnt_demo', 'usr_claire', 'Patrimoine',      'personne', 0, '2023-11-01T09:00:00Z'),
  ('pf_claire_2', 'tnt_demo', 'usr_claire', 'Holding familiale', 'holding',  1, '2025-03-01T09:00:00Z'),
  ('pf_thomas',   'tnt_demo', 'usr_thomas', 'Patrimoine',      'personne', 0, '2024-02-15T09:00:00Z');

INSERT INTO fiche (utilisateur_id, mandat_ref, profil_risque, profil_note, horizon, perte_max_cents, liquidite_cents, regle_reequilibrage, allocation_signee_le, allocation_motif, prochain_point) VALUES
  ('usr_claire', 'MAND-2023-014', 'Équilibré', 5, '2036-12-31', 20000000, 13000000,
   'Revue semestrielle ; arbitrage si une classe s''écarte de 5 points de sa cible.',
   '2025-01-20', 'Revue annuelle : réduction de la part obligataire au profit des actions.', '2027-01-18'),
  ('usr_thomas', 'MAND-2024-003', 'Dynamique', 6, '2041-12-31', 30000000, 5000000,
   'Revue annuelle ; arbitrage si une classe s''écarte de 8 points de sa cible.',
   '2024-02-15', 'Allocation initiale.', '2027-02-15');

INSERT INTO enveloppe (id, portefeuille_id, libelle, etablissement, ouverte_en, valorisation_cents, perf_bp, arrete_le, rang) VALUES
  ('env_av',   'pf_claire', 'Assurance-vie luxembourgeoise',         'Lombard Intl',        '2019-05', 45000000, 580, '2026-10-31', 1),
  ('env_cto',  'pf_claire', 'Compte-titres',                         'Banque Privée Nord',  '2020-09', 32000000, 910, '2026-10-31', 2),
  ('env_immo', 'pf_claire', 'Immobilier détenu en direct',           'Sociétés familiales', '2016-03', 30000000, 340, '2026-10-31', 3),
  ('env_liq',  'pf_claire', 'Liquidités et capital-investissement',  'Banque Privée Nord',  '2021-01', 20000000, 210, '2026-10-31', 4);

INSERT INTO ligne (id, enveloppe_id, libelle, classe, valorisation_cents, pv_cents, frais_bp, arrete_le, rang) VALUES
  -- env_av : 45 000 000
  ('lig_01', 'env_av',   'Fonds en euros',                        'obligations',    20000000,  2400000,  80, '2026-10-31', 1),
  ('lig_02', 'env_av',   'UC actions monde',                      'actions',        12000000,  3100000, 120, '2026-10-31', 2),
  ('lig_03', 'env_av',   'UC obligataire flexible',               'obligations',     8000000,   500000, 100, '2026-10-31', 3),
  ('lig_04', 'env_av',   'UC capital-investissement',             'private_equity',  5000000,   900000, 220, '2026-10-31', 4),
  -- env_cto : 32 000 000
  ('lig_05', 'env_cto',  'Actions européennes',                   'actions',        12000000,  2800000,  35, '2026-10-31', 1),
  ('lig_06', 'env_cto',  'Actions américaines',                   'actions',         9000000,  3300000,  35, '2026-10-31', 2),
  ('lig_07', 'env_cto',  'Obligations souveraines',               'obligations',     7000000,   -80000,  20, '2026-10-31', 3),
  ('lig_08', 'env_cto',  'Obligations d''entreprises',            'obligations',     4000000,   150000,  25, '2026-10-31', 4),
  -- env_immo : 30 000 000
  ('lig_09', 'env_immo', 'SCPI de bureaux',                       'immobilier',     15000000,   600000, 180, '2026-10-31', 1),
  ('lig_10', 'env_immo', 'SCI familiale, résidence principale',   'immobilier',     10000000,  2500000,   0, '2026-10-31', 2),
  ('lig_11', 'env_immo', 'Investissement locatif',                'immobilier',      5000000,   700000,   0, '2026-10-31', 3),
  -- env_liq : 20 000 000
  ('lig_12', 'env_liq',  'Compte courant et livrets',             'liquidites',      8000000,        0,   0, '2026-10-31', 1),
  ('lig_13', 'env_liq',  'Fonds de capital-investissement',       'private_equity',  7000000,  1100000, 250, '2026-10-31', 2),
  ('lig_14', 'env_liq',  'Comptes à terme',                       'liquidites',      5000000,   120000,   0, '2026-10-31', 3);

INSERT INTO cible (id, portefeuille_id, classe, cible_bp, rang) VALUES
  ('cib_1', 'pf_claire', 'actions',        3500, 1),
  ('cib_2', 'pf_claire', 'obligations',    2000, 2),
  ('cib_3', 'pf_claire', 'immobilier',     2500, 3),
  ('cib_4', 'pf_claire', 'private_equity', 1000, 4),
  ('cib_5', 'pf_claire', 'liquidites',     1000, 5);

-- 36 points mensuels (fin de mois), de 100,0 à 127,0 (100 = 1 000 000 €), creux en 2024.
-- Les versements cumulés suivent les apports et le retrait de la section mouvement.
INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES
  ('pt_01', 'pf_claire', '2023-11-30', 100000000,  95000000),
  ('pt_02', 'pf_claire', '2023-12-31', 100800000,  95000000),
  ('pt_03', 'pf_claire', '2024-01-31', 101500000,  95000000),
  ('pt_04', 'pf_claire', '2024-02-29', 102200000,  95000000),
  ('pt_05', 'pf_claire', '2024-03-31', 103000000,  97000000),
  ('pt_06', 'pf_claire', '2024-04-30', 101800000,  97000000),
  ('pt_07', 'pf_claire', '2024-05-31', 100200000,  97000000),
  ('pt_08', 'pf_claire', '2024-06-30',  98500000,  97000000),
  ('pt_09', 'pf_claire', '2024-07-31',  96800000,  97000000),
  ('pt_10', 'pf_claire', '2024-08-31',  95500000,  97000000),
  ('pt_11', 'pf_claire', '2024-09-30',  96200000,  97000000),
  ('pt_12', 'pf_claire', '2024-10-31',  97500000,  97000000),
  ('pt_13', 'pf_claire', '2024-11-30',  99000000,  97000000),
  ('pt_14', 'pf_claire', '2024-12-31', 100500000,  97000000),
  ('pt_15', 'pf_claire', '2025-01-31', 101800000,  99000000),
  ('pt_16', 'pf_claire', '2025-02-28', 103000000,  99000000),
  ('pt_17', 'pf_claire', '2025-03-31', 104100000,  99000000),
  ('pt_18', 'pf_claire', '2025-04-30', 105000000,  99000000),
  ('pt_19', 'pf_claire', '2025-05-31', 106200000,  99000000),
  ('pt_20', 'pf_claire', '2025-06-30', 107000000,  99000000),
  ('pt_21', 'pf_claire', '2025-07-31', 108100000,  99000000),
  ('pt_22', 'pf_claire', '2025-08-31', 109000000,  99000000),
  ('pt_23', 'pf_claire', '2025-09-30', 109900000, 101000000),
  ('pt_24', 'pf_claire', '2025-10-31', 110800000, 101000000),
  ('pt_25', 'pf_claire', '2025-11-30', 111700000, 101000000),
  ('pt_26', 'pf_claire', '2025-12-31', 112600000, 101000000),
  ('pt_27', 'pf_claire', '2026-01-31', 113400000, 101000000),
  ('pt_28', 'pf_claire', '2026-02-28', 114200000, 101000000),
  ('pt_29', 'pf_claire', '2026-03-31', 115000000, 106000000),
  ('pt_30', 'pf_claire', '2026-04-30', 116000000, 106000000),
  ('pt_31', 'pf_claire', '2026-05-31', 117200000, 106000000),
  ('pt_32', 'pf_claire', '2026-06-30', 119000000, 106000000),
  ('pt_33', 'pf_claire', '2026-07-31', 120800000, 106000000),
  ('pt_34', 'pf_claire', '2026-08-31', 122800000, 106000000),
  ('pt_35', 'pf_claire', '2026-09-30', 125000000, 104500000),
  ('pt_36', 'pf_claire', '2026-10-31', 127000000, 104500000);

-- 6 mouvements dont 3 en cours. Apports positifs, retrait négatif.
INSERT INTO mouvement (id, viewer_id, date, libelle, enveloppe, montant_cents, statut, en_cours, etape, detail) VALUES
  ('mvt_1', 'usr_claire', '2026-03-12', 'Versement complémentaire',               'Assurance-vie luxembourgeoise',        5000000, 'execute',  0, 0, 'Fonds crédités sur le contrat.'),
  ('mvt_2', 'usr_claire', '2026-06-20', 'Arbitrage actions vers obligations',     'Compte-titres',                        2000000, 'execute',  0, 0, 'Arbitrage exécuté au cours du jour.'),
  ('mvt_3', 'usr_claire', '2026-09-05', 'Retrait pour travaux',                   'Liquidités et capital-investissement', -1500000, 'execute', 0, 0, 'Virement effectué sur le compte courant.'),
  ('mvt_4', 'usr_claire', '2026-10-28', 'Versement complémentaire',               'Assurance-vie luxembourgeoise',        3000000, 'en_cours', 1, 2, 'Virement émis, en attente de réception par l''assureur.'),
  ('mvt_5', 'usr_claire', '2026-11-04', 'Arbitrage obligations vers actions',     'Compte-titres',                        1800000, 'en_cours', 1, 1, 'Ordre transmis par le gestionnaire.'),
  ('mvt_6', 'usr_claire', '2026-11-10', 'Appel de fonds, capital-investissement', 'Liquidités et capital-investissement', 2500000, 'en_cours', 1, 3, 'Appel reçu, règlement programmé.');

INSERT INTO document (id, viewer_id, titre, categorie, date, cle_fichier, envoye_le) VALUES
  ('doc_1', 'usr_claire', 'Rapport de gestion, troisième trimestre 2026', 'rapport',     '2026-10-15', 'marchand/rapport-2026-t3.pdf',    '2026-10-15T08:30:00Z'),
  ('doc_2', 'usr_claire', 'Relevé fiscal 2025',                           'fiscal',      '2026-02-20', 'marchand/fiscal-2025.pdf',        '2026-02-20T10:00:00Z'),
  ('doc_3', 'usr_claire', 'Lettre de mission',                            'contractuel', '2023-11-01', 'marchand/lettre-de-mission.pdf',  '2023-11-01T09:30:00Z');

INSERT INTO page_contenu (id, tenant_id, cle, langue, titre, contenu_json, maj_le) VALUES
  ('pc_accueil', 'tnt_demo', 'accueil', 'fr', 'Bienvenue',
   '{"accroche":"Votre patrimoine, en toute transparence.","texte":"Un espace de consultation : valorisation, mouvements et documents."}', '2026-11-01'),
  ('pc_contact', 'tnt_demo', 'contact', 'fr', 'Contact',
   '{"texte":"Antoine Verdier répond à vos questions du lundi au vendredi."}', '2026-11-01');

INSERT INTO note_marche (id, tenant_id, slug, langue, titre, chapeau, corps_md, date, publiee) VALUES
  ('nm_1', 'tnt_demo', 'point-de-marche-octobre-2026', 'fr', 'Point de marché, octobre 2026',
   'Les actions poursuivent leur progression.', 'Les marchés actions progressent ; la poche obligataire reste stable.', '2026-10-31', 1),
  ('nm_2', 'tnt_demo', 'point-de-marche-septembre-2026', 'fr', 'Point de marché, septembre 2026',
   'Un mois calme.', 'Peu de mouvements sur les taux, volatilité contenue.', '2026-09-30', 1),
  ('nm_3', 'tnt_demo', 'note-en-preparation', 'fr', 'Note en préparation',
   NULL, 'Brouillon non diffusé.', '2026-11-12', 0);

-- ---------------------------------------------------------------------------
-- Second cabinet (lot 01c) : rend le test de cloisonnement jouable. Hôte distinct ;
-- en local, `curl -H 'Host: cabinet2.localhost'`. Données fictives, sans lien avec le premier.
-- ---------------------------------------------------------------------------
INSERT INTO tenant (id, nom, domaine, cree_le) VALUES
  ('tnt_autre', 'Cabinet Delmas', 'cabinet2.localhost', '2025-01-10T09:00:00Z');

INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le) VALUES
  ('usr_autre_gest',    'tnt_autre', 'gestionnaire@delmas.local', 'Paul Delmas',     'associe',         1, '2025-01-10T09:00:00Z'),
  -- Le même compte de support que dans le cabinet démo : possible depuis que l'adresse n'est unique que par cabinet.
  ('usr_autre_support', 'tnt_autre', 'support@editeur.local',     'Support éditeur', 'support_editeur', 1, '2025-01-10T09:00:00Z'),
  ('usr_autre_viewer',  'tnt_autre', 'viewer@delmas.local',       'Irène Fabre',     'viewer',          1, '2025-01-10T09:00:00Z');
UPDATE utilisateur SET statut = 'publie', publie_le = cree_le WHERE id = 'usr_autre_viewer';

-- Listes de référence COMPLÈTES, les neuf, avec valeurs terminales et marqueurs : les mêmes que celles du premier cabinet. Un cabinet qui n'en a
-- que quelques-unes ne permet pas d'éprouver le suivi (kanban, parcours, indicateurs) ni la création d'un viewer.
INSERT INTO liste_valeur (tenant_id, liste, cle, libelle, ordre, actif) VALUES
  ('tnt_autre', 'classe_actif', 'actions', 'Actions', 1, 1),
  ('tnt_autre', 'classe_actif', 'obligations', 'Obligations', 2, 1),
  ('tnt_autre', 'classe_actif', 'immobilier', 'Immobilier', 3, 1),
  ('tnt_autre', 'classe_actif', 'private_equity', 'Private equity', 4, 1),
  ('tnt_autre', 'classe_actif', 'liquidites', 'Liquidités', 5, 1),
  ('tnt_autre', 'statut_mouvement', 'en_preparation', 'En préparation', 1, 1),
  ('tnt_autre', 'statut_mouvement', 'transmis', 'Transmis', 2, 1),
  ('tnt_autre', 'statut_mouvement', 'chez_etablissement', 'Chez l''établissement', 3, 1),
  ('tnt_autre', 'statut_mouvement', 'execute', 'Exécuté', 4, 1),
  ('tnt_autre', 'statut_mouvement', 'archive', 'Archivé', 5, 1),
  ('tnt_autre', 'type_contact', 'client', 'Client', 1, 1),
  ('tnt_autre', 'type_contact', 'prospect', 'Prospect', 2, 1),
  ('tnt_autre', 'type_contact', 'prescripteur', 'Prescripteur', 3, 1),
  ('tnt_autre', 'type_contact', 'partenaire', 'Partenaire', 4, 1),
  ('tnt_autre', 'type_contact', 'interne', 'Interne', 5, 1),
  ('tnt_autre', 'statut_sujet', 'afaire', 'À faire', 1, 1),
  ('tnt_autre', 'statut_sujet', 'encours', 'En cours', 2, 1),
  ('tnt_autre', 'statut_sujet', 'attente', 'En attente', 3, 1),
  ('tnt_autre', 'statut_sujet', 'fait', 'Fait', 4, 1),
  ('tnt_autre', 'etape', 'contact', 'Premier contact', 1, 1),
  ('tnt_autre', 'etape', 'rdv', 'RDV', 2, 1),
  ('tnt_autre', 'etape', 'proposition', 'Proposition', 3, 1),
  ('tnt_autre', 'etape', 'signe', 'Signé', 4, 1),
  ('tnt_autre', 'etape', 'perdu', 'Perdu', 5, 1),
  ('tnt_autre', 'type_echange', 'rdv', 'RDV', 1, 1),
  ('tnt_autre', 'type_echange', 'tel', 'Appel', 2, 1),
  ('tnt_autre', 'type_echange', 'visio', 'Visio', 3, 1),
  ('tnt_autre', 'type_echange', 'mail', 'E-mail', 4, 1),
  ('tnt_autre', 'metier', 'notaire', 'Notaire', 1, 1),
  ('tnt_autre', 'metier', 'avocat', 'Avocat', 2, 1),
  ('tnt_autre', 'metier', 'expert_comptable', 'Expert-comptable', 3, 1),
  ('tnt_autre', 'metier', 'banquier', 'Banquier', 4, 1),
  ('tnt_autre', 'metier', 'assureur', 'Assureur', 5, 1),
  ('tnt_autre', 'metier', 'agent_immobilier', 'Agent immobilier', 6, 1),
  ('tnt_autre', 'metier', 'cgp', 'Conseiller en gestion de patrimoine', 7, 1),
  ('tnt_autre', 'metier', 'commissaire_comptes', 'Commissaire aux comptes', 8, 1),
  ('tnt_autre', 'metier', 'autre', 'Autre', 9, 1),
  ('tnt_autre', 'categorie_doc', 'reglementaire', 'Réglementaire', 1, 1),
  ('tnt_autre', 'categorie_doc', 'modeles', 'Modèles et contrats', 2, 1),
  ('tnt_autre', 'categorie_doc', 'juridique', 'Juridique', 3, 1),
  ('tnt_autre', 'categorie_doc', 'fiscal', 'Fiscal', 4, 1),
  ('tnt_autre', 'categorie_doc', 'autre', 'Autre', 5, 1),
  ('tnt_autre', 'type_portefeuille', 'personne', 'Personne physique', 1, 1),
  ('tnt_autre', 'type_portefeuille', 'holding', 'Holding', 2, 1),
  ('tnt_autre', 'type_portefeuille', 'sci', 'SCI', 3, 1),
  ('tnt_autre', 'type_portefeuille', 'assurance_vie', 'Assurance-vie', 4, 1),
  ('tnt_autre', 'type_portefeuille', 'autre', 'Autre', 5, 1);

UPDATE liste_valeur SET terminal = 1
 WHERE tenant_id = 'tnt_autre' AND ((liste = 'statut_sujet' AND cle = 'fait') OR (liste = 'etape' AND cle = 'perdu'));
UPDATE liste_valeur SET marqueur = 'parcours'   WHERE tenant_id = 'tnt_autre' AND liste = 'type_contact'      AND cle = 'prospect';
UPDATE liste_valeur SET marqueur = 'client'     WHERE tenant_id = 'tnt_autre' AND liste = 'type_contact'      AND cle = 'client';
UPDATE liste_valeur SET marqueur = 'en_cours'   WHERE tenant_id = 'tnt_autre' AND liste = 'statut_sujet'      AND cle = 'encours';
UPDATE liste_valeur SET marqueur = 'en_attente' WHERE tenant_id = 'tnt_autre' AND liste = 'statut_sujet'      AND cle = 'attente';
UPDATE liste_valeur SET marqueur = 'clos'       WHERE tenant_id = 'tnt_autre' AND liste = 'statut_mouvement'  AND cle IN ('execute', 'archive');
UPDATE liste_valeur SET marqueur = 'defaut'     WHERE tenant_id = 'tnt_autre' AND liste = 'type_portefeuille' AND cle = 'personne';

INSERT INTO portefeuille (id, tenant_id, viewer_id, libelle, type, ordre, cree_le) VALUES
  ('pf_autre', 'tnt_autre', 'usr_autre_viewer', 'Patrimoine', 'personne', 0, '2025-01-10T09:00:00Z');

INSERT INTO enveloppe (id, portefeuille_id, libelle, etablissement, ouverte_en, valorisation_cents, perf_bp, arrete_le, rang) VALUES
  ('env_autre', 'pf_autre', 'Compte-titres', 'Banque Delmas', '2022-06', 20000000, 450, '2026-10-31', 1);

INSERT INTO ligne (id, enveloppe_id, libelle, classe, valorisation_cents, pv_cents, frais_bp, arrete_le, rang) VALUES
  ('lig_autre_1', 'env_autre', 'Actions monde',   'actions',     12000000, 1500000, 30, '2026-10-31', 1),
  ('lig_autre_2', 'env_autre', 'Obligations 2030', 'obligations', 8000000,  100000, 20, '2026-10-31', 2);

INSERT INTO point (id, portefeuille_id, date, valeur_cents, versements_cumules_cents) VALUES
  ('pt_autre_1', 'pf_autre', '2026-09-30', 19700000, 18000000),
  ('pt_autre_2', 'pf_autre', '2026-10-31', 20000000, 18000000);

INSERT INTO document (id, viewer_id, titre, categorie, date, cle_fichier, envoye_le) VALUES
  ('doc_autre', 'usr_autre_viewer', 'Rapport Delmas, troisième trimestre 2026', 'rapport', '2026-10-15', 'fabre/rapport-2026-t3.pdf', '2026-10-15T08:30:00Z');

INSERT INTO page_contenu (id, tenant_id, cle, langue, titre, contenu_json, maj_le) VALUES
  ('pc_autre_accueil', 'tnt_autre', 'accueil', 'fr', 'Cabinet Delmas',
   '{"accroche":"Un cabinet indépendant.","texte":"Page d''accueil du second cabinet."}', '2026-11-01');

-- Le suivi du second cabinet : un membre, un contact (prospect, à l'étape RDV), un sujet et un échange, pour que le cloisonnement du
-- module de suivi du second cabinet soit jouable (listes, contact, sujet, échange) ; ses données n'existent pas dans le premier cabinet.
INSERT INTO membre (id, tenant_id, nom, initiale, couleur, actif, cree_le) VALUES
  ('mbr_autre', 'tnt_autre', 'Paul Delmas', 'P', 'serie-3', 1, '2025-01-10T09:00:00Z');

INSERT INTO contact (id, tenant_id, nom, prenom, email, metier, structure, responsable_id, etape, relance, dernier_echange, type_echange, notes, cree_le, maj_le) VALUES
  ('ctc_autre_1', 'tnt_autre', 'Lefèvre', 'Marc', 'marc.lefevre@etude-lefevre.local', 'notaire', 'Étude Lefèvre', 'mbr_autre', 'rdv',
   '2026-12-01', '2026-11-10', 'rdv', 'Contact du cabinet Delmas : n''existe pas dans le premier cabinet.', '2026-09-01T09:00:00Z', '2026-11-10T09:00:00Z');
INSERT INTO contact_type (tenant_id, contact_id, type) VALUES ('tnt_autre', 'ctc_autre_1', 'prospect');

INSERT INTO sujet (id, tenant_id, contact_id, texte, statut, echeance, origine, cree_le) VALUES
  ('suj_autre_1', 'tnt_autre', 'ctc_autre_1', 'Préparer la proposition pour l''étude Lefèvre', 'encours', '2026-11-30', NULL, '2026-11-10T09:30:00Z');

INSERT INTO echange (id, tenant_id, contact_id, date, type, note, cree_le) VALUES
  ('ech_autre_1', 'tnt_autre', 'ctc_autre_1', '2026-11-10', 'rdv', 'Premier rendez-vous : besoin de transmission.', '2026-11-10T11:00:00Z');

INSERT INTO version_locataire (tenant_id, version) VALUES ('tnt_autre', 1);

-- Un second rapport pour le client du second cabinet, dans une catégorie de SA liste et sous une clé R2 qui commence par l'identifiant du
-- cabinet (la règle de src/lib/fichiers.ts : `servir` refuse toute autre clé). Le fichier lui-même n'est pas dans R2 : le téléchargement répond 404.
INSERT INTO document (id, viewer_id, titre, categorie, date, cle_fichier, envoye_le) VALUES
  ('doc_autre_2', 'usr_autre_viewer', 'Lettre de mission Delmas', 'reglementaire', '2025-01-10', 'tnt_autre/documents/lettre-de-mission.pdf', '2025-01-10T09:30:00Z');

-- ---------------------------------------------------------------------------
-- Cours fictifs (lot 20) : le bloc Chiffres d'une fiche d'actu se lit dans `cours`, que le produit remplit avec une clé d'API. Sans clé, ces
-- lignes le rendent jouable : les cinq symboles par défaut (src/lib/cours.ts, SYMBOLES_DEFAUT), quatre séances. Une fiche d'actu datée du
-- jour J affiche, pour chaque symbole, la dernière séance du jour J ou avant. Valeurs inventées, au format du fournisseur (nombre à point).
-- `recupere_le` est ancien : le produit tentera de récupérer les cours du jour, échouera faute de clé (incident `cours_cle`, que l'écran
-- masque), et gardera ceux-ci. `variation_bp` : centièmes de point, par rapport à la séance précédente.
-- ---------------------------------------------------------------------------
INSERT INTO cours (symbole, date, valeur, variation_bp, sens, recupere_le) VALUES
  ('cac40',     '2026-10-30', '78.4000',  NULL, NULL,      '2026-10-30T20:00:00Z'),
  ('cac40',     '2026-11-06', '79.1500',   96, 'hausse',   '2026-11-06T20:00:00Z'),
  ('cac40',     '2026-11-13', '78.7200',  -54, 'baisse',   '2026-11-13T20:00:00Z'),
  ('cac40',     '2026-11-19', '79.9800',  160, 'hausse',   '2026-11-19T20:00:00Z'),
  ('sp500',     '2026-10-30', '612.3000', NULL, NULL,      '2026-10-30T20:00:00Z'),
  ('sp500',     '2026-11-06', '618.9000', 108, 'hausse',   '2026-11-06T20:00:00Z'),
  ('sp500',     '2026-11-13', '621.4500',  41, 'hausse',   '2026-11-13T20:00:00Z'),
  ('sp500',     '2026-11-19', '617.2000', -68, 'baisse',   '2026-11-19T20:00:00Z'),
  ('nasdaq100', '2026-10-30', '541.1000', NULL, NULL,      '2026-10-30T20:00:00Z'),
  ('nasdaq100', '2026-11-06', '548.7500', 141, 'hausse',   '2026-11-06T20:00:00Z'),
  ('nasdaq100', '2026-11-13', '546.3000', -45, 'baisse',   '2026-11-13T20:00:00Z'),
  ('nasdaq100', '2026-11-19', '551.0500',  87, 'hausse',   '2026-11-19T20:00:00Z'),
  ('eurusd',    '2026-10-30', '1.0850',   NULL, NULL,      '2026-10-30T20:00:00Z'),
  ('eurusd',    '2026-11-06', '1.0912',    57, 'hausse',   '2026-11-06T20:00:00Z'),
  ('eurusd',    '2026-11-13', '1.0912',     0, 'stable',   '2026-11-13T20:00:00Z'),
  ('eurusd',    '2026-11-19', '1.0874',   -35, 'baisse',   '2026-11-19T20:00:00Z'),
  ('brent',     '2026-10-30', '71.2000',  NULL, NULL,      '2026-10-30T20:00:00Z'),
  ('brent',     '2026-11-06', '69.8500', -190, 'baisse',   '2026-11-06T20:00:00Z'),
  ('brent',     '2026-11-13', '70.4000',   79, 'hausse',   '2026-11-13T20:00:00Z'),
  ('brent',     '2026-11-19', '72.1000',  241, 'hausse',   '2026-11-19T20:00:00Z');
