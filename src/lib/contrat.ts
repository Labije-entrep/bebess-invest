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
// locataire) ; resilie et essai_non_converti sont de l'historique. Le lot 12 déclenche le calendrier d'essai sur ces statuts.
// `suspendu` est le statut du CONTRAT (litige de facturation) : rien à voir avec la suspension d'un cabinet (admin.ts), qui est
// une mesure d'accès et ne change pas le contrat.
//
// Chaque modification part dans le même `batch` que son événement (journal.ts). Aucun texte n'est généré : les refus sont des codes
// fixes traduits par MESSAGES_CONTRAT.

import type { Base } from './db';
import { EVENEMENT, journaliser, requeteEvenement, type Acteur } from './journal';
import { ajouterMois } from './tarif';

export interface Prix {
  prix_socle: number;
  prix_pilotage: number;
  prix_site: number;
  prix_acces_sup: number;
}
export const CHAMPS_PRIX: (keyof Prix)[] = ['prix_socle', 'prix_pilotage', 'prix_site', 'prix_acces_sup'];

export const STATUTS_CONTRAT = ['brouillon', 'essai', 'actif', 'suspendu', 'resilie', 'essai_non_converti'] as const;
export type StatutContrat = (typeof STATUTS_CONTRAT)[number];
/** Ceux d'un contrat « en cours » : le locataire n'en a qu'un. */
export const STATUTS_EN_COURS: StatutContrat[] = ['brouillon', 'essai', 'actif', 'suspendu'];
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
  cree_le: string;
  maj_le: string;
}

const COLONNES =
  `id, tenant_id, statut, periodicite, debut_le, fin_le, date_mise_en_production, date_fin_essai, ${CHAMPS_PRIX.join(', ')}, module_pilotage, module_site,
   acces_inclus, frais_installation, tarif_gele_jusqu_au, remise_parrainage_taux, remise_commerciale_taux, remise_motif, remise_revue_le,
   dpa_signe_le, preavis_recu_le, cree_le, maj_le`;

export type CodeContrat =
  | 'aucun_contrat' | 'deja_un_contrat' | 'tarif_gele' | 'gel_raccourci' | 'gel_efface' | 'deja_en_production' | 'dpa_manquant' | 'date_invalide' | 'montant_invalide' | 'taux_invalide'
  | 'motif_requis' | 'revue_requise' | 'periodicite' | 'inchange' | 'fondateur_remise';
export type ResultatContrat = { ok: true; contrat: Contrat } | { ok: false; code: CodeContrat };

