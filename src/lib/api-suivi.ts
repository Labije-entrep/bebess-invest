// API JSON du module de suivi (lot 02). Réutilise la session et le locataire posés par le
// middleware : aucune authentification propre. Réservée aux rôles gestionnaire et éditeur.
//
// Toute valeur de liste passe par valeurValide ; tout identifiant reçu est contrôlé contre le
// locataire avant usage. Les noms de colonnes viennent des tables fermées ci-dessous, jamais
// de la saisie.

import { GESTION_ECRIT, GESTION_LIT, aLeRole } from './roles';
import type { APIContext } from 'astro';
import { COOKIE } from './auth';
import { appartient, type Ressource } from './cloisonnement';
import type { Base, Tenant, Utilisateur } from './db';
import type { Liste } from './listes-defaut';
import { refusValeur, terminauxDe } from './listes';
import { envDe } from './mail';
import { incrementerVersion } from './version';

export const nouvelId = (): string => crypto.randomUUID();
export const maintenant = (): string => new Date().toISOString();

// ---------------------------------------------------------------- réponses

const ENTETES = { 'Content-Type': 'application/json; charset=utf-8' };

export function json(corps: unknown, statut = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...ENTETES, ...extra } });
}
const erreur = (statut: number, message: string, plus: Record<string, unknown> = {}) =>
  json({ erreur: message, ...plus }, statut);

// ---------------------------------------------------------------- garde

export interface Appel {
  db: Base;
  tenant: Tenant;
  utilisateur: Utilisateur;
}

// Limite de débit : 120 écritures par minute et par session, fenêtre fixe, compteur en mémoire.
// Aucune table prévue au schéma pour cela : la limite vaut donc par instance du Worker
// (voir ETAT.md, lot 02).
const LIMITE_ECRITURES = 120;
const FENETRE_MS = 60_000;
const compteurs = new Map<string, { debut: number; n: number }>();

function limiter(cle: string, maintenantMs: number): number | null {
  if (compteurs.size > 5000) {
    for (const [k, v] of compteurs) if (maintenantMs - v.debut >= FENETRE_MS) compteurs.delete(k);
  }
  const c = compteurs.get(cle);
  if (!c || maintenantMs - c.debut >= FENETRE_MS) {
    compteurs.set(cle, { debut: maintenantMs, n: 1 });
    return null;
  }
  c.n += 1;
  return c.n > LIMITE_ECRITURES ? Math.max(1, Math.ceil((c.debut + FENETRE_MS - maintenantMs) / 1000)) : null;
}

/** Session, rôle, locataire. En écriture : JSON exigé, même origine, débit limité. */
export function garde(ctx: APIContext, ecriture: boolean): Appel | Response {
  const { utilisateur, tenant } = ctx.locals;
  if (!utilisateur || !tenant) return erreur(401, 'Connexion requise.');
  // Lecture : tout le personnel, `lecture` compris ; écriture : les rôles qui écrivent (lot 11).
  if (!aLeRole(utilisateur.role, ecriture ? GESTION_ECRIT : GESTION_LIT)) return erreur(403, 'Accès refusé.');
  if (ecriture) {
    const origine = ctx.request.headers.get('Origin');
    if (origine && new URL(origine).host !== ctx.url.host) return erreur(403, 'Origine refusée.');
    if (!(ctx.request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
      return erreur(415, 'Content-Type application/json requis.');
    }
    const secret = ctx.cookies.get(COOKIE)?.value ?? utilisateur.id;
    const attente = limiter(secret, Date.now());
    if (attente !== null) {
      return json({ erreur: 'Trop d\'écritures : 120 par minute au plus.' }, 429, { 'Retry-After': String(attente) });
    }
  }
  return { db: envDe(ctx.locals).DB, tenant, utilisateur };
}

// ---------------------------------------------------------------- champs

type Genre = 'texte' | 'date' | 'entier' | 'bool' | 'liste' | 'membre' | 'contact';
interface Champ {
  col: string;
  genre: Genre;
  max?: number;
  liste?: Liste;
  requis?: boolean;
  /** Posé à la création seulement : jamais modifiable par PATCH. */
  creation?: boolean;
}

const t = (col: string, max: number, requis = false): Champ => ({ col, genre: 'texte', max, requis });
const d = (col: string): Champ => ({ col, genre: 'date' });

const CONTACT: Champ[] = [
  t('nom', 200, true), t('prenom', 200), t('email', 254), t('tel', 50),
  { col: 'metier', genre: 'liste', liste: 'metier' }, t('structure', 200),
  { col: 'responsable_id', genre: 'membre' }, { col: 'binome_id', genre: 'membre' },
  { col: 'etape', genre: 'liste', liste: 'etape' },
  { col: 'convention', genre: 'bool' }, d('convention_le'),
  { col: 'apporteur_id', genre: 'contact' },
  d('relance'), d('dernier_echange'), { col: 'type_echange', genre: 'liste', liste: 'type_echange' },
  { col: 'avoirs_cents', genre: 'entier' }, d('avoirs_le'),
  t('notes', 5000), t('logo_cle', 200),
  { col: 'archive', genre: 'bool' },
];
const SUJET: Champ[] = [
  { col: 'contact_id', genre: 'contact', requis: true, creation: true },
  t('texte', 2000, true),
  { col: 'statut', genre: 'liste', liste: 'statut_sujet', requis: true },
  d('echeance'), t('origine', 200), d('fait_le'),
  { col: 'archive', genre: 'bool' },
];
const ECHANGE: Champ[] = [
  { col: 'contact_id', genre: 'contact', requis: true, creation: true },
  { ...d('date'), requis: true },
  { col: 'type', genre: 'liste', liste: 'type_echange', requis: true },
  t('note', 5000),
];

export interface Entite {
  table: 'contact' | 'sujet' | 'echange';
  champs: Champ[];
  /** Colonne maj_le ? (contact seulement) */
  majLe: boolean;
}
export const ENTITES: Record<'contact' | 'sujet' | 'echange', Entite> = {
  contact: { table: 'contact', champs: CONTACT, majLe: true },
  sujet: { table: 'sujet', champs: SUJET, majLe: false },
  echange: { table: 'echange', champs: ECHANGE, majLe: false },
};

class Refus extends Error {
  constructor(public statut: number, message: string, public plus: Record<string, unknown> = {}) {
    super(message);
  }
}

function dateIso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!r) return null;
  const x = new Date(Date.UTC(+r[1], +r[2] - 1, +r[3]));
  return x.getUTCFullYear() === +r[1] && x.getUTCMonth() === +r[2] - 1 && x.getUTCDate() === +r[3] ? v : null;
}

