// Point d'entrée du Worker (astro.config.mjs : workerEntryPoint).
//
// Astro 5 place son contrôle d'origine (security.checkOrigin) AVANT le middleware de l'application :
// un POST rejeté ne traverse jamais src/middleware.ts et aucune page n'est rendue. Seul ce point
// d'entrée voit ces rejets. Il fait deux choses, uniquement pour POST /connexion et POST /connexion/<jeton> :
//   - il journalise ce que le Worker a vu (Origin, Host, URL, statut) ;
//   - si le POST échoue (contrôle d'origine ou autre), il renvoie l'utilisateur vers la page
//     d'explication au lieu d'un 403 nu. Le contrôle d'origine reste actif : la requête rejetée
//     n'a rien consommé, le jeton n'est pas touché.

import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';
import type { SSRManifest } from 'astro';

const CONFIRMATION = /^\/connexion(\/[^/]+)?$/;

/** Le jeton est un secret : il ne figure jamais dans un journal. */
const masquer = (chemin: string) => chemin.replace(/^(\/connexion\/).*$/, '$1<jeton>');

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  const fetch = async (request: Parameters<typeof handle>[2], env: unknown, context: unknown) => {
    const reponse = await handle(manifest, app, request, env as never, context as never);
    const url = new URL(request.url);
    if (request.method !== 'POST' || !CONFIRMATION.test(url.pathname)) return reponse;
    if (reponse.status < 400) return reponse;

    console.warn(
      `[connexion] POST refusé : statut=${reponse.status} origin=${request.headers.get('origin')} ` +
        `host=${request.headers.get('host')} url=${url.origin}${masquer(url.pathname)} ` +
        `content-type=${request.headers.get('content-type')}`,
    );
    // /connexion : demande de lien. Même sortie, sans prétendre qu'un courriel est parti.
    return new Response(null, {
      status: 303,
      headers: { Location: `${url.pathname}?refus=1`, 'Cache-Control': 'private, no-store' },
    });
  };
  return { default: { fetch } };
}
