-- Lot 01c : un portefeuille se range sans se détruire. 1 = archivé.
ALTER TABLE portefeuille ADD COLUMN archive INTEGER NOT NULL DEFAULT 0;
