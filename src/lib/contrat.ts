// Le contrat (lot 11) : un seul en cours par locataire, et la seule source des prix. Montants en centimes entiers (hors taxes),
// taux en centièmes de point (2500 = 25 %), dates ISO 8601. Toute lecture et toute écriture est bornée au locataire.
//
// Quatre règles dures, tenues ICI et par la base (migrations 0008 et 0009), pas par la convention :
//   1. les prix se lisent SUR LE CONTRAT (`prixDuContrat`) : aucune grille globale n'existe ;
//   2. aucun prix ne change tant que `tarif_gele_jusqu_au` est dans le futur ;
//   3. une date de gel se PROLONGE, jamais elle ne se raccourcit ni ne s'efface (le refus est journalisé) ;
//   4. une date de mise en production est refusée tant que `dpa_signe_le` est vide ; elle fait passer le contrat en essai.
//
// Statuts : brouillon, essai, actif, suspendu, resilie, essai_non_converti. Les quatre premiers sont « en cours » (un seul par
// locataire) ; resilie et essai_non_converti sont de l'historique (STATUTS_DE_SORTIE) : le cabinet est fermé, le calendrier de sortie court
// (essai.ts : lot 12 pour l'essai non converti, lot 17 pour la résiliation).
// `suspendu` est le statut du CONTRAT (litige de facturation) : rien à voir avec la suspension d'un cabinet (admin.ts), qui est
// une mesure d'accès et ne change pas le contrat.
//
// Chaque modification part dans le même `batch` que son événement (journal.ts). Aucun texte n'est généré : les refus sont des codes
// fixes traduits par MESSAGES_CONTRAT.

import type { Base } from './db';
import { EVENEMENT, journaliser, requeteEvenement, type Acteur } from './journal';
import { lignesModifiees } from './envois';
import { ajouterMois, dateEffetPreavis, periodeAu } from './tarif';

export interface Prix {
  prix_socle: number;
  prix_pilotage: number;
  prix_site: number;
  prix_acces_sup: number;
}
export const CHAMPS_PRIX: (keyof Prix)[] = ['prix_socle', 'prix_pilotage', 'prix_site', 'prix_acces_sup'];

/**
 * La grille standard (79, 49, 39, 25 € par mois, au tarif annuel), en centimes. Ce N'EST PAS un tarif : aucun prix ne se lit ici, ils
 * se lisent tous sur le contrat (`prixDuContrat`). C'est la valeur que le formulaire d'ouverture d'un contrat PROPOSE, que l'éditeur
 * garde ou change : le contrat recopie ensuite les quatre prix.
 */
export const GRILLE_STANDARD: Prix = { prix_socle: 7900, prix_pilotage: 4900, prix_site: 3900, prix_acces_sup: 2500 };

export const STATUTS_CONTRAT = ['brouillon', 'essai', 'actif', 'suspendu', 'resilie', 'essai_non_converti'] as const;
export type StatutContrat = (typeof STATUTS_CONTRAT)[number];
/** Ceux d'un contrat « en cours » : le locataire n'en a qu'un. */
export const STATUTS_EN_COURS: StatutContrat[] = ['brouillon', 'essai', 'actif', 'suspendu'];
/** Ceux d'un contrat SORTI : le cabinet est fermé (accès, viewers, modules) tant qu'il n'en a pas de nouveau en cours, puis ses données sont supprimées. */
export const STATUTS_DE_SORTIE: StatutContrat[] = ['essai_non_converti', 'resilie'];
/** Ceux d'un contrat en service, qu'un préavis de résiliation peut viser. */
export const STATUTS_EN_SERVICE: StatutContrat[] = ['actif', 'suspendu'];
/** Une liste de statuts pour une clause SQL « IN (…) » : seules des constantes de ce fichier y passent. */
export const statutsEnSql = (statuts: readonly StatutContrat[]): string => statuts.map((x) => `'${x}'`).join(',');
/** Durée de l'essai, à compter de la mise en production. */
export const JOURS_ESSAI = 45;

export type Module = 'pilotage' | 'site';
export type Periodicite = 'mensuelle' | 'annuelle';

export interface Contrat extends Prix {
  id: string;
  tenant_id: string;
  statut: StatutContrat;
  periodicite: Periodicite;
  debut_le: string | null;
  fin_le: string | null;
  date_mise_en_production: string | null;
  /** Posée avec la mise en production : elle + 45 jours. */
  date_fin_essai: string | null;
  module_pilotage: number;
  module_site: number;
  acces_inclus: number;
  frais_installation: number;
  tarif_gele_jusqu_au: string | null;
  remise_parrainage_taux: number;
  remise_commerciale_taux: number;
  remise_motif: string | null;
  remise_revue_le: string | null;
  dpa_signe_le: string | null;
  preavis_recu_le: string | null;
  /** Lot 17 : la date d'effet de la résiliation, calculée à l'enregistrement du préavis ; null tant qu'aucun préavis n'est enregistré. */
  resiliation_effet_le: string | null;
  /** Date de signature du contrat : le gel d'un fondateur se calcule dessus. */
  date_signature: string | null;
  /** Le jour où le statut fondateur a été posé ; null : pas fondateur. C'est cette colonne, et elle seule, qui fait le statut. */
  fondateur_le: string | null;
  /** Date d'effet d'une désactivation demandée ; le drapeau reste à 1 jusque-là (basculerModulesEchus le baisse). */
  module_pilotage_fin_le: string | null;
  module_site_fin_le: string | null;
  cree_le: string;
  maj_le: string;
}

