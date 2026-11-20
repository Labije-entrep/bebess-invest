-- Lot 19 : le bon d'installation. `bon_a_facturer.type` admet 'installation', en plus de 'periode' et 'complementaire'.
--
-- Un bon d'installation porte les frais d'installation du contrat, UNE fois, à la mise en production : une seule ligne, aucun récurrent,
-- aucune remise (l'assiette des remises est le récurrent seul). Il est daté du jour de la mise en production : sa période est un jour
-- (début = fin), d'où l'assouplissement du contrôle des dates pour ce seul type. La base fait respecter ce qui le distingue :
--   - un seul bon d'installation par contrat, quel que soit son statut (index unique partiel) : un bon annulé ne se recrée pas ;
--   - ni récurrent ni remise sur ce type (contrôle) ; un montant strictement positif (pas de bon à zéro euro).
--
-- SQLite ne change pas un CHECK en place : la table est reconstruite (copie, DROP, recréation, recopie), comme en 0008 et 0009. `avoir`
-- désigne `bon_a_facturer` par son NOM : la clé étrangère retrouve la table reconstruite ; `defer_foreign_keys` repousse son contrôle à la
-- fin de la transaction, après la recopie. Les index et les déclencheurs tombent avec la table et sont recréés à l'identique (celui qui
-- fige un bon émis est celui de 0011), plus l'index des installations. Aucune ligne n'est modifiée par la recopie.
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
  tva_taux INTEGER NOT NULL DEFAULT 2000 CHECK (tva_taux BETWEEN 0 AND 10000),
  remise_motif TEXT,
  facture_cle TEXT,

  UNIQUE (contrat_id, periode_debut),
  CHECK (periode_fin > periode_debut OR (type = 'installation' AND periode_fin = periode_debut)),
  CHECK (type <> 'installation' OR (recurrent_ht = 0 AND remise_taux = 0 AND remise_montant = 0 AND total_ht > 0)),
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

-- Un bon émis ne se recalcule plus : seul un brouillon suit le contrat.
CREATE TRIGGER bon_emis_fige BEFORE UPDATE OF periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, remise_motif, tva_taux, total_ht, contrat_id, tenant_id, type ON bon_a_facturer
WHEN OLD.statut <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : un bon émis est figé'); END;

CREATE TRIGGER bon_statut_sens BEFORE UPDATE OF statut ON bon_a_facturer
WHEN NEW.statut <> OLD.statut AND NOT (OLD.statut = 'brouillon' AND NEW.statut IN ('emise','annulee') OR OLD.statut = 'emise' AND NEW.statut = 'annulee')
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : transition de statut interdite'); END;
