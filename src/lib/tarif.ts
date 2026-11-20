// Le calcul du prix (lot 12). Fonction PURE : aucune base, aucune horloge, aucune lecture d'environnement. Tout ce qu'elle sait
// lui est passé, et un même appel rend toujours le même résultat : c'est ce qui la rend rejouable et testable (tarif.test.ts).
//
// Montants en centimes entiers, hors taxes ; taux en centièmes de point (2500 = 25 %) ; dates ISO 8601 (AAAA-MM-JJ).
//
//   - Les quatre prix sont ceux du CONTRAT (contrat.ts, prixDuContrat) : ce fichier n'en détient aucun. Ils sont les prix
//     « annuels » exprimés au mois (79, 49, 39, 25 €).
//   - Contrat annuel : chaque ligne vaut son prix × 12.
//   - Contrat mensuel : chaque ligne vaut son prix × 1,15, ARRONDI À L'EURO, LIGNE PAR LIGNE (79 → 91, 49 → 56, 39 → 45,
//     25 → 29). Jamais un coefficient sur le total : socle + Pilotage au mois = 91 + 56 = 147 €.
//   - Remise = min(50 %, parrainage + commerciale), parrainage = min(50 %, 25 % × parrainages validés). Assiette : le
//     récurrent seul, jamais les frais d'installation.
//   - Un module activé en cours de période se facture au prorata, en MOIS ENTIERS arrondis au supérieur, de l'activation à la
//     date anniversaire, sur un bon complémentaire (annuel seulement : un contrat mensuel n'a pas de période à entamer).

import type { Role } from './db';
import { ACCES_FACTURABLES } from './roles.ts';

export type Periodicite = 'mensuelle' | 'annuelle';
export type CodeLigne = 'socle' | 'pilotage' | 'site' | 'acces_sup' | 'installation';

/** Le plafond de la remise, et celui de la remise de parrainage seule : 50 %. */
export const REMISE_MAX = 5000;
/** Un parrainage validé vaut 25 %. */
export const REMISE_PAR_PARRAINAGE = 2500;
/** Majoration du paiement mensuel, en centièmes : × 1,15. */
const MAJORATION_MENSUELLE = 115;

export interface Bareme {
  periodicite: Periodicite;
  prix_socle: number;
  prix_pilotage: number;
  prix_site: number;
  prix_acces_sup: number;
  acces_inclus: number;
  module_pilotage: number | boolean;
  module_site: number | boolean;
}

export interface EntreeBon extends Bareme {
  /** Voir `compterAccesFacturables`. */
  acces_facturables: number;
  /** Parrainages VALIDÉS du cabinet : le taux se déduit d'eux, il n'est pas saisi. */
  parrainages_valides: number;
  remise_commerciale_taux: number;
  /** Hors remise. Le bon périodique n'en porte jamais : la facture d'installation est à part. */
  frais_installation?: number;
}

export interface LigneBon {
  code: CodeLigne;
  quantite: number;
  /** Prix d'UN mois d'UNE unité : le prix du contrat, ou ce prix majoré et arrondi à l'euro pour un contrat mensuel. */
  prix_unitaire: number;
  /** 12 pour un contrat annuel, 1 pour un contrat mensuel. */
  mois: number;
  montant: number;
}

export interface Bon {
  lignes: LigneBon[];
  recurrent_ht: number;
  remise_taux: number;
  remise_montant: number;
  frais_installation_ht: number;
  total_ht: number;
}

// ---------------------------------------------------------------- les accès

/**
 * Les accès facturables : les associés et les collaborateurs ACTIFS. `lecture`, `support_editeur`, `editeur` et `viewer` ne sont
 * jamais comptés (la liste est celle de roles.ts, ACCES_FACTURABLES).
 */
export const compterAccesFacturables = (utilisateurs: { role: string; actif: number | boolean }[]): number =>
  utilisateurs.filter((u) => !!u.actif && ACCES_FACTURABLES.includes(u.role as Role)).length;

// ---------------------------------------------------------------- les prix

