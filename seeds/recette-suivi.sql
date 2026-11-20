-- Complément de recette : le suivi (contacts, sujets, échanges) du cabinet `tnt_demo`, que `demo.sql` laisse vide.
-- À jouer APRÈS `demo.sql`, et seulement en recette. Données fictives, dates calées sur la mi-novembre 2026.
-- Couvre : tous les types de contact, toutes les étapes du parcours (dont « perdu », qui en sort), tous les statuts de sujet
-- (dont « fait », qui clôt), des échéances dépassées et à venir, deux clients déjà rattachés à leur espace (viewer).

INSERT INTO contact (id, tenant_id, nom, prenom, email, tel, metier, structure, responsable_id, binome_id, etape,
                     convention, convention_le, apporteur_id, relance, dernier_echange, type_echange,
                     avoirs_cents, avoirs_le, notes, viewer_id, archive, cree_le, maj_le) VALUES
  -- Clients : les deux viewers du jeu, reliés à leur fiche de suivi.
  ('ct_claire', 'tnt_demo', 'Marchand', 'Claire', 'claire@demo.local', '06 11 22 33 44', 'Chirurgienne', 'Clinique des Lilas',
   'mbr_antoine', 'mbr_helene', NULL, 1, '2023-11-10', NULL, '2027-01-18', '2026-11-12', 'rdv',
   127000000, '2026-10-31', 'Mandat équilibré. Souhaite réduire la part obligataire. Attentive aux frais.', 'usr_claire', 0,
   '2023-10-20T09:00:00Z', '2026-11-12T10:00:00Z'),
  ('ct_thomas', 'tnt_demo', 'Marchand', 'Thomas', 'thomas@demo.local', '06 55 44 33 22', 'Entrepreneur', 'Marchand Logistique',
   'mbr_helene', NULL, NULL, 1, '2024-02-20', 'ct_claire', '2027-02-15', '2026-10-28', 'visio',
   NULL, NULL, 'Fils de Claire. Profil dynamique, horizon long.', 'usr_thomas', 0,
   '2024-01-30T09:00:00Z', '2026-10-28T09:00:00Z'),
  -- Prospects, un par étape du parcours.
  ('ct_morel', 'tnt_demo', 'Morel', 'Judith', 'judith.morel@exemple.fr', '06 70 80 90 10', 'Notaire', 'Étude Morel & Associés',
   'mbr_antoine', NULL, 'contact', 0, NULL, 'ct_perrin', '2026-11-25', '2026-11-17', 'tel',
   NULL, NULL, 'Rencontrée au salon patrimoine. Cherche une gestion pour sa succession.', NULL, 0,
   '2026-11-17T09:00:00Z', '2026-11-17T09:30:00Z'),
  ('ct_bernard', 'tnt_demo', 'Bernard', 'Olivier', 'olivier.bernard@exemple.fr', '06 12 34 56 78', 'Médecin', 'Cabinet médical du Parc',
   'mbr_helene', 'mbr_camille', 'rdv', 0, NULL, NULL, '2026-11-22', '2026-11-14', 'rdv',
   85000000, '2026-09-30', 'Deux enveloppes chez deux banques. Veut tout consolider.', NULL, 0,
   '2026-09-12T09:00:00Z', '2026-11-14T16:00:00Z'),
  ('ct_garnier', 'tnt_demo', 'Garnier', 'Sophie', 'sophie.garnier@exemple.fr', '06 98 76 54 32', 'Dirigeante', 'Garnier Textiles',
   'mbr_antoine', NULL, 'proposition', 0, NULL, 'ct_perrin', '2026-11-19', '2026-11-05', 'visio',
   240000000, '2026-10-31', 'Vente prochaine de l''entreprise : besoin d''un projet de remploi du produit de cession.', NULL, 0,
   '2026-08-03T09:00:00Z', '2026-11-05T11:00:00Z'),
  ('ct_lambert', 'tnt_demo', 'Lambert', 'Henri', 'henri.lambert@exemple.fr', '06 01 02 03 04', 'Retraité', NULL,
   'mbr_camille', NULL, 'signe', 1, '2026-11-03', NULL, '2026-12-01', '2026-11-03', 'rdv',
   150000000, '2026-10-15', 'Convention signée le 3 novembre. Lien de connexion à envoyer.', NULL, 0,
   '2026-07-01T09:00:00Z', '2026-11-03T15:00:00Z'),
  ('ct_roche', 'tnt_demo', 'Roche', 'Valérie', 'valerie.roche@exemple.fr', NULL, 'Avocate', NULL,
   'mbr_helene', NULL, 'perdu', 0, NULL, NULL, NULL, '2026-09-20', 'mail',
   NULL, NULL, 'A choisi sa banque privée : frais jugés trop élevés.', NULL, 0,
   '2026-06-15T09:00:00Z', '2026-09-20T09:00:00Z'),
  -- Prescripteur et partenaire : pas dans le parcours.
  ('ct_perrin', 'tnt_demo', 'Perrin', 'Laurent', 'laurent.perrin@exemple.fr', '01 40 50 60 70', 'Expert-comptable', 'Cabinet Perrin',
   'mbr_antoine', NULL, NULL, 0, NULL, NULL, '2026-12-10', '2026-11-10', 'mail',
   NULL, NULL, 'Nous a adressé Garnier et Morel. À remercier en fin d''année.', NULL, 0,
   '2025-02-01T09:00:00Z', '2026-11-10T09:00:00Z'),
  ('ct_vasseur', 'tnt_demo', 'Vasseur', 'Nadia', 'nadia.vasseur@exemple.fr', NULL, 'Gérante', 'Immo Conseil Vasseur',
   'mbr_camille', NULL, NULL, 0, NULL, NULL, NULL, '2026-08-30', 'tel',
   NULL, NULL, 'Partenaire immobilier : accès à des programmes en résidence gérée.', NULL, 0,
   '2025-05-12T09:00:00Z', '2026-08-30T09:00:00Z');

