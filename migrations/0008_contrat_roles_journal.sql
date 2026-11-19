-- Lot 11 : rôles, adresses uniques PAR CABINET, dossier client, contrat, journal.
--
-- Cette migration reconstruit `utilisateur` : SQLite ne sait ni retirer un UNIQUE ni changer un CHECK en place. Les clés
-- étrangères des autres tables (session, jeton_connexion, fiche, mouvement, document, consultation, contact, portefeuille,
-- import_csv, suspension) désignent `utilisateur` par son NOM : elles retrouvent la table reconstruite sans y toucher.
-- `defer_foreign_keys` repousse leur contrôle à la fin de la transaction, après la recopie des lignes.
PRAGMA defer_foreign_keys = on;

-- ---------------------------------------------------------------------------
-- 1. utilisateur : six rôles, UNIQUE(tenant_id, email), dossier client.
--
--    Rôles : editeur ; associe, collaborateur, lecture (le personnel du cabinet) ; support_editeur (le compte de support de
--    l'éditeur, présent dans chaque cabinet, jamais compté ni affiché dans la liste des accès) ; viewer (le client final).
--    L'ancien `gestionnaire` devient `associe` : il avait les réglages, il garde les droits qu'il avait.
--
--    statut / publie_le : le dossier client. Ils ne veulent rien dire hors d'un viewer. Un viewer déjà ouvert avant cette
--    migration a déjà reçu son lien : il passe `publie`, daté de sa création faute de connaître la date d'envoi du lien.
--    Un dossier compte pour UN, quel que soit le nombre de ses portefeuilles : ce sont les entités du dossier.
-- ---------------------------------------------------------------------------
-- Ordre imposé par les clés étrangères : copie, DROP, nouvelle table du même nom, recopie. C'est la recopie DANS la table
-- recréée qui solde les violations différées ; renommer une table « neuve » vers `utilisateur` ne les solderait pas et la
-- transaction échouerait à son terme.
CREATE TABLE utilisateur_copie AS SELECT * FROM utilisateur;

DROP TABLE utilisateur;

CREATE TABLE utilisateur (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  email     TEXT NOT NULL,
  nom       TEXT NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('editeur','associe','collaborateur','lecture','support_editeur','viewer')),
  actif     INTEGER NOT NULL DEFAULT 1,
  cree_le   TEXT NOT NULL,
  statut    TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','publie','archive')),
  publie_le TEXT,
  UNIQUE (tenant_id, email)
);

INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le, statut, publie_le)
SELECT id, tenant_id, email, nom,
       CASE role WHEN 'gestionnaire' THEN 'associe' ELSE role END,
       actif, cree_le,
       CASE WHEN role = 'viewer' THEN 'publie' ELSE 'brouillon' END,
       CASE WHEN role = 'viewer' THEN cree_le END
  FROM utilisateur_copie;

DROP TABLE utilisateur_copie;

CREATE INDEX idx_utilisateur_tenant_role ON utilisateur(tenant_id, role, actif);

-- ---------------------------------------------------------------------------
-- 2. Le journal : une ligne par événement, écrite une fois, jamais modifiée ni effacée.
--    Aucune clé étrangère vers utilisateur : un accès supprimé doit laisser sa trace lisible (son adresse et son rôle sont
--    dans `detail`, pas seulement son identifiant), et la suppression ne doit ni échouer ni effacer l'événement.
--    Les événements d'un dossier client ne portent que des identifiants, jamais un nom ni une adresse de client final.
--    Les deux déclencheurs ci-dessous font respecter « écriture seule » dans la base elle-même, pas seulement dans le code.
-- ---------------------------------------------------------------------------
CREATE TABLE evenement (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenant(id),
  cree_le     TEXT NOT NULL,           -- ISO 8601, UTC
  type        TEXT NOT NULL,           -- code fixe, voir src/lib/journal.ts
  acteur_id   TEXT,                    -- NULL : le système
  acteur_role TEXT,
  cible_type  TEXT,                    -- acces, dossier, contrat, cabinet
  cible_id    TEXT,
  detail      TEXT NOT NULL DEFAULT '{}'  -- JSON : l'avant et l'après, jamais un secret
);
CREATE INDEX idx_evenement_tenant ON evenement(tenant_id, cree_le);
CREATE INDEX idx_evenement_type ON evenement(type, cree_le);

