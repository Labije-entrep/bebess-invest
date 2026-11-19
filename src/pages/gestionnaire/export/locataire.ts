import type { APIRoute } from 'astro';
import { exportLocataire } from '../../../lib/export';
import { GESTION_ECRIT, aLeRole } from '../../../lib/roles';
import { envDe } from '../../../lib/mail';
import { introuvable } from '../../../lib/passerelle';

export const prerender = false;

/** Tout le cabinet, une table par fichier CSV, en une archive ZIP : la sortie de fin de contrat. */
export const GET: APIRoute = async (ctx) => {
  const { utilisateur, tenant } = ctx.locals;
  if (!utilisateur || !tenant || utilisateur.tenant_id !== tenant.id) return introuvable();
  // Le cabinet entier : réservé aux rôles qui écrivent. `lecture` consulte, il n'emporte pas tout le cabinet.
  if (!aLeRole(utilisateur.role, GESTION_ECRIT)) return introuvable();

  const archive = await exportLocataire(envDe(ctx.locals).DB, tenant.id, { id: utilisateur.id, role: utilisateur.role });
  return new Response(archive.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="export-${new Date().toISOString().slice(0, 10)}.zip"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