INSERT INTO contact_type (tenant_id, contact_id, type) VALUES
  ('tnt_demo', 'ct_claire',  'client'),
  ('tnt_demo', 'ct_thomas',  'client'),
  ('tnt_demo', 'ct_morel',   'prospect'),
  ('tnt_demo', 'ct_bernard', 'prospect'),
  ('tnt_demo', 'ct_garnier', 'prospect'),
  ('tnt_demo', 'ct_lambert', 'prospect'),
  ('tnt_demo', 'ct_roche',   'prospect'),
  ('tnt_demo', 'ct_perrin',  'prescripteur'),
  ('tnt_demo', 'ct_vasseur', 'partenaire');

-- Sujets : les quatre statuts, avec échéances dépassées (avant le 20/11/2026) et à venir.
INSERT INTO sujet (id, tenant_id, contact_id, texte, statut, echeance, origine, cree_le, fait_le, archive) VALUES
  ('su_01', 'tnt_demo', 'ct_claire',  'Étudier la réduction de la part obligataire', 'encours', '2026-12-05', NULL, '2026-11-12T10:00:00Z', NULL, 0),
  ('su_02', 'tnt_demo', 'ct_claire',  'Envoyer le rapport semestriel', 'fait', '2026-11-10', NULL, '2026-10-25T09:00:00Z', '2026-11-09T17:00:00Z', 0),
  ('su_03', 'tnt_demo', 'ct_thomas',  'Point sur l''assurance-vie de l''entreprise', 'attente', '2026-11-30', NULL, '2026-10-28T09:00:00Z', NULL, 0),
  ('su_04', 'tnt_demo', 'ct_morel',   'Rappeler pour fixer un premier rendez-vous', 'afaire', '2026-11-24', NULL, '2026-11-17T09:30:00Z', NULL, 0),
  ('su_05', 'tnt_demo', 'ct_bernard', 'Demander les relevés des deux banques', 'encours', '2026-11-18', NULL, '2026-11-14T16:00:00Z', NULL, 0),
  ('su_06', 'tnt_demo', 'ct_garnier', 'Rédiger la proposition de remploi', 'encours', '2026-11-19', NULL, '2026-11-05T11:00:00Z', NULL, 0),
  ('su_07', 'tnt_demo', 'ct_garnier', 'Valider le calendrier de cession avec l''expert-comptable', 'attente', '2026-12-10', NULL, '2026-11-05T11:30:00Z', NULL, 0),
  ('su_08', 'tnt_demo', 'ct_lambert', 'Envoyer le lien de première connexion', 'afaire', '2026-11-21', NULL, '2026-11-03T15:00:00Z', NULL, 0),
  ('su_09', 'tnt_demo', 'ct_lambert', 'Collecter les justificatifs d''identité', 'fait', '2026-11-03', NULL, '2026-10-20T09:00:00Z', '2026-11-03T14:00:00Z', 0),
  ('su_10', 'tnt_demo', 'ct_perrin',  'Carte de vœux et déjeuner de fin d''année', 'afaire', '2026-12-15', NULL, '2026-11-10T09:00:00Z', NULL, 0),
  ('su_11', 'tnt_demo', 'ct_vasseur', 'Recevoir la plaquette du programme de Lyon', 'attente', '2026-10-31', NULL, '2026-08-30T09:00:00Z', NULL, 0);

-- Échanges : de quoi remplir l'historique d'une fiche.
INSERT INTO echange (id, tenant_id, contact_id, date, type, note, cree_le) VALUES
  ('ec_01', 'tnt_demo', 'ct_claire',  '2026-11-12', 'rdv',   'Revue de fin d''année. Souhaite réduire les obligations ; à chiffrer.', '2026-11-12T11:00:00Z'),
  ('ec_02', 'tnt_demo', 'ct_claire',  '2026-05-20', 'visio', 'Revue de mi-année, rien à signaler.', '2026-05-20T11:00:00Z'),
  ('ec_03', 'tnt_demo', 'ct_thomas',  '2026-10-28', 'visio', 'Question sur la fiscalité des versements. Je reviens vers lui.', '2026-10-28T10:00:00Z'),
  ('ec_04', 'tnt_demo', 'ct_morel',   '2026-11-17', 'tel',   'Premier appel, 15 minutes. Rendez-vous à fixer.', '2026-11-17T09:30:00Z'),
  ('ec_05', 'tnt_demo', 'ct_bernard', '2026-11-14', 'rdv',   'Rendez-vous au cabinet. Il apporte ses relevés la semaine prochaine.', '2026-11-14T16:00:00Z'),
  ('ec_06', 'tnt_demo', 'ct_bernard', '2026-10-02', 'tel',   'Premier échange, envoyé la présentation du cabinet.', '2026-10-02T14:00:00Z'),
  ('ec_07', 'tnt_demo', 'ct_garnier', '2026-11-05', 'visio', 'Cadrage du projet de remploi. Cession attendue au printemps.', '2026-11-05T11:00:00Z'),
  ('ec_08', 'tnt_demo', 'ct_lambert', '2026-11-03', 'rdv',   'Signature de la convention.', '2026-11-03T15:00:00Z'),
  ('ec_09', 'tnt_demo', 'ct_roche',   '2026-09-20', 'mail',  'Refus poli : a choisi sa banque privée.', '2026-09-20T09:00:00Z'),
  ('ec_10', 'tnt_demo', 'ct_perrin',  '2026-11-10', 'mail',  'Remerciements pour les deux recommandations.', '2026-11-10T09:00:00Z');
