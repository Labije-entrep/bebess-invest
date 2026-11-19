import type { APIRoute } from 'astro';
import { journaliser } from '../../../lib/espace';
import { documentAccessible, servir } from '../../../lib/fichiers';
import { envDe } from '../../../lib/mail';

export const prerender = false;

/**
 * Télécharge un rapport. Session, locataire et rôle sont contrôlés avant toute lecture de R2 :
 * un viewer ne reçoit que ses propres documents, le personnel du cabinet ceux de son locataire.
 * Sans session (ou session d'un autre cabinet, que le middleware ne retient pas sur cet hôte),
 * document inconnu, étranger ou d'un autre viewer : la même réponse, 404.
 */
export const GET: APIRoute = async (ctx) => {
  const { utilisateur, tenant } = ctx.locals;
  const introuvable = () => new Response('Introuvable.', { status: 404 });
  if (!utilisateur || !tenant || utilisateur.tenant_id !== tenant.id) return introuvable();

  const env = envDe(ctx.locals);
  const doc = await documentAccessible(env.DB, tenant.id, utilisateur, ctx.params.id ?? '');
  if (!doc?.cle_fichier) return introuvable();

  const reponse = await servir(env.FICHIERS, tenant.id, doc.cle_fichier, {
    cache: 'private, no-store',
    telechargement: { nom: doc.titre },
  });
  // La consultation d'un viewer est la preuve qu'il a eu le document : journal du lot 01.
  if (reponse.ok && utilisateur.role === 'viewer') await journaliser(env.DB, utilisateur.id, `/fichiers/document/${doc.id}`);
  return reponse;
};
