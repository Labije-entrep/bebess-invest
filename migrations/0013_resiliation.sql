-- Lot 17 : la sortie d'un contrat résilié. Une colonne de `contrat`, nullable, une date ISO 8601 (AAAA-MM-JJ).
--
-- resiliation_effet_le : la date d'effet de la résiliation, calculée UNE FOIS à l'enregistrement du préavis (`preavis_recu_le`, qui existe
--    depuis 0008) : la première date anniversaire située au moins 30 jours après la réception du préavis. Le contrat reste `actif`
--    jusqu'à cette date ; le traitement quotidien le passe alors en `resilie`, et c'est de cette date que court le calendrier de sortie
--    (J : accès coupés, J+23 : rappel, J+30 : suppression). Elle est stockée plutôt que recalculée : une décision datée ne doit pas
--    bouger si une autre date du contrat change plus tard. Elle s'efface avec le préavis tant qu'elle n'est pas atteinte, et reste sur
--    le contrat `resilie` comme point de départ du calendrier.

ALTER TABLE contrat ADD COLUMN resiliation_effet_le TEXT CHECK (resiliation_effet_le IS NULL OR resiliation_effet_le GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
