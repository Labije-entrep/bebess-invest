-- Jeu de démonstration : une famille, un tenant. Données fictives.
-- Montants en centimes. Pourcentages en centièmes de point.
-- Recoupements : lignes -> enveloppes (45 + 32 + 30 + 20 = 127 M de centimes),
-- enveloppes -> dernier point (2026-10-01 = 127 000 000 centimes = 1 270 000 €).

INSERT INTO tenants (id, nom, hote, cree_le) VALUES
  (1, 'Famille Marchand', 'localhost', '2023-11-01T09:00:00Z');

INSERT INTO utilisateurs (id, tenant_id, email, nom, role, actif, cree_le) VALUES
  (1, 1, 'editeur@demo.local',      'Hélène Roussel',  'editeur',      1, '2023-11-01T09:00:00Z'),
  (2, 1, 'gestionnaire@demo.local', 'Antoine Verdier', 'gestionnaire', 1, '2023-11-01T09:00:00Z'),
  (3, 1, 'claire@demo.local',       'Claire Marchand', 'viewer',       1, '2023-11-01T09:00:00Z'),
  (4, 1, 'thomas@demo.local',       'Thomas Marchand', 'viewer',       1, '2024-02-15T09:00:00Z');

INSERT INTO viewers (id, tenant_id, utilisateur_id, gestionnaire_id, nom_famille, profil, horizon_le, entree_le) VALUES
  (1, 1, 3, 2, 'Famille Marchand', 'Équilibré',  '2036-12-31', '2023-11-01'),
  (2, 1, 4, 2, 'Famille Marchand', 'Dynamique',  '2041-12-31', '2024-02-15');

INSERT INTO enveloppes (id, viewer_id, nom, type, etablissement, ordre) VALUES
  (1, 1, 'Assurance-vie luxembourgeoise', 'assurance_vie',  'Lombard Intl',        1),
  (2, 1, 'Compte-titres',                 'compte_titres',  'Banque Privée Nord',  2),
  (3, 1, 'Immobilier détenu en direct',   'immobilier',     'Sociétés familiales', 3),
  (4, 1, 'Liquidités et capital-investissement', 'divers',  'Banque Privée Nord',  4);

INSERT INTO lignes (id, enveloppe_id, libelle, classe, valeur_cents, ordre) VALUES
  -- Enveloppe 1 : 45 000 000
  (1,  1, 'Fonds en euros',                        'obligations',    20000000, 1),
  (2,  1, 'UC actions monde',                      'actions',        12000000, 2),
  (3,  1, 'UC obligataire flexible',               'obligations',     8000000, 3),
  (4,  1, 'UC capital-investissement',             'private_equity',  5000000, 4),
  -- Enveloppe 2 : 32 000 000
  (5,  2, 'Actions européennes',                   'actions',        12000000, 1),
  (6,  2, 'Actions américaines',                   'actions',         9000000, 2),
  (7,  2, 'Obligations souveraines',               'obligations',     7000000, 3),
  (8,  2, 'Obligations d''entreprises',            'obligations',     4000000, 4),
  -- Enveloppe 3 : 30 000 000
  (9,  3, 'SCPI de bureaux',                       'immobilier',     15000000, 1),
  (10, 3, 'SCI familiale, résidence principale',   'immobilier',     10000000, 2),
  (11, 3, 'Investissement locatif',                'immobilier',      5000000, 3),
  -- Enveloppe 4 : 20 000 000
  (12, 4, 'Compte courant et livrets',             'liquidites',      8000000, 1),
  (13, 4, 'Fonds de capital-investissement',       'private_equity',  7000000, 2),
  (14, 4, 'Comptes à terme',                       'liquidites',      5000000, 3);

INSERT INTO cibles (id, viewer_id, classe, cible_bp, ordre) VALUES
  (1, 1, 'actions',        3500, 1),
  (2, 1, 'obligations',    2000, 2),
  (3, 1, 'immobilier',     2500, 3),
  (4, 1, 'private_equity', 1000, 4),
  (5, 1, 'liquidites',     1000, 5);

