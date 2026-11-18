-- migrations/0003_suivi.sql
-- À reprendre tel quel. Ne l'adapte pas, ne le complète pas : si quelque chose
-- te paraît manquer, arrête-toi et demande.

-- Listes paramétrables. liste ∈ type_contact, metier, etape, type_echange,
-- statut_sujet, categorie_doc, classe_actif, statut_mouvement, type_portefeuille
CREATE TABLE liste_valeur (
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  liste     TEXT NOT NULL,
  cle       TEXT NOT NULL,
  libelle   TEXT NOT NULL,
  ordre     INTEGER NOT NULL DEFAULT 0,
  actif     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, liste, cle)
);

CREATE TABLE membre (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  nom TEXT NOT NULL, initiale TEXT NOT NULL, couleur TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1, cree_le TEXT NOT NULL
);

-- cle ∈ theme, logo_cle, nom_affiche, orias, statut_reglementaire, association,
-- mediateur, seuil_sans_echange, seuil_relance, seuil_arrete, seuil_ecart_bp, symboles
CREATE TABLE reglage (
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  cle TEXT NOT NULL, valeur TEXT NOT NULL,
  PRIMARY KEY (tenant_id, cle)
);

CREATE TABLE domaine (
  hote TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  principal INTEGER NOT NULL DEFAULT 0, valide_le TEXT
);

-- Niveau portefeuille. enveloppe, point et cible sont recréées pour pointer ici
-- plutôt que vers le viewer : la base est vide, inutile de les altérer.
CREATE TABLE portefeuille (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  viewer_id TEXT NOT NULL REFERENCES utilisateur(id),
  libelle TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'personne',
  ordre INTEGER NOT NULL DEFAULT 0, cree_le TEXT NOT NULL
);

CREATE TABLE contact (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  nom TEXT NOT NULL, prenom TEXT, email TEXT, tel TEXT,
  metier TEXT, structure TEXT,
  responsable_id TEXT REFERENCES membre(id), binome_id TEXT REFERENCES membre(id),
  etape TEXT, convention INTEGER NOT NULL DEFAULT 0, convention_le TEXT,
  apporteur_id TEXT REFERENCES contact(id),
  relance TEXT, dernier_echange TEXT, type_echange TEXT,
  avoirs_cents INTEGER, avoirs_le TEXT,
  notes TEXT, logo_cle TEXT,
  viewer_id TEXT UNIQUE REFERENCES utilisateur(id),
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL, maj_le TEXT NOT NULL,
  CHECK (apporteur_id IS NULL OR apporteur_id <> id)
);

CREATE TABLE contact_type (
  tenant_id TEXT NOT NULL, contact_id TEXT NOT NULL REFERENCES contact(id),
  type TEXT NOT NULL, PRIMARY KEY (contact_id, type)
);

CREATE TABLE sujet (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  contact_id TEXT NOT NULL REFERENCES contact(id),
  texte TEXT NOT NULL, statut TEXT NOT NULL, echeance TEXT,
  origine TEXT, cree_le TEXT NOT NULL, fait_le TEXT,
  archive INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE echange (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  contact_id TEXT NOT NULL REFERENCES contact(id),
  date TEXT NOT NULL, type TEXT NOT NULL, note TEXT, cree_le TEXT NOT NULL
);

CREATE TABLE actu (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  date TEXT NOT NULL, titre TEXT NOT NULL, resume TEXT, a_dire TEXT,
  chiffres_json TEXT, faits_json TEXT, mots_cles TEXT, source TEXT, brut TEXT,
  note_marche_id TEXT REFERENCES note_marche(id),
  cree_le TEXT NOT NULL,
  UNIQUE (tenant_id, date)
);

CREATE TABLE document_interne (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant(id),
  titre TEXT NOT NULL, url TEXT, categorie TEXT NOT NULL, type TEXT,
  resume TEXT, ajoute_le TEXT NOT NULL
);

-- Global : les cours ne dépendent d'aucun cabinet. Les rendre propres à chaque
-- locataire multiplierait les appels à l'API par le nombre de cabinets.
CREATE TABLE cours (
  symbole TEXT NOT NULL, date TEXT NOT NULL,
  valeur TEXT NOT NULL, variation_bp INTEGER, sens TEXT,
  recupere_le TEXT NOT NULL, PRIMARY KEY (symbole, date)
);

CREATE TABLE version_locataire (
  tenant_id TEXT PRIMARY KEY REFERENCES tenant(id),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE incident (
  id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenant(id),
  quoi TEXT NOT NULL, detail TEXT, cree_le TEXT NOT NULL
);

CREATE INDEX idx_contact_tenant ON contact(tenant_id, archive, nom);
CREATE INDEX idx_contact_viewer ON contact(viewer_id);
CREATE INDEX idx_sujet_contact ON sujet(contact_id, statut);
CREATE INDEX idx_sujet_tenant ON sujet(tenant_id, statut, echeance);
CREATE INDEX idx_echange_contact ON echange(contact_id, date);
CREATE INDEX idx_portefeuille_viewer ON portefeuille(viewer_id, ordre);
CREATE INDEX idx_actu_tenant ON actu(tenant_id, date);
CREATE INDEX idx_incident_tenant ON incident(tenant_id, cree_le);
