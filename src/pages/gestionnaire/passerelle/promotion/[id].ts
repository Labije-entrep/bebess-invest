import type { APIRoute } from 'astro';
import { demanderLien } from '../../../../lib/auth';
import { lienConnexion } from '../../../../lib/adresses';
import { appartient } from '../../../../lib/cloisonnement';
import { envoyerLien } from '../../../../lib/gestion';
import { publierDossier } from '../../../../lib/acces';
import { CABINET_ECRIT } from '../../../../lib/roles';
import { garde, introuvable, promouvoir } from '../../../../lib/passerelle';

export const prerender = false;

/**
 * Promotion d'un contact en viewer (lot 07), à la demande du gestionnaire. L'identifiant est celui d'un contact :
 * inconnu ou d'un autre cabinet, il répond 404 et rien n'est écrit. Réservée au gestionnaire, comme la création d'un viewer.
 */
export const POST: APIRoute = async (ctx) => {
  const g = garde(ctx, CABINET_ECRIT);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (id.length > 64 || !(await appartient(g.db, g.tenant.id, 'contact', id))) return introuvable();

  const retour = (code: string) => ctx.redirect(`/gestionnaire/suivi/${encodeURIComponent(id)}?pm=${code}`, 303);
  const acteur = { id: g.utilisateur.id, role: g.utilisateur.role };
  const r = await promouvoir(g.db, g.tenant.id, id, acteur);
  if (!r.ok) return retour(r.code);

  // Le rattachement est fait : si l'envoi échoue, il le reste, et l'écran le dit.
  const jeton = await demanderLien(g.db, g.tenant.id, r.email);
  const envoye = jeton ? await envoyerLien(ctx.locals, r.email, r.nom, lienConnexion(g.tenant, ctx.url, jeton), g.tenant.id) : false;
  // Le dossier passe de brouillon à publié quand le lien de première connexion est envoyé.
  if (envoye) await publierDossier(g.db, g.tenant.id, r.viewerId, acteur);
  return retour(envoye ? 'promu' : 'promu_sans_envoi');
};
