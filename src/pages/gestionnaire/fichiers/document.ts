import type { APIRoute } from 'astro';
import { appartient } from '../../../lib/cloisonnement';
import { cleDocument, corpsTropGros, deposer, lireDepot, supprimer } from '../../../lib/fichiers';
import { refusValeur } from '../../../lib/listes';
import { garde, introuvable } from '../../../lib/passerelle';
import { envDe } from '../../../lib/mail';

export const prerender = false;

const dateIso = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * Dépôt d'un rapport PDF pour un viewer du cabinet (adresse : ?viewer_id= ; formulaire multipart : titre, categorie, date, fichier).
 * Taille bornée (10 Mo), type vérifié sur le contenu. L'objet est rangé sous l'identifiant du locataire.
 */
export const POST: APIRoute = async (ctx) => {
  const g = garde(ctx, ['gestionnaire', 'editeur']);
  if (g instanceof Response) return g;

  // Le viewer vient de l'adresse (?viewer_id=), pas du corps : un corps trop gros n'est pas lu du tout.
  const viewerId = (ctx.url.searchParams.get('viewer_id') ?? '').slice(0, 64);
  if (!viewerId || !(await appartient(g.db, g.tenant.id, 'viewer', viewerId))) return introuvable();
  const retour = (q: string) => ctx.redirect(`/gestionnaire/viewers/${encodeURIComponent(viewerId)}?onglet=rapports&${q}`, 303);
  if (corpsTropGros(ctx.request, 'pdf')) return retour('erreur=trop_gros');
  const f = await ctx.request.formData();

  const titre = String(f.get('titre') ?? '').trim().slice(0, 200);
  const categorie = String(f.get('categorie') ?? '');
  const date = String(f.get('date') ?? '') || new Date().toISOString().slice(0, 10);
  if (!titre) return retour('erreur=titre');
  if (!dateIso(date)) return retour('erreur=date');
  if (await refusValeur(g.db, g.tenant.id, 'categorie_doc', categorie)) return retour('erreur=categorie');

  const depot = await lireDepot(f.get('fichier'), 'pdf');
  if (typeof depot === 'string') return retour(`erreur=${depot}`);

  const env = envDe(ctx.locals);
  const cle = cleDocument(g.tenant.id, depot.type);
  await deposer(env.FICHIERS, cle, depot);
  try {
    await g.db
      .prepare('INSERT INTO document (id, viewer_id, titre, categorie, date, cle_fichier, envoye_le) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), viewerId, titre, categorie, date, cle, new Date().toISOString())
      .run();
  } catch (e) {
    await supprimer(env.FICHIERS, g.tenant.id, cle); // pas d'objet orphelin
    throw e;
  }
  return retour('ok=document');
};