/** Prix d'un mois payé au mois : × 1,15 arrondi à l'EURO (le demi-euro monte), en centimes. 7900 → 9100. */
export const prixMensuel = (prixCentimes: number): number =>
  Math.floor((prixCentimes * MAJORATION_MENSUELLE + 5000) / 10000) * 100;

export const tauxParrainage = (parrainagesValides: number): number =>
  Math.min(REMISE_MAX, REMISE_PAR_PARRAINAGE * Math.max(0, Math.floor(parrainagesValides)));

export const tauxRemise = (parrainageTaux: number, commercialeTaux: number): number =>
  Math.min(REMISE_MAX, Math.max(0, parrainageTaux) + Math.max(0, commercialeTaux));

/** Montant × taux (centièmes de point), au centime, le demi-centime montant. */
const appliquer = (montant: number, taux: number): number => Math.floor((montant * taux + 5000) / 10000);

// ---------------------------------------------------------------- la TVA et le motif de la remise (lot 13)

/**
 * Le taux de TVA du bon, en centièmes de point : 20 %. Il est posé sur le bon à sa création (colonne `tva_taux`) et ne bouge plus une
 * fois le bon émis ; un changement de taux légal se fait ICI, et ne touche que les bons suivants.
 */
export const TVA_TAUX = 2000;

/** La TVA d'un total hors taxes, au centime (le demi-centime monte), et le total toutes taxes comprises. */
export const calculerTva = (total_ht: number, taux: number = TVA_TAUX): { tva_taux: number; tva_montant: number; total_ttc: number } => {
  const tva_montant = appliquer(total_ht, taux);
  return { tva_taux: taux, tva_montant, total_ttc: total_ht + tva_montant };
};

/** 2500 → « 25 % », 1250 → « 12,5 % ». */
export const tauxEnTexte = (taux: number): string => `${String(taux / 100).replace('.', ',')} %`;

export interface EntreeMotif {
  parrainages_valides: number;
  remise_commerciale_taux: number;
  /** Le texte libre du contrat (`remise_motif`) : il accompagne la remise commerciale, jamais celle de parrainage. */
  motif_commercial: string | null;
}

/**
 * Le motif de la remise EN CLAIR, tel que le bon et la page d'abonnement l'affichent : la part de parrainage (avec le nombre de
 * parrainages validés), la part commerciale (avec le motif du contrat), et la mention du plafond quand les deux le dépassent.
 * Rien n'est généré : des gabarits fixes. Null quand il n'y a aucune remise.
 */
export function motifRemise(e: EntreeMotif): string | null {
  const valides = Math.max(0, Math.floor(e.parrainages_valides));
  const parrainage = tauxParrainage(valides);
  const commerciale = Math.max(0, e.remise_commerciale_taux);
  const parties: string[] = [];
  if (parrainage > 0) parties.push(`parrainage : ${valides} parrainage${valides > 1 ? 's' : ''} validé${valides > 1 ? 's' : ''}, ${tauxEnTexte(parrainage)}`);
  if (commerciale > 0) parties.push(`remise commerciale de ${tauxEnTexte(commerciale)} : ${e.motif_commercial?.trim() || 'motif non renseigné'}`);
  if (parties.length === 0) return null;
  if (parrainage + commerciale > REMISE_MAX) parties.push(`remise plafonnée à ${tauxEnTexte(REMISE_MAX)}`);
  const t = parties.join(' ; ');
  return t[0].toUpperCase() + t.slice(1);
}

const unitePourPeriodicite = (p: Periodicite, prix: number): number => (p === 'mensuelle' ? prixMensuel(prix) : prix);
const moisDePeriodicite = (p: Periodicite): number => (p === 'mensuelle' ? 1 : 12);

/**
 * Le bon d'une période : socle, Pilotage si actif, Site vitrine si actif, et les accès au-delà de ceux qui sont inclus.
 * `acces_facturables` est celui de l'instant du calcul : c'est le produit qui le lit, ici on ne fait que multiplier.
 */
