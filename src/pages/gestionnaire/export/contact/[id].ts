import type { APIRoute } from 'astro';
import { exportContact, nomFichier } from '../../../../lib/export';
import { envDe } from '../../../../lib/mail';
import { introuvable } from '../../../../lib/passerelle';

export const prerender = false;

/**
 * Un contact seul, avec ses sujets, ses échanges et ses notes : la réponse à une demande d'accès RGPD, en un clic.
 * Contact inconnu ou d'un autre cabinet : 404.
 */
export const GET: APIRoute = async (ctx) => {
  const { utilisateur, tenant } = ctx.locals;
  if (!utilisateur || !tenant || utilisateur.tenant_id !== tenant.id) return introuvable();
  if (utilisateur.role !== 'gestionnaire' && utilisateur.role !== 'editeur') return introuvable();
  const id = ctx.params.id ?? '';
  if (id.length > 64) return introuvable();

  const r = await exportContact(envDe(ctx.locals).DB, tenant.id, id);
  if (!r) return introuvable();
  return new Response(r.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomFichier(`contact-${r.nom}`, 'csv')}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