-- 36 points mensuels, de 100,0 à 127,0 (100 = 1 000 000 €), creux en 2024.
INSERT INTO points (viewer_id, mois, valeur_cents) VALUES
  (1, '2023-11-01', 100000000),
  (1, '2023-12-01', 100800000),
  (1, '2024-01-01', 101500000),
  (1, '2024-02-01', 102200000),
  (1, '2024-03-01', 103000000),
  (1, '2024-04-01', 101800000),
  (1, '2024-05-01', 100200000),
  (1, '2024-06-01',  98500000),
  (1, '2024-07-01',  96800000),
  (1, '2024-08-01',  95500000),
  (1, '2024-09-01',  96200000),
  (1, '2024-10-01',  97500000),
  (1, '2024-11-01',  99000000),
  (1, '2024-12-01', 100500000),
  (1, '2025-01-01', 101800000),
  (1, '2025-02-01', 103000000),
  (1, '2025-03-01', 104100000),
  (1, '2025-04-01', 105000000),
  (1, '2025-05-01', 106200000),
  (1, '2025-06-01', 107000000),
  (1, '2025-07-01', 108100000),
  (1, '2025-08-01', 109000000),
  (1, '2025-09-01', 109900000),
  (1, '2025-10-01', 110800000),
  (1, '2025-11-01', 111700000),
  (1, '2025-12-01', 112600000),
  (1, '2026-01-01', 113400000),
  (1, '2026-02-01', 114200000),
  (1, '2026-03-01', 115000000),
  (1, '2026-04-01', 116000000),
  (1, '2026-05-01', 117200000),
  (1, '2026-06-01', 119000000),
  (1, '2026-07-01', 120800000),
  (1, '2026-08-01', 122800000),
  (1, '2026-09-01', 125000000),
  (1, '2026-10-01', 127000000);

INSERT INTO mouvements (id, viewer_id, enveloppe_id, date_le, libelle, type, montant_cents, statut) VALUES
  (1, 1, 1, '2026-03-12', 'Versement complémentaire',                'apport',    5000000, 'execute'),
  (2, 1, 2, '2026-06-20', 'Arbitrage actions vers obligations',      'arbitrage', 2000000, 'execute'),
  (3, 1, 4, '2026-09-05', 'Retrait pour travaux',                    'retrait',   1500000, 'execute'),
  (4, 1, 1, '2026-10-28', 'Versement complémentaire',                'apport',    3000000, 'en_cours'),
  (5, 1, 2, '2026-11-04', 'Arbitrage obligations vers actions',      'arbitrage', 1800000, 'en_cours'),
  (6, 1, 4, '2026-11-10', 'Appel de fonds, capital-investissement',  'apport',    2500000, 'en_cours');

INSERT INTO documents (id, viewer_id, titre, categorie, date_le, chemin) VALUES
  (1, 1, 'Rapport de gestion, troisième trimestre 2026', 'rapport',     '2026-10-15', 'documents/marchand/rapport-2026-t3.pdf'),
  (2, 1, 'Relevé fiscal 2025',                           'fiscal',      '2026-02-20', 'documents/marchand/fiscal-2025.pdf'),
  (3, 1, 'Lettre de mission',                            'contractuel', '2023-11-01', 'documents/marchand/lettre-de-mission.pdf');

INSERT INTO pages_contenu (id, tenant_id, slug, titre, corps, maj_le) VALUES
  (1, 1, 'accueil', 'Bienvenue',       'Votre espace de consultation : patrimoine, mouvements et documents.', '2026-11-01'),
  (2, 1, 'contact', 'Votre interlocuteur', 'Antoine Verdier, gestionnaire, répond à vos questions du lundi au vendredi.', '2026-11-01');

INSERT INTO notes (id, tenant_id, viewer_id, titre, corps, statut, publie_le, auteur_id) VALUES
  (1, 1, NULL, 'Point de marché, octobre 2026',  'Les marchés actions poursuivent leur progression ; la poche obligataire reste stable.', 'publiee',   '2026-10-31', 2),
  (2, 1, 1,    'Revue annuelle de votre allocation', 'La répartition actuelle s''écarte de la cible sur les obligations et le capital-investissement.', 'publiee', '2026-11-05', 2),
  (3, 1, NULL, 'Note en préparation',            'Brouillon non diffusé.', 'brouillon', NULL, 1);
