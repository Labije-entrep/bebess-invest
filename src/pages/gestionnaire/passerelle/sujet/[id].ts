import type { APIRoute } from 'astro';
import { appartient } from '../../../../lib/cloisonnement';
import { arretesPerimes, ecartsHorsSeuil, panneauPortail } from '../../../../lib/fiche';
import { garde, introuvable, sujetPourOrigine, texteArrete, texteEcart } from '../../../../lib/passerelle';

export const prerender = false;

/**
 * Crée un sujet sur le contact `id`, depuis le panneau Portail : `type=ecart` (champ `cle` = classe d'actif) ou
 * `type=arrete` (champ `cle` = identifiant du portefeuille). Le contact et le viewer sont contrôlés contre le cabinet
 * (inconnu ou étranger : 404) ; l'écart ou l'arrêté périmé est recalculé ici, il n'est pas cru sur parole.
 * Un sujet non clos portant déjà la même origine est ouvert au lieu d'être recréé.
 */
export const POST: APIRoute = async (ctx) => {
  const g = garde(ctx, ['gestionnaire', 'editeur']);
  if (g instanceof Response) return g;
  const id = ctx.params.id ?? '';
  if (id.length > 64 || !(await appartient(g.db, g.tenant.id, 'contact', id))) return introuvable();

  const retour = (code: string, sujet = '') =>
    ctx.redirect(`/gestionnaire/suivi/${encodeURIComponent(id)}?pm=${code}${sujet ? `&s=${encodeURIComponent(sujet)}#sujet-${encodeURIComponent(sujet)}` : ''}`, 303);

  const f = await ctx.request.formData();
  const type = String(f.get('type') ?? '');
  const cle = String(f.get('cle') ?? '').slice(0, 64);

  const c = await g.db
    .prepare('SELECT viewer_id FROM contact WHERE id = ? AND tenant_id = ?')
    .bind(id, g.tenant.id)
    .first<{ viewer_id: string | null }>();
  const portail = c?.viewer_id ? await panneauPortail(g.db, g.tenant.id, c.viewer_id) : null;
  if (!portail) return retour('sans_viewer');

  let origine: string;
  let texte: string;
  if (type === 'ecart') {
    const e = ecartsHorsSeuil(portail).find((x) => x.classe === cle);
    if (!e || !portail.arrete) return retour('ecart_sous_seuil');
    origine = `ecart:${e.classe}:${portail.arrete}`;
    texte = texteEcart(e, portail.arrete, portail.portefeuilles.length > 1);
  } else if (type === 'arrete') {
    const b = arretesPerimes(portail).find((x) => x.id === cle);
    if (!b) return retour('arrete_a_jour');
    origine = `arrete:${b.id}:${b.arrete}`;
    texte = texteArrete(b, portail.seuilArreteJours);
  } else {
    return retour('demande_inconnue');
  }

  const r = await sujetPourOrigine(g.db, g.tenant.id, id, origine, texte);
  if ('refus' in r) return retour('statut_absent');
  return retour(r.cree ? 'sujet_cree' : 'sujet_existant', r.id);
};
