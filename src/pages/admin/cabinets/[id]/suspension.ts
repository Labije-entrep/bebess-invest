import type { APIRoute } from 'astro';
import { cabinetDe, gardeAdmin, introuvable, leverSuspension, suspendre } from '../../../../lib/admin';

export const prerender = false;

/**
 * Suspendre un cabinet (motif obligatoire, horodaté) ou lever sa suspension. Éditeur seulement. Jamais appelée
 * par autre chose qu'un formulaire de la console : aucune suspension automatique, pour aucun motif.
 */
export const POST: APIRoute = async (ctx) => {
  const g = gardeAdmin(ctx);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (!(await cabinetDe(g.db, id))) return introuvable();

  const f = await ctx.request.formData();
  const action = String(f.get('action') ?? '');
  const r =
    action === 'suspendre' ? await suspendre(g.db, id, String(f.get('motif') ?? ''), g.utilisateur.id)
    : action === 'lever' ? await leverSuspension(g.db, id, g.utilisateur.id)
    : null;
  if (!r) return new Response('Action inconnue.', { status: 400 });
  return ctx.redirect(`/admin/cabinets/${encodeURIComponent(id)}?r=${r.code}&ok=${r.ok ? 1 : 0}`, 303);
};
