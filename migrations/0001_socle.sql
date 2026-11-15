-- migrations/0001_socle.sql

CREATE TABLE tenant (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, domaine TEXT UNIQUE, cree_le TEXT NOT NULL);

CREATE TABLE utilisateur (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  email TEXT NOT NULL UNIQUE, nom TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editeur','gestionnaire','viewer')),
  actif INTEGER NOT NULL DEFAULT 1, cree_le TEXT NOT NULL);

CREATE TABLE session (
  id TEXT PRIMARY KEY, utilisateur_id TEXT NOT NULL REFERENCES utilisateur(id),
  expire_le TEXT NOT NULL, cree_le TEXT NOT NULL);

CREATE TABLE jeton_connexion (
  hash TEXT PRIMARY KEY, utilisateur_id TEXT NOT NULL REFERENCES utilisateur(id),
  expire_le TEXT NOT NULL, utilise_le TEXT);

-- Fiche du viewer : ce que le gestionnaire saisit une fois
CREATE TABLE fiche (
  utilisateur_id TEXT PRIMARY KEY REFERENCES utilisateur(id),
  mandat_ref TEXT, profil_risque TEXT, profil_note INTEGER, horizon TEXT,
  perte_max_cents INTEGER, liquidite_cents INTEGER, regle_reequilibrage TEXT,
  allocation_signee_le TEXT, allocation_motif TEXT, prochain_point TEXT);

-- Une enveloppe = un contrat ou un compte
CREATE TABLE enveloppe (
  id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES utilisateur(id),
  libelle TEXT NOT NULL, etablissement TEXT, ouverte_en TEXT,
  valorisation_cents INTEGER NOT NULL DEFAULT 0, perf_bp INTEGER,
  arrete_le TEXT NOT NULL, rang INTEGER NOT NULL DEFAULT 0);

CREATE TABLE ligne (
  id TEXT PRIMARY KEY, enveloppe_id TEXT NOT NULL REFERENCES enveloppe(id),
  libelle TEXT NOT NULL, classe TEXT NOT NULL,
  valorisation_cents INTEGER NOT NULL DEFAULT 0, pv_cents INTEGER,
  frais_bp INTEGER, arrete_le TEXT NOT NULL, rang INTEGER NOT NULL DEFAULT 0);

-- Allocation cible, pour l'ecart affiche sur le tableau de bord
CREATE TABLE cible (
  id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES utilisateur(id),
  classe TEXT NOT NULL, cible_bp INTEGER NOT NULL, rang INTEGER NOT NULL DEFAULT 0);

-- Un point par mois : valeur du portefeuille et cumul des versements
CREATE TABLE point (
  id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES utilisateur(id),
  date TEXT NOT NULL, valeur_cents INTEGER NOT NULL,
  versements_cumules_cents INTEGER NOT NULL,
  UNIQUE (viewer_id, date));

CREATE TABLE mouvement (
  id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES utilisateur(id),
  date TEXT NOT NULL, libelle TEXT NOT NULL, enveloppe TEXT,
  montant_cents INTEGER, statut TEXT NOT NULL,
  en_cours INTEGER NOT NULL DEFAULT 0, etape INTEGER NOT NULL DEFAULT 0,
  detail TEXT);

CREATE TABLE document (
  id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES utilisateur(id),
  titre TEXT NOT NULL, categorie TEXT NOT NULL, date TEXT NOT NULL,
  cle_fichier TEXT, envoye_le TEXT);

-- Journal de consultation : la preuve, horodatee, jamais purgee avant 7 ans
CREATE TABLE consultation (
  id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES utilisateur(id),
  vue_le TEXT NOT NULL, page TEXT NOT NULL);

-- Contenu editorial du site public, alimente par le gestionnaire
CREATE TABLE page_contenu (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  cle TEXT NOT NULL, langue TEXT NOT NULL DEFAULT 'fr',
  titre TEXT, contenu_json TEXT NOT NULL, maj_le TEXT NOT NULL,
  UNIQUE (tenant_id, cle, langue));

CREATE TABLE note_marche (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  slug TEXT NOT NULL, langue TEXT NOT NULL DEFAULT 'fr',
  titre TEXT NOT NULL, chapeau TEXT, corps_md TEXT NOT NULL,
  date TEXT NOT NULL, publiee INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, slug, langue));

CREATE INDEX idx_enveloppe_viewer ON enveloppe(viewer_id);
CREATE INDEX idx_ligne_enveloppe ON ligne(enveloppe_id);
CREATE INDEX idx_point_viewer ON point(viewer_id, date);
CREATE INDEX idx_mouvement_viewer ON mouvement(viewer_id, date);
CREATE INDEX idx_consultation_viewer ON consultation(viewer_id, vue_le);
CREATE INDEX idx_session_user ON session(utilisateur_id);
