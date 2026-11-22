// Les adresses d'un cabinet : où vit son site public, où vivent sa connexion et ses espaces.
//
// Un cabinet peut avoir plusieurs noms d'hôte (l'hôte d'origine, plus des noms propres validés par Cloudflare). Deux réglages, posés
// par l'éditeur dans la console, disent lequel sert quoi :
//   - `hote_public` : le site public (accueil, approche, parcours, notes, contact, mentions) ;
//   - `hote_espace` : la connexion, l'espace gestionnaire, l'espace client, et les liens envoyés par courriel.
// Chacun vaut l'hôte d'origine tant qu'il n'est pas posé : aucune redirection, comportement inchangé. Un réglage n'a de valeur que s'il
// désigne l'hôte d'origine ou un hôte VALIDÉ du cabinet ; sinon il est ignoré (retour à l'hôte d'origine). La lecture est faite par la
// requête du cabinet (db.ts, tenantParHote), pas par une requête de plus.
//
// Ce module ne lit jamais l'hôte cible dans la requête : il vient de la base.

import type { Base, Tenant } from './db';
import { hoteLocal } from './mail';
import { PAGES_SITE } from './modules';
import { reglagesDe } from './reglages';
import { noterIncident } from './incidents';

export const CLE_SITE = 'hote_public';
export const CLE_ESPACE = 'hote_espace';

const sous = (chemin: string, prefixe: string): boolean => chemin === prefixe || chemin.startsWith(`${prefixe}/`);

/** Ce qui se sert à l'adresse de connexion et d'espace. */
const CHEMINS_ESPACE = ['/connexion', '/gestionnaire', '/espace'];
/** Les pages publiques : celles du module Site, sauf le plan du site (servi par hôte). */
const CHEMINS_PUBLICS = PAGES_SITE.filter((p) => p !== '/sitemap.xml');

export interface Redirection {
  url: string;
  /** 301 pour le site public une fois le choix posé ; 302 pour la connexion et l'espace (le choix reste modifiable). */
  statut: 301 | 302;
}