const COLONNES =
  `id, tenant_id, statut, periodicite, debut_le, fin_le, date_mise_en_production, date_fin_essai, ${CHAMPS_PRIX.join(', ')}, module_pilotage, module_site,
   acces_inclus, frais_installation, tarif_gele_jusqu_au, remise_parrainage_taux, remise_commerciale_taux, remise_motif, remise_revue_le,
   dpa_signe_le, preavis_recu_le, resiliation_effet_le, date_signature, fondateur_le, module_pilotage_fin_le, module_site_fin_le, cree_le, maj_le`;

export type CodeContrat =
  | 'aucun_contrat' | 'deja_un_contrat' | 'tarif_gele' | 'gel_raccourci' | 'gel_efface' | 'deja_en_production' | 'dpa_manquant' | 'date_invalide' | 'montant_invalide' | 'taux_invalide'
  | 'motif_requis' | 'revue_requise' | 'periodicite' | 'inchange' | 'signature_manquante' | 'pas_fondateur' | 'effet_atteint'
  | 'pas_en_essai' | 'signature_future' | 'signature_anterieure' | 'signature_differente'
  | 'preavis_hors_service' | 'debut_manquant' | 'preavis_existant' | 'preavis_futur' | 'effet_passe' | 'aucun_preavis' | 'preavis_effet_atteint';
/**
 * `effet` : pour un module, ce que l'écriture a fait (immédiat, désactivation programmée, programmation annulée).
 * `reconduit` : pour un préavis, vrai quand il est arrivé trop tard pour la prochaine date anniversaire (reconduction de douze mois).
 */
export type ResultatContrat = { ok: true; contrat: Contrat; effet?: 'immediat' | 'programme' | 'annule'; reconduit?: boolean } | { ok: false; code: CodeContrat };

export const MESSAGES_CONTRAT: Record<CodeContrat, string> = {
  aucun_contrat: 'Ce cabinet n’a pas de contrat en cours.',
  deja_un_contrat: 'Ce cabinet a déjà un contrat en cours : un seul à la fois.',
  tarif_gele: 'Le tarif est gelé : aucun prix ne se modifie avant la fin du gel.',
  gel_raccourci: 'Le gel du tarif ne se raccourcit pas : une date de gel se prolonge seulement.',
  gel_efface: 'Le gel du tarif ne s’efface pas : une date de gel se prolonge seulement.',
  deja_en_production: 'Ce contrat est déjà au-delà de l’essai : la date de mise en production ne se change plus.',
  dpa_manquant: 'La mise en production et la signature du contrat exigent un DPA signé : renseignez sa date d’abord.',
  date_invalide: 'Date invalide : AAAA-MM-JJ.',
  montant_invalide: 'Montant invalide : des centimes entiers, positifs ou nuls.',
  taux_invalide: 'Taux invalide : entre 0 et 10 000 centièmes de point.',
  motif_requis: 'Une remise commerciale exige un motif.',
  revue_requise: 'Une remise commerciale exige une date de revue.',
  periodicite: 'Périodicité inconnue : mensuelle ou annuelle.',
  inchange: 'Rien à modifier.',
  signature_manquante: 'La date de signature du contrat est requise (le gel d’un fondateur se calcule dessus : signature + 24 mois). Renseignez-la.',
  pas_en_essai: 'Seul un contrat en essai se signe : un brouillon n’est pas en production, un contrat actif est déjà signé, un essai non converti est clos.',
  signature_future: 'La date de signature ne peut pas être dans le futur.',
  signature_anterieure: 'La date de signature ne peut pas précéder la mise en production.',
  signature_differente: 'Ce contrat porte déjà une date de signature (posée avec le statut fondateur, dont le gel se calcule dessus) : la signature la reprend, ne la changez pas ici.',
  pas_fondateur: 'Ce cabinet ne porte pas le statut fondateur.',
  effet_atteint: 'La date d’effet est atteinte : la désactivation n’est plus annulable. Le traitement quotidien bascule le module.',
  preavis_hors_service: 'Un préavis ne vaut que pour un contrat actif ou suspendu. Un essai non converti se clôt de lui-même au 45e jour.',
  debut_manquant: 'Ce contrat n’a pas de date de début de service : sans elle, pas de date anniversaire, donc pas de date d’effet.',
  preavis_existant: 'Un préavis est déjà enregistré pour ce contrat : annulez-le d’abord si la date saisie était fausse.',
  preavis_futur: 'La date de réception du préavis ne peut pas être dans le futur.',
  effet_passe: 'La date d’effet calculée est déjà passée : vérifiez la date de réception du préavis. Une résiliation ne s’enregistre pas après coup.',
  aucun_preavis: 'Ce contrat n’a pas de préavis enregistré.',
  preavis_effet_atteint: 'La date d’effet est atteinte : la résiliation n’est plus annulable. Le traitement quotidien clôt le contrat.',
};

const refus = (code: CodeContrat): { ok: false; code: CodeContrat } => ({ ok: false, code });
const aujourdhui = (): string => new Date().toISOString().slice(0, 10);
const maintenant = (): string => new Date().toISOString();
/** Une date ISO (AAAA-MM-JJ) décalée de `jours` jours, en UTC. */
export const plusJours = (date: string, jours: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);
const dateIso = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const centimes = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1_000_000_000;
const taux = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 10000;

// ---------------------------------------------------------------- lire

/** Le contrat en cours (brouillon, essai, actif ou suspendu) du locataire, ou null. */
export function contratEnCours(db: Base, tenantId: string): Promise<Contrat | null> {
  return db
    .prepare(`SELECT ${COLONNES} FROM contrat WHERE tenant_id = ? AND statut IN (${STATUTS_EN_COURS.map((x) => `'${x}'`).join(',')})`)
    .bind(tenantId)
    .first<Contrat>();
}

