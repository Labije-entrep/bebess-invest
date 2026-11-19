// La console de l'éditeur, côté facturation (lot 13) : les contrats et les parrainages de TOUS les cabinets, en lecture seule.
// Les bons sont dans facturation.ts (bonsParStatut, bonComplet), les remises à revoir aussi (remisesARevoir), le journal dans
// journal.ts (journalDe). Rien ici n'écrit. Aucune de ces lectures n'est faite depuis l'hôte d'un cabinet : la garde est celle de
// la console (admin.ts, gardeAdmin).

import type { Contrat } from './contrat';
import type { Base } from './db';

export interface LigneContrat extends Contrat {
  cabinet: string;
}

/** Tous les contrats, ceux en cours d'abord, par cabinet. Prix, modules, remises, gel de tarif, dates : tout ce que le contrat porte. */
export async function contratsDeTous(db: Base): Promise<LigneContrat[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*, t.nom AS cabinet
         FROM contrat c JOIN tenant t ON t.id = c.tenant_id
        ORDER BY t.nom, t.id, (c.statut IN ('brouillon','essai','actif','suspendu')) DESC, c.cree_le DESC`,
    )
    .bind()
    .all<LigneContrat>();
  return results;
}

export interface LigneParrainage {
  id: string;
  parrain_id: string;
  parrain: string;
  filleul_id: string;
  filleul: string;
  statut: 'en_attente' | 'valide' | 'annule';
  cree_le: string;
  valide_le: string | null;
}

export const STATUTS_PARRAINAGE: Record<LigneParrainage['statut'], string> = {
  en_attente: 'En attente',
  valide: 'Validé',
  annule: 'Annulé',
};

/** Les parrainages et leur statut, du plus récent au plus ancien. Le parrain est le cabinet qui touche la remise. */
export async function parrainagesDeTous(db: Base): Promise<LigneParrainage[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.tenant_id AS parrain_id, tp.nom AS parrain, p.filleul_tenant_id AS filleul_id, tf.nom AS filleul, p.statut, p.cree_le, p.valide_le
         FROM parrainage p
         JOIN tenant tp ON tp.id = p.tenant_id
         JOIN tenant tf ON tf.id = p.filleul_tenant_id
        ORDER BY p.cree_le DESC, p.id DESC`,
    )
    .bind()
    .all<LigneParrainage>();
  return results;
}
