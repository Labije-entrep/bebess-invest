// Ce que les modules du contrat OUVRENT réellement (lot 15). Les deux drapeaux du contrat (`module_pilotage`, `module_site`) conditionnent
// des écrans : sans le module, la route n'existe pas pour ce cabinet.
//
//   Pilotage     le module de suivi : liste, fiche, kanban, parcours (les vues de /gestionnaire/suivi), actus, bibliothèque, et ce qui les
//                sert (API du suivi, passerelle, logos des contacts). Sans lui : 404 — jamais 403, on n'annonce pas ce qui n'a pas été acheté.
//   Site         les pages publiques du cabinet. Sans lui, la racine de l'hôte mène à /connexion et les autres pages répondent 404 : le
//                cabinet garde son propre site, il n'héberge ici que l'espace client (« niveau 0 » de l'offre).
//
// Rien n'est supprimé ni masqué en base : un module repris plus tard retrouve tout. Ce n'est PAS la règle « rien n'est jamais bloqué »
// de la spécification tarifaire, qui vise les quotas et les coupures en cours de période, pas la livraison d'un module non acheté.
//
// Un cabinet sans contrat en cours n'a rien acheté ni rien perdu : il garde l'accès entier (c'est l'état d'avant le contrat, et celui
// du cabinet de l'éditeur). Le drapeau lu est celui du contrat ; une désactivation programmée ne le baisse qu'à sa date (contrat.ts).

import type { Base } from './db';
import { STATUTS_EN_COURS } from './contrat';

export interface Modules {
  pilotage: boolean;
  site: boolean;
}

export const TOUT_OUVERT: Modules = { pilotage: true, site: true };

/** Les routes du module de suivi (préfixes) : l'espace du personnel, son API, et les fichiers qui n'ont de sens que dedans. */
export const ROUTES_PILOTAGE = [
  '/gestionnaire/suivi',
  '/gestionnaire/actus',
  '/gestionnaire/bibliotheque',
  '/gestionnaire/passerelle',
  '/gestionnaire/fichiers/logo-contact',
  '/fichiers/contact',
  '/api/suivi',
];
/** Les entrées du menu de l'espace gestionnaire qui ouvrent ces routes. */
export const MENU_PILOTAGE = ['/gestionnaire/suivi', '/gestionnaire/actus', '/gestionnaire/bibliotheque'];

/** Les pages publiques du cabinet. `/robots.txt` n'en fait pas partie : il protège aussi l'espace client. */
export const PAGES_SITE = ['/', '/approche', '/parcours', '/notes', '/contact', '/mentions-legales', '/en', '/sitemap.xml'];

const sous = (chemin: string, prefixe: string): boolean => chemin === prefixe || chemin.startsWith(`${prefixe}/`);

export const estRoutePilotage = (chemin: string): boolean => ROUTES_PILOTAGE.some((p) => sous(chemin, p));
export const estPageSite = (chemin: string): boolean => PAGES_SITE.some((p) => (p === '/' ? chemin === '/' : sous(chemin, p)));

export async function modulesDuTenant(db: Base, tenantId: string): Promise<Modules> {
  const c = await db
    .prepare(`SELECT module_pilotage, module_site FROM contrat WHERE tenant_id = ? AND statut IN (${STATUTS_EN_COURS.map((x) => `'${x}'`).join(',')})`)
    .bind(tenantId)
    .first<{ module_pilotage: number; module_site: number }>();
  return c ? { pilotage: c.module_pilotage === 1, site: c.module_site === 1 } : TOUT_OUVERT;
}
