import type { APIRoute } from 'astro';
import { cabinetDe, declarerDomaine, gardeAdmin, introuvable, retirerDomaine, verifierDomaine } from '../../../../lib/admin';

export const prerender = false;

/** Déclarer, vérifier ou retirer un nom d'hôte du cabinet. Éditeur seulement ; l'appel à Cloudflare se fait ici, côté serveur. */
export const POST: APIRoute = async (ctx) => {
  const g = gardeAdmin(ctx);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (!(await cabinetDe(g.db, id))) return introuvable();

  const f = await ctx.request.formData();
  const action = String(f.get('action') ?? '');
  const hote = String(f.get('hote') ?? '').slice(0, 253);
  const r =
    action === 'declarer' ? await declarerDomaine(g.db, g.env, id, hote)
    : action === 'verifier' ? await verifierDomaine(g.db, g.env, id, hote)
    : action === 'retirer' ? await retirerDomaine(g.db, g.env, id, hote)
    : null;
  if (!r) return new Response('Action inconnue.', { status: 400 });
  return ctx.redirect(`/admin/cabinets/${encodeURIComponent(id)}?r=${r.code}&ok=${r.ok ? 1 : 0}`, 303);
};
