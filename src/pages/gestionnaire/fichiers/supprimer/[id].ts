import type { APIRoute } from 'astro';
import { appartient } from '../../../../lib/cloisonnement';
import { supprimer } from '../../../../lib/fichiers';
import { envDe } from '../../../../lib/mail';
import { garde, introuvable } from '../../../../lib/passerelle';

export const prerender = false;

/** Retire un rapport : la ligne, puis l'objet. Document inconnu ou d'un autre cabinet : 404. */
export const POST: APIRoute = async (ctx) => {
  const g = garde(ctx, ['gestionnaire', 'editeur']);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (id.length > 64 || !(await appartient(g.db, g.tenant.id, 'document', id))) return introuvable();

  const d = await g.db
    .prepare(
      `SELECT d.viewer_id, d.cle_fichier FROM document d JOIN utilisateur u ON u.id = d.viewer_id
        WHERE d.id = ? AND u.tenant_id = ?`,
    )
    .bind(id, g.tenant.id)
    .first<{ viewer_id: string; cle_fichier: string | null }>();
  if (!d) return introuvable();
  await g.db.prepare('DELETE FROM document WHERE id = ? AND viewer_id = ?').bind(id, d.viewer_id).run();
  await supprimer(envDe(ctx.locals).FICHIERS, g.tenant.id, d.cle_fichier);
  return ctx.redirect(`/gestionnaire/viewers/${encodeURIComponent(d.viewer_id)}?onglet=rapports&ok=supprime`, 303);
};
