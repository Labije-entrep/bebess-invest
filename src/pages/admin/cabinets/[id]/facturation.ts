import type { APIRoute } from 'astro';
import { accesCabinet, cabinetDe, gardeAdmin, introuvable } from '../../../../lib/admin';
import { poserIdentite } from '../../../../lib/identite';

export const prerender = false;

/**
 * Pose l'identité de facturation d'un cabinet : SIREN, adresse, contact. Éditeur seulement. Un SIREN saisi doit être juste (neuf
 * chiffres, clé de Luhn) et n'être celui d'aucun autre cabinet : sinon rien n'est enregistré. Le journal garde les noms des champs
 * modifiés, jamais leurs valeurs.
 */
export const POST: APIRoute = async (ctx) => {
  const g = gardeAdmin(ctx);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (!(await cabinetDe(g.db, id))) return introuvable();
  await accesCabinet(g, id, `POST ${ctx.url.pathname}`);
  const r = await poserIdentite(g.db, id, await ctx.request.formData(), { id: g.utilisateur.id, role: g.utilisateur.role });
  const code = r.ok ? (r.modifies.length > 0 ? 'identite' : 'identite_inchangee') : r.code === 'invalide' ? 'siren_invalide' : r.code;
  if (!r.ok && r.code === 'cabinet_inconnu') return introuvable();
  return ctx.redirect(`/admin/cabinets/${encodeURIComponent(id)}?r=${code}&ok=${r.ok ? 1 : 0}`, 303);
};
