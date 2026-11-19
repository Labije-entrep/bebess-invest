-- Lot 13 : l'identité de facturation du cabinet, et ce qu'il faut au bon à facturer pour être tapé sans rien chercher ailleurs.
--
-- 1. tenant : siren, adresse_facturation, contact_facturation. Le locataire est l'entité juridique, et il y a UN contrat par SIREN :
--    le SIREN est donc unique (un cabinet n'en a pas deux, deux cabinets n'en partagent pas). Vide, il est permis : un cabinet se
--    crée sans SIREN, et c'est le bon qui le signale. La base vérifie les neuf chiffres ; la clé de Luhn est contrôlée dans le code
--    (src/lib/siren.ts), SQLite n'ayant pas de quoi la calculer proprement. La ligne du locataire survit à la suppression du J+75
--    (purge.ts) : le SIREN, l'adresse et le contact de facturation restent avec la raison sociale.
-- 2. bon_a_facturer : le taux de TVA (centièmes de point, figé avec le bon : un bon émis ne change plus), le motif de la remise en clair
--    (figé aussi : le motif du contrat peut changer après l'émission) et la clé du PDF de la facture, déposé par l'éditeur après l'avoir
--    tapée dans son outil. Le PDF est rangé hors du préfixe du locataire (factures/<locataire>/…) : la purge du J+75 vide `<locataire>/`
--    et ne doit pas emporter la facture d'un cabinet dont le bon, lui, reste.
-- 3. Le déclencheur « un bon émis est figé » est recréé pour couvrir les deux nouvelles colonnes de calcul. `facture_cle` n'y figure
--    pas : le PDF se dépose après l'émission.

ALTER TABLE tenant ADD COLUMN siren TEXT CHECK (siren IS NULL OR (length(siren) = 9 AND siren NOT GLOB '*[^0-9]*'));
ALTER TABLE tenant ADD COLUMN adresse_facturation TEXT;
ALTER TABLE tenant ADD COLUMN contact_facturation TEXT;
CREATE UNIQUE INDEX idx_tenant_siren ON tenant(siren) WHERE siren IS NOT NULL;

ALTER TABLE bon_a_facturer ADD COLUMN tva_taux INTEGER NOT NULL DEFAULT 2000 CHECK (tva_taux BETWEEN 0 AND 10000);
ALTER TABLE bon_a_facturer ADD COLUMN remise_motif TEXT;
ALTER TABLE bon_a_facturer ADD COLUMN facture_cle TEXT;

DROP TRIGGER bon_emis_fige;
CREATE TRIGGER bon_emis_fige BEFORE UPDATE OF periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, remise_motif, tva_taux, total_ht, contrat_id, tenant_id, type ON bon_a_facturer
WHEN OLD.statut <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : un bon émis est figé'); END;