/** Les contrats ACTIFS, de tous les cabinets, qui ont une date de début : ce que le traitement quotidien (lot 12) facture. */
export async function contratsActifs(db: Base): Promise<Contrat[]> {
  const { results } = await db
    .prepare(`SELECT ${COLONNES} FROM contrat WHERE statut = 'actif' AND debut_le IS NOT NULL ORDER BY tenant_id, id`)
    .bind()
    .all<Contrat>();
  return results;
}

/**
 * Les prix, tels que le contrat les porte. C'est la SEULE façon de lire un prix : ni constante, ni grille globale. Sans contrat
 * en cours, null : on ne devine pas un tarif.
 */
export async function prixDuContrat(db: Base, tenantId: string): Promise<(Prix & { acces_inclus: number; frais_installation: number }) | null> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return null;
  return {
    prix_socle: c.prix_socle, prix_pilotage: c.prix_pilotage, prix_site: c.prix_site, prix_acces_sup: c.prix_acces_sup,
    acces_inclus: c.acces_inclus, frais_installation: c.frais_installation,
  };
}

/** Le gel est actif tant que sa date est strictement dans le futur. */
export const tarifGele = (c: Pick<Contrat, 'tarif_gele_jusqu_au'>, jour = aujourdhui()): boolean =>
  !!c.tarif_gele_jusqu_au && c.tarif_gele_jusqu_au > jour;

// ---------------------------------------------------------------- écrire

export interface SaisieContrat extends Prix {
  periodicite: Periodicite;
  acces_inclus: number;
  frais_installation?: number;
  debut_le?: string | null;
  fin_le?: string | null;
  tarif_gele_jusqu_au?: string | null;
}

