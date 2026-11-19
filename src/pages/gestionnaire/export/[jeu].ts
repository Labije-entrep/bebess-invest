import { GESTION_LIT, aLeRole } from '../../../lib/roles';
import type { APIRoute } from 'astro';
import { estJeuSuivi, exportSuivi } from '../../../lib/export';
import { envDe } from '../../../lib/mail';
import { introuvable } from '../../../lib/passerelle';

export const prerender = false;

/** Export CSV d'un jeu du suivi : contacts, sujets, echanges, actus. Personnel du cabinet, locataire de l'hôte. */
export const GET: APIRoute = async (ctx) => {
  const { utilisateur, tenant } = ctx.locals;
  if (!utilisateur || !tenant || utilisateur.tenant_id !== tenant.id) return introuvable();
  if (!aLeRole(utilisateur.role, GESTION_LIT)) return introuvable();
  const jeu = ctx.params.jeu ?? '';
  if (!estJeuSuivi(jeu)) return introuvable();

  const corps = await exportSuivi(envDe(ctx.locals).DB, tenant.id, jeu);
  return new Response(corps, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${jeu}.csv"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
