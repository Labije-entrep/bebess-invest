// La passerelle (lot 07) : de la fiche d'un contact vers le portail, et de l'actu vers la note de marché.
//
// Quatre ponts, tous commandés par un geste humain : rien ici ne se déclenche seul. Les routes qui les
// appellent sont des POST de formulaire (src/pages/gestionnaire/passerelle/). Chaque identifiant reçu est
// contrôlé contre le locataire avant tout usage ; ce qui est écrit est recalculé côté serveur, jamais lu
// dans le formulaire. Aucun texte n'est généré : les phrases des sujets sont des gabarits fixes.

import type { APIContext } from 'astro';
import { dateLongue, pourcent } from './format';
import { signeBp } from './espace';
import { cleMarquee } from './listes';
import { MARQUEUR } from './marqueurs';
import { envDe } from './mail';
import { incrementerVersion } from './version';
import { evenementCreation } from './acces';
import type { Acteur } from './journal';
import type { Base, Role, Tenant, Utilisateur } from './db';
import type { BlocPortefeuille, EcartHorsSeuil } from './fiche';

// ---------------------------------------------------------------- garde

export interface Garde {
  db: Base;
  tenant: Tenant;
  utilisateur: Utilisateur;
}

/** Session, rôle, même origine. Sans session : la connexion ; mauvais rôle ou autre origine : 403. */
export function garde(ctx: APIContext, roles: Role[]): Garde | Response {
  const { utilisateur, tenant } = ctx.locals;
  if (!utilisateur || !tenant) return ctx.redirect('/connexion');
  if (!roles.includes(utilisateur.role)) return new Response('Accès refusé.', { status: 403 });
  const origine = ctx.request.headers.get('Origin');
  if (origine && new URL(origine).host !== ctx.url.host) return new Response('Origine refusée.', { status: 403 });
  return { db: envDe(ctx.locals).DB, tenant, utilisateur };
}

/** Identifiant inconnu ou d'un autre cabinet : la même réponse, rien ne distingue les deux. */
export const introuvable = (): Response => new Response('Introuvable.', { status: 404 });

// ---------------------------------------------------------------- 1. promotion

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ResultatPromotion =
  | { ok: true; viewerId: string; email: string; nom: string }
  | { ok: false; code: 'deja' | 'email_absent' | 'email_invalide' | 'email_pris' | 'inconnu' | 'type_absent' };

/**
 * Crée, en une transaction, le viewer (nom, prénom et adresse du contact), sa fiche et son portefeuille
 * « Patrimoine », puis pose `contact.viewer_id`. Tout ou rien (`batch` de D1) : l'adresse d'un utilisateur est
 * unique dans son cabinet, donc un second clic simultané échoue sur la première insertion et rien n'est écrit deux fois.
 * L'envoi du lien se fait après, par l'appelant : s'il échoue, le rattachement reste fait.
 */
export async function promouvoir(db: Base, tenantId: string, contactId: string, acteur: Acteur | null): Promise<ResultatPromotion> {
  const c = await db
    .prepare('SELECT id, nom, prenom, email, viewer_id FROM contact WHERE id = ? AND tenant_id = ?')
    .bind(contactId, tenantId)
    .first<{ id: string; nom: string; prenom: string | null; email: string | null; viewer_id: string | null }>();
  if (!c) return { ok: false, code: 'inconnu' };
  if (c.viewer_id) return { ok: false, code: 'deja' };

  const email = (c.email ?? '').trim().toLowerCase();
  if (email === '') return { ok: false, code: 'email_absent' };
  if (!EMAIL.test(email)) return { ok: false, code: 'email_invalide' };
  // Une adresse n'est unique qu'au sein d'un cabinet (lot 11) : on ne la cherche que dans celui-ci.
  if (await db.prepare('SELECT 1 AS ok FROM utilisateur WHERE tenant_id = ? AND email = ?').bind(tenantId, email).first()) return { ok: false, code: 'email_pris' };

  // Type du portefeuille de départ : la valeur qui porte le marqueur « Type par défaut ». Sans elle, on ne devine rien.
  const typeDefaut = await cleMarquee(db, tenantId, 'type_portefeuille', MARQUEUR.DEFAUT);
  if (!typeDefaut) return { ok: false, code: 'type_absent' };

  const nom = [c.prenom?.trim(), c.nom.trim()].filter(Boolean).join(' ');
  const viewerId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare("INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le) VALUES (?, ?, ?, ?, 'viewer', 1, ?)")
        .bind(viewerId, tenantId, email, nom, now),
      db.prepare('INSERT INTO fiche (utilisateur_id) VALUES (?)').bind(viewerId),
      db
        .prepare("INSERT INTO portefeuille (id, tenant_id, viewer_id, libelle, type, ordre, cree_le) VALUES (?, ?, ?, 'Patrimoine', ?, 0, ?)")
        .bind(crypto.randomUUID(), tenantId, viewerId, typeDefaut, now),
      db
        .prepare('UPDATE contact SET viewer_id = ?, maj_le = ? WHERE id = ? AND tenant_id = ? AND viewer_id IS NULL')
        .bind(viewerId, now, contactId, tenantId),
      evenementCreation(db, tenantId, viewerId, 'viewer', email, acteur),
    ]);
  } catch {
    // Adresse prise entre-temps, ou contact promu par un autre clic : on relit pour dire laquelle.
    const apres = await db.prepare('SELECT viewer_id FROM contact WHERE id = ? AND tenant_id = ?').bind(contactId, tenantId).first<{ viewer_id: string | null }>();
    return { ok: false, code: apres?.viewer_id ? 'deja' : 'email_pris' };
  }
  await incrementerVersion(db, tenantId);
  return { ok: true, viewerId, email, nom };
}

