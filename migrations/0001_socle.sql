-- Socle de l'espace client family office.
-- Montants : centimes entiers. Pourcentages : centièmes de point (640 = 6,40 %).
-- Dates : ISO 8601 en texte.

CREATE TABLE tenants (
  id      INTEGER PRIMARY KEY,
  nom     TEXT NOT NULL,
  hote    TEXT NOT NULL UNIQUE,
  cree_le TEXT NOT NULL
);

CREATE TABLE utilisateurs (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  email     TEXT NOT NULL UNIQUE,
  nom       TEXT NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('editeur', 'gestionnaire', 'viewer')),
  actif     INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)),
  cree_le   TEXT NOT NULL
);
CREATE INDEX idx_utilisateurs_tenant ON utilisateurs(tenant_id);

CREATE TABLE viewers (
  id              INTEGER PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  utilisateur_id  INTEGER NOT NULL UNIQUE REFERENCES utilisateurs(id),
  gestionnaire_id INTEGER NOT NULL REFERENCES utilisateurs(id),
  nom_famille     TEXT NOT NULL,
  profil          TEXT NOT NULL,
  horizon_le      TEXT NOT NULL,
  entree_le       TEXT NOT NULL
);
CREATE INDEX idx_viewers_tenant ON viewers(tenant_id);

CREATE TABLE enveloppes (
  id            INTEGER PRIMARY KEY,
  viewer_id     INTEGER NOT NULL REFERENCES viewers(id),
  nom           TEXT NOT NULL,
  type          TEXT NOT NULL,
  etablissement TEXT NOT NULL,
  ordre         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_enveloppes_viewer ON enveloppes(viewer_id);

CREATE TABLE lignes (
  id            INTEGER PRIMARY KEY,
  enveloppe_id  INTEGER NOT NULL REFERENCES enveloppes(id),
  libelle       TEXT NOT NULL,
  classe        TEXT NOT NULL CHECK (classe IN ('actions', 'obligations', 'immobilier', 'private_equity', 'liquidites')),
  valeur_cents  INTEGER NOT NULL,
  ordre         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lignes_enveloppe ON lignes(enveloppe_id);

CREATE TABLE cibles (
  id        INTEGER PRIMARY KEY,
  viewer_id INTEGER NOT NULL REFERENCES viewers(id),
  classe    TEXT NOT NULL CHECK (classe IN ('actions', 'obligations', 'immobilier', 'private_equity', 'liquidites')),
  cible_bp  INTEGER NOT NULL,
  ordre     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (viewer_id, classe)
);

CREATE TABLE points (
  id           INTEGER PRIMARY KEY,
  viewer_id    INTEGER NOT NULL REFERENCES viewers(id),
  mois         TEXT NOT NULL,
  valeur_cents INTEGER NOT NULL,
  UNIQUE (viewer_id, mois)
);

CREATE TABLE mouvements (
  id           INTEGER PRIMARY KEY,
  viewer_id    INTEGER NOT NULL REFERENCES viewers(id),
  enveloppe_id INTEGER REFERENCES enveloppes(id),
  date_le      TEXT NOT NULL,
  libelle      TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('apport', 'retrait', 'arbitrage')),
  montant_cents INTEGER NOT NULL,
  statut       TEXT NOT NULL CHECK (statut IN ('en_cours', 'execute'))
);
CREATE INDEX idx_mouvements_viewer ON mouvements(viewer_id);

CREATE TABLE documents (
  id        INTEGER PRIMARY KEY,
  viewer_id INTEGER NOT NULL REFERENCES viewers(id),
  titre     TEXT NOT NULL,
  categorie TEXT NOT NULL,
  date_le   TEXT NOT NULL,
  chemin    TEXT NOT NULL
);
CREATE INDEX idx_documents_viewer ON documents(viewer_id);

CREATE TABLE pages_contenu (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  slug      TEXT NOT NULL,
  titre     TEXT NOT NULL,
  corps     TEXT NOT NULL,
  maj_le    TEXT NOT NULL,
  UNIQUE (tenant_id, slug)
);

CREATE TABLE notes (
  id         INTEGER PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
  viewer_id  INTEGER REFERENCES viewers(id),
  titre      TEXT NOT NULL,
  corps      TEXT NOT NULL,
  statut     TEXT NOT NULL CHECK (statut IN ('brouillon', 'publiee')),
  publie_le  TEXT,
  auteur_id  INTEGER NOT NULL REFERENCES utilisateurs(id)
);
CREATE INDEX idx_notes_tenant ON notes(tenant_id);
