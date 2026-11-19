// Panneau Portail de la fiche du module de suivi (lot 04) : lecture seule.
//
// Tout vient du portail et de ses règles, rien n'est recalculé ici : les points de plusieurs
// portefeuilles sont additionnés par `pointsConsolides`, la performance enchaînée par
// `indicateurs` (espace.ts), la répartition par `repartition`. Les portefeuilles archivés sont
// exclus de tout. Chaque lecture est bornée au locataire.

import {
  ciblesDuViewer, enveloppesDuViewer, lignesDesEnveloppes, pointsDuViewer, portefeuillesDuViewer,
  type Base, type Ligne,
} from './db';
import { indicateurs, plusAncien, pointsConsolides, repartition, type Classe } from './espace';
import { ecartAllocation, seuilArrete } from './gestion';
import { valeursDe } from './listes';
import { seuilsDe } from './suivi';

/** Repli du seuil d'écart d'allocation : 5 points (maquette Suivi-Fiche), soit 500 centièmes de point. */
const REPLI_ECART_BP = 500;

export async function seuilEcartBp(db: Base, tenantId: string): Promise<number> {
  const r = await db
    .prepare("SELECT valeur FROM reglage WHERE tenant_id = ? AND cle = 'seuil_ecart_bp'")
    .bind(tenantId)
    .first<{ valeur: string }>();
  const v = r?.valeur.trim() ?? '';
  return /^\d{1,5}$/.test(v) && Number(v) > 0 ? Number(v) : REPLI_ECART_BP;
}

export interface BlocPortefeuille {
  id: string;
  libelle: string;
  totalCents: number;
  /**
   * Réel contre cible, dans l'ordre des cibles puis des classes détenues sans cible. L'écart vient de
   * `ecartAllocation` (la règle du portail) ; il reste nul tant que le portefeuille n'a aucune cible.
   */
  classes: Classe[];
  /** Date du dernier arrêté de ce portefeuille : la plus ancienne de ses enveloppes, lignes et de son dernier point. */
  arrete: string | null;
}

export interface PanneauPortail {
  viewer: { id: string; nom: string };
  portefeuilles: BlocPortefeuille[];
  /** Somme des enveloppes de tous les portefeuilles actifs (à défaut, dernière valeur consolidée). */
  totalCents: number;
  /** La plus ancienne des dates d'arrêté (même règle que le tableau de bord et la liste du suivi). */
  arrete: string | null;
  annee: string | null;
  /** Performance de l'année civile, pondérée par le temps, sur les totaux consolidés (centièmes de point). */
  perfBp: number | null;
  perfOrigineBp: number | null;
  derniereVisite: string | null;
  seuilEcartBp: number;
  /** Au-delà de ce nombre de jours, l'arrêté d'un portefeuille est périmé (réglage `seuil_arrete`). */
  seuilArreteJours: number;
  libellesClasses: Record<string, string>;
}

