// Connexion par lien magique. Un jeton de 32 octets aléatoires, jamais stocké en clair :
// la base ne contient que son SHA-256. Le cookie "bbs" porte un second jeton aléatoire
// dont la base ne garde aussi que le hash (session.id).

import type { AstroCookies } from 'astro';
import { utilisateurParId, type Base, type Role, type Utilisateur } from './db';
import { ACCES_CABINET, ESSAI_ECHU_COUPES, enSql } from './roles';
import { STATUTS_EN_COURS } from './contrat';

export const COOKIE = 'bbs';

const VALIDITE_JETON_MS = 15 * 60 * 1000;
const VALIDITE_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const FENETRE_LIMITE_MS = 60 * 60 * 1000;
const DEMANDES_MAX = 10;

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Condition SQL (alias `u` = utilisateur) : un cabinet suspendu (lot 10) n'a plus de personnel qui puisse entrer (associés,
 * collaborateurs, lecture : les accès du cabinet). Elle vaut pour la demande de lien, l'ouverture du lien ET chaque requête d'une
 * session déjà ouverte : suspendre rend donc inopérants les accès existants sans rien effacer, et lever la suspension les rend.
 * Les viewers n'en dépendent jamais : leurs espaces restent consultables. L'éditeur et son compte de support (support_editeur,
 * lot 11) ne sont pas concernés : ils ne sont pas des accès du cabinet, et la suspension est une mesure contre lui.
 */
export const HORS_SUSPENSION =
  `NOT (u.role IN (${enSql(ACCES_CABINET)}) AND EXISTS (SELECT 1 FROM suspension sp WHERE sp.tenant_id = u.tenant_id AND sp.fin_le IS NULL))`;

/**
 * L'essai non converti (lot 12) : à J+45 le contrat passe en `essai_non_converti` et, TANT QU'AUCUN AUTRE contrat n'est en cours,
 * le cabinet se ferme — ses viewers COMPRIS (ESSAI_ECHU_COUPES), contrairement à la suspension commerciale ci-dessus qui les laisse
 * en ligne. L'associé n'est pas coupé ici : il garde l'export de ses données (le middleware le borne à cette seule route). Un
 * contrat `suspendu` (litige de facturation) n'entre pas dans cette condition : seul `essai_non_converti` ferme.
 * Les deux conditions ne se fusionnent pas : elles sont jointes par ACCES_OUVERT, qui est tout ce que les requêtes de session lisent.
 */
export const HORS_ESSAI_ECHU =
  `NOT (u.role IN (${enSql(ESSAI_ECHU_COUPES)})
        AND EXISTS (SELECT 1 FROM contrat ce WHERE ce.tenant_id = u.tenant_id AND ce.statut = 'essai_non_converti')
        AND NOT EXISTS (SELECT 1 FROM contrat ec WHERE ec.tenant_id = u.tenant_id AND ec.statut IN (${STATUTS_EN_COURS.map((x) => `'${x}'`).join(',')})))`;

/** Les deux mesures d'accès, chacune avec son périmètre : la suspension du cabinet, la fin d'un essai non converti. */
export const ACCES_OUVERT = `${HORS_SUSPENSION} AND ${HORS_ESSAI_ECHU}`;

/**
 * Un dossier ARCHIVÉ ferme l'accès de son viewer : c'est l'inverse exact de la suspension d'un cabinet, qui LAISSE les viewers en
 * ligne. Les deux mécanismes ne se rejoignent pas : HORS_SUSPENSION ne touche jamais un viewer, celui-ci ne touche que lui.
 * Il n'est pas une condition SQL de la session : un viewer archivé garde une session lisible pour que le middleware lui réponde
 * par un message qui l'oriente vers son conseiller, au lieu de le renvoyer en silence vers la connexion (voir `dossierFerme`).
 */
export const dossierFerme = (u: { role: Role; statut?: string } | null | undefined): boolean =>
  !!u && u.role === 'viewer' && u.statut === 'archive';

function iso(decalageMs = 0): string {
  return new Date(Date.now() + decalageMs).toISOString();
}

function aleatoire(): string {
  const octets = new Uint8Array(32);
  crypto.getRandomValues(octets);
  return Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('');
}

async function sha256(texte: string): Promise<string> {
  const empreinte = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(empreinte), (o) => o.toString(16).padStart(2, '0')).join('');
}

export function accueilDuRole(role: Role): string {
  if (role === 'viewer') return '/espace';
  if (role === 'editeur') return '/admin';
  return '/gestionnaire'; // associe, collaborateur, lecture, support_editeur
}

/**
 * Prépare un lien pour un utilisateur actif du tenant et renvoie le jeton en clair.
 * Renvoie null, sans rien distinguer, si l'e-mail est inconnu ou si la limite
 * de 10 demandes par heure est atteinte : l'appelant affiche toujours le même message.
 * La limite se compte dans jeton_connexion : un jeton vit 15 minutes, donc une demande
 * faite il y a moins d'une heure a une expiration postérieure à (maintenant - 45 min).
 */
