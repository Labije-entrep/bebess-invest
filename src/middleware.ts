import { defineMiddleware } from 'astro:middleware';
import { tenantParHote, type Role, type Tenant, type Utilisateur } from './lib/db';
import { sessionCourante } from './lib/auth';
import { envDe } from './lib/mail';

declare global {
  namespace App {
    interface Locals {
      utilisateur: Utilisateur | null;
      tenant: Tenant | null;
    }
  }
}

const PUBLIC = 'public, s-maxage=60, stale-while-revalidate=600';
const PRIVE = 'private, no-store';

// Une route gardée exige l'un de ces rôles. Sinon : redirection vers /connexion.
const GARDES: { prefixe: string; roles: Role[] }[] = [
  { prefixe: '/espace', roles: ['viewer'] },
  { prefixe: '/gestionnaire', roles: ['gestionnaire', 'editeur'] },
  { prefixe: '/admin', roles: ['editeur'] },
];

// Jamais en cache partagé : pages authentifiées, et pages qui lisent ou posent le cookie.
const PRIVES = [...GARDES.map((g) => g.prefixe), '/connexion', '/deconnexion'];

function sous(chemin: string, prefixe: string): boolean {
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const chemin = context.url.pathname;
  const { DB } = envDe(context.locals);

  const tenant = await tenantParHote(DB, context.url.host);
  context.locals.tenant = tenant;
  context.locals.utilisateur = null;

  const prive = PRIVES.some((p) => sous(chemin, p));
  if (prive) {
    // Un utilisateur n'a qu'un tenant : sa session ne vaut que sur l'hôte de ce tenant.
    const utilisateur = await sessionCourante(DB, context.cookies);
    if (utilisateur && tenant && utilisateur.tenant_id === tenant.id) {
      context.locals.utilisateur = utilisateur;
    }
  }

  const garde = GARDES.find((g) => sous(chemin, g.prefixe));
  const role = context.locals.utilisateur?.role;
  const refuse = garde !== undefined && (role === undefined || !garde.roles.includes(role));

  const reponse = refuse ? context.redirect('/connexion') : await next();
  const resultat = new Response(reponse.body, reponse);

  if (prive) {
    // Toujours, quel que soit le statut : une page authentifiée ne doit jamais être mise en cache.
    resultat.headers.set('Cache-Control', PRIVE);
  } else if (
    (context.request.method === 'GET' || context.request.method === 'HEAD') &&
    resultat.status === 200 &&
    !resultat.headers.has('Cache-Control')
  ) {
    resultat.headers.set('Cache-Control', PUBLIC);
  }

  return resultat;
});
