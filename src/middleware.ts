import { defineMiddleware } from 'astro:middleware';
import { tenantParHote, type Role, type Tenant, type Utilisateur } from './lib/db';
import { sessionCourante } from './lib/auth';
import { envDe } from './lib/mail';
import { appartient } from './lib/cloisonnement';
import { COMPTES_EDITEUR, GESTION_LIT, REGLAGES, aLeRole } from './lib/roles';
import { journaliserAccesEditeur } from './lib/journal';

declare global {
  namespace App {
    interface Locals {
      utilisateur: Utilisateur | null;
      tenant: Tenant | null;
      /** Nonce CSP de la requête, à poser sur tout script en ligne. */
      nonce: string;
    }
  }
}

// Aucun domaine externe. Scripts en ligne : uniquement avec le nonce de la requête.
// Styles en ligne tolérés : Astro en produit.
const csp = (nonce: string) => [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}'`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

function nouveauNonce(): string {
  const o = new Uint8Array(16);
  crypto.getRandomValues(o);
  return btoa(String.fromCharCode(...o));
}

const PUBLIC = 'public, s-maxage=60, stale-while-revalidate=600';
const PRIVE = 'private, no-store';

// Une route gardée exige l'un de ces rôles. Sinon : redirection vers /connexion. Le premier préfixe qui correspond l'emporte :
// les réglages (et, au lot 13, l'abonnement) passent donc avant /gestionnaire. Qui peut quoi : src/lib/roles.ts.
const GARDES: { prefixe: string; roles: Role[] }[] = [
  { prefixe: '/espace', roles: ['viewer'] },
  { prefixe: '/gestionnaire/reglages', roles: ['editeur', ...REGLAGES] },
  { prefixe: '/gestionnaire', roles: GESTION_LIT },
  { prefixe: '/admin', roles: ['editeur'] },
];

// Le rôle « lecture » n'écrit rien : toute requête qui n'est pas une lecture lui est refusée ici, pour TOUTES les routes du
// personnel (pages à formulaire, API du suivi, fichiers), sans dépendre de chaque route. /deconnexion reste ouverte.
const ECRITURE_PREFIXES = ['/gestionnaire', '/api/suivi', '/fichiers'];
// Les accès aux données d'un cabinet par l'éditeur ou son compte de support sont journalisés (journal.ts).
const DONNEES_CABINET = ['/gestionnaire', '/api/suivi', '/fichiers'];

// Jamais en cache partagé : pages authentifiées, et pages qui lisent ou posent le cookie.
// L'API du suivi n'est pas une « garde » : elle répond 401/403 en JSON au lieu de rediriger (src/lib/api-suivi.ts).
// /fichiers : rapports et logos de contact, servis après contrôle de session, de locataire et de rôle.
// Le logo du cabinet (/logo-cabinet) est public par nature : il s'affiche sur le site, sans session.
const PRIVES = [...GARDES.map((g) => g.prefixe), '/connexion', '/deconnexion', '/api/suivi', '/fichiers'];

function sous(chemin: string, prefixe: string): boolean {
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const chemin = context.url.pathname;
  const { DB } = envDe(context.locals);

  const tenant = await tenantParHote(DB, context.url.host);
  context.locals.tenant = tenant;
  context.locals.utilisateur = null;
  const nonce = nouveauNonce();
  context.locals.nonce = nonce;

  const prive = PRIVES.some((p) => sous(chemin, p));
  if (prive) {
    // Un utilisateur n'a qu'un tenant : sa session ne vaut que sur l'hôte de ce tenant.
    const utilisateur = await sessionCourante(DB, context.cookies);
    if (utilisateur && tenant && utilisateur.tenant_id === tenant.id) {
      context.locals.utilisateur = utilisateur;
    }
  }

  // Contrôle de cloisonnement : tout l'espace client ne lit que des données du viewer connecté,
  // lequel doit appartenir au tenant de l'hôte.
  const u = context.locals.utilisateur;
  if (u && u.role === 'viewer' && sous(chemin, '/espace') && tenant) {
    if (!(await appartient(DB, tenant.id, 'viewer', u.id))) context.locals.utilisateur = null;
  }

  const garde = GARDES.find((g) => sous(chemin, g.prefixe));
  const role = context.locals.utilisateur?.role;
  const refuse = garde !== undefined && (role === undefined || !garde.roles.includes(role));

  // La console de l'éditeur : sans session, la connexion ; avec la session d'un autre rôle (un gestionnaire, un viewer),
  // un refus net, jamais une redirection vers une page qui l'accueillerait ailleurs.
  const refusAdmin = refuse && garde?.prefixe === '/admin' && role !== undefined;
  // Un membre du personnel qui n'a pas le droit d'une rubrique (les réglages) : un refus net, pas une redirection.
  const refusRubrique = refuse && garde?.prefixe === '/gestionnaire/reglages' && aLeRole(role, GESTION_LIT);
  const lectureSeule =
    !refuse && role === 'lecture' && !['GET', 'HEAD'].includes(context.request.method) && ECRITURE_PREFIXES.some((p) => sous(chemin, p));
  if (!refuse && u && aLeRole(role, COMPTES_EDITEUR) && DONNEES_CABINET.some((p) => sous(chemin, p))) {
    await journaliserAccesEditeur(DB, u.tenant_id, { id: u.id, role: u.role }, `${context.request.method} ${chemin}`);
  }
  const reponse = refusAdmin || refusRubrique
    ? new Response('Accès refusé.', { status: 403 })
    : lectureSeule
      ? new Response('Accès refusé : ce compte est en lecture seule.', { status: 403 })
      : refuse
        ? context.redirect('/connexion')
        : await next();
  const resultat = new Response(reponse.body, reponse);

  // Mesure (lot 08) : POST de confirmation de connexion. Ne voit que les requêtes que le contrôle
  // d'origine d'Astro a laissées passer ; les rejets sont journalisés par src/worker.ts.
  // Le jeton, qui est un secret, n'est jamais écrit.
  if (context.request.method === 'POST' && chemin.startsWith('/connexion/')) {
    console.log(
      `[connexion] POST confirmation : statut=${resultat.status} origin=${context.request.headers.get('origin')} ` +
        `host=${context.request.headers.get('host')} url=${context.url.origin}/connexion/<jeton>`,
    );
  }

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

  resultat.headers.set('X-Frame-Options', 'DENY');
  resultat.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  resultat.headers.set('Content-Security-Policy', csp(nonce));

  return resultat;
});
