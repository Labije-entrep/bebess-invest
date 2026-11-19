-- Lot 11b : les statuts du contrat suivent la spécification, le gel ne recule pas, l'adresse de support est un réglage de l'éditeur.
--
-- 1. contrat : SQLite ne change pas un CHECK en place, la table est reconstruite (copie, DROP, recréation, recopie : aucune autre
--    table ne désigne `contrat`). Statuts : brouillon, essai, actif, suspendu, resilie, essai_non_converti. Les quatre premiers
--    sont « en cours » (un seul par locataire) ; resilie et essai_non_converti sont de l'historique. `date_fin_essai` : posée avec
--    la mise en production, à +45 jours.
-- 2. Le gel du tarif ne se raccourcit pas et ne s'efface pas : déclencheur, en plus du code (contrat.ts).
-- 3. reglage_editeur : réglages GLOBAUX de l'éditeur (aucun locataire), dont l'adresse du compte de support.
PRAGMA defer_foreign_keys = on;

CREATE TABLE contrat_copie AS SELECT * FROM contrat;

DROP TABLE contrat;

CREATE TABLE contrat (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  statut    TEXT NOT NULL DEFAULT 'brouillon'
            CHECK (statut IN ('brouillon','essai','actif','suspendu','resilie','essai_non_converti')),
  periodicite TEXT NOT NULL CHECK (periodicite IN ('mensuelle','annuelle')),

  debut_le TEXT,
  fin_le   TEXT,
  date_mise_en_production TEXT,
  date_fin_essai TEXT,

  prix_socle     INTEGER NOT NULL CHECK (prix_socle >= 0),
  prix_pilotage  INTEGER NOT NULL CHECK (prix_pilotage >= 0),
  prix_site      INTEGER NOT NULL CHECK (prix_site >= 0),
  prix_acces_sup INTEGER NOT NULL CHECK (prix_acces_sup >= 0),

  module_pilotage INTEGER NOT NULL DEFAULT 0 CHECK (module_pilotage IN (0, 1)),
  module_site     INTEGER NOT NULL DEFAULT 0 CHECK (module_site IN (0, 1)),
  acces_inclus    INTEGER NOT NULL CHECK (acces_inclus >= 0),
  frais_installation INTEGER NOT NULL DEFAULT 0 CHECK (frais_installation >= 0),
  tarif_gele_jusqu_au TEXT,

  remise_parrainage_taux  INTEGER NOT NULL DEFAULT 0 CHECK (remise_parrainage_taux BETWEEN 0 AND 10000),
  remise_commerciale_taux INTEGER NOT NULL DEFAULT 0 CHECK (remise_commerciale_taux BETWEEN 0 AND 10000),
  remise_motif    TEXT,
  remise_revue_le TEXT,

  dpa_signe_le    TEXT,
  preavis_recu_le TEXT,

  cree_le TEXT NOT NULL,
  maj_le  TEXT NOT NULL,

  CHECK (date_mise_en_production IS NULL OR (dpa_signe_le IS NOT NULL AND trim(dpa_signe_le) <> ''))
);

INSERT INTO contrat (id, tenant_id, statut, periodicite, debut_le, fin_le, date_mise_en_production, date_fin_essai,
                     prix_socle, prix_pilotage, prix_site, prix_acces_sup, module_pilotage, module_site, acces_inclus,
                     frais_installation, tarif_gele_jusqu_au, remise_parrainage_taux, remise_commerciale_taux, remise_motif,
                     remise_revue_le, dpa_signe_le, preavis_recu_le, cree_le, maj_le)
SELECT id, tenant_id, statut, periodicite, debut_le, fin_le, date_mise_en_production,
       -- un contrat déjà mis en production avant cette migration : sa fin d'essai se déduit de la même règle (+45 jours)
       CASE WHEN date_mise_en_production IS NOT NULL THEN date(date_mise_en_production, '+45 days') END,
       prix_socle, prix_pilotage, prix_site, prix_acces_sup, module_pilotage, module_site, acces_inclus,
       frais_installation, tarif_gele_jusqu_au, remise_parrainage_taux, remise_commerciale_taux, remise_motif,
       remise_revue_le, dpa_signe_le, preavis_recu_le, cree_le, maj_le
  FROM contrat_copie;

DROP TABLE contrat_copie;

CREATE UNIQUE INDEX idx_contrat_en_cours ON contrat(tenant_id) WHERE statut IN ('brouillon','essai','actif','suspendu');

CREATE TRIGGER contrat_tarif_gele BEFORE UPDATE OF prix_socle, prix_pilotage, prix_site, prix_acces_sup ON contrat
WHEN OLD.tarif_gele_jusqu_au IS NOT NULL AND OLD.tarif_gele_jusqu_au > date('now')
 AND (NEW.prix_socle IS NOT OLD.prix_socle OR NEW.prix_pilotage IS NOT OLD.prix_pilotage
   OR NEW.prix_site IS NOT OLD.prix_site OR NEW.prix_acces_sup IS NOT OLD.prix_acces_sup)
BEGIN SELECT RAISE(ABORT, 'contrat : tarif gelé'); END;

-- Une date de gel peut être prolongée, jamais raccourcie ni effacée : c'est une promesse faite au cabinet.
CREATE TRIGGER contrat_gel_ne_recule_pas BEFORE UPDATE OF tarif_gele_jusqu_au ON contrat
WHEN OLD.tarif_gele_jusqu_au IS NOT NULL AND (NEW.tarif_gele_jusqu_au IS NULL OR NEW.tarif_gele_jusqu_au < OLD.tarif_gele_jusqu_au)
BEGIN SELECT RAISE(ABORT, 'contrat : le gel du tarif ne se raccourcit pas'); END;

-- Réglages globaux de l'éditeur : pas de locataire. `par` : qui a posé la valeur (le journal est celui d'un cabinet, il ne peut
-- pas porter un réglage qui les concerne tous).
CREATE TABLE reglage_editeur (
  cle    TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  par    TEXT
);
