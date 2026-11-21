// Les phrases du dépassement d'accès (lot 13). Fonctions PURES : aucune base, aucune horloge (le jour est passé).
//
// Les accès facturables (associé, collaborateur) au-delà de ceux que le contrat inclut sont facturés au prix `prix_acces_sup`, À LA
// PROCHAINE DATE ANNIVERSAIRE : un accès ajouté en cours de période est actif tout de suite et offert jusqu'à elle (le bon du lot 12 est
// calculé à l'avance, sur les accès de ce moment-là). C'est cette date, celle du contrat, que les phrases donnent.
//
// Le texte de la confirmation de création (retour de recette du 21/11/2026) fait d'abord apparaître le DÉPASSEMENT, puis son effet :
//   « Vous dépassez les 3 accès inclus dans votre contrat : 4 accès facturables. »
//   « Ce 4ᵉ accès est offert jusqu'au 14/03/2027, puis facturé 25 € HT par mois. »
// Les valeurs sont celles du CONTRAT. Un contrat mensuel paie ses accès au prix mensuel (tarif.ts, prixMensuel) : la phrase le dit.

import { dateCourte } from './format.ts';
import { periodeAu, prixMensuel, type Periodicite } from './tarif.ts';

export interface ContratDepassement {
  periodicite: Periodicite;
  debut_le: string | null;
  date_fin_essai: string | null;
  acces_inclus: number;
  prix_acces_sup: number;
}

/** « 25 € », « 29,50 € » : sans décimales quand le compte est rond. */
export const eurosCourts = (centimes: number): string =>
  centimes % 100 === 0 ? `${centimes / 100} €` : `${Math.floor(centimes / 100)},${String(centimes % 100).padStart(2, '0')} €`;

/** Le prix d'UN accès supplémentaire pour UN mois, tel que le bon le compte (tarif annuel, ou tarif mensuel majoré et arrondi). */
export const prixAccesParMois = (c: Pick<ContratDepassement, 'periodicite' | 'prix_acces_sup'>): number =>
  c.periodicite === 'mensuelle' ? prixMensuel(c.prix_acces_sup) : c.prix_acces_sup;

/**
 * La date jusqu'à laquelle un accès en plus est gratuit : la fin de la période en cours (la prochaine date anniversaire). Avant le
 * début du contrat, ce début. Un contrat en essai, sans début, n'a que la fin de son essai. Sans aucune date : null (on n'en invente pas).
 */
export function dateAnniversaire(c: Pick<ContratDepassement, 'periodicite' | 'debut_le' | 'date_fin_essai'>, jour: string): string | null {
  if (c.debut_le) return periodeAu(c.debut_le, c.periodicite, jour)?.fin ?? c.debut_le;
  return c.date_fin_essai;
}

/** La confirmation d'un dépassement : le constat d'abord, puis l'effet. Deux phrases, affichées ensemble dans un encadré. */
export interface PhraseDepassement {
  constat: string;
  effet: string;
}

/**
 * La phrase de la confirmation, affichée UNE SEULE FOIS, à la création de l'accès qui fait passer les accès facturables au-delà de
 * ceux que le contrat inclut. D'abord le constat (« Vous dépassez les 3 accès inclus dans votre contrat : 4 accès facturables. »), puis
 * l'effet (« Ce 4ᵉ accès est offert jusqu'au 14/03/2027, puis facturé 25 € HT par mois. »). `facturables` est le décompte APRÈS la
 * création (lecture, support et accès suspendus exclus). Null s'il n'y a pas de date de contrat à donner : jamais écrite sans sa date.
 */
export function phraseCreationAcces(c: ContratDepassement, facturables: number, jour: string): PhraseDepassement | null {
  const date = dateAnniversaire(c, jour);
  if (!date) return null;
  return {
    constat: `Vous dépassez les ${c.acces_inclus} accès inclus dans votre contrat : ${facturables} accès facturable${facturables > 1 ? 's' : ''}.`,
    effet: `Ce ${facturables}ᵉ accès est offert jusqu'au ${dateCourte(date)}, puis facturé ${eurosCourts(prixAccesParMois(c))} HT par mois.`,
  };
}

/**
 * La phrase de la page d'abonnement, SEULEMENT si les accès facturables dépassent les inclus. Elle donne le nombre, le prix et la date
 * à partir de laquelle ils comptent : le même chiffre que le bon. Null sinon.
 */
export function phraseDepassement(c: ContratDepassement, facturables: number, jour: string): string | null {
  const en_plus = facturables - c.acces_inclus;
  if (en_plus <= 0) return null;
  const date = dateAnniversaire(c, jour);
  return (
    `${en_plus} accès facturable${en_plus > 1 ? 's' : ''} ${en_plus > 1 ? 'dépassent' : 'dépasse'} les ${c.acces_inclus} inclus. ` +
    `Au-delà, chaque accès est facturé ${eurosCourts(prixAccesParMois(c))} HT par mois` +
    (date ? ` à partir du ${dateCourte(date)}.` : '.')
  );
}
