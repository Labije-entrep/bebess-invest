import type { APIRoute } from 'astro';
import { envDe } from '../../lib/mail';
import { themeConnu } from '../../lib/themes';

export const prerender = false;

// Les seules pages où l'on revient après le choix : celles de l'espace client (jamais une adresse venue du formulaire telle quelle).
const RETOURS = ['/espace', '/espace/portefeuille', '/espace/mouvements', '/espace/rapports'];

/**
 * Le client choisit son thème. POST de formulaire classique, sans JavaScript. Le middleware ne laisse passer ici qu'un viewer connecté
 * (garde de /espace) : le compte modifié est celui de la SESSION, jamais un identifiant lu dans le formulaire, et filtré par cabinet.
 * Le nom est validé contre la liste fermée de themes.ts ; vide ou inconnu, le choix est effacé et l'espace suit le thème du cabinet.
 */
export const POST: APIRoute = async (ctx) => {
  const u = ctx.locals.utilisateur;
  const tenant = ctx.locals.tenant;
  if (!u || !tenant || u.role !== 'viewer') return new Response(null, { status: 404 });
  const f = await ctx.request.formData();
  const theme = themeConnu(String(f.get('theme') ?? ''));
  await envDe(ctx.locals).DB
    .prepare("UPDATE utilisateur SET theme = ? WHERE id = ? AND tenant_id = ? AND role = 'viewer'")
    .bind(theme, u.id, tenant.id)
    .run();
  const retour = String(f.get('retour') ?? '').split('?')[0];
  return ctx.redirect(RETOURS.includes(retour) ? retour : '/espace', 303);
};
