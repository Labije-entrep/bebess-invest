// Le serveur du banc : la chaîne d'une requête telle que le Worker la traverse, avec le code du dépôt à chaque étape.
//
//   Worker (src/worker.ts, réel)
//     → contrôle d'origine d'Astro (createOriginCheckMiddleware, celui du paquet installé)
//       → middleware (src/middleware.ts, réel)
//         → la route : un point d'entrée .ts (GET/POST/PATCH/DELETE) ou l'en-tête d'une page .astro (voir hooks.mjs)
//
// Ce que le banc NE fait PAS : rendre le gabarit HTML des pages .astro, ni démarrer Astro. Pour une page, on voit sa Response
// (redirection, 404) ou, quand l'en-tête va jusqu'au bout, les variables qu'il a calculées (`rendu`).
//
// Hors ligne par construction : `fetch` est remplacé. Seuls Scaleway (courriel) et l'API Cloudflare (domaines) sont connus, et
// répondent ce que le test décide ; tout autre appel sortant fait échouer le test.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { Bucket } from '../../src/lib/fichiers';
import type { Env } from '../../src/lib/mail';
import type { BaseTest } from './d1.ts';

const PAGES = fileURLToPath(new URL('../../src/pages/', import.meta.url));

// ------------------------------------------------------------------ console et réseau

export const console_ = { lignes: [] as string[] };
for (const m of ['log', 'warn', 'error', 'info'] as const) {
  console[m] = (...a: unknown[]) => {
    console_.lignes.push(a.map(String).join(' '));
  };
}

export interface Sortant {
  url: string;
  methode: string;
  corps: unknown;
}
export const reseau = {
  /** Les appels RELATIFS (`/api/suivi/etat`, ceux du navigateur) : le test les branche sur le Worker. */
  interne: null as null | ((url: string, init?: RequestInit) => Promise<Response>),
  /** Tout ce qui est parti vers l'extérieur depuis le début du test. */
  sortants: [] as Sortant[],
  /** Faire échouer Scaleway (courriel) ou Cloudflare (domaines). */
  scalewayRefuse: false,
  cloudflareRefuse: false,
  /** Alpha Vantage (cours) : la réponse que le test décide, selon les paramètres de l'appel. Sans elle, tout appel fait échouer le test. */
  cours: null as null | ((p: URLSearchParams) => Response | Promise<Response>),
  vider(): void {
    this.sortants = [];
    this.scalewayRefuse = false;
    this.cloudflareRefuse = false;
    this.cours = null;
    this.interne = null;
  },
  /** Les courriels envoyés par le pilote Scaleway : destinataire, sujet, texte. */
  courriels(): { a: string; sujet: string; texte: string }[] {
    return this.sortants
      .filter((s) => s.url.startsWith('https://api.scaleway.com/'))
      .map((s) => {
        const c = s.corps as { to: { email: string }[]; subject: string; text: string };
        return { a: c.to[0].email, sujet: c.subject, texte: c.text };
      });
  },
};

globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(entree instanceof Request ? entree.url : entree);
  if (url.startsWith('/') && reseau.interne) return reseau.interne(url, init);
  const corps = init?.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : null;
  reseau.sortants.push({ url, methode: init?.method ?? 'GET', corps });
  if (url.startsWith('https://api.scaleway.com/')) {
    return reseau.scalewayRefuse ? new Response('{}', { status: 500 }) : new Response('{}', { status: 200 });
  }
  if (url.startsWith('https://api.cloudflare.com/')) {
    return reseau.cloudflareRefuse
      ? new Response(JSON.stringify({ success: false, errors: [{ message: 'refusé' }] }), { status: 500 })
      : new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
  }
  if (url.startsWith('https://www.alphavantage.co/query')) {
    if (!reseau.cours) throw new Error(`Le banc est hors ligne : appel Alpha Vantage non prévu (${url.replace(/apikey=[^&]*/, 'apikey=***')})`);
    return reseau.cours(new URL(url).searchParams);
  }
  throw new Error(`Le banc est hors ligne : appel sortant inattendu vers ${url}`);
}) as typeof fetch;

// ------------------------------------------------------------------ R2

