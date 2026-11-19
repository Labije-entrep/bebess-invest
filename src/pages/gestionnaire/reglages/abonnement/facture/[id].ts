import type { APIRoute } from 'astro';
import { factureDuBon } from '../../../../../lib/facturation';
import { servirFacture } from '../../../../../lib/fichiers';
import { envDe } from '../../../../../lib/mail';
import { ABONNEMENT, aLeRole } from '../../../../../lib/roles';

export const prerender = false;

/**
 * Télécharge le PDF d'une facture du cabinet (lot 13). L'associé seul, sur son propre hôte : un autre rôle, un bon d'un autre cabinet,
 * un bon non émis ou sans PDF : la même réponse, 404. La clé ne sort jamais de la base : elle est relue ici, bornée au locataire.
 */
export const GET: APIRoute = async (ctx) => {
  const { utilisateur, tenant } = ctx.locals;
  const introuvable = () => new Response('Introuvable.', { status: 404 });
  if (!utilisateur || !tenant || utilisateur.tenant_id !== tenant.id || !aLeRole(utilisateur.role, ABONNEMENT)) return introuvable();
  const env = envDe(ctx.locals);
  const facture = await factureDuBon(env.DB, tenant.id, ctx.params.id ?? '');
  if (!facture) return introuvable();
  return servirFacture(env.FICHIERS, tenant.id, facture.cle, { cache: 'private, no-store', telechargement: { nom: facture.numero } });
};
