// Le journal (lot 11) : la table `evenement`, horodatée, en écriture seule. Rien ici ne modifie ni n'efface une ligne, et la base
// l'interdit aussi (deux déclencheurs, migration 0008).
//
// En cas de litige sur le nombre d'accès, le journal tranche ; s'il est muet, la décision va au cabinet. Un événement manquant
// se paie donc cher : toute écriture qui doit être journalisée part dans la MÊME transaction que l'événement (`requeteEvenement`
// dans un `batch`), jamais après elle.
//
// Un événement ne porte que des identifiants, des types, des dates et des montants du CONTRAT du cabinet. Pour un accès du
// personnel, son adresse et son rôle s'y ajoutent (sans quoi un accès supprimé ne se lirait plus). Jamais une donnée d'un client
// final : ni nom, ni adresse, ni montant nominatif, ni texte libre. Le journal ne se modifie pas : il ne peut donc rien
// « expurger » plus tard (la purge du J+75 du lot 12 n'a pas à y toucher), la seule défense est de ne jamais l'y écrire.
// `valeurs` le fait respecter : un événement visant un dossier client qui porterait `email` ou `nom` est refusé à l'écriture.

import type { Base, Requete } from './db';

export const EVENEMENT = {
  // Accès du cabinet
  ACCES_CREE: 'acces_cree',
  ACCES_SUPPRIME: 'acces_supprime',
  ACCES_SUSPENDU: 'acces_suspendu',
  ACCES_REACTIVE: 'acces_reactive',
  ACCES_ROLE: 'acces_role',
  // Modules
  MODULE_ACTIVE: 'module_active',
  MODULE_DESACTIVE: 'module_desactive',
  // Lot 15 : une désactivation est une intention datée. `module_desactive` n'est écrit que le jour où elle prend effet (acteur null : le
  // traitement quotidien), ou tout de suite quand le contrat n'a pas encore de date anniversaire.
  MODULE_DESACTIVATION_PROGRAMMEE: 'module_desactivation_programmee',
  MODULE_DESACTIVATION_ANNULEE: 'module_desactivation_annulee',
  // Dossiers clients
  DOSSIER_PUBLIE: 'dossier_publie',
  DOSSIER_ARCHIVE: 'dossier_archive',
  // Contrat
  CONTRAT_CREE: 'contrat_cree',
  MISE_EN_PRODUCTION: 'mise_en_production',
  PRIX_MODIFIE: 'prix_modifie',
  REMISE_SAISIE: 'remise_saisie',
  REMISE_MODIFIEE: 'remise_modifiee',
  GEL_TARIF: 'gel_tarif',
  GEL_TARIF_REFUSE: 'gel_tarif_refuse',
  DPA_SIGNE: 'dpa_signe',
  // Lot 14 : la formule du contrat (périodicité, accès inclus, frais d'installation) et le statut fondateur, posés depuis la console.
  CONTRAT_MODIFIE: 'contrat_modifie',
  STATUT_FONDATEUR: 'statut_fondateur',
  STATUT_FONDATEUR_RETIRE: 'statut_fondateur_retire',
  // Facturation et essai (lot 12). Acteur null : le traitement quotidien. Des identifiants, des dates et des montants du contrat.
  BON_GENERE: 'bon_genere',
  BON_EMIS: 'bon_emis',
  BON_ANNULE: 'bon_annule',
  PARRAINAGE_VALIDE: 'parrainage_valide',
  ESSAI_NON_CONVERTI: 'essai_non_converti',
  CABINET_PURGE: 'cabinet_purge',
  // Lot 17 : la résiliation. Le préavis et son annulation (acteur : l'éditeur), puis le passage en `resilie` à la date d'effet (acteur null :
  // le traitement quotidien). Des identifiants, des dates et le statut du contrat.
  PREAVIS_ENREGISTRE: 'preavis_enregistre',
  PREAVIS_ANNULE: 'preavis_annule',
  CONTRAT_RESILIE: 'contrat_resilie',
  // Lot 13. L'identité de facturation : les NOMS des champs modifiés, jamais leurs valeurs. La facture : l'identifiant du bon.
  IDENTITE_FACTURATION: 'identite_facturation',
  FACTURE_DEPOSEE: 'facture_deposee',
  // L'éditeur et ses comptes
  ACCES_EDITEUR: 'acces_editeur',
  EXPORT_COMPLET: 'export_complet',
  CABINET_SUSPENDU: 'cabinet_suspendu',
  CABINET_LEVE: 'cabinet_leve',
} as const;
export type TypeEvenement = (typeof EVENEMENT)[keyof typeof EVENEMENT];

