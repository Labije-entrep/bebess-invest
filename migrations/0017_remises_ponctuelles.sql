-- Facturation (21/11/2026) : les remises ponctuelles sur une ligne précise d'un bon de commande, et le crédit de prorata.
--
-- 1. `remise_ponctuelle` : une remise en euros (centimes entiers) sur UNE ligne (socle, pilotage, site, accès supplémentaire, installation).
--    Elle est distincte de la remise commerciale en pourcentage (contrat.remise_commerciale_taux), qui ne bouge pas.
--      - origine `manuelle` : posée par l'éditeur sur l'écran d'un bon BROUILLON ; motif obligatoire ; toujours rattachée à son bon.
--      - origine `acces` : crédit de prorata d'un accès facturable supprimé ou suspendu en cours de période d'un contrat annuel. Ce n'est PAS
--        un document comptable numéroté (il n'y a pas d'avoir dans le produit) : une remise ponctuelle, appliquée au bon SUIVANT, sans
--        remboursement. `en_attente` tant qu'aucun bon ne la porte (bon_id NULL), `appliquee` quand un bon brouillon ou émis la porte,
--        `annulee` si l'accès est réactivé avant qu'un bon émis ne l'ait consommée. `applicable_des` : la date anniversaire à partir de
--        laquelle un bon peut la porter (début de période du bon >= cette date).
--      - origine `module` : réservée (aucun module ne se ferme avant sa date anniversaire aujourd'hui : voir modules.ts) ; admise par la table
--        pour ne pas la reconstruire le jour où une fermeture immédiate existera.
--    `acces_id` n'est PAS une clé étrangère : l'accès supprimé n'existe plus, le crédit lui survit. Il ne porte aucune donnée personnelle.
--    Les déclencheurs figent la remise avec son bon : dès que le bon n'est plus un brouillon, plus rien ne la touche.
-- 2. `bon_a_facturer.remise_ponctuelle_montant` : la somme des remises ponctuelles retenues sur le bon (déjà déduite de `total_ht`).
--    Ajout de colonne (pas de reconstruction) ; le déclencheur « bon émis figé » est recréé pour la couvrir.
CREATE TABLE remise_ponctuelle (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenant(id),
  contrat_id     TEXT NOT NULL REFERENCES contrat(id),
  bon_id         TEXT REFERENCES bon_a_facturer(id),
  code_ligne     TEXT NOT NULL CHECK (code_ligne IN ('socle','pilotage','site','acces_sup','installation')),
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

CREATE INDEX idx_remise_ponctuelle_bon ON remise_ponctuelle(bon_id);
CREATE INDEX idx_remise_ponctuelle_contrat ON remise_ponctuelle(tenant_id, contrat_id, etat);
-- Un accès n'a qu'UN crédit en attente à la fois : rejouer une suspension n'en duplique pas.
CREATE UNIQUE INDEX idx_remise_ponctuelle_acces_attente ON remise_ponctuelle(acces_id) WHERE origine = 'acces' AND etat = 'en_attente';

-- Le bon et sa remise sont de la même famille : le contrat de la remise est celui du bon.
CREATE TRIGGER remise_ponctuelle_coherente BEFORE INSERT ON remise_ponctuelle
WHEN NEW.bon_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM bon_a_facturer b WHERE b.id = NEW.bon_id AND b.contrat_id = NEW.contrat_id AND b.tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'remise_ponctuelle : le bon n''est pas celui de ce contrat'); END;

-- Plus rien ne touche une remise portée par un bon émis ou annulé : ni modification, ni suppression, ni nouvelle remise sur ce bon.
CREATE TRIGGER remise_ponctuelle_bon_fige_ajout BEFORE INSERT ON remise_ponctuelle
WHEN NEW.bon_id IS NOT NULL AND (SELECT statut FROM bon_a_facturer WHERE id = NEW.bon_id) <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'remise_ponctuelle : un bon émis est figé'); END;

CREATE TRIGGER remise_ponctuelle_bon_fige_modif BEFORE UPDATE ON remise_ponctuelle
WHEN OLD.bon_id IS NOT NULL AND (SELECT statut FROM bon_a_facturer WHERE id = OLD.bon_id) <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'remise_ponctuelle : un bon émis est figé'); END;

CREATE TRIGGER remise_ponctuelle_bon_fige_suppression BEFORE DELETE ON remise_ponctuelle
WHEN OLD.bon_id IS NOT NULL AND (SELECT statut FROM bon_a_facturer WHERE id = OLD.bon_id) <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'remise_ponctuelle : un bon émis est figé'); END;

ALTER TABLE bon_a_facturer ADD COLUMN remise_ponctuelle_montant INTEGER NOT NULL DEFAULT 0 CHECK (remise_ponctuelle_montant >= 0);

DROP TRIGGER bon_emis_fige;
CREATE TRIGGER bon_emis_fige BEFORE UPDATE OF periode_debut, periode_fin, acces_facturables, lignes, recurrent_ht, remise_taux, remise_montant, remise_motif, remise_ponctuelle_montant, tva_taux, total_ht, contrat_id, tenant_id, type ON bon_a_facturer
WHEN OLD.statut <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'bon_a_facturer : un bon émis est figé'); END;