// ---------------------------------------------------------------- 3 et 4. sujets depuis le portail

/** Texte du sujet d'écart : la classe, le réel et la cible, dans une phrase fixe. */
export function texteEcart(e: EcartHorsSeuil, arrete: string | null, plusieursPortefeuilles: boolean): string {
  const lignes = e.portefeuilles.map(
    (p) =>
      `${plusieursPortefeuilles ? `${p.libelle} : ` : ''}réel ${pourcent(p.partBp)}, cible ${pourcent(p.cibleBp)} (écart ${signeBp(p.ecartBp).replace(/\s%$/, '')} points)`,
  );
  return `Écart d’allocation sur « ${e.libelle} » : ${lignes.join(' ; ')}.${arrete ? ` Arrêté du ${dateLongue(arrete)}.` : ''}`;
}

/** Texte du sujet d'arrêté périmé. */
export function texteArrete(b: BlocPortefeuille & { arrete: string }, jours: number): string {
  return `Arrêté périmé : le portefeuille « ${b.libelle} » a été arrêté pour la dernière fois le ${dateLongue(b.arrete)}, soit au-delà du seuil de ${jours} jours.`;
}

/**
 * Le statut de création : le premier statut actif non terminal de la liste du cabinet, dans l'ordre de la liste.
 * Jamais une clé écrite en dur : un cabinet qui renomme ses statuts reçoit ses sujets au bon endroit.
 */
export async function statutDeCreation(db: Base, tenantId: string): Promise<string | null> {
  const r = await db
    .prepare(
      `SELECT cle FROM liste_valeur
        WHERE tenant_id = ? AND liste = 'statut_sujet' AND actif = 1 AND terminal = 0
        ORDER BY ordre, cle LIMIT 1`,
    )
    .bind(tenantId)
    .first<{ cle: string }>();
  return r?.cle ?? null;
}

/** Les sujets d'écart ont pour origine `ecart:<classe>:<date de l'arrêté>`. */
export const prefixeEcart = (classe: string): string => `ecart:${classe}:`;

const NON_CLOS = `archive = 0 AND statut NOT IN (SELECT cle FROM liste_valeur WHERE tenant_id = ? AND liste = 'statut_sujet' AND terminal = 1)`;

/**
 * Les classes d'actifs qui ont déjà un sujet d'écart non clos (et non archivé) sur ce contact, quelle que soit la date d'arrêté qui l'a
 * fait naître : c'est ce qui grise le bouton « Créer un sujet depuis l'écart ». Un sujet clos redonne la main.
 */
export async function classesAvecEcartOuvert(db: Base, tenantId: string, contactId: string): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT origine FROM sujet WHERE tenant_id = ? AND contact_id = ? AND origine LIKE 'ecart:%' AND ${NON_CLOS}`)
    .bind(tenantId, contactId, tenantId)
    .all<{ origine: string }>();
  const classes = new Set<string>();
  for (const { origine } of results) {
    const reste = origine.slice('ecart:'.length);
    const i = reste.lastIndexOf(':');
    if (i > 0) classes.add(reste.slice(0, i));
  }
  return classes;
}

/**
 * Crée le sujet portant `origine` sur le contact, sauf si un sujet non clos et non archivé la porte déjà : dans ce
 * cas renvoie celui-là. « Non clos » se lit dans la colonne `terminal` de la liste. La vérification et l'insertion
 * sont une seule requête : deux clics simultanés ne créent pas deux sujets.
 */
export async function sujetPourOrigine(
  db: Base,
  tenantId: string,
  contactId: string,
  origine: string,
  texte: string,
  /** Le sujet non clos qui vaut doublon : par défaut celui de la même origine ; pour un écart, toute origine de la même classe. */
  prefixeDoublon: string = origine,
): Promise<{ id: string; cree: boolean } | { refus: 'statut' }> {
  const statut = await statutDeCreation(db, tenantId);
  if (statut === null) return { refus: 'statut' };

  const OUVERT = `tenant_id = ? AND contact_id = ? AND substr(origine, 1, length(?)) = ? AND archive = 0
    AND statut NOT IN (SELECT cle FROM liste_valeur WHERE tenant_id = ? AND liste = 'statut_sujet' AND terminal = 1)`;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO sujet (id, tenant_id, contact_id, texte, statut, echeance, origine, cree_le, fait_le, archive)
       SELECT ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 0
        WHERE NOT EXISTS (SELECT 1 FROM sujet WHERE ${OUVERT})`,
    )
    .bind(id, tenantId, contactId, texte, statut, origine, new Date().toISOString(), tenantId, contactId, prefixeDoublon, prefixeDoublon, tenantId)
    .run();
  const ouvert = await db
    .prepare(`SELECT id FROM sujet WHERE ${OUVERT} ORDER BY cree_le, id LIMIT 1`)
    .bind(tenantId, contactId, prefixeDoublon, prefixeDoublon, tenantId)
    .first<{ id: string }>();
  if (!ouvert) return { refus: 'statut' };
  if (ouvert.id === id) await incrementerVersion(db, tenantId);
  return { id: ouvert.id, cree: ouvert.id === id };
}
