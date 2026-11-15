-- Journal des imports CSV du gestionnaire : nom du fichier et nombre de lignes traitées.
CREATE TABLE import_csv (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  utilisateur_id TEXT NOT NULL REFERENCES utilisateur(id),
  nom_fichier TEXT NOT NULL,
  lignes INTEGER NOT NULL,
  cree_le TEXT NOT NULL
);
CREATE INDEX import_csv_tenant ON import_csv(tenant_id, cree_le);