/** Nom d'hôte de l'URL, sans port ni crochets, en minuscules. */
function hoteDe(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

/** Le développement local : jamais de redirection, jamais de canonique ailleurs que sur l'hôte de la requête. */
function enLocal(url: URL): boolean {
  return hoteLocal(hoteDe(url)) || hoteDe(url) === '::1';
}

/**
 * La redirection à faire pour cette requête, ou null. Seuls GET et HEAD sont redirigés, et seulement quand le cabinet a CHOISI
 * l'adresse du chemin (réglage posé) et que la requête n'arrive pas dessus. La cible est lue sur le locataire (donc en base), jamais
 * dans la requête ; elle désigne toujours un hôte du même cabinet, qui ne redirige pas lui-même : aucune boucle possible. Ce qui n'est ni
 * une page publique ni la connexion/l'espace (API, fichiers, logo, robots.txt, plan du site, ressources statiques, console de
 * l'éditeur, /plateforme, /deconnexion) n'est jamais redirigé.
 */
export function redirectionHote(tenant: Tenant | null, url: URL, methode: string): Redirection | null {
  if (!tenant || (methode !== 'GET' && methode !== 'HEAD') || enLocal(url)) return null;
  const chemin = url.pathname;
  let cible: string | null | undefined;
  let statut: 301 | 302;
  if (CHEMINS_ESPACE.some((p) => sous(chemin, p))) {
    if (!tenant.espace_choisi) return null;
    cible = tenant.hote_espace;
    statut = 302;
  } else if (CHEMINS_PUBLICS.some((p) => (p === '/' ? chemin === '/' : sous(chemin, p)))) {
    if (!tenant.site_choisi) return null;
    cible = tenant.hote_site;
    statut = 301;
  } else {
    return null;
  }
  if (!cible || cible === hoteDe(url)) return null;
  return { url: `${url.protocol}//${cible}${url.pathname}${url.search}`, statut };
}

/** `schéma://hôte[:port]` d'un hôte du cabinet. Le port de la requête ne suit que si l'hôte reste le même (il n'existe qu'en développement). */
function origineSur(hote: string | null | undefined, requete: URL): string {
  if (!hote || hote === hoteDe(requete)) return requete.origin;
  return `${requete.protocol}//${hote}`;
}

/** L'adresse du site public du cabinet. En local ou sans réglage lisible : celle de la requête. */
export function origineDuSite(tenant: Tenant | null, requete: URL): string {
  return enLocal(requete) ? requete.origin : origineSur(tenant?.hote_site, requete);
}

/** L'adresse de connexion et d'espace du cabinet. En local ou sans réglage lisible : celle de la requête. */
export function origineDeLEspace(tenant: Tenant | null, requete: URL): string {
  return enLocal(requete) ? requete.origin : origineSur(tenant?.hote_espace, requete);
}

/** Une page publique servie sur un autre hôte que l'adresse du site (montage sans redirection) ne doit pas être indexée. */
export function pageHorsAdresseDuSite(tenant: Tenant | null, requete: URL): boolean {
  return !!tenant?.hote_site && !enLocal(requete) && tenant.hote_site !== hoteDe(requete);
}

/** Le lien de connexion d'un jeton, sur l'adresse de connexion et d'espace du cabinet, quel que soit l'hôte de la requête. */
export function lienConnexion(tenant: Tenant | null, requete: URL, jeton: string): string {
  return `${origineDeLEspace(tenant, requete)}/connexion/${jeton}`;
}

// ---------------------------------------------------------------- lecture pour la console

export interface AdressesCabinet {
  /** L'hôte d'origine du cabinet : il compte toujours comme validé. */
  origine: string | null;
  /** Les hôtes qu'on peut choisir : l'origine et les hôtes validés. */
  choisissables: string[];
  /** Le choix enregistré (null : pas de choix, comportement par défaut) et l'hôte effectif. */
  site: { choix: string | null; effectif: string | null };
  espace: { choix: string | null; effectif: string | null };
  /** Un choix enregistré dont l'hôte n'est plus valide : repéré, jamais appliqué. */
  perimes: { cle: string; hote: string }[];
}

export async function adressesDe(db: Base, tenantId: string): Promise<AdressesCabinet> {
  const [t, valides, lu] = await Promise.all([
    db.prepare('SELECT domaine FROM tenant WHERE id = ?').bind(tenantId).first<{ domaine: string | null }>(),
    db.prepare('SELECT hote FROM domaine WHERE tenant_id = ? AND valide_le IS NOT NULL ORDER BY principal DESC, hote').bind(tenantId).all<{ hote: string }>(),
    reglagesDe(db, tenantId, [CLE_SITE, CLE_ESPACE]),
  ]);
  const origine = t?.domaine ?? null;
  const choisissables = [...new Set([...(origine ? [origine] : []), ...valides.results.map((r) => r.hote)])];
  const bon = (h: string | undefined): string | null => (h && choisissables.includes(h) ? h : null);
  const perimes = [CLE_SITE, CLE_ESPACE].filter((c) => lu[c] && !bon(lu[c])).map((cle) => ({ cle, hote: lu[cle] }));
  return {
    origine,
    choisissables,
    site: { choix: bon(lu[CLE_SITE]), effectif: bon(lu[CLE_SITE]) ?? origine },
    espace: { choix: bon(lu[CLE_ESPACE]), effectif: bon(lu[CLE_ESPACE]) ?? origine },
    perimes,
  };
}

/**
 * Retour automatique à l'hôte d'origine : un réglage qui désigne un hôte devenu invalide (validation perdue, hôte retiré) est effacé,
 * et un incident le dit dans la console. Aucune page ne reste sans adresse : en attendant, la requête du cabinet ignore déjà ce choix.
 * Renvoie les réglages effacés.
 */
export async function reparerAdresses(db: Base, tenantId: string): Promise<string[]> {
  const a = await adressesDe(db, tenantId);
  for (const p of a.perimes) {
    await db.prepare('DELETE FROM reglage WHERE tenant_id = ? AND cle = ? AND valeur = ?').bind(tenantId, p.cle, p.hote).run();
    await noterIncident(
      db,
      tenantId,
      'adresse_repli',
      `${p.cle === CLE_SITE ? 'Adresse du site public' : 'Adresse de connexion et d’espace'} : ${p.hote} n’est plus valide, retour à l’hôte d’origine${a.origine ? ` (${a.origine})` : ''}.`,
    );
  }
  return a.perimes.map((p) => p.cle);
}
