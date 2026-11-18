// Version du jeu de données d'un cabinet : incrémentée par toute écriture du module de suivi,
// lue par les clients pour savoir s'ils doivent se resynchroniser.

import type { Base } from './db';

export async function incrementerVersion(db: Base, tenantId: string): Promise<number> {
  await db
    .prepare(
      `INSERT INTO version_locataire (tenant_id, version) VALUES (?, 2)
       ON CONFLICT(tenant_id) DO UPDATE SET version = version + 1`,
    )
    .bind(tenantId)
    .run();
  return versionDe(db, tenantId);
}

export async function versionDe(db: Base, tenantId: string): Promise<number> {
  const r = await db
    .prepare('SELECT version FROM version_locataire WHERE tenant_id = ?')
    .bind(tenantId)
    .first<{ version: number }>();
  return r?.version ?? 1;
}
