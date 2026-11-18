import type { APIRoute } from 'astro';
import { garde, json } from '../../../lib/api-suivi';
import { versionDe } from '../../../lib/version';

export const prerender = false;

/** Réponse minuscule, avec ETag : un client qui renvoie If-None-Match reçoit 304 sans corps. */
export const GET: APIRoute = async (ctx) => {
  const a = garde(ctx, false);
  if (a instanceof Response) return a;
  const version = await versionDe(a.db, a.tenant.id);
  const etag = `"v${version}"`;
  const envoye = ctx.request.headers.get('If-None-Match');
  if (envoye && envoye.split(',').some((x) => x.trim().replace(/^W\//, '') === etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return json({ version }, 200, { ETag: etag });
};