/** Ouvre le contrat du cabinet, en brouillon, avec les quatre prix recopiés. Refusé s'il en a déjà un en cours. */
export async function creerContrat(db: Base, tenantId: string, s: SaisieContrat, acteur: Acteur | null): Promise<ResultatContrat> {
  if (s.periodicite !== 'mensuelle' && s.periodicite !== 'annuelle') return refus('periodicite');
  if (![...CHAMPS_PRIX.map((k) => s[k]), s.acces_inclus, s.frais_installation ?? 0].every(centimes)) return refus('montant_invalide');
  for (const d of [s.debut_le, s.fin_le, s.tarif_gele_jusqu_au]) if (d && !dateIso(d)) return refus('date_invalide');
  if (await contratEnCours(db, tenantId)) return refus('deja_un_contrat');
  const id = crypto.randomUUID();
  const now = maintenant();
  try {
    await db.batch([db.prepare(
      `INSERT INTO contrat (id, tenant_id, statut, periodicite, debut_le, fin_le, ${CHAMPS_PRIX.join(', ')}, acces_inclus, frais_installation,
                            tarif_gele_jusqu_au, cree_le, maj_le)
       VALUES (?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, tenantId, s.periodicite, s.debut_le ?? null, s.fin_le ?? null, s.prix_socle, s.prix_pilotage, s.prix_site, s.prix_acces_sup,
      s.acces_inclus, s.frais_installation ?? 0, s.tarif_gele_jusqu_au ?? null, now, now,
    ), requeteEvenement(db, {
      tenantId, type: EVENEMENT.CONTRAT_CREE, acteur, cible: { type: 'contrat', id },
      detail: { periodicite: s.periodicite, acces_inclus: s.acces_inclus, prix: Object.fromEntries(CHAMPS_PRIX.map((k) => [k, s[k]])) },
    })]);
  } catch {
    return refus('deja_un_contrat');
  }
  return relire(db, tenantId);
}

async function relire(db: Base, tenantId: string): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  return c ? { ok: true, contrat: c } : refus('aucun_contrat');
}

/**
 * Modifie un ou plusieurs prix. REFUSÉ tant que `tarif_gele_jusqu_au` est dans le futur — la base refuse aussi, au cas où une
 * autre écriture contournerait celle-ci. Un prix inchangé n'est pas une modification.
 */
export async function modifierPrix(db: Base, tenantId: string, prix: Partial<Prix>, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  const champs = CHAMPS_PRIX.filter((k) => prix[k] !== undefined);
  if (!champs.every((k) => centimes(prix[k]))) return refus('montant_invalide');
  const change = champs.filter((k) => prix[k] !== c[k]);
  if (change.length === 0) return refus('inchange');
  if (tarifGele(c)) return refus('tarif_gele');
  const avant = Object.fromEntries(change.map((k) => [k, c[k]]));
  const apres = Object.fromEntries(change.map((k) => [k, prix[k]]));
  try {
    await db.batch([
      db
        .prepare(`UPDATE contrat SET ${change.map((k) => `${k} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND tenant_id = ?`)
        .bind(...change.map((k) => prix[k]), maintenant(), c.id, tenantId),
      requeteEvenement(db, { tenantId, type: EVENEMENT.PRIX_MODIFIE, acteur, cible: { type: 'contrat', id: c.id }, detail: { avant, apres } }, true),
    ]);
  } catch {
    return refus('tarif_gele');
  }
  return relire(db, tenantId);
}

/**
 * Pose ou PROLONGE le gel du tarif jusqu'à une date. Une date de gel ne se raccourcit jamais et ne s'efface jamais (`null`) :
 * c'est une promesse faite au cabinet, et la lever puis changer un prix viderait le gel de son sens. Le refus est explicite ET
 * journalisé (`gel_tarif_refuse`, avec la date tentée) ; la base refuse aussi (déclencheur `contrat_gel_ne_recule_pas`).
 * Une prolongation est journalisée (`gel_tarif`, avant et après).
 */
export async function poserGelTarif(db: Base, tenantId: string, jusquAu: string | null, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  if (jusquAu !== null && !dateIso(jusquAu)) return refus('date_invalide');
  const actuel = c.tarif_gele_jusqu_au;
  if (actuel !== null && (jusquAu === null || jusquAu < actuel)) {
    const code: CodeContrat = jusquAu === null ? 'gel_efface' : 'gel_raccourci';
    await journaliser(db, { tenantId, type: EVENEMENT.GEL_TARIF_REFUSE, acteur, cible: { type: 'contrat', id: c.id }, detail: { actuel, tentative: jusquAu, motif: code } });
    return refus(code);
  }
  if (actuel === jusquAu) return refus('inchange');
  try {
    await db.batch([
      db.prepare('UPDATE contrat SET tarif_gele_jusqu_au = ?, maj_le = ? WHERE id = ? AND tenant_id = ?').bind(jusquAu, maintenant(), c.id, tenantId),
      requeteEvenement(db, { tenantId, type: EVENEMENT.GEL_TARIF, acteur, cible: { type: 'contrat', id: c.id }, detail: { avant: actuel, apres: jusquAu } }, true),
    ]);
  } catch {
    // Le déclencheur a refusé : une autre écriture a avancé la date entre la lecture et celle-ci.
    return refus('gel_raccourci');
  }
  return relire(db, tenantId);
}

/** Date de signature du DPA. Préalable de la mise en production. */
export async function poserDpa(db: Base, tenantId: string, date: string, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  if (!dateIso(date)) return refus('date_invalide');
  await db.batch([
    db.prepare('UPDATE contrat SET dpa_signe_le = ?, maj_le = ? WHERE id = ? AND tenant_id = ?').bind(date, maintenant(), c.id, tenantId),
    requeteEvenement(db, { tenantId, type: EVENEMENT.DPA_SIGNE, acteur, cible: { type: 'contrat', id: c.id }, detail: { avant: c.dpa_signe_le, apres: date } }, true),
  ]);
  return relire(db, tenantId);
}

/**
 * Pose la date de mise en production. REFUSÉ si `dpa_signe_le` est vide (le CHECK de la base refuse aussi). Elle fait passer le
 * contrat en `essai` et pose `date_fin_essai` à +45 jours : c'est sur ces deux champs que le lot 12 construit le calendrier
 * d'essai. Admise depuis `brouillon` (la mise en production) et depuis `essai` (correction de la date : la fin d'essai suit) ;
 * un contrat `actif` ou `suspendu` ne revient pas en essai.
 */
export async function poserMiseEnProduction(db: Base, tenantId: string, date: string, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  if (!dateIso(date)) return refus('date_invalide');
  if (!c.dpa_signe_le || c.dpa_signe_le.trim() === '') return refus('dpa_manquant');
  if (c.statut !== 'brouillon' && c.statut !== 'essai') return refus('deja_en_production');
  if (c.statut === 'essai' && c.date_mise_en_production === date) return refus('inchange');
  const finEssai = plusJours(date, JOURS_ESSAI);
  try {
    await db.batch([
      db
        .prepare("UPDATE contrat SET date_mise_en_production = ?, date_fin_essai = ?, statut = 'essai', maj_le = ? WHERE id = ? AND tenant_id = ? AND statut IN ('brouillon','essai')")
        .bind(date, finEssai, maintenant(), c.id, tenantId),
      requeteEvenement(
        db,
        {
          tenantId, type: EVENEMENT.MISE_EN_PRODUCTION, acteur, cible: { type: 'contrat', id: c.id },
          detail: { avant: c.date_mise_en_production, apres: date, statut_avant: c.statut, statut_apres: 'essai', date_fin_essai: finEssai },
        },
        true,
      ),
    ]);
  } catch {
    return refus('dpa_manquant');
  }
  return relire(db, tenantId);
}

/**
 * LA SIGNATURE : l'essai devient contrat. Elle pose `date_signature`, `debut_le` et `statut = 'actif'` en UNE écriture, avec son événement.
 * `debut_le` est le début du SERVICE, donc la date anniversaire : tous les bons en partent (periodesDebutant), et le contrat devient
 * visible du traitement quotidien (contratsActifs), du calendrier de bons, de la validation des parrainages.
 *
 * Refusée sans DPA signé (comme la mise en production), refusée hors du statut `essai`. La date de signature ne peut ni précéder la
 * mise en production ni être dans le futur ; elle reprend celle que le contrat porte déjà (statut fondateur) et ne la change pas.
 *
 * LE DÉBUT DU SERVICE (choix à relire, voir le rapport du lot 20) : la spécification dit « Signature : la facture annuelle est émise,
 * date_anniversaire = le 45e jour ». On retient donc la FIN D'ESSAI (`date_fin_essai`, +45 jours) — jamais la date de signature quand
 * elle est antérieure : l'essai est gratuit et entier jusqu'au 45e jour, signer le 10e jour ne l'abrège pas. Si la signature tombe APRÈS la
 * fin d'essai (le jour même, avant le passage du traitement), le service commence à la signature : on ne facture pas une période
 * écoulée avant que le contrat existe.
 */
export async function signerContrat(db: Base, tenantId: string, signeLe: string | null, acteur: Acteur | null, jour = aujourdhui()): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  // Le DPA d'abord : c'est ce que l'éditeur doit régler en premier, quel que soit le statut (un brouillon sans DPA n'est pas « hors essai », il
  // attend son DPA). La base garantit déjà qu'un contrat en essai en a un (contrôle de la table) : la règle est tenue deux fois.
  if (!c.dpa_signe_le || c.dpa_signe_le.trim() === '') return refus('dpa_manquant');
  if (c.statut !== 'essai') return refus('pas_en_essai');
  const saisie = signeLe && signeLe.trim() !== '' ? signeLe.trim() : null;
  const signature = saisie ?? c.date_signature;
  if (!signature) return refus('signature_manquante');
  if (!dateIso(signature)) return refus('date_invalide');
  if (c.date_signature && saisie && saisie !== c.date_signature) return refus('signature_differente');
  if (signature > jour) return refus('signature_future');
  if (!c.date_mise_en_production || signature < c.date_mise_en_production) return refus('signature_anterieure');
  const finEssai = c.date_fin_essai ?? plusJours(c.date_mise_en_production, JOURS_ESSAI);
  const debut = signature > finEssai ? signature : finEssai;
  await db.batch([
    db
      .prepare("UPDATE contrat SET statut = 'actif', date_signature = ?, debut_le = ?, maj_le = ? WHERE id = ? AND tenant_id = ? AND statut = 'essai'")
      .bind(signature, debut, maintenant(), c.id, tenantId),
    requeteEvenement(
      db,
      {
        tenantId, type: EVENEMENT.CONTRAT_SIGNE, acteur, cible: { type: 'contrat', id: c.id },
        detail: { signe_le: signature, debut_le: debut, date_fin_essai: finEssai, statut_avant: 'essai', statut_apres: 'actif', avant: { date_signature: c.date_signature, debut_le: c.debut_le } },
      },
      true,
    ),
  ]);
  return relire(db, tenantId);
}

/**
 * Active ou désactive un module.
 *
 * ACTIVER est immédiat (le bon complémentaire au prorata est l'affaire du traitement quotidien). Sur un module dont la désactivation
 * est programmée, activer ANNULE la programmation — tant que sa date n'est pas atteinte (`effet_atteint` ensuite).
 *
 * DÉSACTIVER ne bascule JAMAIS le drapeau tout de suite : c'est la règle de la spécification, la période déjà facturée va à son
 * terme. L'écriture enregistre une date d'effet (`module_*_fin_le` : la prochaine date anniversaire) et le drapeau reste à 1 ;
 * `basculerModulesEchus` le baisse ce jour-là. Seule exception : un contrat sans date anniversaire (pas encore de début de service,
 * ou début dans le futur) n'a ni période en cours ni bon à protéger, le drapeau tombe tout de suite.
 *
 * Sans effet (refus `inchange`) si le module est déjà dans cet état : pas d'événement pour rien.
 */
export async function basculerModule(db: Base, tenantId: string, module: Module, actif: boolean, acteur: Acteur | null, jour = aujourdhui()): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  const colonne = module === 'pilotage' ? 'module_pilotage' : 'module_site';
  const colonneFin = module === 'pilotage' ? 'module_pilotage_fin_le' : 'module_site_fin_le';
  const cible = { type: 'contrat' as const, id: c.id };
  const en = c[colonne] === 1;
  const fin = c[colonneFin];

  if (actif) {
    if (en && fin === null) return refus('inchange');
    if (en && fin !== null) {
      if (fin <= jour) return refus('effet_atteint');
      await db.batch([
        db.prepare(`UPDATE contrat SET ${colonneFin} = NULL, maj_le = ? WHERE id = ? AND tenant_id = ?`).bind(maintenant(), c.id, tenantId),
        requeteEvenement(db, { tenantId, type: EVENEMENT.MODULE_DESACTIVATION_ANNULEE, acteur, cible, detail: { module, effet_le: fin } }, true),
      ]);
      const r = await relire(db, tenantId);
      return r.ok ? { ...r, effet: 'annule' } : r;
    }
    await db.batch([
      db.prepare(`UPDATE contrat SET ${colonne} = 1, ${colonneFin} = NULL, maj_le = ? WHERE id = ? AND tenant_id = ?`).bind(maintenant(), c.id, tenantId),
      requeteEvenement(db, { tenantId, type: EVENEMENT.MODULE_ACTIVE, acteur, cible, detail: { module } }, true),
    ]);
    return relire(db, tenantId);
  }

  if (!en || fin !== null) return refus('inchange');
  const periode = c.debut_le ? periodeAu(c.debut_le, c.periodicite, jour) : null;
  if (!periode) {
    await db.batch([
      db.prepare(`UPDATE contrat SET ${colonne} = 0, maj_le = ? WHERE id = ? AND tenant_id = ?`).bind(maintenant(), c.id, tenantId),
      requeteEvenement(db, { tenantId, type: EVENEMENT.MODULE_DESACTIVE, acteur, cible, detail: { module } }, true),
    ]);
    return relire(db, tenantId);
  }
  await db.batch([
    db.prepare(`UPDATE contrat SET ${colonneFin} = ?, maj_le = ? WHERE id = ? AND tenant_id = ?`).bind(periode.fin, maintenant(), c.id, tenantId),
    requeteEvenement(db, { tenantId, type: EVENEMENT.MODULE_DESACTIVATION_PROGRAMMEE, acteur, cible, detail: { module, effet_le: periode.fin } }, true),
  ]);
  const r = await relire(db, tenantId);
  return r.ok ? { ...r, effet: 'programme' } : r;
}

