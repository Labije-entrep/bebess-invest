// Les phrases du dépassement d'accès (lot 13, refondues le 21/11/2026). Fonctions PURES : aucune base, aucune horloge (le jour est passé).
//
// Les accès facturables (associé, collaborateur) au-delà de ceux que le contrat inclut sont facturés au prix `prix_acces_sup`. Depuis le retour
// de recette du 21/11/2026, un accès ajouté en cours de période d'un contrat ANNUEL est facturé TOUT DE SUITE, au prorata des mois entiers
// restants jusqu'à la date anniversaire (arrondis au supérieur, comme un module) : un bon complémentaire, que le traitement quotidien pose le
// lendemain (facturation.ts). Plus d'accès « offert jusqu'à l'anniversaire ». Contrat mensuel : l'accès entre dans le bon du mois suivant.
//
// Le texte de la confirmation de création fait d'abord apparaître le DÉPASSEMENT, puis son effet :
//   « Vous dépassez les 3 accès inclus dans votre contrat : 4 accès facturables. »
//   « Ce 4ᵉ accès est facturé 25 € HT par mois à compter d'aujourd'hui : 100 € HT jusqu'au 14/03/2027. »
// Les valeurs sont celles du CONTRAT. Un contrat mensuel paie ses accès au prix mensuel (tarif.ts, prixMensuel) : la phrase le dit.

import { dateCourte } from './format.ts';
import { moisArrondisAuSuperieur, periodeAu, prixMensuel, type Periodicite } from './tarif.ts';

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
 * La date qui clôt la période en cours : la prochaine date anniversaire (celle où le prorata d'un accès ajouté s'arrête). Avant le
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

export interface SituationBonPeriode {
  /** Le bon périodique de la période en cours existe et n'est PAS émis, ou n'est pas encore posé : il suit le contrat et compte déjà cet accès. */
  suit_le_contrat?: boolean;
}

/**
 * La phrase de la confirmation, affichée UNE SEULE FOIS, à la création de l'accès qui fait passer les accès facturables au-delà de
 * ceux que le contrat inclut. D'abord le constat (« Vous dépassez les 3 accès inclus dans votre contrat : 4 accès facturables. »), puis
 * l'effet, qui dit ce que l'accès coûte et à partir de quand :
 *   - contrat annuel en cours : « Ce 4ᵉ accès est facturé 25 € HT par mois à compter d'aujourd'hui : 100 € HT jusqu'au 14/03/2027. » (mois
 *     entiers restants arrondis au supérieur, prix du contrat, avant remise) ;
 *   - … mais si le bon de la période n'est pas encore émis, il compte l'accès lui-même : on le dit, sans second montant ;
 *   - contrat mensuel : « … à partir du prochain bon. » ; contrat pas encore en service (essai, début futur) : à partir du début du service.
 * `facturables` est le décompte APRÈS la création (lecture, support et accès suspendus exclus). Null s'il n'y a pas de date de contrat à
 * donner : jamais écrite sans sa date.
 */
export function phraseCreationAcces(c: ContratDepassement, facturables: number, jour: string, situation: SituationBonPeriode = {}): PhraseDepassement | null {
  const date = dateAnniversaire(c, jour);
  if (!date) return null;
  const prix = `${eurosCourts(prixAccesParMois(c))} HT par mois`;
  const rang = `Ce ${facturables}ᵉ accès est facturé ${prix}`;
  let effet: string;
  if (c.periodicite === 'mensuelle') effet = `${rang} à partir du prochain bon.`;
  else if (!c.debut_le || !periodeAu(c.debut_le, c.periodicite, jour)) effet = `${rang} à partir du ${dateCourte(date)}, début du service.`;
  else if (situation.suit_le_contrat) effet = `${rang} : il entre dans le bon de la période en cours, qui n'est pas encore émis.`;
  else {
    const mois = moisArrondisAuSuperieur(jour, date);
    effet = `${rang} à compter d'aujourd'hui : ${eurosCourts(c.prix_acces_sup * mois)} HT jusqu'au ${dateCourte(date)}.`;
  }
  return {
    constat: `Vous dépassez les ${c.acces_inclus} accès inclus dans votre contrat : ${facturables} accès facturable${facturables > 1 ? 's' : ''}.`,
    effet,
  };
}

/**
 * La phrase de la page d'abonnement, SEULEMENT si les accès facturables dépassent les inclus. Elle donne le nombre, le prix et la règle
 * (au prorata dès l'ajout, jusqu'à la date anniversaire) : le même chiffre que le bon. Null sinon.
 */
export function phraseDepassement(c: ContratDepassement, facturables: number, jour: string): string | null {
  const en_plus = facturables - c.acces_inclus;
  if (en_plus <= 0) return null;
  const date = dateAnniversaire(c, jour);
  return (
    `${en_plus} accès facturable${en_plus > 1 ? 's' : ''} ${en_plus > 1 ? 'dépassent' : 'dépasse'} les ${c.acces_inclus} inclus. ` +
    `Au-delà, chaque accès est facturé ${eurosCourts(prixAccesParMois(c))} HT par mois` +
    (c.periodicite === 'mensuelle' ? ', à partir du prochain bon.' : date ? `, dès son ajout, au prorata jusqu'au ${dateCourte(date)}.` : '.')
  );
}
