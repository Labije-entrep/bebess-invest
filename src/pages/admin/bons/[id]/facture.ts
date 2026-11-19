import type { APIRoute } from 'astro';
import { accesCabinet, gardeAdmin, introuvable } from '../../../../lib/admin';
import { bonComplet, factureDuBon } from '../../../../lib/facturation';
import { servirFacture } from '../../../../lib/fichiers';

export const prerender = false;

/** Le PDF de la facture d'un bon émis, pour l'éditeur. Chaque téléchargement est un accès de l'éditeur aux données du cabinet : journalisé. */
export const GET: APIRoute = async (ctx) => {
  const g = gardeAdmin(ctx);
  if (g instanceof Response) return g;
  const bon = await bonComplet(g.db, ctx.params.id ?? '');
  if (!bon) return introuvable();
  await accesCabinet(g, bon.tenant_id, `GET ${ctx.url.pathname}`);
  const facture = await factureDuBon(g.db, bon.tenant_id, bon.id);
  if (!facture) return introuvable();
  return servirFacture(g.env.FICHIERS, bon.tenant_id, facture.cle, { cache: 'private, no-store', telechargement: { nom: facture.numero } });
};
