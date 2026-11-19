import type { APIRoute } from 'astro';
import { appartient } from '../../../../lib/cloisonnement';
import { cleLogoContact, corpsTropGros, deposer, lireDepot, supprimer } from '../../../../lib/fichiers';
import { envDe } from '../../../../lib/mail';
import { garde, introuvable } from '../../../../lib/passerelle';
import { GESTION_ECRIT } from '../../../../lib/roles';
import { incrementerVersion } from '../../../../lib/version';

export const prerender = false;

/** Dépose (champ `fichier`) ou retire (`action=retirer`) le logo d'un contact du cabinet. PNG, JPEG ou WebP, 512 Ko au plus. */
export const POST: APIRoute = async (ctx) => {
  const g = garde(ctx, GESTION_ECRIT);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (id.length > 64 || !(await appartient(g.db, g.tenant.id, 'contact', id))) return introuvable();
  const retour = (pm: string) => ctx.redirect(`/gestionnaire/suivi/${encodeURIComponent(id)}?pm=${pm}`, 303);
  if (corpsTropGros(ctx.request, 'logo')) return retour('logo_trop_gros');

  const f = await ctx.request.formData();
  const env = envDe(ctx.locals);
  const ancien = (
    await g.db.prepare('SELECT logo_cle FROM contact WHERE id = ? AND tenant_id = ?').bind(id, g.tenant.id).first<{ logo_cle: string | null }>()
  )?.logo_cle;

  let nouvelle: string | null = null;
  if (f.get('action') !== 'retirer') {
    const depot = await lireDepot(f.get('fichier'), 'logo');
    if (typeof depot === 'string') return retour(`logo_${depot}`);
    nouvelle = cleLogoContact(g.tenant.id, id, depot.type);
    await deposer(env.FICHIERS, nouvelle, depot);
  }
  await g.db
    .prepare('UPDATE contact SET logo_cle = ?, maj_le = ? WHERE id = ? AND tenant_id = ?')
    .bind(nouvelle, new Date().toISOString(), id, g.tenant.id)
    .run();
  await supprimer(env.FICHIERS, g.tenant.id, ancien);
  await incrementerVersion(g.db, g.tenant.id);
  return retour(nouvelle ? 'logo_ok' : 'logo_retire');
};
