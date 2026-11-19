import type { APIRoute } from 'astro';
import { appartient } from '../../../../lib/cloisonnement';
import { garde, introuvable } from '../../../../lib/passerelle';

export const prerender = false;

/**
 * Rattache un rapport déjà déposé à un autre portefeuille de son viewer (ou à tout le dossier : champ vide). Seule la colonne
 * `portefeuille_id` change : le fichier de R2, sa clé et la ligne du document sont intacts. Même règle qu'au dépôt : le
 * portefeuille doit être à CE viewer, dans CE cabinet, et ne pas être archivé. Document inconnu ou d'un autre cabinet : 404.
 */
export const POST: APIRoute = async (ctx) => {
  const g = garde(ctx, ['gestionnaire', 'editeur']);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (id.length > 64 || !(await appartient(g.db, g.tenant.id, 'document', id))) return introuvable();

  const d = await g.db
    .prepare('SELECT d.viewer_id FROM document d JOIN utilisateur u ON u.id = d.viewer_id WHERE d.id = ? AND u.tenant_id = ?')
    .bind(id, g.tenant.id)
    .first<{ viewer_id: string }>();
  if (!d) return introuvable();
  const retour = (q: string) => ctx.redirect(`/gestionnaire/viewers/${encodeURIComponent(d.viewer_id)}?onglet=rapports&${q}`, 303);

  const f = await ctx.request.formData();
  const pfId = String(f.get('portefeuille_id') ?? '').slice(0, 64);
  if (pfId) {
    const pf = await g.db
      .prepare('SELECT id FROM portefeuille WHERE id = ? AND viewer_id = ? AND tenant_id = ? AND archive = 0')
      .bind(pfId, d.viewer_id, g.tenant.id)
      .first();
    if (!pf) return retour('erreur=portefeuille');
  }
  await g.db
    .prepare('UPDATE document SET portefeuille_id = ? WHERE id = ? AND viewer_id = ?')
    .bind(pfId || null, id, d.viewer_id)
    .run();
  return retour('ok=rattache');
};