export class BucketMemoire implements Bucket {
  objets = new Map<string, { octets: ArrayBuffer; type: string }>();
  async put(cle: string, valeur: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    this.objets.set(cle, { octets: valeur, type: options?.httpMetadata?.contentType ?? 'application/octet-stream' });
  }
  async get(cle: string) {
    const o = this.objets.get(cle);
    if (!o) return null;
    return { body: new Blob([o.octets]).stream(), size: o.octets.byteLength, httpMetadata: { contentType: o.type } };
  }
  async delete(cle: string | string[]): Promise<void> {
    for (const k of Array.isArray(cle) ? cle : [cle]) this.objets.delete(k);
  }
  async list(o: { prefix?: string; limit?: number }) {
    return { objects: [...this.objets.keys()].filter((k) => k.startsWith(o.prefix ?? '')).slice(0, o.limit ?? 1000).map((key) => ({ key })) };
  }
}

// ------------------------------------------------------------------ cookies

class Cookies {
  entrants = new Map<string, string>();
  sortants: string[] = [];
  constructor(entete: string | null) {
    for (const part of (entete ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) this.entrants.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
  }
  get(nom: string): { value: string } | undefined {
    const v = this.entrants.get(nom);
    return v === undefined ? undefined : { value: v };
  }
  set(nom: string, valeur: string, o: { maxAge?: number; path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: string } = {}): void {
    this.entrants.set(nom, valeur);
    this.sortants.push(
      [`${nom}=${valeur}`, o.path && `Path=${o.path}`, o.maxAge !== undefined && `Max-Age=${o.maxAge}`, o.httpOnly && 'HttpOnly', o.secure && 'Secure', o.sameSite && `SameSite=${o.sameSite}`]
        .filter(Boolean)
        .join('; '),
    );
  }
  delete(nom: string): void {
    this.entrants.delete(nom);
    this.sortants.push(`${nom}=; Max-Age=0`);
  }
}

// ------------------------------------------------------------------ routes

interface Route {
  segments: string[];
  fichier: string;
}
function lister(dossier: string, prefixe: string[] = []): Route[] {
  const sortie: Route[] = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    if (e.isDirectory()) {
      sortie.push(...lister(dossier + e.name + '/', [...prefixe, e.name]));
      continue;
    }
    const m = /^(.*?)(\.astro|\.ts)$/.exec(e.name);
    if (!m) continue;
    sortie.push({ segments: m[1] === 'index' ? prefixe : [...prefixe, m[1]], fichier: dossier + e.name });
  }
  return sortie;
}
const ROUTES = lister(PAGES);