/** null si le viewer n'existe pas dans ce locataire. */
export async function panneauPortail(db: Base, tenantId: string, viewerId: string): Promise<PanneauPortail | null> {
  const viewer = await db
    .prepare("SELECT id, nom FROM utilisateur WHERE id = ? AND tenant_id = ? AND role = 'viewer'")
    .bind(viewerId, tenantId)
    .first<{ id: string; nom: string }>();
  if (!viewer) return null;

  const [portefeuilles, enveloppes, cibles, points, visite, classes, seuil, seuils] = await Promise.all([
    portefeuillesDuViewer(db, tenantId, viewerId),
    enveloppesDuViewer(db, tenantId, viewerId),
    ciblesDuViewer(db, tenantId, viewerId),
    pointsDuViewer(db, tenantId, viewerId),
    db
      .prepare(
        `SELECT MAX(c.vue_le) AS vue FROM consultation c
           JOIN utilisateur u ON u.id = c.viewer_id
          WHERE c.viewer_id = ? AND u.tenant_id = ?`,
      )
      .bind(viewerId, tenantId)
      .first<{ vue: string | null }>(),
    valeursDe(db, tenantId, 'classe_actif'),
    seuilEcartBp(db, tenantId),
    seuilsDe(db, tenantId),
  ]);
  const lignes = await lignesDesEnveloppes(db, enveloppes.map((e) => e.id));

  const chiffres = indicateurs(pointsConsolides(points), enveloppes, lignes);

  // Dernier point de chaque portefeuille : points est trié par date croissante.
  const dernierPoint = new Map<string, string>();
  for (const p of points) dernierPoint.set(p.portefeuille_id, p.date);
  const arrete = plusAncien([
    ...enveloppes.map((e) => e.arrete_le),
    ...lignes.map((l) => l.arrete_le),
    ...dernierPoint.values(),
  ]);

  const blocs: BlocPortefeuille[] = portefeuilles.map((pf) => {
    const env = enveloppes.filter((e) => e.portefeuille_id === pf.id);
    const ids = new Set(env.map((e) => e.id));
    const lig: Ligne[] = lignes.filter((l) => ids.has(l.enveloppe_id));
    const cib = cibles.filter((c) => c.portefeuille_id === pf.id);
    // Sans cible du tout, une classe n'a pas d'écart à signaler (sinon tout le portefeuille serait « hors cible »).
    const ecarts = cib.length > 0 ? new Map(ecartAllocation(lig, cib).map((e) => [e.classe, e.ecart_bp])) : null;
    return {
      id: pf.id,
      libelle: pf.libelle,
      totalCents: env.reduce((s, e) => s + e.valorisation_cents, 0),
      classes: repartition(lig, cib).map((c) => ({ ...c, ecartBp: ecarts ? (ecarts.get(c.classe) ?? null) : null })),
      arrete: plusAncien([
        ...env.map((e) => e.arrete_le),
        ...lig.map((l) => l.arrete_le),
        ...(dernierPoint.has(pf.id) ? [dernierPoint.get(pf.id)!] : []),
      ]),
    };
  });

  return {
    viewer,
    portefeuilles: blocs,
    totalCents: chiffres.totalCents,
    arrete,
    annee: chiffres.annee,
    perfBp: chiffres.perfBp,
    perfOrigineBp: chiffres.perfOrigineBp,
    derniereVisite: visite?.vue ?? null,
    seuilEcartBp: seuil,
    seuilArreteJours: seuils.arrete,
    libellesClasses: Object.fromEntries(classes.map((c) => [c.cle, c.libelle])),
  };
}

// ---------------------------------------------------------------- passerelle (lot 07)
// Ce que le panneau propose de transformer en sujet. Même fonction pour l'écran et pour la route qui crée le
// sujet : la route recalcule, elle ne croit rien de ce que le navigateur lui dit.

export interface EcartHorsSeuil {
  classe: string;
  libelle: string;
  /** Une entrée par portefeuille où la classe dépasse le seuil. */
  portefeuilles: { libelle: string; partBp: number; cibleBp: number; ecartBp: number }[];
}

/** Les classes dont l'écart d'allocation dépasse `seuil_ecart_bp` (en valeur absolue), dans l'ordre d'apparition. */
export function ecartsHorsSeuil(p: PanneauPortail): EcartHorsSeuil[] {
  const parClasse = new Map<string, EcartHorsSeuil>();
  for (const b of p.portefeuilles) {
    for (const c of b.classes) {
      if (c.ecartBp === null || Math.abs(c.ecartBp) <= p.seuilEcartBp) continue;
      const e = parClasse.get(c.classe) ?? { classe: c.classe, libelle: p.libellesClasses[c.classe] ?? c.classe, portefeuilles: [] };
      e.portefeuilles.push({ libelle: b.libelle, partBp: c.partBp, cibleBp: c.cibleBp ?? 0, ecartBp: c.ecartBp });
      parClasse.set(c.classe, e);
    }
  }
  return [...parClasse.values()];
}

/** Les portefeuilles dont le dernier arrêté a plus de `seuil_arrete` jours (strictement). Sans arrêté : rien à dire. */
export function arretesPerimes(p: PanneauPortail): (BlocPortefeuille & { arrete: string })[] {
  const limite = seuilArrete(p.seuilArreteJours);
  return p.portefeuilles.filter((b): b is BlocPortefeuille & { arrete: string } => b.arrete !== null && b.arrete < limite);
}