export function calculerBon(e: EntreeBon): Bon {
  const mois = moisDePeriodicite(e.periodicite);
  const ligne = (code: CodeLigne, quantite: number, prix: number): LigneBon => {
    const prix_unitaire = unitePourPeriodicite(e.periodicite, prix);
    return { code, quantite, prix_unitaire, mois, montant: prix_unitaire * quantite * mois };
  };
  const lignes: LigneBon[] = [ligne('socle', 1, e.prix_socle)];
  if (e.module_pilotage) lignes.push(ligne('pilotage', 1, e.prix_pilotage));
  if (e.module_site) lignes.push(ligne('site', 1, e.prix_site));
  const supplementaires = Math.max(0, e.acces_facturables - e.acces_inclus);
  if (supplementaires > 0) lignes.push(ligne('acces_sup', supplementaires, e.prix_acces_sup));

  const recurrent_ht = lignes.reduce((s, l) => s + l.montant, 0);
  const remise_taux = tauxRemise(tauxParrainage(e.parrainages_valides), e.remise_commerciale_taux);
  const remise_montant = appliquer(recurrent_ht, remise_taux);
  const frais_installation_ht = e.frais_installation ?? 0;
  return { lignes, recurrent_ht, remise_taux, remise_montant, frais_installation_ht, total_ht: recurrent_ht - remise_montant + frais_installation_ht };
}

/**
 * Le bon d'installation (lot 19) : une seule ligne, les frais du contrat, sans récurrent. La remise ne s'y applique JAMAIS (elle ne porte
 * que sur le récurrent). Fonction pure ; l'appelant ne la sollicite que pour des frais non nuls : pas de bon à zéro euro.
 */
export function calculerBonInstallation(frais: number): Bon {
  return {
    lignes: [{ code: 'installation', quantite: 1, prix_unitaire: frais, mois: 1, montant: frais }],
    recurrent_ht: 0,
    remise_taux: 0,
    remise_montant: 0,
    frais_installation_ht: frais,
    total_ht: frais,
  };
}

// ---------------------------------------------------------------- les dates

const analyser = (d: string): { y: number; m: number; j: number } => {
  const [y, m, j] = d.split('-').map(Number);
  return { y, m, j };
};
const joursDuMois = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const deux = (n: number): string => String(n).padStart(2, '0');