export const MESSAGES_CONTRAT: Record<CodeContrat, string> = {
  aucun_contrat: 'Ce cabinet n’a pas de contrat en cours.',
  deja_un_contrat: 'Ce cabinet a déjà un contrat en cours : un seul à la fois.',
  tarif_gele: 'Le tarif est gelé : aucun prix ne se modifie avant la fin du gel.',
  gel_raccourci: 'Le gel du tarif ne se raccourcit pas : une date de gel se prolonge seulement.',
  gel_efface: 'Le gel du tarif ne s’efface pas : une date de gel se prolonge seulement.',
  deja_en_production: 'Ce contrat est déjà au-delà de l’essai : la date de mise en production ne se change plus.',
  dpa_manquant: 'La mise en production exige un DPA signé : renseignez sa date d’abord.',
  date_invalide: 'Date invalide : AAAA-MM-JJ.',
  montant_invalide: 'Montant invalide : des centimes entiers, positifs ou nuls.',
  taux_invalide: 'Taux invalide : entre 0 et 10 000 centièmes de point.',
  motif_requis: 'Une remise commerciale exige un motif.',
  revue_requise: 'Une remise commerciale exige une date de revue.',
  periodicite: 'Périodicité inconnue : mensuelle ou annuelle.',
  inchange: 'Rien à modifier.',
  fondateur_remise: 'Le statut fondateur et une remise commerciale ne se cumulent pas : le motif « fondateur » est le motif de la remise. Aucun pourcentage n’est posé.',
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

/** Active ou désactive un module. Sans effet (refus `inchange`) s'il est déjà dans cet état : pas d'événement pour rien. */
export async function basculerModule(db: Base, tenantId: string, module: Module, actif: boolean, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  const colonne = module === 'pilotage' ? 'module_pilotage' : 'module_site';
  if ((c[colonne] === 1) === actif) return refus('inchange');
  await db.batch([
    db.prepare(`UPDATE contrat SET ${colonne} = ?, maj_le = ? WHERE id = ? AND tenant_id = ?`).bind(actif ? 1 : 0, maintenant(), c.id, tenantId),
    requeteEvenement(
      db,
      { tenantId, type: actif ? EVENEMENT.MODULE_ACTIVE : EVENEMENT.MODULE_DESACTIVE, acteur, cible: { type: 'contrat', id: c.id }, detail: { module } },
      true,
    ),
  ]);
  return relire(db, tenantId);
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
  if (commerciale > 0 && c.remise_motif === MOTIF_FONDATEUR) return refus('fondateur_remise');
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

// ---------------------------------------------------------------- le statut fondateur (lot 14)

/** Le motif qui MARQUE un cabinet fondateur : c'est lui que `compterFondateurs` retrouve. Il occupe `remise_motif`, sans pourcentage. */
export const MOTIF_FONDATEUR = 'Cabinet fondateur — co-conception et référence';
/** Le gel du tarif d'un fondateur : sa date de signature + 24 mois. */
export const MOIS_GEL_FONDATEUR = 24;

export const estFondateur = (c: Pick<Contrat, 'remise_motif'>): boolean => c.remise_motif === MOTIF_FONDATEUR;

/** Combien de contrats en cours portent le statut fondateur, sur combien : le statut doit rester exceptionnel. */
export async function compterFondateurs(db: Base): Promise<{ fondateurs: number; contrats: number }> {
  const en = STATUTS_EN_COURS.map((x) => `'${x}'`).join(',');
  const r = await db
    .prepare(`SELECT COUNT(*) AS contrats, COALESCE(SUM(remise_motif = ?), 0) AS fondateurs FROM contrat WHERE statut IN (${en})`)
    .bind(MOTIF_FONDATEUR)
    .first<{ contrats: number; fondateurs: number }>();
  return { fondateurs: r?.fondateurs ?? 0, contrats: r?.contrats ?? 0 };
}

/**
 * Pose le statut fondateur EN UNE ÉCRITURE : frais d'installation à zéro, gel du tarif jusqu'à la signature + 24 mois, motif
 * « Cabinet fondateur — co-conception et référence ». Aucun pourcentage de remise n'est posé. Mêmes garde-fous que le gel : une date
 * qui raccourcirait un gel existant est refusée (et le refus journalisé) ; une remise commerciale en cours est refusée aussi, son motif
 * serait écrasé. Un seul événement `statut_fondateur` porte l'avant et l'après.
 */
export async function poserStatutFondateur(db: Base, tenantId: string, signeLe: string, acteur: Acteur | null): Promise<ResultatContrat> {
  const c = await contratEnCours(db, tenantId);
  if (!c) return refus('aucun_contrat');
  if (!dateIso(signeLe)) return refus('date_invalide');
  if (c.remise_commerciale_taux > 0) return refus('fondateur_remise');
  const gel = ajouterMois(signeLe, MOIS_GEL_FONDATEUR);
  const actuel = c.tarif_gele_jusqu_au;
  if (actuel !== null && gel < actuel) {
    await journaliser(db, { tenantId, type: EVENEMENT.GEL_TARIF_REFUSE, acteur, cible: { type: 'contrat', id: c.id }, detail: { actuel, tentative: gel, motif: 'gel_raccourci' } });
    return refus('gel_raccourci');
  }
  if (c.frais_installation === 0 && actuel === gel && estFondateur(c)) return refus('inchange');
  try {
    await db.batch([
      db
        .prepare('UPDATE contrat SET frais_installation = 0, tarif_gele_jusqu_au = ?, remise_motif = ?, maj_le = ? WHERE id = ? AND tenant_id = ?')
        .bind(gel, MOTIF_FONDATEUR, maintenant(), c.id, tenantId),
      requeteEvenement(
        db,
        {
          tenantId, type: EVENEMENT.STATUT_FONDATEUR, acteur, cible: { type: 'contrat', id: c.id },
          detail: { signe_le: signeLe, avant: { frais_installation: c.frais_installation, tarif_gele_jusqu_au: actuel }, apres: { frais_installation: 0, tarif_gele_jusqu_au: gel } },
        },
        true,
      ),
    ]);
  } catch {
    return refus('gel_raccourci');
  }
  return relire(db, tenantId);
}
