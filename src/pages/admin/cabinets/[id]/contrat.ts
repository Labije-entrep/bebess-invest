import type { APIRoute } from 'astro';
import { accesCabinet, cabinetDe, gardeAdmin, introuvable } from '../../../../lib/admin';
import { appliquerContrat } from '../../../../lib/contrat-ecran';

export const prerender = false;

/**
 * Écrit le contrat d'un cabinet depuis la console (lot 14) : formule et prix, modules, remise commerciale, gel du tarif, DPA, mise en
 * production, statut fondateur. Éditeur seulement (`gardeAdmin` : un gestionnaire reçoit 403, comme sur toute la console). Les garde-fous
 * sont ceux de contrat.ts ; chaque écriture part avec son événement. Le retour est un CODE, traduit par la fiche (jamais un texte).
 */
export const POST: APIRoute = async (ctx) => {
  const g = gardeAdmin(ctx);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (!(await cabinetDe(g.db, id))) return introuvable();
  await accesCabinet(g, id, `POST ${ctx.url.pathname}`);
  const r = await appliquerContrat(g.db, id, await ctx.request.formData(), { id: g.utilisateur.id, role: g.utilisateur.role });
  const plus = r.complementaire ? `&mois=${r.complementaire.mois}&ht=${r.complementaire.total_ht}&jusqu=${r.complementaire.anniversaire}` : '';
  return ctx.redirect(`/admin/cabinets/${encodeURIComponent(id)}?r=${r.code}&ok=${r.ok ? 1 : 0}${plus}#contrat`, 303);
};
