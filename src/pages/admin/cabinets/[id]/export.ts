import type { APIRoute } from 'astro';
import { cabinetDe, gardeAdmin, introuvable } from '../../../../lib/admin';
import { exportLocataire, nomFichier } from '../../../../lib/export';

export const prerender = false;

/** L'export complet d'un cabinet : celui du lot 08 (une table par fichier CSV, en ZIP), pour le cabinet visé par l'adresse. */
export const GET: APIRoute = async (ctx) => {
  const g = gardeAdmin(ctx);
  if (g instanceof Response) return g;
  const cabinet = await cabinetDe(g.db, ctx.params.id ?? '');
  if (!cabinet) return introuvable();

  const archive = await exportLocataire(g.db, cabinet.id);
  return new Response(archive.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nomFichier(`export-${cabinet.nom}-${new Date().toISOString().slice(0, 10)}`, 'zip')}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
