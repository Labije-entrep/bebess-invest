import { defineMiddleware } from 'astro:middleware';
import { tenantParHote, type Role, type Tenant, type Utilisateur } from './lib/db';
import { dossierFerme, sessionCourante } from './lib/auth';
import { envDe } from './lib/mail';
import { appartient } from './lib/cloisonnement';
import { COMPTES_EDITEUR, EXPORT_ESSAI_ECHU, GESTION_LIT, REGLAGES, aLeRole } from './lib/roles';
import { sortieDuCabinet, type GenreSortie } from './lib/essai';
import { journaliserAccesEditeur } from './lib/journal';
import { estPageSite, estRouteContenu, estRoutePilotage, modulesDuTenant, type Modules } from './lib/modules';

declare global {
  namespace App {
    interface Locals {
      utilisateur: Utilisateur | null;
      tenant: Tenant | null;
      /** Nonce CSP de la requête, à poser sur tout script en ligne. */
      nonce: string;
      /** Ce que le contrat du cabinet ouvre (lot 15). Lu seulement pour l'espace du personnel, le module de suivi et le site public : null ailleurs. */
      modules: Modules | null;
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

// Ce que voit un client dont le dossier est archivé : un message, pas une erreur technique. Aucune donnée du dossier n'est lue pour
// l'afficher. Le nom du cabinet vient du locataire de l'hôte ; il est échappé.
const echapper = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function pageDossierFerme(cabinet: string): Response {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>Accès à votre espace · ${echapper(cabinet)}</title></head>` +
    `<body style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6">` +
    `<h1 style="font-weight: 300">Votre espace n’est plus accessible</h1>` +
    `<p>Votre dossier est archivé : vous ne pouvez plus consulter votre espace en ligne.</p>` +
    `<p>Pour en savoir plus ou pour le rouvrir, rapprochez-vous de votre conseiller au sein de ${echapper(cabinet)}.</p>` +
    `<form method="post" action="/deconnexion"><button type="submit">Se déconnecter</button></form></body></html>`;
  return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Ce que voit l'associé d'un cabinet dont l'essai n'a pas été converti (lot 12) ou dont le contrat est résilié (lot 17) : le cabinet est
// fermé, sauf l'export de ses données, qui reste ouvert jusqu'à la suppression. Un message, pas une erreur technique ; rien du cabinet
// n'est lu pour l'afficher.
function pageEssaiEchu(cabinet: string, genre: GenreSortie): Response {
  const titre = genre === 'resiliation' ? `Le contrat de ${echapper(cabinet)} est résilié` : `L’essai de ${echapper(cabinet)} est terminé`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${genre === 'resiliation' ? 'Contrat résilié' : 'Essai terminé'} · ${echapper(cabinet)}</title></head>` +
    `<body style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6">` +
    `<h1 style="font-weight: 300">${titre}</h1>` +
    `<p>L’accès au cabinet et les espaces de ses clients sont suspendus.</p>` +
    `<p>Vos données restent disponibles jusqu’à leur suppression définitive : vous pouvez en télécharger l’export complet.</p>` +
    `<p><a href="${EXPORT_ESSAI_ECHU}">Télécharger l’export complet</a></p>` +
    `<form method="post" action="/deconnexion"><button type="submit">Se déconnecter</button></form></body></html>`;
  return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
// Les chemins où une session d'un AUTRE cabinet reçoit un 404 (lot 20). La connexion et la déconnexion en sont exclues : elles doivent
// rester ouvertes à qui arrive avec un cookie qui ne vaut pas ici, pour qu'il puisse se reconnecter chez ce cabinet.
const SANS_SESSION_ETRANGERE = ['/connexion', '/deconnexion'];

function sous(chemin: string, prefixe: string): boolean {
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const chemin = context.url.pathname;
  const { DB } = envDe(context.locals);

  const tenant = await tenantParHote(DB, context.url.host);
  context.locals.tenant = tenant;
  context.locals.utilisateur = null;
  context.locals.modules = null;
  const nonce = nouveauNonce();
  context.locals.nonce = nonce;

  const prive = PRIVES.some((p) => sous(chemin, p));
  // Une session valide d'un AUTRE cabinet (ou présentée à un hôte qui n'en désigne aucun) : un cookie rejoué, jamais un navigateur, qui
  // ne renvoie un cookie qu'à l'hôte qui l'a posé. Elle ne vaut rien ici, et la réponse est celle d'une page qui n'existe pas : 404,
  // comme pour un identifiant d'un autre cabinet, ni redirection vers la connexion ni 401 qui dirait « ici, une session aurait un sens ».
  let sessionEtrangere = false;
  if (prive) {
    // Un utilisateur n'a qu'un tenant : sa session ne vaut que sur l'hôte de ce tenant.
    const utilisateur = await sessionCourante(DB, context.cookies);
    if (utilisateur && tenant && utilisateur.tenant_id === tenant.id) {
      context.locals.utilisateur = utilisateur;
    } else if (utilisateur && !SANS_SESSION_ETRANGERE.some((p) => sous(chemin, p))) {
      sessionEtrangere = true;
    }
  }

  // Contrôle de cloisonnement : tout l'espace client ne lit que des données du viewer connecté,
  // lequel doit appartenir au tenant de l'hôte.
  const u = context.locals.utilisateur;
  if (u && u.role === 'viewer' && sous(chemin, '/espace') && tenant) {
    if (!(await appartient(DB, tenant.id, 'viewer', u.id))) context.locals.utilisateur = null;
  }

  // Les modules du contrat (lot 15). Une requête, et seulement là où elle sert : le menu du personnel, les routes du suivi, le site public.
  const routePilotage = estRoutePilotage(chemin);
  const pageSite = estPageSite(chemin);
  if (tenant && (routePilotage || pageSite || sous(chemin, '/gestionnaire'))) context.locals.modules = await modulesDuTenant(DB, tenant.id);
  const modules = context.locals.modules;

  const garde = GARDES.find((g) => sous(chemin, g.prefixe));
  const role = context.locals.utilisateur?.role;
  const refuse = garde !== undefined && (role === undefined || !garde.roles.includes(role));

  // La console de l'éditeur : sans session, la connexion ; avec la session d'un autre rôle (un gestionnaire, un viewer),
  // un refus net, jamais une redirection vers une page qui l'accueillerait ailleurs.
  const refusAdmin = refuse && garde?.prefixe === '/admin' && role !== undefined;
  // Un membre du personnel qui n'a pas le droit d'une rubrique (les réglages) : un refus net, pas une redirection.
  const refusRubrique = refuse && garde?.prefixe === '/gestionnaire/reglages' && aLeRole(role, GESTION_LIT);
  // Un dossier archivé ferme l'accès de son viewer (auth.ts, dossierFerme). Ce n'est PAS la suspension d'un cabinet, qui laisse
  // les viewers en ligne : deux mécanismes opposés, à ne pas faire converger. /deconnexion reste ouverte.
  const archive = !refuse && dossierFerme(u) && (sous(chemin, '/espace') || sous(chemin, '/fichiers'));
  // Essai non converti ou contrat résilié : l'associé garde l'export et rien d'autre. Les autres rôles du cabinet et les viewers sont coupés plus tôt, à la
  // session (auth.ts, HORS_ESSAI_ECHU) : leur session n'existe plus. Ce mécanisme n'a rien de commun avec la suspension commerciale d'un
  // cabinet sous contrat, qui laisse les viewers en ligne.
  const sortie: GenreSortie | null =
    !refuse && !!tenant && u?.role === 'associe' && chemin !== EXPORT_ESSAI_ECHU &&
    ['/gestionnaire', '/api/suivi', '/fichiers'].some((p) => sous(chemin, p))
      ? await sortieDuCabinet(DB, tenant.id)
      : null;
  // Un module non acheté : 404, jamais 403. Sans session, une route gardée redirige comme avant vers /connexion (rien n'est annoncé).
  // Le site public non acheté : la racine mène à /connexion, les autres pages sont introuvables.
  // Les écrans de contenu (notes de marché, textes) suivent le module Site vitrine : leur seul lecteur est le site public.
  const moduleFerme =
    !refuse && modules !== null && ((routePilotage && !modules.pilotage) || (estRouteContenu(chemin) && !modules.site));
  const siteFerme = pageSite && modules !== null && !modules.site;
  const lectureSeule =
    !refuse && role === 'lecture' && !['GET', 'HEAD'].includes(context.request.method) && ECRITURE_PREFIXES.some((p) => sous(chemin, p));
  if (!refuse && !moduleFerme && u && aLeRole(role, COMPTES_EDITEUR) && DONNEES_CABINET.some((p) => sous(chemin, p))) {
    await journaliserAccesEditeur(DB, u.tenant_id, { id: u.id, role: u.role }, `${context.request.method} ${chemin}`);
  }
  const reponse = sessionEtrangere
    ? new Response('Introuvable.', { status: 404 })
    : archive
    ? pageDossierFerme(tenant?.nom ?? 'votre cabinet')
    : sortie !== null
    ? pageEssaiEchu(tenant?.nom ?? 'votre cabinet', sortie)
    : moduleFerme
    ? new Response('Introuvable.', { status: 404 })
    : siteFerme
    ? chemin === '/' ? context.redirect('/connexion') : new Response('Introuvable.', { status: 404 })
    : refusAdmin || refusRubrique
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
