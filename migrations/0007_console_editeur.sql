-- Lot 10 : la console de l'éditeur.

-- 1. Suspension d'un cabinet. Une ligne par suspension : le motif est obligatoire et la date est écrite avec lui.
--    Une suspension en cours est une ligne dont fin_le est NULL (une seule par cabinet, garantie par l'index).
--    Elle rend inopérants les accès des GESTIONNAIRES du cabinet (connexion et sessions déjà ouvertes). Elle ne touche
--    jamais les viewers : leurs espaces restent en ligne et consultables. Rien n'est effacé ; lever la suspension
--    rétablit tout. Aucune suspension n'est posée par le code seul : seule la route de la console en écrit.
CREATE TABLE suspension (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  motif     TEXT NOT NULL CHECK (length(trim(motif)) > 0),
  debut_le  TEXT NOT NULL,
  par       TEXT NOT NULL REFERENCES utilisateur(id),
  fin_le    TEXT,
  fin_par   TEXT REFERENCES utilisateur(id)
);
CREATE UNIQUE INDEX idx_suspension_en_cours ON suspension(tenant_id) WHERE fin_le IS NULL;
CREATE INDEX idx_suspension_tenant ON suspension(tenant_id, debut_le);

-- 2. Domaines personnalisés (Cloudflare for SaaS). valide_le (lot 01) reste la seule vérité du routage : un nom d'hôte
--    n'ouvre un cabinet que s'il est validé. Les colonnes ci-dessous gardent ce que Cloudflare a répondu.
ALTER TABLE domaine ADD COLUMN cf_id TEXT;        -- identifiant du « custom hostname » chez Cloudflare
ALTER TABLE domaine ADD COLUMN statut TEXT;       -- dernier état connu : en_attente, actif, erreur
ALTER TABLE domaine ADD COLUMN detail TEXT;       -- message de Cloudflare ou de la console, tel quel
ALTER TABLE domaine ADD COLUMN declare_le TEXT;
ALTER TABLE domaine ADD COLUMN verifie_le TEXT;   -- dernière interrogation de Cloudflare

-- Les domaines déjà présents (seed, lot 01c) sont ceux que le Worker sert depuis l'origine : validés.
UPDATE domaine SET statut = 'actif' WHERE valide_le IS NOT NULL AND statut IS NULL;
