import type { APIRoute } from 'astro';
import { garde, json } from '../../../lib/api-suivi';
import { terminauxDe, valeursDe } from '../../../lib/listes';
import { LISTES_DEFAUT, type Liste } from '../../../lib/listes-defaut';
import { avoirsDesViewers, seuilsDe } from '../../../lib/suivi';
import { versionDe } from '../../../lib/version';

export const prerender = false;

/** Tout l'état du cabinet. La version est lue d'abord : un client en retard se resynchronise, jamais l'inverse. */
export const GET: APIRoute = async (ctx) => {
  const a = garde(ctx, false);
  if (a instanceof Response) return a;
  const T = a.tenant.id;
  const version = await versionDe(a.db, T);
  const tout = <R>(sql: string) => a.db.prepare(sql).bind(T).all<R>().then((r) => r.results);
  const [contacts, types, sujets, echanges, membres] = await Promise.all([
    tout<Record<string, unknown> & { id: string }>('SELECT * FROM contact WHERE tenant_id = ? ORDER BY nom, id'),
    tout<{ contact_id: string; type: string }>('SELECT contact_id, type FROM contact_type WHERE tenant_id = ? ORDER BY type'),
    tout('SELECT * FROM sujet WHERE tenant_id = ? ORDER BY cree_le, id'),
    tout('SELECT * FROM echange WHERE tenant_id = ? ORDER BY date DESC, id'),
    tout('SELECT id, nom, initiale, couleur, actif FROM membre WHERE tenant_id = ? ORDER BY nom, id'),
  ]);
  const parContact = new Map<string, string[]>();
  for (const t of types) parContact.set(t.contact_id, [...(parContact.get(t.contact_id) ?? []), t.type]);
  const noms = Object.keys(LISTES_DEFAUT) as Liste[];
  const valeurs = await Promise.all(noms.map((n) => valeursDe(a.db, T, n)));
  const [seuils, portail, terminaux] = await Promise.all([seuilsDe(a.db, T), avoirsDesViewers(a.db, T), terminauxDe(a.db, T)]);
  return json({
    version,
    seuils,
    terminaux,
    // Contact rattaché à un viewer : avoirs lus dans ses portefeuilles, jamais saisis (clé `avoirs_portail`).
    // Les avoirs saisis avant le rattachement restent en base mais ne sont plus servis (lot 07).
    contacts: contacts.map((c) => ({
      ...c,
      ...(typeof c.viewer_id === 'string' ? { avoirs_cents: null, avoirs_le: null } : {}),
      types: parContact.get(c.id) ?? [],
      avoirs_portail: typeof c.viewer_id === 'string' ? (portail[c.viewer_id] ?? null) : null,
    })),
    sujets,
    echanges,
    membres,
    listes: Object.fromEntries(noms.map((n, i) => [n, valeurs[i]])),
  });
};
