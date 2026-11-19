import type { APIRoute } from 'astro';
import { appartient } from '../../../lib/cloisonnement';
import { servir } from '../../../lib/fichiers';
import { envDe } from '../../../lib/mail';

export const prerender = false;

/** Logo d'un contact : personnel du cabinet seulement (gestionnaire, éditeur), contact du locataire. Sinon 404. */
export const GET: APIRoute = async (ctx) => {
  const { utilisateur, tenant } = ctx.locals;
  const introuvable = () => new Response('Introuvable.', { status: 404 });
  if (!utilisateur || !tenant || utilisateur.tenant_id !== tenant.id) return introuvable();
  if (utilisateur.role !== 'gestionnaire' && utilisateur.role !== 'editeur') return introuvable();

  const env = envDe(ctx.locals);
  const id = ctx.params.id ?? '';
  if (id.length > 64 || !(await appartient(env.DB, tenant.id, 'contact', id))) return introuvable();
  const c = await env.DB
    .prepare('SELECT logo_cle FROM contact WHERE id = ? AND tenant_id = ?')
    .bind(id, tenant.id)
    .first<{ logo_cle: string | null }>();
  return servir(env.FICHIERS, tenant.id, c?.logo_cle ?? null, { cache: 'private, no-store' });
};