/** Contrôle une valeur et renvoie ce qui s'écrit en base. Lève Refus (422, ou 404 pour un parent). */
async function valider(c: Champ, v: unknown, a: Appel, soi: string | null): Promise<string | number | null> {
  const faux = (msg: string) => new Refus(422, `${c.col} : ${msg}`, { champ: c.col });
  if (v === null || (c.genre !== 'texte' && v === '')) {
    if (c.requis || c.col === 'nom') throw faux('valeur requise.');
    return c.genre === 'bool' ? 0 : null;
  }
  switch (c.genre) {
    case 'texte': {
      if (typeof v !== 'string') throw faux('texte attendu.');
      const s = v.trim();
      if (c.requis && !s) throw faux('valeur requise.');
      if (s.length > (c.max ?? 200)) throw faux(`${c.max} caractères au plus.`);
      if (c.col === 'email' && s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw faux('adresse invalide.');
      return s === '' ? null : s;
    }
    case 'date': {
      const s = dateIso(v);
      if (!s) throw faux('date AAAA-MM-JJ attendue.');
      return s;
    }
    case 'entier':
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw faux('entier attendu (centimes).');
      return v;
    case 'bool':
      if (v === true || v === 1) return 1;
      if (v === false || v === 0) return 0;
      throw faux('0, 1 ou booléen attendu.');
    case 'liste': {
      if (typeof v !== 'string') throw faux('texte attendu.');
      const refus = await refusValeur(a.db, a.tenant.id, c.liste!, v);
      if (refus) {
        const admises = refus.split('Valeurs admises : ')[1]?.replace(/\.$/, '').split(', ').filter((x) => x && x !== 'aucune') ?? [];
        throw new Refus(422, refus, { champ: c.col, admises });
      }
      return v;
    }
    case 'membre':
    case 'contact': {
      if (typeof v !== 'string' || v.length > 64) throw faux('identifiant attendu.');
      const ressource: Ressource = c.genre;
      // Inconnu ou d'un autre locataire : même réponse, rien ne distingue les deux.
      if (!(await appartient(a.db, a.tenant.id, ressource, v))) {
        if (c.col === 'contact_id') throw new Refus(404, 'Contact introuvable.');
        throw faux(`${c.genre} inconnu.`);
      }
      if (c.col === 'apporteur_id' && v === soi) throw faux('un contact ne peut pas être son propre apporteur.');
      return v;
    }
  }
}

async function lireCorps(req: Request): Promise<Record<string, unknown>> {
  const brut = await req.text();
  if (brut.length > 65536) throw new Refus(413, 'Corps trop volumineux.');
  let o: unknown;
  try {
    o = JSON.parse(brut);
  } catch {
    throw new Refus(400, 'JSON invalide.');
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Refus(400, 'Objet JSON attendu.');
  return o as Record<string, unknown>;
}

/** Contacts : `types` est un tableau de valeurs de la liste type_contact. */
async function lireTypes(a: Appel, corps: Record<string, unknown>): Promise<string[] | undefined> {
  if (!('types' in corps)) return undefined;
  const v = corps.types;
  if (!Array.isArray(v) || v.length > 20 || v.some((x) => typeof x !== 'string')) {
    throw new Refus(422, 'types : tableau de valeurs attendu.', { champ: 'types' });
  }
  const uniques = [...new Set(v as string[])];
  for (const x of uniques) {
    const refus = await refusValeur(a.db, a.tenant.id, 'type_contact', x);
    if (refus) throw new Refus(422, refus, { champ: 'types' });
  }
  return uniques;
}

function enRefus(e: unknown): Response {
  if (e instanceof Refus) return erreur(e.statut, e.message, e.plus);
  throw e;
}

// ---------------------------------------------------------------- lecture

export async function lire(a: Appel, entite: Entite, id: string): Promise<Record<string, unknown> | null> {
  const ligne = await a.db
    .prepare(`SELECT * FROM ${entite.table} WHERE id = ? AND tenant_id = ?`)
    .bind(id, a.tenant.id)
    .first<Record<string, unknown>>();
  if (!ligne) return null;
  if (entite.table === 'contact') {
    const { results } = await a.db
      .prepare('SELECT type FROM contact_type WHERE contact_id = ? AND tenant_id = ? ORDER BY type')
      .bind(id, a.tenant.id)
      .all<{ type: string }>();
    ligne.types = results.map((r) => r.type);
  }
  return ligne;
}

// ---------------------------------------------------------------- écritures

export async function creer(ctx: APIContext, entite: Entite): Promise<Response> {
  const a = garde(ctx, true);
  if (a instanceof Response) return a;
  try {
    const corps = await lireCorps(ctx.request);
    const connus = new Set([...entite.champs.map((c) => c.col), ...(entite.table === 'contact' ? ['types'] : [])]);
    const inconnu = Object.keys(corps).find((k) => !connus.has(k));
    if (inconnu) throw new Refus(422, `Champ inconnu : ${inconnu}.`, { champ: inconnu });

    const id = nouvelId();
    const cols: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const c of entite.champs) {
      if (!(c.col in corps)) {
        if (c.requis) throw new Refus(422, `${c.col} : valeur requise.`, { champ: c.col });
        continue;
      }
      cols.push(c.col);
      vals.push(await valider(c, corps[c.col], a, id));
    }
    const types = entite.table === 'contact' ? await lireTypes(a, corps) : undefined;
    const maintenantIso = maintenant();
    const colsFixes = ['id', 'tenant_id', 'cree_le', ...(entite.majLe ? ['maj_le'] : [])];
    const valsFixes = [id, a.tenant.id, maintenantIso, ...(entite.majLe ? [maintenantIso] : [])];
    const toutes = [...colsFixes, ...cols];
    const requetes = [
      a.db
        .prepare(`INSERT INTO ${entite.table} (${toutes.join(', ')}) VALUES (${toutes.map(() => '?').join(', ')})`)
        .bind(...valsFixes, ...vals),
      ...(types ?? []).map((ty) =>
        a.db.prepare('INSERT INTO contact_type (tenant_id, contact_id, type) VALUES (?, ?, ?)').bind(a.tenant.id, id, ty),
      ),
    ];
    if (entite.table === 'echange') {
      // Le contact porte son dernier échange : un échange plus ancien que celui déjà noté ne le remplace pas,
      // un échange du même jour le remplace. Même transaction que l'insertion.
      const dateEchange = vals[cols.indexOf('date')];
      const typeEchange = vals[cols.indexOf('type')];
      requetes.push(
        a.db
          .prepare(
            `UPDATE contact SET dernier_echange = ?, type_echange = ?, maj_le = ?
              WHERE id = ? AND tenant_id = ? AND (dernier_echange IS NULL OR dernier_echange <= ?)`,
          )
          .bind(dateEchange, typeEchange, maintenantIso, vals[cols.indexOf('contact_id')], a.tenant.id, dateEchange),
      );
    }
    await a.db.batch(requetes);
    const version = await incrementerVersion(a.db, a.tenant.id);
    return json({ item: await lire(a, entite, id), version }, 201);
  } catch (e) {
    return enRefus(e);
  }
}

/** PATCH : n'écrit que les champs reçus. Deux associés sur deux champs d'une même fiche ne s'écrasent pas. */
export async function modifier(ctx: APIContext, entite: Entite): Promise<Response> {
  const a = garde(ctx, true);
  if (a instanceof Response) return a;
  const id = ctx.params.id ?? '';
  try {
    // Identifiant du chemin : inconnu ou d'un autre locataire → 404, rien n'est écrit.
    if (id.length > 64 || !(await appartient(a.db, a.tenant.id, entite.table, id))) throw new Refus(404, 'Introuvable.');
    const corps = await lireCorps(ctx.request);
    // Un contact rattaché à un viewer a ses avoirs calculés (somme de ses enveloppes) : ils ne s'écrivent plus.
    // Les valeurs saisies avant le rattachement restent en base, intactes.
    if (entite.table === 'contact' && ('avoirs_cents' in corps || 'avoirs_le' in corps)) {
      const lie = await a.db
        .prepare('SELECT 1 AS ok FROM contact WHERE id = ? AND tenant_id = ? AND viewer_id IS NOT NULL')
        .bind(id, a.tenant.id)
        .first();
      if (lie) throw new Refus(422, 'Les avoirs de ce contact sont calculés depuis son portail : ils ne se saisissent plus.', { champ: 'avoirs_cents' });
    }
    const modifiables = new Map(entite.champs.filter((c) => !c.creation).map((c) => [c.col, c]));
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(corps)) {
      if (k === 'types' && entite.table === 'contact') continue;
      const c = modifiables.get(k);
      if (!c) throw new Refus(422, `Champ inconnu ou non modifiable : ${k}.`, { champ: k });
      sets.push(`${c.col} = ?`);
      vals.push(await valider(c, v, a, id));
    }
    const types = entite.table === 'contact' ? await lireTypes(a, corps) : undefined;
    // Changer le statut d'un sujet sans dire la date de clôture : le serveur la déduit, pour que le saut, le retour
    // arrière et la réouverture donnent le même résultat quel que soit le client. Statut terminal : la date de clôture
    // déjà posée est gardée (clos → clos), sinon celle du jour ; statut non terminal : plus de date.
    if (entite.table === 'sujet' && 'statut' in corps && !('fait_le' in corps)) {
      const actuel = await a.db
        .prepare('SELECT statut, fait_le FROM sujet WHERE id = ? AND tenant_id = ?')
        .bind(id, a.tenant.id)
        .first<{ statut: string; fait_le: string | null }>();
      const terminaux = (await terminauxDe(a.db, a.tenant.id)).statut_sujet ?? [];
      const clos = terminaux.includes(String(corps.statut));
      const etaitClos = actuel !== null && terminaux.includes(actuel.statut);
      sets.push('fait_le = ?');
      vals.push(clos ? (etaitClos && actuel?.fait_le ? actuel.fait_le : maintenant().slice(0, 10)) : null);
    }
    if (sets.length === 0 && types === undefined) throw new Refus(422, 'Aucun champ à modifier.');
    if (entite.majLe) {
      sets.push('maj_le = ?');
      vals.push(maintenant());
    }
    const requetes = [];
    if (sets.length) {
      requetes.push(
        a.db.prepare(`UPDATE ${entite.table} SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals, id, a.tenant.id),
      );
    }
    if (types !== undefined) {
      requetes.push(a.db.prepare('DELETE FROM contact_type WHERE contact_id = ? AND tenant_id = ?').bind(id, a.tenant.id));
      for (const ty of types) {
        requetes.push(a.db.prepare('INSERT INTO contact_type (tenant_id, contact_id, type) VALUES (?, ?, ?)').bind(a.tenant.id, id, ty));
      }
    }
    await a.db.batch(requetes);
    const version = await incrementerVersion(a.db, a.tenant.id);
    return json({ item: await lire(a, entite, id), version });
  } catch (e) {
    return enRefus(e);
  }
}

export async function supprimer(ctx: APIContext, entite: Entite): Promise<Response> {
  const a = garde(ctx, true);
  if (a instanceof Response) return a;
  const id = ctx.params.id ?? '';
  try {
    if (id.length > 64 || !(await appartient(a.db, a.tenant.id, entite.table, id))) throw new Refus(404, 'Introuvable.');
    const T = a.tenant.id;
    const requetes =
      entite.table === 'contact'
        ? [
            a.db.prepare('DELETE FROM sujet WHERE contact_id = ? AND tenant_id = ?').bind(id, T),
            a.db.prepare('DELETE FROM echange WHERE contact_id = ? AND tenant_id = ?').bind(id, T),
            a.db.prepare('DELETE FROM contact_type WHERE contact_id = ? AND tenant_id = ?').bind(id, T),
            a.db.prepare('UPDATE contact SET apporteur_id = NULL, maj_le = ? WHERE apporteur_id = ? AND tenant_id = ?').bind(maintenant(), id, T),
            a.db.prepare('DELETE FROM contact WHERE id = ? AND tenant_id = ?').bind(id, T),
          ]
        : [a.db.prepare(`DELETE FROM ${entite.table} WHERE id = ? AND tenant_id = ?`).bind(id, T)];
    await a.db.batch(requetes);
    const version = await incrementerVersion(a.db, T);
    return json({ supprime: id, version });
  } catch (e) {
    return enRefus(e);
  }
}
