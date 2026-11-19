-- Lot 12 : parrainage, bons à facturer, avoirs, et le registre des envois du traitement quotidien.
-- Montants en centimes entiers (hors taxes), taux en centièmes de point, dates ISO 8601.

-- ---------------------------------------------------------------------------
-- 1. Parrainage. `tenant_id` est le PARRAIN, `filleul_tenant_id` le cabinet parrainé (un cabinet n'est parrainé qu'une fois).
--    en_attente → valide : par le traitement quotidien, quand le filleul a six mois de service payant. Un parrainage validé
--    vaut 25 % de remise au parrain (tarif.ts), 50 % au plus. La remise ne se SAISIT pas : elle se déduit de ces lignes.
-- ---------------------------------------------------------------------------
CREATE TABLE parrainage (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenant(id),
  filleul_tenant_id TEXT NOT NULL UNIQUE REFERENCES tenant(id),
  statut            TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','valide','annule')),
  cree_le           TEXT NOT NULL,
  valide_le         TEXT,
  CHECK (tenant_id <> filleul_tenant_id)
);
CREATE INDEX idx_parrainage_parrain ON parrainage(tenant_id, statut);

-- ---------------------------------------------------------------------------
-- 2. Le bon à facturer. Sa clé d'unicité (contrat_id, periode_debut) rend le traitement quotidien rejouable : le même jour
--    rejoué dix fois n'en crée qu'un. Un bon COMPLÉMENTAIRE (module activé en cours de période) a pour début le jour de
--    l'activation.
--
--    brouillon → emise → annulee, ou brouillon → annulee. Le numéro FACT-AAAA-NNNN est attribué par le produit, dans la
--    transaction qui fait passer le bon à `emise` (facturation.ts), jamais avant, jamais à la main : la base refuse un brouillon
--    qui porte un numéro et un bon émis qui n'en porte pas. La séquence est celle de l'année, sans trou : elle se lit au moment
--    de l'attribution (MAX + 1) dans la MÊME instruction que l'écriture du numéro, et un index unique fait échouer toute
--    collision plutôt que de la laisser passer. Un bon émis garde son numéro à jamais, même annulé : le numéro ne change pas,
--    le bon ne s'efface pas et ses montants ne bougent plus.
-- ---------------------------------------------------------------------------
CREATE TABLE bon_a_facturer (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenant(id),
  contrat_id    TEXT NOT NULL REFERENCES contrat(id),
  type          TEXT NOT NULL DEFAULT 'periode' CHECK (type IN ('periode','complementaire')),
  periode_debut TEXT NOT NULL,
  periode_fin   TEXT NOT NULL,
  statut        TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','emise','annulee')),

  -- Le calcul (tarif.ts), figé au moment de l'émission : les lignes en JSON, les totaux en colonnes.
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

  UNIQUE (contrat_id, periode_debut),
  CHECK (periode_fin > periode_debut),
  CHECK (statut <> 'brouillon' OR (numero IS NULL AND seq IS NULL AND emis_le IS NULL)),
  CHECK (statut <> 'emise' OR (numero IS NOT NULL AND seq IS NOT NULL AND annee IS NOT NULL AND emis_le IS NOT NULL)),
  CHECK (numero IS NULL OR numero GLOB 'FACT-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]*')
);
CREATE INDEX idx_bon_tenant ON bon_a_facturer(tenant_id, periode_debut);
CREATE UNIQUE INDEX idx_bon_sequence ON bon_a_facturer(annee, seq) WHERE seq IS NOT NULL;
CREATE UNIQUE INDEX idx_bon_numero ON bon_a_facturer(numero) WHERE numero IS NOT NULL;

CREATE TRIGGER bon_pas_de_suppression BEFORE DELETE ON bon_a_facturer
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : un bon ne s''efface pas'); END;

CREATE TRIGGER bon_numero_definitif BEFORE UPDATE OF numero, annee, seq, emis_le ON bon_a_facturer
WHEN OLD.numero IS NOT NULL
 AND (NEW.numero IS NOT OLD.numero OR NEW.annee IS NOT OLD.annee OR NEW.seq IS NOT OLD.seq OR NEW.emis_le IS NOT OLD.emis_le)
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : le numéro d''un bon émis ne change pas'); END;

-- Un bon émis ne se recalcule plus : seul un brouillon suit le contrat.
CREATE TRIGGER bon_emis_fige BEFORE UPDATE OF periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, total_ht, contrat_id, tenant_id, type ON bon_a_facturer
WHEN OLD.statut <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : un bon émis est figé'); END;

CREATE TRIGGER bon_statut_sens BEFORE UPDATE OF statut ON bon_a_facturer
WHEN NEW.statut <> OLD.statut AND NOT (OLD.statut = 'brouillon' AND NEW.statut IN ('emise','annulee') OR OLD.statut = 'emise' AND NEW.statut = 'annulee')
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : transition de statut interdite'); END;

-- ---------------------------------------------------------------------------
-- 3. L'avoir : l'annulation d'un bon ÉMIS. Il a sa propre séquence (AVOIR-AAAA-NNNN), attribuée comme celle des factures.
-- ---------------------------------------------------------------------------
CREATE TABLE avoir (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenant(id),
  bon_id     TEXT NOT NULL UNIQUE REFERENCES bon_a_facturer(id),
  numero     TEXT NOT NULL UNIQUE CHECK (numero GLOB 'AVOIR-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]*'),
  annee      INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  montant_ht INTEGER NOT NULL CHECK (montant_ht >= 0),
  emis_le    TEXT NOT NULL,
  UNIQUE (annee, seq)
);

CREATE TRIGGER avoir_pas_de_modification BEFORE UPDATE ON avoir
BEGIN SELECT RAISE(ABORT, 'avoir : un avoir ne se modifie pas'); END;
CREATE TRIGGER avoir_pas_de_suppression BEFORE DELETE ON avoir
BEGIN SELECT RAISE(ABORT, 'avoir : un avoir ne s''efface pas'); END;

-- ---------------------------------------------------------------------------
-- 4. Le registre des envois du traitement quotidien : ce qui rend « rejouable dix fois » vrai pour les courriels.
--    La clé est RÉSERVÉE avant l'envoi (une seule ligne par clé : la clé primaire), l'envoi se fait ensuite, et `envoye_le` se
--    pose après. Un échec constaté libère la clé (l'envoi se retentera à la passe suivante) ; rien ne repart jamais deux fois.
--    Clés : essai:<contrat>:J38:<utilisateur>, revue:<contrat>:<date>, purge:<contrat>…
-- ---------------------------------------------------------------------------
CREATE TABLE envoi_automatique (
  cle        TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenant(id),
  reserve_le TEXT NOT NULL,
  envoye_le  TEXT
);
