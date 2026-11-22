-- Facturation (22/11/2026) : la LIGNE LIBRE PONCTUELLE et le bon ponctuel « prestation ».
--
-- Constat de recette : les frais d'installation sont un champ du contrat et ne produisent qu'UN bon, à la signature ; on ne pouvait pas
-- facturer une prestation demandée en cours de contrat (mise en place du site, etc.).
--
-- 1. `ligne_libre` : une ligne ajoutée à la main sur un bon BROUILLON (libellé de 120 caractères au plus, quantité entière, prix unitaire
--    HT en centimes, motif facultatif). Elle ADDITIONNE (la remise ponctuelle retire). Stockée À PART des lignes du bon (`bon_a_facturer.lignes`,
--    que le traitement quotidien recalcule) : elle survit donc aux recalculs. Les déclencheurs la figent avec son bon.
--    `bon_a_facturer.lignes_libres_ht` : la somme des lignes libres du bon (déjà comprise dans `total_ht`). Hors du récurrent : la remise
--    commerciale en pourcentage ne s'y applique jamais.
-- 2. Un nouveau TYPE de bon, `prestation` : un bon ponctuel sans période récurrente, pour un cabinet dont aucun brouillon n'est ouvert.
--    Il porte `periode_debut = periode_fin` = le jour de sa création (comme le bon d'installation), n'a aucune ligne de récurrent
--    (`lignes` = '[]', recurrent_ht = 0) et partage la numérotation BC-AAAA-NNNN et la séquence (annee, seq) de tous les bons.
--    Plusieurs bons prestation peuvent naître le même jour : l'unicité (contrat_id, periode_debut), qui garantissait un bon par période,
--    devient un index PARTIEL qui les exclut (les bons périodiques, complémentaires et d'installation gardent leur clé).
-- 3. Une remise ponctuelle peut viser les lignes libres (code de ligne `libre`, au plus leur montant) : la liste fermée de `code_ligne`
--    s'élargit, ce qui impose de reconstruire `remise_ponctuelle`.
--
-- SQLite ne change pas un CHECK en place : `remise_ponctuelle` (qui référence `bon_a_facturer`) puis `bon_a_facturer` sont copiées, supprimées
-- et recréées, avec leurs colonnes, index et déclencheurs repris à l'identique (0015, 0017), puis recopiées. Aucune ligne n'est perdue ni modifiée.
PRAGMA defer_foreign_keys = on;

CREATE TABLE remise_copie AS SELECT * FROM remise_ponctuelle;
DROP TABLE remise_ponctuelle;

CREATE TABLE bon_copie AS SELECT * FROM bon_a_facturer;
DROP TABLE bon_a_facturer;

CREATE TABLE bon_a_facturer (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenant(id),
  contrat_id    TEXT NOT NULL REFERENCES contrat(id),
  type          TEXT NOT NULL DEFAULT 'periode' CHECK (type IN ('periode','complementaire','installation','prestation')),
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
  remise_ponctuelle_montant INTEGER NOT NULL DEFAULT 0 CHECK (remise_ponctuelle_montant >= 0),
  lignes_libres_ht          INTEGER NOT NULL DEFAULT 0 CHECK (lignes_libres_ht >= 0),

  CHECK (periode_fin > periode_debut OR (type IN ('installation','prestation') AND periode_fin = periode_debut)),
  CHECK (type <> 'prestation' OR (acces_facturables = 0 AND recurrent_ht = 0 AND remise_taux = 0 AND remise_montant = 0)),
  CHECK (statut <> 'brouillon' OR (numero IS NULL AND seq IS NULL AND emis_le IS NULL)),
  CHECK (statut <> 'emise' OR (numero IS NOT NULL AND seq IS NOT NULL AND annee IS NOT NULL AND emis_le IS NOT NULL)),
  CHECK (numero IS NULL
         OR numero GLOB 'BC-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]*'
         OR numero GLOB 'FACT-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]*')
);

INSERT INTO bon_a_facturer (id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht,
                            remise_taux, remise_montant, total_ht, numero, annee, seq, emis_le, annule_le, cree_le, tva_taux, remise_motif, facture_cle,
                            remise_ponctuelle_montant)
SELECT id, tenant_id, contrat_id, type, periode_debut, periode_fin, statut, acces_facturables, lignes, recurrent_ht,
       remise_taux, remise_montant, total_ht, numero, annee, seq, emis_le, annule_le, cree_le, tva_taux, remise_motif, facture_cle,
       remise_ponctuelle_montant
  FROM bon_copie;

DROP TABLE bon_copie;

CREATE INDEX idx_bon_tenant ON bon_a_facturer(tenant_id, periode_debut);
CREATE UNIQUE INDEX idx_bon_sequence ON bon_a_facturer(annee, seq) WHERE seq IS NOT NULL;
CREATE UNIQUE INDEX idx_bon_numero ON bon_a_facturer(numero) WHERE numero IS NOT NULL;
CREATE UNIQUE INDEX idx_bon_installation ON bon_a_facturer(contrat_id) WHERE type = 'installation';
CREATE UNIQUE INDEX idx_bon_periode ON bon_a_facturer(contrat_id, periode_debut) WHERE type <> 'prestation';

CREATE TRIGGER bon_pas_de_suppression BEFORE DELETE ON bon_a_facturer
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : un bon ne s''efface pas'); END;

CREATE TRIGGER bon_numero_definitif BEFORE UPDATE OF numero, annee, seq, emis_le ON bon_a_facturer
WHEN OLD.numero IS NOT NULL
 AND (NEW.numero IS NOT OLD.numero OR NEW.annee IS NOT OLD.annee OR NEW.seq IS NOT OLD.seq OR NEW.emis_le IS NOT OLD.emis_le)
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : le numéro d''un bon émis ne change pas'); END;

CREATE TRIGGER bon_emis_fige BEFORE UPDATE OF periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, remise_motif, remise_ponctuelle_montant, lignes_libres_ht, tva_taux, total_ht, contrat_id, tenant_id, type ON bon_a_facturer
WHEN OLD.statut <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : un bon émis est figé'); END;

CREATE TRIGGER bon_statut_sens BEFORE UPDATE OF statut ON bon_a_facturer
WHEN NEW.statut <> OLD.statut AND NOT (OLD.statut = 'brouillon' AND NEW.statut IN ('emise','annulee') OR OLD.statut = 'emise' AND NEW.statut = 'annulee')
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : transition de statut interdite'); END;

-- Les remises ponctuelles, reconstruites avec le code de ligne `libre` (le reste est celui de 0017).
CREATE TABLE remise_ponctuelle (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenant(id),
  contrat_id     TEXT NOT NULL REFERENCES contrat(id),
  bon_id         TEXT REFERENCES bon_a_facturer(id),
  code_ligne     TEXT NOT NULL CHECK (code_ligne IN ('socle','pilotage','site','acces_sup','installation','libre')),
  montant        INTEGER NOT NULL CHECK (montant > 0),
  motif          TEXT NOT NULL CHECK (length(trim(motif)) > 0),
  origine        TEXT NOT NULL CHECK (origine IN ('manuelle','acces','module')),
  acces_id       TEXT,
  etat           TEXT NOT NULL DEFAULT 'appliquee' CHECK (etat IN ('en_attente','appliquee','annulee')),
  applicable_des TEXT,
  cree_le        TEXT NOT NULL,
  maj_le         TEXT NOT NULL,
  CHECK (etat <> 'appliquee' OR bon_id IS NOT NULL),
  CHECK (etat = 'appliquee' OR bon_id IS NULL),
  CHECK (origine <> 'manuelle' OR (etat = 'appliquee' AND acces_id IS NULL)),
  CHECK (origine = 'manuelle' OR applicable_des IS NOT NULL)
);

INSERT INTO remise_ponctuelle (id, tenant_id, contrat_id, bon_id, code_ligne, montant, motif, origine, acces_id, etat, applicable_des, cree_le, maj_le)
SELECT id, tenant_id, contrat_id, bon_id, code_ligne, montant, motif, origine, acces_id, etat, applicable_des, cree_le, maj_le FROM remise_copie;

DROP TABLE remise_copie;

CREATE INDEX idx_remise_ponctuelle_bon ON remise_ponctuelle(bon_id);
CREATE INDEX idx_remise_ponctuelle_contrat ON remise_ponctuelle(tenant_id, contrat_id, etat);
CREATE UNIQUE INDEX idx_remise_ponctuelle_acces_attente ON remise_ponctuelle(acces_id) WHERE origine = 'acces' AND etat = 'en_attente';

CREATE TRIGGER remise_ponctuelle_coherente BEFORE INSERT ON remise_ponctuelle
WHEN NEW.bon_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM bon_a_facturer b WHERE b.id = NEW.bon_id AND b.contrat_id = NEW.contrat_id AND b.tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'remise_ponctuelle : le bon n''est pas celui de ce contrat'); END;

CREATE TRIGGER remise_ponctuelle_bon_fige_ajout BEFORE INSERT ON remise_ponctuelle
WHEN NEW.bon_id IS NOT NULL AND (SELECT statut FROM bon_a_facturer WHERE id = NEW.bon_id) <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'remise_ponctuelle : un bon émis est figé'); END;