export async function demanderLien(db: Base, tenantId: string, email: string): Promise<string | null> {
  const utilisateur = await db
    .prepare(`SELECT u.id FROM utilisateur u WHERE u.tenant_id = ? AND u.email = ? AND u.actif = 1 AND ${ACCES_OUVERT}`)
    .bind(tenantId, email.trim().toLowerCase())
    .first<{ id: string }>();
  if (!utilisateur) return null;

  const seuil = iso(-FENETRE_LIMITE_MS + VALIDITE_JETON_MS);
  const compte = await db
    .prepare('SELECT COUNT(*) AS n FROM jeton_connexion WHERE utilisateur_id = ? AND expire_le > ?')
    .bind(utilisateur.id, seuil)
    .first<{ n: number }>();
  if ((compte?.n ?? 0) >= DEMANDES_MAX) {
    // Visible côté serveur seulement : la réponse au navigateur ne change pas.
    console.warn(`[connexion] limite de ${DEMANDES_MAX} demandes par heure atteinte`);
    return null;
  }

  // Ménage : les jetons expirés depuis plus d'un jour ne servent plus à rien.
  await db.prepare('DELETE FROM jeton_connexion WHERE expire_le < ?').bind(iso(-24 * 60 * 60 * 1000)).run();

  const jeton = aleatoire();
  await db
    .prepare('INSERT INTO jeton_connexion (hash, utilisateur_id, expire_le, utilise_le) VALUES (?, ?, ?, NULL)')
    .bind(await sha256(jeton), utilisateur.id, iso(VALIDITE_JETON_MS))
    .run();
  return jeton;
}

/**
 * Lecture seule : le jeton existe-t-il, est-il non expiré, non utilisé, et d'un utilisateur
 * actif de ce tenant ? Ne modifie rien. Seul consommerJeton consomme.
 */
export async function jetonValide(db: Base, jeton: string, tenantId: string): Promise<boolean> {
  if (!HEX_64.test(jeton)) return false;
  const ligne = await db
    .prepare(
      `SELECT 1 AS ok FROM jeton_connexion
        WHERE hash = ? AND utilise_le IS NULL AND expire_le > ?
          AND utilisateur_id IN (SELECT u.id FROM utilisateur u WHERE u.tenant_id = ? AND u.actif = 1 AND ${ACCES_OUVERT})`,
    )
    .bind(await sha256(jeton), iso(), tenantId)
    .first<{ ok: number }>();
  return ligne !== null;
}

/**
 * Consomme le jeton une seule fois (un seul UPDATE conditionnel, donc sans course),
 * ouvre une session de 30 jours et pose le cookie. Renvoie null si le jeton est
 * invalide, expiré, déjà utilisé, ou s'il n'appartient pas à ce tenant.
 */
export async function consommerJeton(
  db: Base,
  cookies: AstroCookies,
  jeton: string,
  tenantId: string,
): Promise<Utilisateur | null> {
  if (!HEX_64.test(jeton)) return null;
  const maintenant = iso();
  const ligne = await db
    .prepare(
      `UPDATE jeton_connexion SET utilise_le = ?
        WHERE hash = ? AND utilise_le IS NULL AND expire_le > ?
          AND utilisateur_id IN (SELECT u.id FROM utilisateur u WHERE u.tenant_id = ? AND u.actif = 1 AND ${ACCES_OUVERT})
        RETURNING utilisateur_id`,
    )
    .bind(maintenant, await sha256(jeton), maintenant, tenantId)
    .first<{ utilisateur_id: string }>();
  if (!ligne) return null;

  const utilisateur = await utilisateurParId(db, ligne.utilisateur_id);
  if (!utilisateur) return null;

  await db.prepare('DELETE FROM session WHERE expire_le < ?').bind(maintenant).run();

  const secret = aleatoire();
  await db
    .prepare('INSERT INTO session (id, utilisateur_id, expire_le, cree_le) VALUES (?, ?, ?, ?)')
    .bind(await sha256(secret), utilisateur.id, iso(VALIDITE_SESSION_MS), maintenant)
    .run();

  cookies.set(COOKIE, secret, {
    httpOnly: true,
    // Secure en production. En développement, http://localhost : Safari refuse les cookies Secure.
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: VALIDITE_SESSION_MS / 1000,
  });
  return utilisateur;
}

/** L'utilisateur actif de la session portée par le cookie, ou null. */
export async function sessionCourante(db: Base, cookies: AstroCookies): Promise<Utilisateur | null> {
  const secret = cookies.get(COOKIE)?.value;
  if (!secret || !HEX_64.test(secret)) return null;
  return db
    .prepare(
      `SELECT u.id, u.tenant_id, u.email, u.nom, u.role, u.actif, u.cree_le, u.statut
         FROM session s
         JOIN utilisateur u ON u.id = s.utilisateur_id
        WHERE s.id = ? AND s.expire_le > ? AND u.actif = 1 AND ${ACCES_OUVERT}`,
    )
    .bind(await sha256(secret), iso())
    .first<Utilisateur>();
}

export async function deconnecter(db: Base, cookies: AstroCookies): Promise<void> {
  const secret = cookies.get(COOKIE)?.value;
  if (secret && HEX_64.test(secret)) {
    await db.prepare('DELETE FROM session WHERE id = ?').bind(await sha256(secret)).run();
  }
  cookies.delete(COOKIE, { path: '/' });
}