export interface Acteur {
  id: string;
  role: string;
}

export interface Evenement {
  tenantId: string;
  type: TypeEvenement;
  /** null : le système (un calcul du produit, pas un geste d'une personne). */
  acteur: Acteur | null;
  cible?: { type: 'acces' | 'dossier' | 'contrat' | 'cabinet'; id: string };
  detail?: Record<string, unknown>;
}

const COLONNES = 'id, tenant_id, cree_le, type, acteur_id, acteur_role, cible_type, cible_id, detail';

/** Les clés qui ne doivent jamais accompagner un client final (cible `dossier`). */
const CLES_PERSONNELLES = ['email', 'nom', 'adresse', 'telephone', 'montant', 'libelle'];

function valeurs(e: Evenement): unknown[] {
  if (e.cible?.type === 'dossier' && e.detail) {
    const fautive = Object.keys(e.detail).find((k) => CLES_PERSONNELLES.includes(k));
    if (fautive) throw new Error(`journal : « ${fautive} » n'entre pas dans l'événement d'un dossier client`);
  }
  return [
    crypto.randomUUID(),
    e.tenantId,
    new Date().toISOString(),
    e.type,
    e.acteur?.id ?? null,
    e.acteur?.role ?? null,
    e.cible?.type ?? null,
    e.cible?.id ?? null,
    JSON.stringify(e.detail ?? {}),
  ];
}

/**
 * L'événement, prêt à entrer dans un `batch` avec l'écriture qu'il décrit : tout ou rien.
 * `siChangement` : n'écrit la ligne que si la requête PRÉCÉDENTE du batch a modifié une ligne (une publication qui n'a rien
 * changé ne laisse pas d'événement).
 */
export function requeteEvenement(db: Base, e: Evenement, siChangement = false): Requete {
  const v = valeurs(e);
  if (!siChangement) {
    return db.prepare(`INSERT INTO evenement (${COLONNES}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...v);
  }
  return db.prepare(`INSERT INTO evenement (${COLONNES}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`).bind(...v);
}

/** Écrit un événement seul. Pour ce qui n'est pas lié à une autre écriture (un export, un accès de l'éditeur). */
export async function journaliser(db: Base, e: Evenement): Promise<void> {
  await requeteEvenement(db, e).run();
}

/** Fenêtre au-delà de laquelle un nouvel accès de l'éditeur à un cabinet redonne une ligne. */
const FENETRE_ACCES_MS = 10 * 60 * 1000;

/**
 * Un accès de l'éditeur (ou de son compte de support) aux données d'un cabinet. Une page affichée compte comme un accès ; pour
 * ne pas écrire une ligne par requête, un seul événement est écrit par acteur et par cabinet dans une fenêtre de dix minutes
 * (la première route touchée est dans `detail`). Un export, lui, est toujours journalisé à part : voir `journaliser`.
 * Ne se rattrape pas : si l'écriture échoue, l'erreur remonte et l'accès n'a pas lieu.
 */
export async function journaliserAccesEditeur(db: Base, tenantId: string, acteur: Acteur, route: string): Promise<void> {
  const v = valeurs({
    tenantId,
    type: EVENEMENT.ACCES_EDITEUR,
    acteur,
    cible: { type: 'cabinet', id: tenantId },
    detail: { route: route.slice(0, 200) },
  });
  await db
    .prepare(
      `INSERT INTO evenement (${COLONNES})
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM evenement WHERE tenant_id = ? AND type = ? AND acteur_id = ? AND cree_le > ?
        )`,
    )
    .bind(...v, tenantId, EVENEMENT.ACCES_EDITEUR, acteur.id, new Date(Date.now() - FENETRE_ACCES_MS).toISOString())
    .run();
}

export interface LigneJournal {
  id: string;
  cree_le: string;
  type: string;
  acteur_id: string | null;
  acteur_role: string | null;
  cible_type: string | null;
  cible_id: string | null;
  detail: string;
}

/** Le journal d'un cabinet, du plus récent au plus ancien. Lecture seule, bornée au locataire. */
export async function journalDe(db: Base, tenantId: string, limite = 200): Promise<LigneJournal[]> {
  const { results } = await db
    .prepare(
      `SELECT id, cree_le, type, acteur_id, acteur_role, cible_type, cible_id, detail
         FROM evenement WHERE tenant_id = ? ORDER BY cree_le DESC, id DESC LIMIT ?`,
    )
    .bind(tenantId, Math.min(Math.max(1, limite), 1000))
    .all<LigneJournal>();
  return results;
}
