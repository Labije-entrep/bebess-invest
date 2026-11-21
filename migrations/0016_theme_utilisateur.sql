-- Retours de recette (21/11/2026) : le client final choisit son thème.
--
-- `utilisateur.theme` : le NOM d'un thème de la liste fermée de src/lib/themes.ts (maison, nuit, foret, pierre, clair), jamais une valeur de
-- couleur. NULL : le client n'a rien choisi, l'espace suit le thème de son cabinet (le réglage `theme`). Le nom est validé par le code à
-- l'écriture et à la lecture : un nom inconnu en base retombe sur le thème du cabinet. Pas de CHECK : la liste est celle du code, et une
-- contrainte figée en base obligerait une migration à chaque thème ajouté.
ALTER TABLE utilisateur ADD COLUMN theme TEXT;