CREATE TRIGGER remise_ponctuelle_bon_fige_modif BEFORE UPDATE ON remise_ponctuelle
WHEN OLD.bon_id IS NOT NULL AND (SELECT statut FROM bon_a_facturer WHERE id = OLD.bon_id) <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'remise_ponctuelle : un bon émis est figé'); END;

CREATE TRIGGER remise_ponctuelle_bon_fige_suppression BEFORE DELETE ON remise_ponctuelle
WHEN OLD.bon_id IS NOT NULL AND (SELECT statut FROM bon_a_facturer WHERE id = OLD.bon_id) <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'remise_ponctuelle : un bon émis est figé'); END;

-- Les lignes libres. Une ligne appartient toujours à un bon (pas de ligne en attente) ; le montant d'une ligne est quantite × prix_unitaire,
-- au centime, en entiers (bornés : le produit tient largement dans un entier de 53 bits).
CREATE TABLE ligne_libre (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenant(id),
  contrat_id    TEXT NOT NULL REFERENCES contrat(id),
  bon_id        TEXT NOT NULL REFERENCES bon_a_facturer(id),
  libelle       TEXT NOT NULL CHECK (length(trim(libelle)) BETWEEN 1 AND 120),
  quantite      INTEGER NOT NULL CHECK (quantite BETWEEN 1 AND 9999),
  prix_unitaire INTEGER NOT NULL CHECK (prix_unitaire BETWEEN 1 AND 99999999),
  motif         TEXT CHECK (motif IS NULL OR length(motif) <= 200),
  cree_le       TEXT NOT NULL,
  maj_le        TEXT NOT NULL
);

