// « Mon abonnement » (lot 13) : ce que la page lit, une seule fois, pour un cabinet. Lecture seule, tout est borné au locataire.
//
// Le nombre d'accès affiché est le nombre FACTURABLE (associé et collaborateur actifs), celui que le bon du lot 12 compte : les deux
// viennent de la même constante (roles.ts, ACCES_FACTURABLES). Un nombre affiché qui ne correspondrait pas à la facture est la
// première cause de contestation. La liste nominative est celle de TOUS les comptes du cabinet (acces.ts, accesDuCabinet) : le compte
// de support de l'éditeur, l'éditeur et les clients finaux n'y sont jamais.
//
// Rien ici n'écrit, rien ne projette un coût, rien ne mesure un taux d'usage : il n'y a aucun plafond d'espaces clients, donc rien à
// jauger. Aucun texte n'est généré : des gabarits fixes et des nombres.

import { accesDuCabinet, compterAcces, compterDossiers, type Acces } from './acces';
import { adresseSupport } from './admin';
import { contratEnCours, type Contrat } from './contrat';
import type { Base } from './db';
import { dateAnniversaire, phraseDepassement } from './depassement';
import { dateCourte } from './format';
import { facturesDuCabinet, LIBELLES_LIGNE, parrainagesValides } from './facturation';
import { ACCES_FACTURABLES } from './roles';
import { calculerBon, motifRemise, periodeAu, REMISE_MAX, REMISE_PAR_PARRAINAGE, tauxEnTexte, tauxParrainage, type LigneBon } from './tarif';

export interface LignePoste extends LigneBon {
  libelle: string;
}

export interface CompteAbonnement extends Acces {
  /** Ce compte est-il facturé ? Un associé ou un collaborateur actif, et personne d'autre. */
  facture: boolean;
  /** Pourquoi il ne l'est pas, en clair. */
  raison: string | null;
}

export interface VueAbonnement {
  contrat: Contrat | null;
  /** Bloc a. */
  formule: string;
  periodicite: string;
  situation: string | null;
  renouvellement: string | null;
  /** Bloc b. */
  postes: LignePoste[];
  remise: { taux: number; montant: number; motif: string | null } | null;
  total_annuel_ht: number;
  equivalent_mensuel_ht: number;
  /** Bloc c. */
  facturables: number;
  inclus: number;
  comptes: CompteAbonnement[];
  /** Bloc d : null tant que les accès facturables ne dépassent pas les inclus. */
  depassement: string | null;
  /** Bloc e. */
  espaces_publies: number;
  /** Bloc f. */
  parrainages_valides: number;
  parrainage_taux: number;
  regle_parrainage: string;
  /** Bloc g. */
  factures: Awaited<ReturnType<typeof facturesDuCabinet>>;
  /** La ligne de contact humain : l'adresse de l'éditeur, ou null si elle n'est pas réglée. */
  contact: string | null;
}

export const LIBELLES_ROLE: Record<string, string> = { associe: 'Associé', collaborateur: 'Collaborateur', lecture: 'Lecture' };

function formuleEnMots(c: Contrat): string {
  const jusqua = (fin: string | null): string => (fin ? ` (jusqu’au ${dateCourte(fin)})` : '');
  const modules = [c.module_pilotage ? `module Pilotage${jusqua(c.module_pilotage_fin_le)}` : '', c.module_site ? `module Site vitrine${jusqua(c.module_site_fin_le)}` : ''].filter(Boolean);
  if (modules.length === 0) return 'Socle seul';
  return `Socle${modules.length === 1 ? ' et ' : ', '}${modules.join(' et ')}`;
}

function qualifier(a: Acces): CompteAbonnement {
  const role = a.role;
  if (!ACCES_FACTURABLES.includes(role)) return { ...a, facture: false, raison: 'Non facturé : accès en lecture' };
  if (a.actif !== 1) return { ...a, facture: false, raison: 'Non facturé : accès suspendu' };
  return { ...a, facture: true, raison: null };
}

const STATUTS_EN_MOTS: Partial<Record<Contrat['statut'], string>> = {
  brouillon: 'Contrat en préparation.',
  suspendu: 'Contrat suspendu : contactez-nous.',
};

export async function vueAbonnement(db: Base, tenantId: string, jour: string): Promise<VueAbonnement> {
  const [contrat, acces, compteurs, dossiers, valides, factures, contact] = await Promise.all([
    contratEnCours(db, tenantId),
    accesDuCabinet(db, tenantId),
    compterAcces(db, tenantId),
    compterDossiers(db, tenantId),
    parrainagesValides(db, tenantId),
    facturesDuCabinet(db, tenantId),
    adresseSupport(db),
  ]);
  const comptes = acces.map(qualifier);
  const regle = `Chaque parrainage validé, quand le cabinet parrainé a six mois de service payant, vaut ${tauxEnTexte(REMISE_PAR_PARRAINAGE)} de remise sur votre abonnement, jusqu'à ${tauxEnTexte(REMISE_MAX)}.`;
  const base = {
    comptes, facturables: compteurs.facturables, espaces_publies: dossiers.publie, parrainages_valides: valides,
    parrainage_taux: tauxParrainage(valides), regle_parrainage: regle, factures, contact, contrat,
  };
  if (!contrat) {
    return {
      ...base, formule: 'Aucun contrat en cours', periodicite: '', situation: null, renouvellement: null, postes: [], remise: null,
      total_annuel_ht: 0, equivalent_mensuel_ht: 0, inclus: 0, depassement: null,
    };
  }

  // Le calcul est celui du bon (tarif.ts) sur les accès d'aujourd'hui : ce que le prochain bon dirait, pas une estimation.
  // Un module dont la désactivation est programmée part à la prochaine date anniversaire : le prochain bon ne le porte plus.
  const bon = calculerBon({
    ...contrat,
    module_pilotage: contrat.module_pilotage_fin_le ? 0 : contrat.module_pilotage,
    module_site: contrat.module_site_fin_le ? 0 : contrat.module_site,
    acces_facturables: compteurs.facturables, parrainages_valides: valides,
  });
  const mensuel = contrat.periodicite === 'mensuelle';
  const annuel = mensuel ? bon.total_ht * 12 : bon.total_ht;
  const mois = mensuel ? bon.total_ht : Math.floor((bon.total_ht + 6) / 12);

  const date = dateAnniversaire(contrat, jour);
  const periode = contrat.debut_le ? periodeAu(contrat.debut_le, contrat.periodicite, jour) : null;
  const situation =
    contrat.statut === 'essai' && contrat.date_fin_essai
      ? `Essai en cours, jusqu'au ${dateCourte(contrat.date_fin_essai)}.`
      : (STATUTS_EN_MOTS[contrat.statut] ?? null);

  return {
    ...base,
    formule: formuleEnMots(contrat),
    periodicite: mensuel ? 'Paiement mensuel' : 'Paiement annuel',
    situation,
    renouvellement: periode ? periode.fin : contrat.debut_le ?? date,
    postes: bon.lignes.map((l) => ({ ...l, libelle: LIBELLES_LIGNE[l.code] })),
    remise: bon.remise_taux > 0
      ? {
          taux: bon.remise_taux,
          montant: bon.remise_montant,
          motif: motifRemise({ parrainages_valides: valides, remise_commerciale_taux: contrat.remise_commerciale_taux, motif_commercial: contrat.remise_motif }),
        }
      : null,
    total_annuel_ht: annuel,
    equivalent_mensuel_ht: mois,
    inclus: contrat.acces_inclus,
    depassement: phraseDepassement(contrat, compteurs.facturables, jour),
  };
}
