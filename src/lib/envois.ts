// Le registre des envois du traitement quotidien (lot 12) : ce qui rend « rejouable dix fois » vrai pour un courriel.
//
// Une action qui ne doit avoir lieu qu'une fois (un courriel à un destinataire, un incident signalé à l'éditeur) porte une clé.
// La clé est RÉSERVÉE d'abord : la clé primaire de `envoi_automatique` n'admet qu'une ligne, donc deux passes simultanées ou dix
// passes successives ne réservent qu'une fois. L'action se fait ensuite. Si elle échoue (et qu'on le constate), la réservation est
// libérée : la passe suivante retentera. Si le processus meurt entre la réservation et l'envoi, la clé reste prise et rien ne
// repart : on préfère un courriel manquant, que l'éditeur voit, à un courriel en double chez un cabinet.

import type { Base } from './db';
import type { Env, Mailer } from './mail';

/** Ce que le traitement quotidien reçoit : la base, l'environnement, le jour traité et la façon d'obtenir un pilote de courriel. */
export interface Contexte {
  db: Base;
  env: Env;
  /** AAAA-MM-JJ, UTC : le jour que cette passe traite. */
  jour: string;
  /** ISO 8601, UTC. */
  maintenant: string;
  /** `hote` : l'hôte du cabinet destinataire (le pilote console ne s'en sert qu'en local). */
  mailer: (hote: string) => Mailer;
}

/** Nombre de lignes modifiées par une requête D1 (`meta.changes`). */
export const lignesModifiees = (resultat: unknown): number =>
  (resultat as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;

export type EtatEnvoi = { etat: 'fait' } | { etat: 'deja' } | { etat: 'echec'; message: string };

/** `instant` : celui de la passe (Contexte.maintenant), pour que les dates du registre soient celles du jour traité. */
export async function unePremiereFois(db: Base, tenantId: string, cle: string, instant: string, action: () => Promise<void>): Promise<EtatEnvoi> {
  const reservation = await db
    .prepare('INSERT INTO envoi_automatique (cle, tenant_id, reserve_le) VALUES (?, ?, ?) ON CONFLICT(cle) DO NOTHING')
    .bind(cle, tenantId, instant)
    .run();
  if (lignesModifiees(reservation) === 0) return { etat: 'deja' };
  try {
    await action();
  } catch (e) {
    await db.prepare('DELETE FROM envoi_automatique WHERE cle = ? AND envoye_le IS NULL').bind(cle).run();
    return { etat: 'echec', message: e instanceof Error ? e.message : 'erreur' };
  }
  await db.prepare('UPDATE envoi_automatique SET envoye_le = ? WHERE cle = ?').bind(instant, cle).run();
  return { etat: 'fait' };
}