CREATE INDEX idx_ligne_libre_bon ON ligne_libre(bon_id, cree_le);
CREATE INDEX idx_ligne_libre_tenant ON ligne_libre(tenant_id);

CREATE TRIGGER ligne_libre_coherente BEFORE INSERT ON ligne_libre
WHEN NOT EXISTS (SELECT 1 FROM bon_a_facturer b WHERE b.id = NEW.bon_id AND b.contrat_id = NEW.contrat_id AND b.tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'ligne_libre : le bon n''est pas celui de ce contrat'); END;

CREATE TRIGGER ligne_libre_bon_fige_ajout BEFORE INSERT ON ligne_libre
WHEN (SELECT statut FROM bon_a_facturer WHERE id = NEW.bon_id) <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'ligne_libre : un bon émis est figé'); END;

CREATE TRIGGER ligne_libre_bon_fige_modif BEFORE UPDATE ON ligne_libre
WHEN (SELECT statut FROM bon_a_facturer WHERE id = OLD.bon_id) <> 'brouillon' OR NEW.bon_id <> OLD.bon_id
BEGIN SELECT RAISE(ABORT, 'ligne_libre : un bon émis est figé'); END;

CREATE TRIGGER ligne_libre_bon_fige_suppression BEFORE DELETE ON ligne_libre
WHEN (SELECT statut FROM bon_a_facturer WHERE id = OLD.bon_id) <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'ligne_libre : un bon émis est figé'); END;
