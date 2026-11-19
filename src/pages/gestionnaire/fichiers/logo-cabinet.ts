import type { APIRoute } from 'astro';
import { cleLogoCabinet, cleLogoDuCabinet, corpsTropGros, deposer, lireDepot, supprimer } from '../../../lib/fichiers';
import { envDe } from '../../../lib/mail';
import { garde } from '../../../lib/passerelle';
import { GESTION_ECRIT } from '../../../lib/roles';

export const prerender = false;

/** Dépose (champ `fichier`) ou retire (`action=retirer`) le logo du cabinet, affiché sur le site et dans l'espace. */
export const POST: APIRoute = async (ctx) => {
  const g = garde(ctx, GESTION_ECRIT);
  if (g instanceof Response) return g;
  // Le formulaire des réglages (Identité) ajoute ?retour=reglages ; le tableau de bord garde son retour d'origine.
  const versReglages = ctx.url.searchParams.get('retour') === 'reglages';
  const retour = (q: string) => ctx.redirect(versReglages ? `/gestionnaire/reglages?onglet=identite&logo=${q}` : `/gestionnaire?logo=${q}`, 303);
  if (corpsTropGros(ctx.request, 'logo')) return retour('trop_gros');

  const f = await ctx.request.formData();
  const env = envDe(ctx.locals);
  const ancien = await cleLogoDuCabinet(g.db, g.tenant.id);

  if (f.get('action') === 'retirer') {
    await g.db.prepare("DELETE FROM reglage WHERE tenant_id = ? AND cle = 'logo_cle'").bind(g.tenant.id).run();
    await supprimer(env.FICHIERS, g.tenant.id, ancien);
    return retour('retire');
  }
  const depot = await lireDepot(f.get('fichier'), 'logo');
  if (typeof depot === 'string') return retour(depot);
  const cle = cleLogoCabinet(g.tenant.id, depot.type);
  await deposer(env.FICHIERS, cle, depot);
  await g.db
    .prepare(
      `INSERT INTO reglage (tenant_id, cle, valeur) VALUES (?, 'logo_cle', ?)
       ON CONFLICT (tenant_id, cle) DO UPDATE SET valeur = excluded.valeur`,
    )
    .bind(g.tenant.id, cle)
    .run();
  await supprimer(env.FICHIERS, g.tenant.id, ancien);
  return retour('ok');
};
