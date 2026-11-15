import { defineMiddleware } from 'astro:middleware';

const PUBLIC = 'public, s-maxage=60, stale-while-revalidate=600';
const PRIVE = 'private, no-store';

function estPrive(chemin: string): boolean {
  return ['/espace', '/gestionnaire'].some((p) => chemin === p || chemin.startsWith(`${p}/`));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const reponse = await next();
  const resultat = new Response(reponse.body, reponse);

  if (estPrive(context.url.pathname)) {
    // Toujours, quel que soit le statut : une page authentifiée ne doit jamais être mise en cache.
    resultat.headers.set('Cache-Control', PRIVE);
  } else if (
    (context.request.method === 'GET' || context.request.method === 'HEAD') &&
    resultat.status === 200 &&
    !resultat.headers.has('Cache-Control')
  ) {
    resultat.headers.set('Cache-Control', PUBLIC);
  }

  return resultat;
});
