-- Jeu de démonstration : une famille, un tenant. Données fictives.
-- Montants en centimes. Pourcentages en centièmes de point (640 = 6,40 %).
-- Recoupements, pour le viewer usr_claire :
--   lignes -> enveloppe : 45 000 000 + 32 000 000 + 30 000 000 + 20 000 000
--   enveloppes -> dernier point (2026-10-31) : 127 000 000 centimes = 1 270 000 €.

INSERT INTO tenant (id, nom, domaine, cree_le) VALUES
  ('tnt_demo', 'Family office de démonstration', 'localhost', '2023-11-01T09:00:00Z');

INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le) VALUES
  ('usr_editeur',      'tnt_demo', 'editeur@demo.local',      'Hélène Roussel',  'editeur',      1, '2023-11-01T09:00:00Z'),
  ('usr_gestionnaire', 'tnt_demo', 'gestionnaire@demo.local', 'Antoine Verdier', 'gestionnaire', 1, '2023-11-01T09:00:00Z'),
  ('usr_claire',       'tnt_demo', 'claire@demo.local',       'Claire Marchand', 'viewer',       1, '2023-11-01T09:00:00Z'),
  ('usr_thomas',       'tnt_demo', 'thomas@demo.local',       'Thomas Marchand', 'viewer',       1, '2024-02-15T09:00:00Z');

INSERT INTO fiche (utilisateur_id, mandat_ref, profil_risque, profil_note, horizon, perte_max_cents, liquidite_cents, regle_reequilibrage, allocation_signee_le, allocation_motif, prochain_point) VALUES
  ('usr_claire', 'MAND-2023-014', 'Équilibré', 5, '2036-12-31', 20000000, 13000000,
   'Revue semestrielle ; arbitrage si une classe s''écarte de 5 points de sa cible.',
   '2025-01-20', 'Revue annuelle : réduction de la part obligataire au profit des actions.', '2027-01-18'),
  ('usr_thomas', 'MAND-2024-003', 'Dynamique', 6, '2041-12-31', 30000000, 5000000,
   'Revue annuelle ; arbitrage si une classe s''écarte de 8 points de sa cible.',
   '2024-02-15', 'Allocation initiale.', '2027-02-15');

INSERT INTO enveloppe (id, viewer_id, libelle, etablissement, ouverte_en, valorisation_cents, perf_bp, arrete_le, rang) VALUES
  ('env_av',   'usr_claire', 'Assurance-vie luxembourgeoise',         'Lombard Intl',        '2019-05', 45000000, 580, '2026-10-31', 1),
  ('env_cto',  'usr_claire', 'Compte-titres',                         'Banque Privée Nord',  '2020-09', 32000000, 910, '2026-10-31', 2),
  ('env_immo', 'usr_claire', 'Immobilier détenu en direct',           'Sociétés familiales', '2016-03', 30000000, 340, '2026-10-31', 3),
  ('env_liq',  'usr_claire', 'Liquidités et capital-investissement',  'Banque Privée Nord',  '2021-01', 20000000, 210, '2026-10-31', 4);

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

INSERT INTO cible (id, viewer_id, classe, cible_bp, rang) VALUES
  ('cib_1', 'usr_claire', 'actions',        3500, 1),
  ('cib_2', 'usr_claire', 'obligations',    2000, 2),
  ('cib_3', 'usr_claire', 'immobilier',     2500, 3),
  ('cib_4', 'usr_claire', 'private_equity', 1000, 4),
  ('cib_5', 'usr_claire', 'liquidites',     1000, 5);

-- 36 points mensuels (fin de mois), de 100,0 à 127,0 (100 = 1 000 000 €), creux en 2024.
-- Les versements cumulés suivent les apports et le retrait de la section mouvement.
INSERT INTO point (id, viewer_id, date, valeur_cents, versements_cumules_cents) VALUES
  ('pt_01', 'usr_claire', '2023-11-30', 100000000,  95000000),
  ('pt_02', 'usr_claire', '2023-12-31', 100800000,  95000000),
  ('pt_03', 'usr_claire', '2024-01-31', 101500000,  95000000),
  ('pt_04', 'usr_claire', '2024-02-29', 102200000,  95000000),
  ('pt_05', 'usr_claire', '2024-03-31', 103000000,  97000000),
  ('pt_06', 'usr_claire', '2024-04-30', 101800000,  97000000),
  ('pt_07', 'usr_claire', '2024-05-31', 100200000,  97000000),
  ('pt_08', 'usr_claire', '2024-06-30',  98500000,  97000000),
  ('pt_09', 'usr_claire', '2024-07-31',  96800000,  97000000),
  ('pt_10', 'usr_claire', '2024-08-31',  95500000,  97000000),
  ('pt_11', 'usr_claire', '2024-09-30',  96200000,  97000000),
  ('pt_12', 'usr_claire', '2024-10-31',  97500000,  97000000),
  ('pt_13', 'usr_claire', '2024-11-30',  99000000,  97000000),
  ('pt_14', 'usr_claire', '2024-12-31', 100500000,  97000000),
  ('pt_15', 'usr_claire', '2025-01-31', 101800000,  99000000),
  ('pt_16', 'usr_claire', '2025-02-28', 103000000,  99000000),
  ('pt_17', 'usr_claire', '2025-03-31', 104100000,  99000000),
  ('pt_18', 'usr_claire', '2025-04-30', 105000000,  99000000),
  ('pt_19', 'usr_claire', '2025-05-31', 106200000,  99000000),
  ('pt_20', 'usr_claire', '2025-06-30', 107000000,  99000000),
  ('pt_21', 'usr_claire', '2025-07-31', 108100000,  99000000),
  ('pt_22', 'usr_claire', '2025-08-31', 109000000,  99000000),
  ('pt_23', 'usr_claire', '2025-09-30', 109900000, 101000000),
  ('pt_24', 'usr_claire', '2025-10-31', 110800000, 101000000),
  ('pt_25', 'usr_claire', '2025-11-30', 111700000, 101000000),
  ('pt_26', 'usr_claire', '2025-12-31', 112600000, 101000000),
  ('pt_27', 'usr_claire', '2026-01-31', 113400000, 101000000),
  ('pt_28', 'usr_claire', '2026-02-28', 114200000, 101000000),
  ('pt_29', 'usr_claire', '2026-03-31', 115000000, 106000000),
  ('pt_30', 'usr_claire', '2026-04-30', 116000000, 106000000),
  ('pt_31', 'usr_claire', '2026-05-31', 117200000, 106000000),
  ('pt_32', 'usr_claire', '2026-06-30', 119000000, 106000000),
  ('pt_33', 'usr_claire', '2026-07-31', 120800000, 106000000),
  ('pt_34', 'usr_claire', '2026-08-31', 122800000, 106000000),
  ('pt_35', 'usr_claire', '2026-09-30', 125000000, 104500000),
  ('pt_36', 'usr_claire', '2026-10-31', 127000000, 104500000);

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