/**
 * Le cinquième travail du traitement quotidien : baisse le drapeau des modules dont la date d'effet est atteinte. Idempotent dans la
 * base elle-même : la date d'effet s'efface avec le drapeau, et chaque écriture est conditionnée à l'état qu'elle quitte, donc un
 * second passage le même jour ne trouve plus rien. Les données du module restent intactes. Renvoie le nombre de modules basculés.
 */
export async function basculerModulesEchus(db: Base, jour: string): Promise<number> {
  const en = STATUTS_EN_COURS.map((x) => `'${x}'`).join(',');
  const { results } = await db
    .prepare(
      `SELECT id, tenant_id, module_pilotage, module_pilotage_fin_le, module_site, module_site_fin_le FROM contrat
        WHERE statut IN (${en})
          AND ((module_pilotage_fin_le IS NOT NULL AND module_pilotage_fin_le <= ?) OR (module_site_fin_le IS NOT NULL AND module_site_fin_le <= ?))
        ORDER BY tenant_id, id`,
    )
    .bind(jour, jour)
    .all<{ id: string; tenant_id: string; module_pilotage: number; module_pilotage_fin_le: string | null; module_site: number; module_site_fin_le: string | null }>();
  let n = 0;
  for (const c of results) {
    for (const module of ['pilotage', 'site'] as const) {
      const colonne = module === 'pilotage' ? 'module_pilotage' : 'module_site';
      const colonneFin = `${colonne}_fin_le`;
      const effet = module === 'pilotage' ? c.module_pilotage_fin_le : c.module_site_fin_le;
      if (effet === null || effet > jour) continue;
      const r = await db.batch([
        db
          .prepare(`UPDATE contrat SET ${colonne} = 0, ${colonneFin} = NULL, maj_le = ? WHERE id = ? AND tenant_id = ? AND ${colonneFin} = ? AND ${colonneFin} <= ?`)
          .bind(maintenant(), c.id, c.tenant_id, effet, jour),
        requeteEvenement(db, { tenantId: c.tenant_id, type: EVENEMENT.MODULE_DESACTIVE, acteur: null, cible: { type: 'contrat', id: c.id }, detail: { module, effet_le: effet, programmee: true } }, true),
      ]);
      if (lignesModifiees(r[0]) > 0) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- la résiliation (lot 17)

/**
 * Enregistre un préavis de résiliation REÇU le `recuLe`. La règle de la spécification : un préavis écrit reçu au moins 30 jours avant la
 * date anniversaire prend effet à cette date ; sinon le contrat est reconduit pour douze mois et l'effet est l'anniversaire suivant
 * (`reconduit`). Aucun remboursement au prorata. La date d'effet est calculée ICI, une fois (tarif.ts, `dateEffetPreavis`), et posée sur
 * le contrat avec la date de réception et l'événement `preavis_enregistre` : le contrat reste `actif` ; c'est le traitement quotidien
 * qui le passe en `resilie` à la date d'effet (essai.ts).
 *
 * Refusé : sans contrat en service (actif ou suspendu), sans date de début de service (pas de date anniversaire), si un préavis est déjà
 * enregistré, pour une réception dans le futur, et quand la date d'effet calculée est déjà passée ou tombe aujourd'hui (une résiliation
 * qui a déjà pris effet ne s'enregistre pas après coup : c'est presque toujours une date de réception mal saisie, et le calendrier de
 * sortie qui suit supprime des données).
 */
export async function enregistrerPreavis(db: Base, tenantId: string, recuLe: string, acteur: Acteur | null, jour = aujourdhui()): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  if (!STATUTS_EN_SERVICE.includes(c.statut)) return refus('preavis_hors_service');
  if (!c.debut_le) return refus('debut_manquant');
  if (c.resiliation_effet_le !== null || c.preavis_recu_le !== null) return refus('preavis_existant');
  if (!dateIso(recuLe)) return refus('date_invalide');
  if (recuLe > jour) return refus('preavis_futur');
  const { prochain, effet, reconduit } = dateEffetPreavis(c.debut_le, recuLe);
  if (effet <= jour) return refus('effet_passe');
  const r = await db.batch([
    db
      .prepare(
        `UPDATE contrat SET preavis_recu_le = ?, resiliation_effet_le = ?, maj_le = ?
          WHERE id = ? AND tenant_id = ? AND statut IN (${statutsEnSql(STATUTS_EN_SERVICE)}) AND resiliation_effet_le IS NULL AND preavis_recu_le IS NULL`,
      )
      .bind(recuLe, effet, maintenant(), c.id, tenantId),
    requeteEvenement(
      db,
      { tenantId, type: EVENEMENT.PREAVIS_ENREGISTRE, acteur, cible: { type: 'contrat', id: c.id }, detail: { recu_le: recuLe, anniversaire_vise: prochain, effet_le: effet, reconduit } },
      true,
    ),
  ]);
  if (lignesModifiees(r[0]) === 0) return refus('preavis_existant');
  const apres = await relire(db, tenantId);
  return apres.ok ? { ...apres, reconduit } : apres;
}

/**
 * Annule la résiliation, TANT QUE sa date d'effet n'est pas atteinte (le jour même, elle l'est : le traitement quotidien clôt le contrat).
 * La date de réception et la date d'effet s'effacent du contrat ; l'événement `preavis_annule` garde l'une et l'autre.
 */
export async function annulerPreavis(db: Base, tenantId: string, acteur: Acteur | null, jour = aujourdhui()): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  if (c.resiliation_effet_le === null) return refus('aucun_preavis');
  if (c.resiliation_effet_le <= jour) return refus('preavis_effet_atteint');
  const r = await db.batch([
    db
      .prepare(
        `UPDATE contrat SET preavis_recu_le = NULL, resiliation_effet_le = NULL, maj_le = ?
          WHERE id = ? AND tenant_id = ? AND resiliation_effet_le = ? AND resiliation_effet_le > ?`,
      )
      .bind(maintenant(), c.id, tenantId, c.resiliation_effet_le, jour),
    requeteEvenement(
      db,
      { tenantId, type: EVENEMENT.PREAVIS_ANNULE, acteur, cible: { type: 'contrat', id: c.id }, detail: { recu_le: c.preavis_recu_le, effet_le: c.resiliation_effet_le } },
      true,
    ),
  ]);
  if (lignesModifiees(r[0]) === 0) return refus('preavis_effet_atteint');
  return relire(db, tenantId);
}

/** Le contrat RÉSILIÉ du locataire (le plus récent), avec ce qu'il faut pour afficher la suite : la fiche de la console. Null s'il n'en a pas. */
export async function contratResilie(db: Base, tenantId: string): Promise<{ id: string; preavis_recu_le: string | null; resiliation_effet_le: string; purge: boolean } | null> {
  const c = await db
    .prepare("SELECT id, preavis_recu_le, resiliation_effet_le FROM contrat WHERE tenant_id = ? AND statut = 'resilie' AND resiliation_effet_le IS NOT NULL ORDER BY resiliation_effet_le DESC, id DESC LIMIT 1")
    .bind(tenantId)
    .first<{ id: string; preavis_recu_le: string | null; resiliation_effet_le: string }>();
  if (!c) return null;
  const purge = await db.prepare('SELECT 1 AS ok FROM envoi_automatique WHERE cle = ?').bind(`purge:${c.id}`).first();
  return { ...c, purge: purge !== null };
}

export interface SaisieRemise {
  commerciale_taux?: number;
  parrainage_taux?: number;
  motif?: string | null;
  revue_le?: string | null;
}

/**
 * Saisit ou modifie une remise. Une remise commerciale non nulle exige un motif et une date de revue. `remise_saisie` la première
 * fois qu'un taux commercial est posé, `remise_modifiee` ensuite (y compris pour la remise de parrainage recalculée par le produit).
 */
export async function saisirRemise(db: Base, tenantId: string, s: SaisieRemise, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  const commerciale = s.commerciale_taux ?? c.remise_commerciale_taux;
  const parrainage = s.parrainage_taux ?? c.remise_parrainage_taux;
  if (!taux(commerciale) || !taux(parrainage)) return refus('taux_invalide');
  const motif = s.motif === undefined ? c.remise_motif : (s.motif ?? '').trim().slice(0, 500) || null;
  const revue = s.revue_le === undefined ? c.remise_revue_le : s.revue_le || null;
  if (revue && !dateIso(revue)) return refus('date_invalide');
  if (commerciale > 0 && !motif) return refus('motif_requis');
  if (commerciale > 0 && !revue) return refus('revue_requise');
  if (
    commerciale === c.remise_commerciale_taux && parrainage === c.remise_parrainage_taux
    && motif === c.remise_motif && revue === c.remise_revue_le
  ) return refus('inchange');
  const premiere = c.remise_commerciale_taux === 0 && !c.remise_motif && commerciale > 0;
  await db.batch([
    db
      .prepare('UPDATE contrat SET remise_commerciale_taux = ?, remise_parrainage_taux = ?, remise_motif = ?, remise_revue_le = ?, maj_le = ? WHERE id = ? AND tenant_id = ?')
      .bind(commerciale, parrainage, motif, revue, maintenant(), c.id, tenantId),
    requeteEvenement(
      db,
      {
        tenantId, type: premiere ? EVENEMENT.REMISE_SAISIE : EVENEMENT.REMISE_MODIFIEE, acteur, cible: { type: 'contrat', id: c.id },
        // Le motif est un texte libre : il reste sur le contrat (modifiable, effaçable avec lui), jamais dans le journal, où une
        // remise « accordée à M. X » n'aurait plus rien à y faire. Le journal garde les taux, la revue et si le motif a changé.
        detail: {
          avant: { commerciale_taux: c.remise_commerciale_taux, parrainage_taux: c.remise_parrainage_taux, revue_le: c.remise_revue_le },
          apres: { commerciale_taux: commerciale, parrainage_taux: parrainage, revue_le: revue },
          motif_modifie: motif !== c.remise_motif,
        },
      },
      true,
    ),
  ]);
  return relire(db, tenantId);
}

// ---------------------------------------------------------------- la formule du contrat (lot 14)

export interface SaisieFormule {
  periodicite?: Periodicite;
  acces_inclus?: number;
  frais_installation?: number;
}

const CHAMPS_FORMULE = ['periodicite', 'acces_inclus', 'frais_installation'] as const;

/**
 * Modifie la périodicité, le nombre d'accès inclus ou les frais d'installation. Les prix ont leur propre garde (`modifierPrix`) :
 * ce qui est modifié ici n'est pas un prix unitaire, le gel du tarif ne le bloque donc pas. Un champ inchangé n'est pas une
 * modification ; sans aucun champ modifié, `inchange` et pas d'événement.
 */
export async function modifierFormule(db: Base, tenantId: string, s: SaisieFormule, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  if (s.periodicite !== undefined && s.periodicite !== 'mensuelle' && s.periodicite !== 'annuelle') return refus('periodicite');
  if (![s.acces_inclus, s.frais_installation].filter((v) => v !== undefined).every(centimes)) return refus('montant_invalide');
  const change = CHAMPS_FORMULE.filter((k) => s[k] !== undefined && s[k] !== c[k]);
  if (change.length === 0) return refus('inchange');
  const avant = Object.fromEntries(change.map((k) => [k, c[k]]));
  const apres = Object.fromEntries(change.map((k) => [k, s[k]]));
  await db.batch([
    db
      .prepare(`UPDATE contrat SET ${change.map((k) => `${k} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND tenant_id = ?`)
      .bind(...change.map((k) => s[k]), maintenant(), c.id, tenantId),
    requeteEvenement(db, { tenantId, type: EVENEMENT.CONTRAT_MODIFIE, acteur, cible: { type: 'contrat', id: c.id }, detail: { avant, apres } }, true),
  ]);
  return relire(db, tenantId);
}

// ---------------------------------------------------------------- le statut fondateur (lot 14, donnée au lot 15)

/** Le libellé d'AFFICHAGE du statut fondateur. Il ne marque plus rien : le statut se lit sur `fondateur_le`. */
export const MOTIF_FONDATEUR = 'Cabinet fondateur — co-conception et référence';
/** Le gel du tarif d'un fondateur : sa date de signature + 24 mois. */
export const MOIS_GEL_FONDATEUR = 24;

export const estFondateur = (c: Pick<Contrat, 'fondateur_le'>): boolean => c.fondateur_le !== null;

/** Combien de contrats en cours portent le statut fondateur, sur combien : le statut doit rester exceptionnel. */
export async function compterFondateurs(db: Base): Promise<{ fondateurs: number; contrats: number }> {
  const en = STATUTS_EN_COURS.map((x) => `'${x}'`).join(',');
  const r = await db
    .prepare(`SELECT COUNT(*) AS contrats, COUNT(fondateur_le) AS fondateurs FROM contrat WHERE statut IN (${en})`)
    .bind()
    .first<{ contrats: number; fondateurs: number }>();
  return { fondateurs: r?.fondateurs ?? 0, contrats: r?.contrats ?? 0 };
}

/**
 * Pose le statut fondateur EN UNE ÉCRITURE : `fondateur_le` (aujourd'hui), la date de signature, frais d'installation à zéro, gel du
 * tarif jusqu'à la signature + 24 mois. Le statut ne pose AUCUN pourcentage et ne touche pas au motif de remise : un cabinet fondateur
 * peut recevoir une remise commerciale, avant comme après.
 *
 * La date de signature est demandée, jamais devinée : celle de la saisie, à défaut celle déjà portée par le contrat ; sans l'une ni
 * l'autre, refus `signature_manquante`. Une date qui raccourcirait un gel existant est refusée (et le refus journalisé). Un seul
 * événement `statut_fondateur` porte l'avant et l'après.
 */
export async function poserStatutFondateur(db: Base, tenantId: string, signeLe: string | null, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  const signature = signeLe && signeLe.trim() !== '' ? signeLe.trim() : c.date_signature;
  if (!signature) return refus('signature_manquante');
  if (!dateIso(signature)) return refus('date_invalide');
  const gel = ajouterMois(signature, MOIS_GEL_FONDATEUR);
  const actuel = c.tarif_gele_jusqu_au;
  if (actuel !== null && gel < actuel) {
    await journaliser(db, { tenantId, type: EVENEMENT.GEL_TARIF_REFUSE, acteur, cible: { type: 'contrat', id: c.id }, detail: { actuel, tentative: gel, motif: 'gel_raccourci' } });
    return refus('gel_raccourci');
  }
  if (c.frais_installation === 0 && actuel === gel && c.date_signature === signature && estFondateur(c)) return refus('inchange');
  try {
    await db.batch([
      db
        .prepare('UPDATE contrat SET frais_installation = 0, tarif_gele_jusqu_au = ?, date_signature = ?, fondateur_le = COALESCE(fondateur_le, ?), maj_le = ? WHERE id = ? AND tenant_id = ?')
        .bind(gel, signature, aujourdhui(), maintenant(), c.id, tenantId),
      requeteEvenement(
        db,
        {
          tenantId, type: EVENEMENT.STATUT_FONDATEUR, acteur, cible: { type: 'contrat', id: c.id },
          detail: {
            signe_le: signature,
            avant: { fondateur_le: c.fondateur_le, frais_installation: c.frais_installation, tarif_gele_jusqu_au: actuel, date_signature: c.date_signature },
            apres: { frais_installation: 0, tarif_gele_jusqu_au: gel, date_signature: signature },
          },
        },
        true,
      ),
    ]);
  } catch {
    return refus('gel_raccourci');
  }
  return relire(db, tenantId);
}

/**
 * Retire le statut fondateur : `fondateur_le` s'efface, rien d'autre. Le gel déjà posé reste en place — un gel ne se raccourcit jamais,
 * et retirer un statut n'est pas une façon de le lever —, les frais d'installation et la date de signature ne bougent pas. Journalisé,
 * avec le gel conservé.
 */
export async function retirerStatutFondateur(db: Base, tenantId: string, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  if (!estFondateur(c)) return refus('pas_fondateur');
  await db.batch([
    db.prepare('UPDATE contrat SET fondateur_le = NULL, maj_le = ? WHERE id = ? AND tenant_id = ? AND fondateur_le IS NOT NULL').bind(maintenant(), c.id, tenantId),
    requeteEvenement(
      db,
      { tenantId, type: EVENEMENT.STATUT_FONDATEUR_RETIRE, acteur, cible: { type: 'contrat', id: c.id }, detail: { fondateur_le: c.fondateur_le, tarif_gele_jusqu_au_conserve: c.tarif_gele_jusqu_au } },
      true,
    ),
  ]);
  return relire(db, tenantId);
}
