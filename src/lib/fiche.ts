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
import { valeursDe } from './listes';

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
  /** Réel contre cible, dans l'ordre des cibles puis des classes détenues sans cible. */
  classes: Classe[];
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
  libellesClasses: Record<string, string>;
}

/** null si le viewer n'existe pas dans ce locataire. */
export async function panneauPortail(db: Base, tenantId: string, viewerId: string): Promise<PanneauPortail | null> {
  const viewer = await db
    .prepare("SELECT id, nom FROM utilisateur WHERE id = ? AND tenant_id = ? AND role = 'viewer'")
    .bind(viewerId, tenantId)
    .first<{ id: string; nom: string }>();
  if (!viewer) return null;

  const [portefeuilles, enveloppes, cibles, points, visite, classes, seuil] = await Promise.all([
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
    return {
      id: pf.id,
      libelle: pf.libelle,
      totalCents: env.reduce((s, e) => s + e.valorisation_cents, 0),
      classes: repartition(lig, cibles.filter((c) => c.portefeuille_id === pf.id)),
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
    libellesClasses: Object.fromEntries(classes.map((c) => [c.cle, c.libelle])),
  };
}
