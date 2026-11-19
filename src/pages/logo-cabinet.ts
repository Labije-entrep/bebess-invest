import type { APIRoute } from 'astro';
import { cleLogoDuCabinet, servir } from '../lib/fichiers';
import { envDe } from '../lib/mail';

export const prerender = false;

/**
 * Logo du cabinet, pour le site et l'espace. Seule route de fichier sans session : une marque s'affiche
 * aux visiteurs du site. Elle reste une route du Worker, pas une URL de R2 : le locataire vient de l'hôte
 * de la requête, jamais de l'adresse, et la clé lue est celle de CE locataire.
 */
export const GET: APIRoute = async (ctx) => {
  const tenant = ctx.locals.tenant;
  if (!tenant) return new Response('Introuvable.', { status: 404 });
  const env = envDe(ctx.locals);
  return servir(env.FICHIERS, tenant.id, await cleLogoDuCabinet(env.DB, tenant.id), {
    cache: 'public, max-age=3600',
  });
};
