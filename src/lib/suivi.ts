// Données de lecture propres au module de suivi : seuils du cabinet et avoirs issus du portail.

import type { Base } from './db';
import { viewersResumes } from './gestion';

/** Seuils en jours. Valeurs de repli quand la clé de `reglage` est absente ou illisible : 7 et 60 sont celles de
 *  la maquette Suivi-Clients (« à rappeler sous 7 j », « sans échange 60 j »), 45 celle de l'arrêté périmé du
 *  tableau de bord (`seuilArrete`). Le cabinet les remplace dans /gestionnaire/reglages. */
export interface Seuils {
  sans_echange: number;
  relance: number;
  arrete: number;
}

/** Valeurs par défaut des seuils en jours : l'écran des réglages (/gestionnaire/reglages) les rappelle. */
export const REPLI: Seuils = { sans_echange: 60, relance: 7, arrete: 45 };
const CLES: Record<keyof Seuils, string> = {
  sans_echange: 'seuil_sans_echange',
  relance: 'seuil_relance',
  arrete: 'seuil_arrete',
};

/** Un seuil en jours tel que `reglage` le porte : un entier strictement positif, sinon le repli (clé absente ou illisible). */
export function joursOuRepli(valeur: string | null | undefined, repli: number): number {
  return valeur != null && /^\d{1,4}$/.test(valeur.trim()) && Number(valeur) > 0 ? Number(valeur) : repli;
}

export async function seuilsDe(db: Base, tenantId: string): Promise<Seuils> {
  const { results } = await db
    .prepare("SELECT cle, valeur FROM reglage WHERE tenant_id = ? AND cle IN ('seuil_sans_echange', 'seuil_relance', 'seuil_arrete')")
    .bind(tenantId)
    .all<{ cle: string; valeur: string }>();
  const lu = new Map(results.map((r) => [r.cle, r.valeur]));
  const entier = (cle: string, repli: number): number => joursOuRepli(lu.get(cle), repli);
  return {
    sans_echange: entier(CLES.sans_echange, REPLI.sans_echange),
    relance: entier(CLES.relance, REPLI.relance),
    arrete: entier(CLES.arrete, REPLI.arrete),
  };
}

export interface AvoirsPortail {
  cents: number;
  /** Date du plus ancien arrêté parmi ceux qui composent le total (même règle que le tableau de bord). */
  le: string | null;
}

/** Avoirs des contacts rattachés à un viewer : mêmes encours et même date que le tableau de bord. */
export async function avoirsDesViewers(db: Base, tenantId: string): Promise<Record<string, AvoirsPortail>> {
  const resumes = await viewersResumes(db, tenantId);
  return Object.fromEntries(resumes.map((v) => [v.id, { cents: v.encours, le: v.arrete }]));
}
