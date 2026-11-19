// Les phrases du dépassement d'accès (lot 13). Fonctions PURES : aucune base, aucune horloge (le jour est passé).
//
// Les accès facturables (associé, collaborateur) au-delà de ceux que le contrat inclut sont facturés au prix `prix_acces_sup`, À LA
// PROCHAINE DATE ANNIVERSAIRE : un accès ajouté en cours de période est actif tout de suite et gratuit jusqu'à elle (le bon du lot 12 est
// calculé à l'avance, sur les accès de ce moment-là). C'est cette date, celle du contrat, que les phrases donnent.
//
// Le texte de la confirmation de création est celui du cahier des charges, mot pour mot, avec les valeurs du CONTRAT à la place des
// chiffres : un contrat à 25 € HT par mois et trois accès inclus donne exactement
//   « Cet accès est actif immédiatement et gratuit jusqu'au 14/03/2027. À partir de cette date, les accès au-delà du troisième sont
//     facturés 25 € HT par mois. »
// Un contrat mensuel paie ses accès au prix mensuel (tarif.ts, prixMensuel) : la phrase le dit.

import { dateCourte } from './format.ts';
import { periodeAu, prixMensuel, type Periodicite } from './tarif.ts';

export interface ContratDepassement {
  periodicite: Periodicite;
  debut_le: string | null;
  date_fin_essai: string | null;
  acces_inclus: number;
  prix_acces_sup: number;
}

const ORDINAUX = ['', 'premier', 'deuxième', 'troisième', 'quatrième', 'cinquième', 'sixième', 'septième', 'huitième', 'neuvième', 'dixième'];

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

/** « au-delà du troisième » ; « au-delà des 12 inclus » au-delà de dix. */
const auDela = (inclus: number): string => (inclus >= 1 && inclus < ORDINAUX.length ? `au-delà du ${ORDINAUX[inclus]}` : `au-delà des ${inclus} inclus`);

/**
 * La phrase de la confirmation, affichée UNE SEULE FOIS, à la création de l'accès qui fait passer les accès facturables au-delà de
 * ceux que le contrat inclut. Null s'il n'y a pas de date de contrat à donner : la phrase n'est jamais écrite sans sa date.
 */
export function phraseCreationAcces(c: ContratDepassement, jour: string): string | null {
  const date = dateAnniversaire(c, jour);
  if (!date) return null;
  return (
    `Cet accès est actif immédiatement et gratuit jusqu'au ${dateCourte(date)}. ` +
    `À partir de cette date, les accès ${auDela(c.acces_inclus)} sont facturés ${eurosCourts(prixAccesParMois(c))} HT par mois.`
  );
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
