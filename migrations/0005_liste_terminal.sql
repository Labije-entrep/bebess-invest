-- Lot 05 : la valeur terminale d'une liste se déclare dans la table de référence, plus dans le code.
-- terminal = 1 : la valeur clôt l'objet (statut_sujet : le sujet n'est plus ouvert) ou le fait sortir du
-- parcours (etape : le contact n'avance plus). Une liste sans valeur terminale ne clôt rien.
ALTER TABLE liste_valeur ADD COLUMN terminal INTEGER NOT NULL DEFAULT 0;

-- Cabinets déjà créés : leurs listes sont celles de listes-defaut.ts, on y marque les deux valeurs qui
-- étaient jusque-là supposées par le code. Les cabinets créés ensuite reçoivent le drapeau à la création.
UPDATE liste_valeur SET terminal = 1
 WHERE (liste = 'statut_sujet' AND cle = 'fait') OR (liste = 'etape' AND cle = 'perdu');