CREATE TRIGGER evenement_pas_de_modification BEFORE UPDATE ON evenement
BEGIN SELECT RAISE(ABORT, 'evenement : journal en écriture seule'); END;

CREATE TRIGGER evenement_pas_de_suppression BEFORE DELETE ON evenement
BEGIN SELECT RAISE(ABORT, 'evenement : journal en écriture seule'); END;

-- ---------------------------------------------------------------------------
-- 3. Le contrat. Un seul en cours par locataire (brouillon, essai ou actif) ; un contrat résilié reste en historique.
--    Montants en centimes entiers (hors taxes), taux en centièmes de point (2500 = 25 %), dates ISO 8601.
--    Les noms de colonnes sont ceux du lot 12 (prix_acces_sup, acces_inclus, remise_*_taux…).
--
--    Les prix sont recopiés ICI et lus ici : il n'existe pas de grille globale à laquelle le code se référerait.
--    Deux règles dures sont tenues par la base elle-même :
--      - le CHECK : une date de mise en production exige un DPA signé ;
--      - le déclencheur : aucun prix ne change tant que tarif_gele_jusqu_au est dans le futur.
-- ---------------------------------------------------------------------------
CREATE TABLE contrat (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  statut    TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','essai','actif','resilie')),
  periodicite TEXT NOT NULL CHECK (periodicite IN ('mensuelle','annuelle')),

  debut_le TEXT,
  fin_le   TEXT,
  date_mise_en_production TEXT,

  -- Les quatre prix unitaires, en centimes : le socle, le module Pilotage, le module Site vitrine, l'accès supplémentaire.
  prix_socle     INTEGER NOT NULL CHECK (prix_socle >= 0),
  prix_pilotage  INTEGER NOT NULL CHECK (prix_pilotage >= 0),
  prix_site      INTEGER NOT NULL CHECK (prix_site >= 0),
  prix_acces_sup INTEGER NOT NULL CHECK (prix_acces_sup >= 0),

  module_pilotage INTEGER NOT NULL DEFAULT 0 CHECK (module_pilotage IN (0, 1)),
  module_site     INTEGER NOT NULL DEFAULT 0 CHECK (module_site IN (0, 1)),
  acces_inclus    INTEGER NOT NULL CHECK (acces_inclus >= 0),
  frais_installation INTEGER NOT NULL DEFAULT 0 CHECK (frais_installation >= 0),
  tarif_gele_jusqu_au TEXT,

  -- Remises, en centièmes de point. La commerciale est saisie avec son motif et sa date de revue ; celle de parrainage est
  -- recalculée par le produit (lot 12).
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
CREATE UNIQUE INDEX idx_contrat_en_cours ON contrat(tenant_id) WHERE statut IN ('brouillon','essai','actif');

-- date('now') est la date du jour en UTC, au même format que tarif_gele_jusqu_au : « dans le futur » = strictement après aujourd'hui.
CREATE TRIGGER contrat_tarif_gele BEFORE UPDATE OF prix_socle, prix_pilotage, prix_site, prix_acces_sup ON contrat
WHEN OLD.tarif_gele_jusqu_au IS NOT NULL AND OLD.tarif_gele_jusqu_au > date('now')
 AND (NEW.prix_socle IS NOT OLD.prix_socle OR NEW.prix_pilotage IS NOT OLD.prix_pilotage
   OR NEW.prix_site IS NOT OLD.prix_site OR NEW.prix_acces_sup IS NOT OLD.prix_acces_sup)
BEGIN SELECT RAISE(ABORT, 'contrat : tarif gelé'); END;
