import type { APIRoute } from 'astro';
import { creerNoteDepuisActu } from '../../../../lib/actus';
import { appartient } from '../../../../lib/cloisonnement';
import { garde, introuvable } from '../../../../lib/passerelle';

export const prerender = false;

/**
 * Crée la note de marché (brouillon, non publiée) d'une fiche d'actu, `id`. Une actu inconnue ou d'un autre cabinet
 * répond 404. Le texte est copié par la base, mot pour mot ; publier reste un second geste, dans l'écran des notes.
 */
export const POST: APIRoute = async (ctx) => {
  const g = garde(ctx, ['gestionnaire', 'editeur']);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (id.length > 64 || !(await appartient(g.db, g.tenant.id, 'actu', id))) return introuvable();

  const a = await g.db.prepare('SELECT date FROM actu WHERE id = ? AND tenant_id = ?').bind(id, g.tenant.id).first<{ date: string }>();
  const retour = (code: string) => ctx.redirect(`/gestionnaire/actus?date=${a?.date ?? ''}&ok=${code}`, 303);

  const r = await creerNoteDepuisActu(g.db, g.tenant.id, id);
  if ('refus' in r) return retour(r.refus === 'vide' ? 'note_vide' : 'absente');
  return retour(r.cree ? 'note' : 'note_existante');
};