/** `n` mois après `date`. Le jour est ramené à la fin du mois d'arrivée s'il n'y existe pas (31 janvier + 1 mois = 28 février). */
export function ajouterMois(date: string, n: number): string {
  const { y, m, j } = analyser(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return `${ny}-${deux(nm)}-${deux(Math.min(j, joursDuMois(ny, nm)))}`;
}

/**
 * Les mois ENTIERS de `du` à `au`, ARRONDIS AU SUPÉRIEUR : un mois commencé est un mois dû. Zéro si `au` n'est pas après `du`.
 * 20/11/2026 → 14/03/2027 : trois mois entiers et un reste = 4. 02/03/2027 → 14/03/2027 : un reste = 1.
 */
export function moisArrondisAuSuperieur(du: string, au: string): number {
  if (au <= du) return 0;
  const a = analyser(au);
  const d = analyser(du);
  let entiers = (a.y - d.y) * 12 + (a.m - d.m);
  // ISO 8601 : l'ordre des chaînes est celui des dates.
  while (entiers > 0 && ajouterMois(du, entiers) > au) entiers--;
  return ajouterMois(du, entiers) < au ? entiers + 1 : entiers;
}

export interface Periode {
  debut: string;
  fin: string;
}

const pasDePeriode = (p: Periodicite): number => moisDePeriodicite(p);

/**
 * Les périodes dont le DÉBUT tombe dans [du, au] (bornes comprises). Une période commence à la date anniversaire du contrat
 * (`debut_le`) et tous les 12 mois (annuel) ou tous les mois (mensuel) ensuite ; chaque début est calculé depuis `debut_le`,
 * jamais depuis le précédent, pour que le jour ne dérive pas après un mois court.
 */
export function periodesDebutant(debut_le: string, periodicite: Periodicite, du: string, au: string): Periode[] {
  const pas = pasDePeriode(periodicite);
  const sortie: Periode[] = [];
  for (let k = 0; ; k++) {
    const debut = ajouterMois(debut_le, k * pas);
    if (debut > au) return sortie;
    if (debut >= du) sortie.push({ debut, fin: ajouterMois(debut_le, (k + 1) * pas) });
  }
}

/** La période en cours un jour donné : débutée au plus tard ce jour-là, pas encore finie. Null avant le début du contrat. */
export function periodeAu(debut_le: string, periodicite: Periodicite, jour: string): Periode | null {
  if (jour < debut_le) return null;
  const pas = pasDePeriode(periodicite);
  for (let k = 0; ; k++) {
    const fin = ajouterMois(debut_le, (k + 1) * pas);
    if (fin > jour) return { debut: ajouterMois(debut_le, k * pas), fin };
  }
}

// ---------------------------------------------------------------- la résiliation (lot 17)

/** Un préavis écrit doit être reçu au moins 30 jours avant la date anniversaire. */
export const JOURS_PREAVIS_RESILIATION = 30;
/** L'engagement est de douze mois, quelle que soit la périodicité de la facturation : la date anniversaire revient tous les douze mois. */
export const MOIS_ENGAGEMENT = 12;

const joursApres = (date: string, jours: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);

/** La première date anniversaire strictement après `jour` (la première est un an après `debut_le`). */
export function prochainAnniversaire(debut_le: string, jour: string): string {
  for (let k = 1; ; k++) {
    const a = ajouterMois(debut_le, k * MOIS_ENGAGEMENT);
    if (a > jour) return a;
  }
}

/**
 * La date d'effet d'une résiliation : la première date anniversaire située AU MOINS 30 jours après la réception du préavis (30 jours
 * pile suffisent). `prochain` est l'anniversaire que le préavis visait (le premier à partir de sa réception) ; s'il n'est pas atteint
 * à temps, le contrat est reconduit pour douze mois et l'effet est l'anniversaire suivant (`reconduit`). Aucun remboursement au prorata :
 * la période en cours va à son terme dans tous les cas. Fonction pure.
 */
export function dateEffetPreavis(debut_le: string, recu_le: string): { prochain: string; effet: string; reconduit: boolean } {
  const limite = joursApres(recu_le, JOURS_PREAVIS_RESILIATION);
  let prochain: string | null = null;
  for (let k = 1; ; k++) {
    const a = ajouterMois(debut_le, k * MOIS_ENGAGEMENT);
    if (prochain === null && a >= recu_le) prochain = a;
    if (a >= limite) return { prochain: prochain as string, effet: a, reconduit: a !== prochain };
  }
}

// ---------------------------------------------------------------- le prorata d'un module activé en cours de période

export interface EntreeComplementaire {
  periodicite: Periodicite;
  /** Les modules activés ce jour-là, avec leur prix du contrat (au mois, tarif annuel). */
  modules: { code: 'pilotage' | 'site'; prix: number }[];
  activation: string;
  /** Fin de la période en cours : la date anniversaire. */
  anniversaire: string;
  remise_taux: number;
}

export interface BonComplementaire extends Omit<Bon, 'frais_installation_ht'> {
  mois: number;
}

/**
 * Le bon complémentaire : chaque module × les mois entiers (arrondis au supérieur) de l'activation à la date anniversaire, au
 * tarif annuel. Anniversaire au 14/03/2027, Pilotage à 49 € : activé le 20/11/2026 → 4 mois → 196 € ; le 02/03/2027 → 1 mois →
 * 49 €. Null pour un contrat mensuel (le module entre dans le bon du mois suivant) et quand il n'y a plus rien à courir.
 */
export function calculerComplementaire(e: EntreeComplementaire): BonComplementaire | null {
  if (e.periodicite !== 'annuelle') return null;
  const mois = moisArrondisAuSuperieur(e.activation, e.anniversaire);
  if (mois === 0 || e.modules.length === 0) return null;
  const lignes: LigneBon[] = e.modules.map((m) => ({ code: m.code, quantite: 1, prix_unitaire: m.prix, mois, montant: m.prix * mois }));
  const recurrent_ht = lignes.reduce((s, l) => s + l.montant, 0);
  const remise_taux = Math.min(REMISE_MAX, Math.max(0, e.remise_taux));
  const remise_montant = appliquer(recurrent_ht, remise_taux);
  return { lignes, recurrent_ht, remise_taux, remise_montant, total_ht: recurrent_ht - remise_montant, mois };
}
