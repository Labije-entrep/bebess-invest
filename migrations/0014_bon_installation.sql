-- Lot 19 : le bon d'installation. `bon_a_facturer.type` admet 'installation' en plus de 'periode' et 'complementaire'.
--
-- Les frais d'installation (`contrat.frais_installation`) ne figuraient sur aucun bon : rien ne rappelait qu'un cabinet les doit à la
-- signature. Le bon d'installation est posé UNE SEULE FOIS, à la signature du contrat (contrat.ts, signerContrat), si les frais sont non nuls ;
-- il ne porte que cette ligne, sans récurrent, et la remise ne s'y applique pas. Un contrat à frais nuls n'en produit aucun.
--
-- 1. SQLite ne change pas un CHECK en place : la table est reconstruite (copie, DROP, recréation, recopie), comme `contrat` en 0009 et
--    `utilisateur` en 0008. `avoir` désigne `bon_a_facturer` : les clés étrangères sont différées jusqu'à la fin de la transaction.
-- 2. La période d'un bon d'installation est le jour de la signature (début = fin) : le CHECK « fin après début » ne vaut plus que pour les
--    deux autres types.
-- 3. Un seul bon d'installation par contrat : index unique partiel.
-- 4. Les index et les quatre déclencheurs de 0010 et 0011 sont recréés à l'identique (le déclencheur « un bon émis est figé » est celui de 0011).
PRAGMA defer_foreign_keys = on;

CREATE TABLE bon_copie AS SELECT * FROM bon_a_facturer;

DROP TABLE bon_a_facturer;

CREATE TABLE bon_a_facturer (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenant(id),
  contrat_id    TEXT NOT NULL REFERENCES contrat(id),
  type          TEXT NOT NULL DEFAULT 'periode' CHECK (type IN ('periode','complementaire','installation')),
  periode_debut TEXT NOT NULL,
  periode_fin   TEXT NOT NULL,
  statut        TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','emise','annulee')),

  acces_facturables INTEGER NOT NULL CHECK (acces_facturables >= 0),
  lignes            TEXT NOT NULL,
  recurrent_ht      INTEGER NOT NULL CHECK (recurrent_ht >= 0),
  remise_taux       INTEGER NOT NULL CHECK (remise_taux BETWEEN 0 AND 5000),
  remise_montant    INTEGER NOT NULL CHECK (remise_montant >= 0),
  total_ht          INTEGER NOT NULL CHECK (total_ht >= 0),

  numero   TEXT,
  annee    INTEGER,
  seq      INTEGER,
  emis_le  TEXT,
  annule_le TEXT,
  cree_le  TEXT NOT NULL,

  tva_taux    INTEGER NOT NULL DEFAULT 2000 CHECK (tva_taux BETWEEN 0 AND 10000),
  remise_motif TEXT,
  facture_cle TEXT,

  UNIQUE (contrat_id, periode_debut),
  CHECK (periode_fin > periode_debut OR (type = 'installation' AND periode_fin = periode_debut)),
  CHECK (statut <> 'brouillon' OR (numero IS NULL AND seq IS NULL AND emis_le IS NULL)),
  CHECK (statut <> 'emise' OR (numero IS NOT NULL AND seq IS NOT NULL AND annee IS NOT NULL AND emis_le IS NOT NULL)),
  CHECK (numero IS NULL OR numero GLOB 'FACT-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]*')
);

INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht,
                            remise_taux, remise_montant, total_ht, numero, annee, seq, emis_le, annule_le, cree_le, tva_taux, remise_motif, facture_cle)
SELECT id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht,
       remise_taux, remise_montant, total_ht, numero, annee, seq, emis_le, annule_le, cree_le, tva_taux, remise_motif, facture_cle
  FROM bon_copie;

DROP TABLE bon_copie;

CREATE INDEX idx_bon_tenant ON bon_a_facturer(tenant_id, periode_debut);
CREATE UNIQUE INDEX idx_bon_sequence ON bon_a_facturer(annee, seq) WHERE seq IS NOT NULL;
CREATE UNIQUE INDEX idx_bon_numero ON bon_a_facturer(numero) WHERE numero IS NOT NULL;
CREATE UNIQUE INDEX idx_bon_installation ON bon_a_facturer(contrat_id) WHERE type = 'installation';

CREATE TRIGGER bon_pas_de_suppression BEFORE DELETE ON bon_a_facturer
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : un bon ne s''efface pas'); END;

CREATE TRIGGER bon_numero_definitif BEFORE UPDATE OF numero, annee, seq, emis_le ON bon_a_facturer
WHEN OLD.numero IS NOT NULL
 AND (NEW.numero IS NOT OLD.numero OR NEW.annee IS NOT OLD.annee OR NEW.seq IS NOT OLD.seq OR NEW.emis_le IS NOT OLD.emis_le)
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : le numéro d''un bon émis ne change pas'); END;

CREATE TRIGGER bon_emis_fige BEFORE UPDATE OF periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, remise_motif, tva_taux, total_ht, contrat_id, tenant_id, type ON bon_a_facturer
WHEN OLD.statut <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : un bon émis est figé'); END;

CREATE TRIGGER bon_statut_sens BEFORE UPDATE OF statut ON bon_a_facturer
WHEN NEW.statut <> OLD.statut AND NOT (OLD.statut = 'brouillon' AND NEW.statut IN ('emise','annulee') OR OLD.statut = 'emise' AND NEW.statut = 'annulee')
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : transition de statut interdite'); END;
