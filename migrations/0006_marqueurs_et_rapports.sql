-- Lot 09 : trois dettes.

-- 1. Marqueur de liste : un rôle que le code attend d'une valeur, déclaré dans la table de référence au lieu d'être
--    supposé par la clé. Le vocabulaire des marqueurs (parcours, client, en_cours, en_attente, clos, defaut) est fermé
--    et vit dans src/lib/marqueurs.ts ; le cabinet choisit sur quelle valeur de quelle liste ils se posent.
--    NULL = aucun rôle. Plusieurs valeurs d'une même liste peuvent porter des marqueurs différents ; l'unicité
--    d'un marqueur (sauf `clos`) est contrôlée à l'écriture, dans l'écran des listes.
ALTER TABLE liste_valeur ADD COLUMN marqueur TEXT;

-- Cabinets déjà créés : leurs listes sont celles de listes-defaut.ts, on y pose les marqueurs que le code
-- supposait jusque-là. Les cabinets créés ensuite les reçoivent à la création.
UPDATE liste_valeur SET marqueur = 'parcours'   WHERE liste = 'type_contact'      AND cle = 'prospect';
UPDATE liste_valeur SET marqueur = 'client'     WHERE liste = 'type_contact'      AND cle = 'client';
UPDATE liste_valeur SET marqueur = 'en_cours'   WHERE liste = 'statut_sujet'      AND cle = 'encours';
UPDATE liste_valeur SET marqueur = 'en_attente' WHERE liste = 'statut_sujet'      AND cle = 'attente';
UPDATE liste_valeur SET marqueur = 'clos'       WHERE liste = 'statut_mouvement'  AND cle IN ('execute', 'archive');
UPDATE liste_valeur SET marqueur = 'defaut'     WHERE liste = 'type_portefeuille' AND cle = 'personne';

-- 2. Un rapport peut viser un portefeuille. NULL = il vaut pour tout le dossier du viewer.
--    Un portefeuille archivé garde ses rapports, qui restent consultables.
ALTER TABLE document ADD COLUMN portefeuille_id TEXT REFERENCES portefeuille(id);
CREATE INDEX idx_document_portefeuille ON document(portefeuille_id);

-- 3. Couleur d'un membre : un jeton de la palette des graphiques (serie-1 à serie-5), plus une valeur libre.
--    Les hexadécimaux du seed et du lot 03 sont ceux de la palette : on les convertit. Toute autre valeur est
--    laissée telle quelle (l'écran des membres la remplace dès qu'on la modifie).
UPDATE membre SET couleur = 'serie-1' WHERE upper(couleur) = '#B9862B';
UPDATE membre SET couleur = 'serie-2' WHERE upper(couleur) = '#4E9BD6';
UPDATE membre SET couleur = 'serie-3' WHERE upper(couleur) = '#C9684E';
UPDATE membre SET couleur = 'serie-4' WHERE upper(couleur) = '#3FA98A';
UPDATE membre SET couleur = 'serie-5' WHERE upper(couleur) = '#9B7BD4';
