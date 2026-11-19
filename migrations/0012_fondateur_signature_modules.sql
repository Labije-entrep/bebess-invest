-- Lot 15 : le statut fondateur devient une donnée, la date de signature existe enfin, la désactivation d'un module prend effet
-- à une date. Quatre colonnes de `contrat`, toutes nullables, toutes des dates ISO 8601 (AAAA-MM-JJ).
--
-- 1. fondateur_le : le jour où le statut fondateur a été posé. Le statut se lit sur cette colonne ; `compterFondateurs` en fait un
--    COUNT. Le motif « Cabinet fondateur — co-conception et référence » n'est plus qu'un libellé d'affichage : il ne marque plus rien,
--    et `remise_motif` redevient le motif d'une remise commerciale, rien d'autre.
-- 2. date_signature : la date de signature du contrat. Le gel d'un fondateur se calcule à signature + 24 mois.
-- 3. module_pilotage_fin_le, module_site_fin_le : la date d'effet d'une désactivation. Tant qu'elle est devant nous, le drapeau
--    `module_*` reste à 1 ; le traitement quotidien le bascule à cette date. Aucune donnée n'est supprimée : un module repris plus
--    tard retrouve tout.

ALTER TABLE contrat ADD COLUMN fondateur_le TEXT CHECK (fondateur_le IS NULL OR fondateur_le GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE contrat ADD COLUMN date_signature TEXT CHECK (date_signature IS NULL OR date_signature GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE contrat ADD COLUMN module_pilotage_fin_le TEXT CHECK (module_pilotage_fin_le IS NULL OR module_pilotage_fin_le GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE contrat ADD COLUMN module_site_fin_le TEXT CHECK (module_site_fin_le IS NULL OR module_site_fin_le GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

-- Reprise des cabinets déjà marqués fondateurs par le lot 14 : le jour et la date de signature se relisent dans le journal (l'événement
-- `statut_fondateur` porte `signe_le`), à défaut le jour de la dernière modification du contrat. Le motif, qui ne servait que de marque,
-- est vidé : il n'a jamais désigné une remise (aucun pourcentage n'était posé).
UPDATE contrat
   SET fondateur_le = COALESCE(
         (SELECT substr(e.cree_le, 1, 10) FROM evenement e
           WHERE e.cible_type = 'contrat' AND e.cible_id = contrat.id AND e.type = 'statut_fondateur' ORDER BY e.cree_le DESC LIMIT 1),
         substr(maj_le, 1, 10)),
       date_signature = (SELECT json_extract(e.detail, '$.signe_le') FROM evenement e
           WHERE e.cible_type = 'contrat' AND e.cible_id = contrat.id AND e.type = 'statut_fondateur' ORDER BY e.cree_le DESC LIMIT 1),
       remise_motif = NULL
 WHERE remise_motif = 'Cabinet fondateur — co-conception et référence';
