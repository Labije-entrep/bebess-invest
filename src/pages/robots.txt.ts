import type { APIRoute } from 'astro';
import { origineDuSite } from '../lib/adresses';

export const GET: APIRoute = ({ url, locals }) => {
  const corps = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /gestionnaire',
    'Disallow: /espace',
    'Disallow: /connexion',
    'Disallow: /deconnexion',
    '',
    `Sitemap: ${origineDuSite(locals.tenant, url)}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(corps, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
