// Les accès d'un cabinet et ses dossiers clients (lot 11). Aucun écran n'est branché ici (lot 13) : ce sont les opérations, avec
// leurs règles et leur journal. Toute lecture et toute écriture est bornée au locataire ; chaque écriture part dans le même
// `batch` que son événement.

import type { Base, Requete, Role } from './db';
import { ACCES_CABINET, ACCES_FACTURABLES, COMPTES_EDITEUR, aLeRole, enSql, roleCreable } from './roles';
import { EVENEMENT, requeteEvenement, type Acteur } from './journal';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maintenant = (): string => new Date().toISOString();

export type CodeAcces = 'nom' | 'email' | 'role' | 'pris' | 'inconnu' | 'interdit' | 'utilise' | 'inchange';
export type ResultatAcces = { ok: true; id: string } | { ok: false; code: CodeAcces };

// ---------------------------------------------------------------- lire

export interface Acces {
  id: string;
  nom: string;
  email: string;
  role: Role;
  actif: number;
}

/**
 * La liste des accès du cabinet : associés, collaborateurs, lecture. Jamais le compte de support de l'éditeur, jamais l'éditeur,
 * jamais un viewer. C'est la liste que le cabinet voit et sur laquelle il est facturé.
 */
export async function accesDuCabinet(db: Base, tenantId: string): Promise<Acces[]> {
  const { results } = await db
    .prepare(`SELECT id, nom, email, role, actif FROM utilisateur WHERE tenant_id = ? AND role IN (${enSql(ACCES_CABINET)}) ORDER BY nom, id`)
    .bind(tenantId)
    .all<Acces>();
  return results;
}

/**
 * Les nombres sur lesquels un litige se tranche. `actifs` : tous les accès affichés et actifs ; `facturables` : ceux qui entrent
 * dans le prix (associé, collaborateur) — `lecture`, le support de l'éditeur et les viewers n'y sont jamais.
 */
