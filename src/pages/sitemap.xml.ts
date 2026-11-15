import type { APIRoute } from 'astro';
import { envDe } from '../lib/mail';
import { notesPubliees } from '../lib/db';

const PAGES = ['/', '/approche', '/parcours', '/notes', '/contact', '/mentions-legales'];

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async ({ locals, url }) => {
  const { DB } = envDe(locals);
  const tenant = locals.tenant;
  const notes = tenant ? await notesPubliees(DB, tenant.id) : [];
  const lignes = [
    ...PAGES.map((p) => `  <url><loc>${xml(url.origin + p)}</loc></url>`),
    ...notes.map(
      (n) => `  <url><loc>${xml(`${url.origin}/notes/${n.slug}`)}</loc><lastmod>${xml(n.date.slice(0, 10))}</lastmod></url>`,
    ),
  ];
  const corps = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lignes.join('\n')}\n</urlset>\n`;
  return new Response(corps, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
