import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ url }) => {
  const corps = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /gestionnaire',
    'Disallow: /espace',
    'Disallow: /connexion',
    'Disallow: /deconnexion',
    '',
    `Sitemap: ${url.origin}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(corps, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