export async function compterAcces(db: Base, tenantId: string): Promise<{ actifs: number; facturables: number }> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS actifs,
              COALESCE(SUM(CASE WHEN role IN (${enSql(ACCES_FACTURABLES)}) THEN 1 ELSE 0 END), 0) AS facturables
         FROM utilisateur WHERE tenant_id = ? AND actif = 1 AND role IN (${enSql(ACCES_CABINET)})`,
    )
    .bind(tenantId)
    .first<{ actifs: number; facturables: number }>();
  return { actifs: r?.actifs ?? 0, facturables: r?.facturables ?? 0 };
}

/** Les dossiers clients par statut. Un dossier compte pour UN, quel que soit le nombre de ses portefeuilles. */
export async function compterDossiers(db: Base, tenantId: string): Promise<{ brouillon: number; publie: number; archive: number }> {
  const { results } = await db
    .prepare("SELECT statut, COUNT(*) AS n FROM utilisateur WHERE tenant_id = ? AND role = 'viewer' GROUP BY statut")
    .bind(tenantId)
    .all<{ statut: 'brouillon' | 'publie' | 'archive'; n: number }>();
  const nombres = { brouillon: 0, publie: 0, archive: 0 };
  for (const r of results) nombres[r.statut] = r.n;
  return nombres;
}

// ---------------------------------------------------------------- écrire

/** Le compte visé, du locataire, à gérer par cet acteur : le support et l'éditeur ne se gèrent pas depuis le cabinet. */
async function cibleGerable(db: Base, tenantId: string, id: string, acteur: Acteur | null) {
  const c = await db
    .prepare('SELECT id, email, role, actif FROM utilisateur WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<{ id: string; email: string; role: Role; actif: number }>();
  if (!c) return { code: 'inconnu' as const };
  const deLEditeur = aLeRole(c.role, COMPTES_EDITEUR);
  if (deLEditeur && !(acteur && aLeRole(acteur.role as Role, COMPTES_EDITEUR))) return { code: 'inconnu' as const };
  return { cible: c };
}

/**
 * Crée un accès du cabinet. Une adresse n'est unique qu'au sein d'un cabinet : le même compte de support peut exister dans un
 * deuxième. `support_editeur` ne se crée que par l'éditeur ou son support (ou le système : `acteur` null).
 */
export async function creerAcces(
  db: Base,
  tenantId: string,
  saisie: { nom: string; email: string; role: Role },
  acteur: Acteur | null,
): Promise<ResultatAcces> {
  const nom = saisie.nom.trim().slice(0, 120);
  const email = saisie.email.trim().toLowerCase().slice(0, 254);
  if (!nom) return { ok: false, code: 'nom' };
  if (!EMAIL.test(email)) return { ok: false, code: 'email' };
  if (!roleCreable(acteur, saisie.role)) return { ok: false, code: 'role' };
  if (await db.prepare('SELECT 1 AS ok FROM utilisateur WHERE tenant_id = ? AND email = ?').bind(tenantId, email).first()) {
    return { ok: false, code: 'pris' };
  }
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare('INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le) VALUES (?, ?, ?, ?, ?, 1, ?)')
        .bind(id, tenantId, email, nom, saisie.role, maintenant()),
      requeteEvenement(db, {
        tenantId, type: EVENEMENT.ACCES_CREE, acteur, cible: { type: 'acces', id }, detail: { email, role: saisie.role },
      }),
    ]);
  } catch {
    return { ok: false, code: 'pris' };
  }
  return { ok: true, id };
}

/**
 * Supprime un accès. Ses sessions et liens de connexion partent avec lui. S'il a déjà écrit au nom du cabinet (un import), la
 * base refuse la suppression : on le suspend plutôt. L'événement garde son adresse et son rôle.
 */
export async function supprimerAcces(db: Base, tenantId: string, id: string, acteur: Acteur | null): Promise<ResultatAcces> {
  const g = await cibleGerable(db, tenantId, id, acteur);
  if (!g.cible) return { ok: false, code: g.code };
  if (g.cible.role === 'viewer' || g.cible.role === 'editeur') return { ok: false, code: 'interdit' };
  const { id: cibleId, email, role } = g.cible;
  try {
    await db.batch([
      db.prepare('DELETE FROM session WHERE utilisateur_id = ?').bind(cibleId),
      db.prepare('DELETE FROM jeton_connexion WHERE utilisateur_id = ?').bind(cibleId),
      db.prepare('DELETE FROM utilisateur WHERE id = ? AND tenant_id = ?').bind(cibleId, tenantId),
      requeteEvenement(db, { tenantId, type: EVENEMENT.ACCES_SUPPRIME, acteur, cible: { type: 'acces', id: cibleId }, detail: { email, role } }, true),
    ]);
  } catch {
    return { ok: false, code: 'utilise' };
  }
  return { ok: true, id: cibleId };
}

/** Suspend (actif = 0) ou rétablit un accès. Rien n'est effacé. */
export async function suspendreAcces(db: Base, tenantId: string, id: string, actif: boolean, acteur: Acteur | null): Promise<ResultatAcces> {
  const g = await cibleGerable(db, tenantId, id, acteur);
  if (!g.cible) return { ok: false, code: g.code };
  if (g.cible.role === 'editeur') return { ok: false, code: 'interdit' };
  if ((g.cible.actif === 1) === actif) return { ok: false, code: 'inchange' };
  await db.batch([
    db.prepare('UPDATE utilisateur SET actif = ? WHERE id = ? AND tenant_id = ?').bind(actif ? 1 : 0, g.cible.id, tenantId),
    requeteEvenement(
      db,
      { tenantId, type: actif ? EVENEMENT.ACCES_REACTIVE : EVENEMENT.ACCES_SUSPENDU, acteur, cible: { type: 'acces', id: g.cible.id }, detail: { email: g.cible.email, role: g.cible.role } },
      true,
    ),
  ]);
  return { ok: true, id: g.cible.id };
}

/** Change le rôle d'un accès du cabinet. Un viewer ne devient jamais du personnel, ni l'inverse : ce n'est pas le même compte. */
export async function changerRole(db: Base, tenantId: string, id: string, role: Role, acteur: Acteur | null): Promise<ResultatAcces> {
  const g = await cibleGerable(db, tenantId, id, acteur);
  if (!g.cible) return { ok: false, code: g.code };
  const avant = g.cible.role;
  if (avant === 'viewer' || avant === 'editeur' || role === 'viewer' || role === 'editeur') return { ok: false, code: 'interdit' };
  if (!roleCreable(acteur, role)) return { ok: false, code: 'role' };
  if (avant === role) return { ok: false, code: 'inchange' };
  await db.batch([
    db.prepare('UPDATE utilisateur SET role = ? WHERE id = ? AND tenant_id = ?').bind(role, g.cible.id, tenantId),
    requeteEvenement(
      db,
      { tenantId, type: EVENEMENT.ACCES_ROLE, acteur, cible: { type: 'acces', id: g.cible.id }, detail: { email: g.cible.email, de: avant, vers: role } },
      true,
    ),
  ]);
  return { ok: true, id: g.cible.id };
}

/** L'événement de création d'un accès fait par un autre chemin (création d'un cabinet, d'un viewer, promotion d'un contact). */
export function evenementCreation(
  db: Base,
  tenantId: string,
  id: string,
  role: Role,
  email: string,
  acteur: Acteur | null,
): Requete {
  // Un viewer est un client final : son adresse n'entre jamais dans le journal.
  const detail = role === 'viewer' ? { role } : { email, role };
  return requeteEvenement(db, { tenantId, type: EVENEMENT.ACCES_CREE, acteur, cible: { type: role === 'viewer' ? 'dossier' : 'acces', id }, detail });
}

// ---------------------------------------------------------------- dossier client

/**
 * Brouillon → publié, au moment où le lien de première connexion est envoyé. Sans effet (et sans événement) si le dossier est
 * déjà publié ou archivé : renvoyer un lien ne republie rien. La date de publication est celle du premier passage.
 */
export async function publierDossier(db: Base, tenantId: string, viewerId: string, acteur: Acteur | null): Promise<boolean> {
  const r = await db.batch([
    db
      .prepare("UPDATE utilisateur SET statut = 'publie', publie_le = COALESCE(publie_le, ?) WHERE id = ? AND tenant_id = ? AND role = 'viewer' AND statut = 'brouillon'")
      .bind(maintenant(), viewerId, tenantId),
    requeteEvenement(db, { tenantId, type: EVENEMENT.DOSSIER_PUBLIE, acteur, cible: { type: 'dossier', id: viewerId } }, true),
  ]);
  return ((r[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0;
}

/** Brouillon ou publié → archivé. L'archivage ne supprime rien. */
export async function archiverDossier(db: Base, tenantId: string, viewerId: string, acteur: Acteur | null): Promise<boolean> {
  const r = await db.batch([
    db
      .prepare("UPDATE utilisateur SET statut = 'archive' WHERE id = ? AND tenant_id = ? AND role = 'viewer' AND statut <> 'archive'")
      .bind(viewerId, tenantId),
    requeteEvenement(db, { tenantId, type: EVENEMENT.DOSSIER_ARCHIVE, acteur, cible: { type: 'dossier', id: viewerId } }, true),
  ]);
  return ((r[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0;
}