function trouver(chemin: string): { route: Route; params: Record<string, string> } | null {
  const segs = chemin.split('/').filter(Boolean).map(decodeURIComponent);
  let meilleur: { route: Route; params: Record<string, string>; statiques: number } | null = null;
  for (const route of ROUTES) {
    if (route.segments.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let statiques = 0;
    let ok = true;
    route.segments.forEach((s, i) => {
      const p = /^\[(\w+)\]$/.exec(s);
      if (p) params[p[1]] = segs[i];
      else if (s === segs[i]) statiques++;
      else ok = false;
    });
    if (ok && (!meilleur || statiques > meilleur.statiques)) meilleur = { route, params, statiques };
  }
  return meilleur;
}

// ------------------------------------------------------------------ la chaîne

const exiger = createRequire(import.meta.url);
const originAstro = await import(pathToFileURL(exiger.resolve('astro/package.json').replace('package.json', 'dist/core/app/middlewares.js')).href);
const { onRequest } = await import('../../src/middleware.ts');
const { createExports } = await import('../../src/worker.ts');

export interface Environnement extends Env {
  DB: BaseTest;
  FICHIERS: BucketMemoire;
}

export function environnement(db: BaseTest, extra: Partial<Env> = {}): Environnement {
  return {
    DB: db,
    FICHIERS: new BucketMemoire(),
    MAIL_DRIVER: 'scaleway',
    SCW_SECRET_KEY: 'secret-de-test',
    SCW_PROJECT_ID: 'projet-de-test',
    MAIL_FROM: 'noreply@bebess.test',
    ...extra,
  } as Environnement;
}

export interface Rendu {
  /** Les variables que l'en-tête d'une page .astro a calculées, quand il est allé jusqu'au bout. */
  rendu?: Record<string, unknown>;
  /** Les `locals` de la dernière requête, tels que le middleware les a posés (utilisateur, tenant, modules). */
  locals?: Record<string, any>;
}
export const dernier: Rendu = {};

async function chaine(request: Request, env: Environnement): Promise<Response> {
  const url = new URL(request.url);
  const cookies = new Cookies(request.headers.get('cookie'));
  const locals: Record<string, unknown> = { runtime: { env } };
  const redirect = (chemin: string, statut = 302): Response => new Response(null, { status: statut, headers: { Location: chemin } });
  const contexte: Record<string, unknown> = {
    request, url, cookies, locals, redirect, params: {}, isPrerendered: false, site: new URL('https://www.bebess-invest.fr'),
    rewrite: async () => new Response('Introuvable.', { status: 404 }),
  };
  dernier.rendu = undefined;
  dernier.locals = locals;

  const route = async (): Promise<Response> => {
    const t = trouver(url.pathname);
    if (!t) return new Response('Introuvable.', { status: 404 });
    contexte.params = t.params;
    const module = await import(pathToFileURL(t.route.fichier).href);
    if (t.route.fichier.endsWith('.astro')) {
      const Astro = { ...contexte, props: {}, slots: {}, clientAddress: '127.0.0.1' };
      const r = await module.default(Astro);
      if (r instanceof Response) return r;
      dernier.rendu = r.rendu;
      return new Response('page', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    const methode = module[request.method];
    if (typeof methode !== 'function') return new Response('Méthode non permise.', { status: 405 });
    return methode(contexte);
  };

  const controle = originAstro.createOriginCheckMiddleware();
  const reponse: Response = await controle(contexte, () => onRequest(contexte, route));
  const entetes = new Headers(reponse.headers);
  for (const c of cookies.sortants) entetes.append('Set-Cookie', c);
  return new Response(reponse.body, { status: reponse.status, headers: entetes });
}

(globalThis as any).__banc_handle = (_manifest: unknown, _app: unknown, request: Request, env: Environnement) => chaine(request, env);
const worker = createExports({} as never).default;

export interface Requete {
  methode?: string;
  /** Adresse complète, ou chemin (alors sur l'hôte `hote`). */
  url: string;
  hote?: string;
  cookie?: string;
  /** Formulaire (application/x-www-form-urlencoded) ou, avec `multipart`, FormData. */
  formulaire?: Record<string, string>;
  multipart?: FormData;
  json?: unknown;
  /** Origin : `undefined` = celle de la page (un navigateur honnête), `null` = absent, une chaîne = forgée. */
  origine?: string | null;
  entetes?: Record<string, string>;
}

export interface Reponse {
  statut: number;
  location: string | null;
  texte: string;
  json: any;
  entetes: Headers;
  /** Le cookie de session posé par la réponse, ou null. */
  cookieSession: string | null;
}

/** Une requête de bout en bout, par le Worker. Les cookies ne sont jamais mémorisés : le test passe celui qu'il veut. */
export async function envoyer(env: Environnement, r: Requete): Promise<Reponse> {
  const adresse = r.url.startsWith('http') ? r.url : `http://${r.hote ?? 'localhost'}${r.url}`;
  const methode = r.methode ?? (r.formulaire || r.json || r.multipart ? 'POST' : 'GET');
  const entetes = new Headers(r.entetes);
  if (r.cookie) entetes.set('cookie', r.cookie);
  let corps: BodyInit | undefined;
  if (r.formulaire) {
    entetes.set('content-type', 'application/x-www-form-urlencoded');
    corps = new URLSearchParams(r.formulaire).toString();
  } else if (r.multipart) {
    corps = r.multipart;
  } else if (r.json !== undefined) {
    entetes.set('content-type', 'application/json');
    corps = JSON.stringify(r.json);
  }
  if (methode !== 'GET' && methode !== 'HEAD') {
    const origine = r.origine === undefined ? new URL(adresse).origin : r.origine;
    if (origine !== null) entetes.set('origin', origine);
  }
  const requete = new Request(adresse, { method: methode, headers: entetes, body: corps });
  const reponse = await (worker.fetch as (r: Request, e: Environnement, c: unknown) => Promise<Response>)(requete, env, {});
  const texte = await reponse.text();
  const cookies = reponse.headers.getSetCookie().find((c) => c.startsWith('bbs=') && !c.startsWith('bbs=;'));
  return {
    statut: reponse.status,
    location: reponse.headers.get('location'),
    texte,
    get json() {
      return JSON.parse(texte);
    },
    entetes: reponse.headers,
    cookieSession: cookies ? cookies.split(';')[0].slice(4) : null,
  };
}
