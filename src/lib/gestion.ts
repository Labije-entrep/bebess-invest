// Espace gestionnaire : accès, lecture des saisies, validation et écriture.
// Requêtes préparées uniquement. Montants en centimes, pourcentages en centièmes de point.
// Toute écriture sur un viewer passe par viewerDuTenant (ou une clause viewer_id) : le tenant
// du gestionnaire connecté est toujours vérifié.

import { accueilDuRole } from './auth';
import { AccesRefuse, appartient, exiger } from './cloisonnement';
import { creerMailer, envDe } from './mail';
import {
  enveloppesDuViewer,
  lignesDesEnveloppes,
  type Base,
  type Cible,
  type Ligne,
  type Point,
  type Requete,
  type Tenant,
  type Utilisateur,
} from './db';

export type Erreurs = Record<string, string>;

export interface Contexte {
  db: Base;
  tenant: Tenant;
  utilisateur: Utilisateur;
}

/** La base D1 : le binding "DB" est exigé, sans recherche de repli. */
export function baseDe(locals: any): Base {
  const base = locals?.runtime?.env?.DB;
  if (!base || typeof base.prepare !== 'function') {
    throw new Error('Binding D1 "DB" absent : déclarez-le dans wrangler.toml (d1_databases, binding = "DB").');
  }
  return base as Base;
}

/** Réservé au gestionnaire du tenant. Renvoie une réponse (redirection, 403) ou le contexte. */
export function contexte(a: {
  locals: any;
  request: Request;
  redirect: (chemin: string) => Response;
}): Contexte | Response {
  const utilisateur = a.locals.utilisateur as Utilisateur | null;
  const tenant = a.locals.tenant as Tenant | null;
  if (!utilisateur || !tenant) return a.redirect('/connexion');
  if (utilisateur.role !== 'gestionnaire') return a.redirect(accueilDuRole(utilisateur.role));
  if (utilisateur.tenant_id !== tenant.id) return new Response('Interdit', { status: 403 });
  if (a.request.method === 'POST') {
    const origine = a.request.headers.get('origin');
    if (origine && new URL(origine).host !== new URL(a.request.url).host) {
      return new Response('Interdit', { status: 403 });
    }
  }
  return { db: baseDe(a.locals), tenant, utilisateur };
}

// ---------------------------------------------------------------- lecture et conversion

export const nouvelId = (): string => crypto.randomUUID();
export const maintenant = (): string => new Date().toISOString();

export function texte(v: FormDataEntryValue | null | undefined, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function entier(v: FormDataEntryValue | null | undefined, min: number, max: number): number {
  const n = Number.parseInt(texte(v, 12), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/** "12 345,67" -> 1234567. Virgule décimale seulement, deux décimales au plus. */
function decimal(s: string): number | null {
  const t = s.replace(/[\s  €%]/g, '');
  const m = /^(-?)(\d{1,12})(?:,(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const v = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] && v ? -v : v;
}
export const lireEuros = decimal; // euros -> centimes
export const lireBp = decimal; // pourcentage -> centièmes de point

export function formEuros(cents: number | null | undefined): string {
  if (cents == null) return '';
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}
export const formBp = formEuros;

/** AAAA-MM-JJ ou JJ/MM/AAAA, renvoie l'ISO ou null. */
export function lireDate(s: string): string | null {
  const t = s.trim();
  let a: string, m: string, j: string;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (r) [, a, m, j] = r;
  else {
    r = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
    if (!r) return null;
    [, j, m, a] = r;
  }
  const na = +a, nm = +m, nj = +j;
  const bissextile = na % 4 === 0 && (na % 100 !== 0 || na % 400 === 0);
  const jours = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (na < 1900 || na > 2200 || nm < 1 || nm > 12 || nj < 1 || nj > jours[nm - 1]) return null;
  return `${a}-${m}-${j}`;
}

/** CSV à point-virgule, guillemets doubles admis, BOM ignoré. Les lignes vides sont sautées. */
export function lireCsv(source: string): string[][] {
  const t = source.replace(/^﻿/, '');
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let guillemets = false;
  const fin = () => {
    ligne.push(champ);
    champ = '';
    if (ligne.some((x) => x.trim() !== '')) lignes.push(ligne);
    ligne = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (guillemets) {
      if (c === '"') {
        if (t[i + 1] === '"') { champ += '"'; i++; } else guillemets = false;
      } else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === ';') { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fin();
    } else champ += c;
  }
  fin();
  return lignes;
}

// ---------------------------------------------------------------- tableau de bord

export interface ViewerResume {
  id: string;
  nom: string;
  email: string;
  actif: number;
  encours: number;
  arrete: string | null;
}

export async function viewersResumes(db: Base, tenantId: string): Promise<ViewerResume[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.nom, u.email, u.actif,
              COALESCE((SELECT SUM(e.valorisation_cents) FROM enveloppe e WHERE e.viewer_id = u.id), 0) AS encours,
              (SELECT MAX(e.arrete_le) FROM enveloppe e WHERE e.viewer_id = u.id) AS arrete
         FROM utilisateur u
        WHERE u.tenant_id = ? AND u.role = 'viewer'
        ORDER BY u.nom`,
    )
    .bind(tenantId)
    .all<ViewerResume>();
  return results;
}

/** Date seuil ISO : un arrêté strictement antérieur est périmé (plus de 45 jours). */
export function seuilArrete(joursMax = 45): string {
  return new Date(Date.now() - joursMax * 86400000).toISOString().slice(0, 10);
}

export interface ImportCsv {
  nom_fichier: string;
  lignes: number;
  cree_le: string;
}

export function dernierImport(db: Base, tenantId: string): Promise<ImportCsv | null> {
  return db
    .prepare(
      `SELECT nom_fichier, lignes, cree_le FROM import_csv
        WHERE tenant_id = ? ORDER BY cree_le DESC LIMIT 1`,
    )
    .bind(tenantId)
    .first<ImportCsv>();
}

// ---------------------------------------------------------------- viewers

const COLONNES_VIEWER = 'id, tenant_id, email, nom, role, actif, cree_le';

export async function viewerDuTenant(db: Base, tenantId: string, id: string): Promise<Utilisateur | null> {
  if (!(await appartient(db, tenantId, 'viewer', id))) return null;
  return db
    .prepare(`SELECT ${COLONNES_VIEWER} FROM utilisateur WHERE id = ? AND tenant_id = ? AND role = 'viewer'`)
    .bind(id, tenantId)
    .first<Utilisateur>();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Crée le viewer. Renvoie ses erreurs, ou son identifiant. */
export async function creerViewer(
  db: Base,
  tenantId: string,
  f: FormData,
): Promise<{ erreurs: Erreurs } | { id: string; email: string }> {
  const erreurs: Erreurs = {};
  const nom = texte(f.get('nom'), 120);
  const email = texte(f.get('email'), 254).toLowerCase();
  if (!nom) erreurs.nom = 'Le nom est requis.';
  if (!EMAIL.test(email)) erreurs.email = 'Adresse e-mail invalide.';
  else {
    const existant = await db.prepare('SELECT id FROM utilisateur WHERE email = ?').bind(email).first();
    if (existant) erreurs.email = 'Cette adresse est déjà utilisée.';
  }
  if (Object.keys(erreurs).length) return { erreurs };
  const id = nouvelId();
  await db
    .prepare(
      `INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le)
       VALUES (?, ?, ?, ?, 'viewer', 1, ?)`,
    )
    .bind(id, tenantId, email, nom, maintenant())
    .run();
  return { id, email };
}

/** Envoie le lien de première connexion par le pilote de mail.ts. Renvoie false en cas d'échec. */
export async function envoyerLien(locals: unknown, email: string, nom: string, lien: string): Promise<boolean> {
  try {
    await creerMailer(envDe(locals)).envoyer(
      email,
      'Votre accès à votre espace client',
      `Bonjour ${nom},\n\nVoici votre lien de première connexion, valable 15 minutes et utilisable une seule fois :\n\n${lien}\n\nAucun mot de passe n'est nécessaire.`,
    );
    return true;
  } catch (e) {
    console.error('[gestionnaire] envoi du lien impossible :', e instanceof Error ? e.message : 'erreur');
    return false;
  }
}

// ---------------------------------------------------------------- onglets d'un viewer

/** apercu : la performance du mois est à montrer et à confirmer avant toute écriture. */
type Retour = { onglet: string; erreurs: Erreurs; apercu?: Apercu };

export async function traiter(
  db: Base,
  tenantId: string,
  viewerId: string,
  action: string,
  f: FormData,
): Promise<Retour> {
  // Contrôle de cloisonnement, avant toute écriture : le viewer et chaque identifiant reçu
  // doivent appartenir au tenant du gestionnaire connecté.
  try {
    await exiger(db, tenantId, 'viewer', viewerId);
    const type = { enveloppes: 'enveloppe', lignes: 'ligne', suppr_point: 'point', suppr_mouvement: 'mouvement' }[action] as
      'enveloppe' | 'ligne' | 'point' | 'mouvement' | undefined;
    if (type) {
      for (const [cle, valeur] of f) {
        if ((cle === 'id' || /^r\d+_id$/.test(cle)) && typeof valeur === 'string' && valeur !== '') {
          await exiger(db, tenantId, type, valeur.slice(0, 64));
        }
      }
    }
  } catch (e) {
    if (e instanceof AccesRefuse) return { onglet: 'fiche', erreurs: { general: 'Accès refusé.' } };
    throw e;
  }
  switch (action) {
    case 'fiche':
      return { onglet: 'fiche', erreurs: await enregistrerFiche(db, viewerId, f) };
    case 'enveloppes':
      return { onglet: 'enveloppes', erreurs: await enregistrerEnveloppes(db, viewerId, f) };
    case 'lignes':
      return { onglet: 'lignes', erreurs: await enregistrerLignes(db, viewerId, f) };
    case 'cibles':
      return { onglet: 'cibles', erreurs: await enregistrerCibles(db, viewerId, f) };
    case 'point': {
      const r = await enregistrerPoint(db, viewerId, f);
      return { onglet: 'historique', ...r };
    }
    case 'arrete': {
      const r = await enregistrerArrete(db, viewerId, f);
      return { onglet: 'arrete', ...r };
    }
    case 'points_import':
      return { onglet: 'historique', erreurs: await importerPoints(db, viewerId, f) };
    case 'suppr_point':
      await db
        .prepare('DELETE FROM point WHERE id = ? AND viewer_id = ?')
        .bind(texte(f.get('id'), 64), viewerId)
        .run();
      return { onglet: 'historique', erreurs: {} };
    case 'mouvement':
      return { onglet: 'mouvements', erreurs: await enregistrerMouvement(db, viewerId, f) };
    case 'suppr_mouvement':
      await db
        .prepare('DELETE FROM mouvement WHERE id = ? AND viewer_id = ?')
        .bind(texte(f.get('id'), 64), viewerId)
        .run();
      return { onglet: 'mouvements', erreurs: {} };
    default:
      return { onglet: 'fiche', erreurs: { general: 'Action inconnue.' } };
  }
}

export const STATUTS: [string, string][] = [
  ['en_preparation', 'En préparation'],
  ['transmis', 'Transmis'],
  ['chez_etablissement', 'Chez l\'établissement'],
  ['execute', 'Exécuté'],
  ['archive', 'Archivé'],
];
export const CLASSES: [string, string][] = [
  ['actions', 'Actions'],
  ['obligations', 'Obligations'],
  ['immobilier', 'Immobilier'],
  ['private_equity', 'Private equity'],
  ['liquidites', 'Liquidités'],
];
const MSG_CLASSE = 'Choisissez une classe dans la liste.';
const estClasse = (c: string) => CLASSES.some(([k]) => k === c);
const norm = (s: string) => s.trim().toLowerCase();

const MSG_EUROS = 'Montant en euros, avec virgule (ex. 25000,00).';
const MSG_PCT = 'Pourcentage avec virgule (ex. 6,40).';
const MSG_DATE = 'Date au format AAAA-MM-JJ.';

async function enregistrerFiche(db: Base, viewerId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const noteS = texte(f.get('profil_note'), 3);
  let note: number | null = null;
  if (noteS) {
    if (!/^\d{1,2}$/.test(noteS) || +noteS < 1 || +noteS > 10) e.profil_note = 'Note entière de 1 à 10.';
    else note = +noteS;
  }
  const montant = (cle: string): number | null => {
    const s = texte(f.get(cle), 20);
    if (!s) return null;
    const v = lireEuros(s);
    if (v === null || v < 0) e[cle] = MSG_EUROS;
    return v;
  };
  const date = (cle: string): string | null => {
    const s = texte(f.get(cle), 10);
    if (!s) return null;
    const v = lireDate(s);
    if (!v) e[cle] = MSG_DATE;
    return v;
  };
  const perte = montant('perte_max');
  const liquidite = montant('liquidite');
  const signee = date('allocation_signee_le');
  const prochain = date('prochain_point');
  if (Object.keys(e).length) return e;
  await db
    .prepare(
      `INSERT INTO fiche (utilisateur_id, mandat_ref, profil_risque, profil_note, horizon,
                          perte_max_cents, liquidite_cents, regle_reequilibrage,
                          allocation_signee_le, allocation_motif, prochain_point)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(utilisateur_id) DO UPDATE SET
         mandat_ref = excluded.mandat_ref, profil_risque = excluded.profil_risque,
         profil_note = excluded.profil_note, horizon = excluded.horizon,
         perte_max_cents = excluded.perte_max_cents, liquidite_cents = excluded.liquidite_cents,
         regle_reequilibrage = excluded.regle_reequilibrage,
         allocation_signee_le = excluded.allocation_signee_le,
         allocation_motif = excluded.allocation_motif, prochain_point = excluded.prochain_point`,
    )
    .bind(
      viewerId,
      texte(f.get('mandat_ref'), 80) || null,
      texte(f.get('profil_risque'), 80) || null,
      note,
      texte(f.get('horizon'), 80) || null,
      perte,
      liquidite,
      texte(f.get('regle_reequilibrage'), 1000) || null,
      signee,
      texte(f.get('allocation_motif'), 1000) || null,
      prochain,
    )
    .run();
  return {};
}

async function enregistrerEnveloppes(db: Base, viewerId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const n = entier(f.get('n'), 0, 200);
  const suppr: string[] = [];
  const maj: { id: string; v: unknown[] }[] = [];
  const ajout: unknown[][] = [];
  for (let i = 0; i < n; i++) {
    const g = (c: string, max = 120) => texte(f.get(`r${i}_${c}`), max);
    const id = g('id', 64);
    if (id && g('suppr', 1) === '1') { suppr.push(id); continue; }
    const libelle = g('libelle'), etab = g('etab'), ouverteS = g('ouverte', 10);
    const valoS = g('valo', 20), perfS = g('perf', 20), arreteS = g('arrete', 10);
    if (!id && !libelle && !etab && !valoS && !ouverteS && !perfS && !arreteS) continue;
    if (!libelle) e[`r${i}_libelle`] = 'Libellé requis.';
    const valo = lireEuros(valoS);
    if (valo === null) e[`r${i}_valo`] = MSG_EUROS;
    const perf = perfS ? lireBp(perfS) : null;
    if (perfS && perf === null) e[`r${i}_perf`] = MSG_PCT;
    const ouverte = ouverteS ? lireDate(ouverteS) : null;
    if (ouverteS && !ouverte) e[`r${i}_ouverte`] = MSG_DATE;
    const arrete = lireDate(arreteS);
    if (!arrete) e[`r${i}_arrete`] = MSG_DATE;
    const v = [libelle, etab || null, ouverte, valo, perf, arrete, i];
    if (id) maj.push({ id, v }); else ajout.push(v);
  }
  if (Object.keys(e).length) return e;
  for (const id of suppr) {
    await db
      .prepare('DELETE FROM ligne WHERE enveloppe_id IN (SELECT id FROM enveloppe WHERE id = ? AND viewer_id = ?)')
      .bind(id, viewerId)
      .run();
    await db.prepare('DELETE FROM enveloppe WHERE id = ? AND viewer_id = ?').bind(id, viewerId).run();
  }
  for (const { id, v } of maj) {
    await db
      .prepare(
        `UPDATE enveloppe SET libelle = ?, etablissement = ?, ouverte_en = ?, valorisation_cents = ?,
                perf_bp = ?, arrete_le = ?, rang = ?
          WHERE id = ? AND viewer_id = ?`,
      )
      .bind(...v, id, viewerId)
      .run();
  }
  for (const v of ajout) {
    await db
      .prepare(
        `INSERT INTO enveloppe (id, viewer_id, libelle, etablissement, ouverte_en, valorisation_cents,
                                perf_bp, arrete_le, rang)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(nouvelId(), viewerId, ...v)
      .run();
  }
  return {};
}

/** Une enveloppe qui a des lignes vaut la somme de ses lignes, arrêtée à la plus récente. */
async function recalculerEnveloppe(db: Base, enveloppeId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE enveloppe SET
         valorisation_cents = (SELECT COALESCE(SUM(valorisation_cents), 0) FROM ligne WHERE enveloppe_id = ?),
         arrete_le = (SELECT MAX(arrete_le) FROM ligne WHERE enveloppe_id = ?)
        WHERE id = ? AND EXISTS (SELECT 1 FROM ligne WHERE enveloppe_id = ?)`,
    )
    .bind(enveloppeId, enveloppeId, enveloppeId, enveloppeId)
    .run();
}

async function enregistrerLignes(db: Base, viewerId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const envs = new Set((await enveloppesDuViewer(db, viewerId)).map((x) => x.id));
  const n = entier(f.get('n'), 0, 600);
  const suppr: { id: string; env: string }[] = [];
  const maj: { id: string; env: string; v: unknown[] }[] = [];
  const ajout: { env: string; v: unknown[] }[] = [];
  for (let i = 0; i < n; i++) {
    const g = (c: string, max = 120) => texte(f.get(`r${i}_${c}`), max);
    const env = g('env', 64), id = g('id', 64);
    if (!envs.has(env)) return { general: 'Enveloppe inconnue pour ce viewer.' };
    if (id && g('suppr', 1) === '1') { suppr.push({ id, env }); continue; }
    const libelle = g('libelle'), classe = g('classe', 80), valoS = g('valo', 20);
    const pvS = g('pv', 20), fraisS = g('frais', 20), arreteS = g('arrete', 10);
    if (!id && !libelle && !classe && !valoS && !pvS && !fraisS && !arreteS) continue;
    if (!libelle) e[`r${i}_libelle`] = 'Libellé requis.';
    if (!estClasse(classe)) e[`r${i}_classe`] = MSG_CLASSE;
    const valo = lireEuros(valoS);
    if (valo === null) e[`r${i}_valo`] = MSG_EUROS;
    const pv = pvS ? lireEuros(pvS) : null;
    if (pvS && pv === null) e[`r${i}_pv`] = MSG_EUROS;
    const frais = fraisS ? lireBp(fraisS) : null;
    if (fraisS && frais === null) e[`r${i}_frais`] = MSG_PCT;
    const arrete = lireDate(arreteS);
    if (!arrete) e[`r${i}_arrete`] = MSG_DATE;
    const v = [libelle, classe, valo, pv, frais, arrete, i];
    if (id) maj.push({ id, env, v }); else ajout.push({ env, v });
  }
  if (Object.keys(e).length) return e;
  for (const s of suppr) {
    await db.prepare('DELETE FROM ligne WHERE id = ? AND enveloppe_id = ?').bind(s.id, s.env).run();
  }
  for (const m of maj) {
    await db
      .prepare(
        `UPDATE ligne SET libelle = ?, classe = ?, valorisation_cents = ?, pv_cents = ?, frais_bp = ?,
                arrete_le = ?, rang = ?
          WHERE id = ? AND enveloppe_id = ?`,
      )
      .bind(...m.v, m.id, m.env)
      .run();
  }
  for (const a of ajout) {
    await db
      .prepare(
        `INSERT INTO ligne (id, enveloppe_id, libelle, classe, valorisation_cents, pv_cents, frais_bp,
                            arrete_le, rang)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(nouvelId(), a.env, ...a.v)
      .run();
  }
  for (const env of envs) await recalculerEnveloppe(db, env);
  return {};
}

async function enregistrerCibles(db: Base, viewerId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const n = entier(f.get('n'), 0, 60);
  const lignes: [string, number][] = [];
  const vues = new Set<string>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const classe = texte(f.get(`r${i}_classe`), 80);
    const pctS = texte(f.get(`r${i}_pct`), 12);
    if (!classe && !pctS) continue;
    if (!estClasse(classe)) e[`r${i}_classe`] = MSG_CLASSE;
    else if (vues.has(classe)) e[`r${i}_classe`] = 'Classe en double.';
    vues.add(classe);
    const bp = lireBp(pctS);
    if (bp === null || bp <= 0 || bp > 10000) e[`r${i}_pct`] = 'Pourcentage de 0,01 à 100,00.';
    else total += bp;
    lignes.push([classe, bp ?? 0]);
  }
  if (!Object.keys(e).length && total !== 10000) {
    e.total = `Le total doit faire 100,00 % ; il fait ${formBp(total)} %.`;
  }
  if (Object.keys(e).length) return e;
  await db.prepare('DELETE FROM cible WHERE viewer_id = ?').bind(viewerId).run();
  for (let i = 0; i < lignes.length; i++) {
    await db
      .prepare('INSERT INTO cible (id, viewer_id, classe, cible_bp, rang) VALUES (?, ?, ?, ?, ?)')
      .bind(nouvelId(), viewerId, lignes[i][0], lignes[i][1], i)
      .run();
  }
  return {};
}

export interface EcartClasse {
  classe: string;
  cible_bp: number;
  actuel_bp: number;
  ecart_bp: number;
}

/** Part réelle de chaque classe (somme des lignes) face à la cible. */
export function ecartAllocation(lignes: Ligne[], cibles: Cible[]): EcartClasse[] {
  const total = lignes.reduce((s, l) => s + l.valorisation_cents, 0);
  const parClasse = new Map<string, number>();
  for (const l of lignes) parClasse.set(l.classe, (parClasse.get(l.classe) ?? 0) + l.valorisation_cents);
  const classes = cibles.map((c) => c.classe);
  for (const k of parClasse.keys()) if (!classes.includes(k)) classes.push(k);
  return classes.map((classe) => {
    const cible_bp = cibles.find((c) => c.classe === classe)?.cible_bp ?? 0;
    const actuel_bp = total > 0 ? Math.round(((parClasse.get(classe) ?? 0) / total) * 10000) : 0;
    return { classe, cible_bp, actuel_bp, ecart_bp: actuel_bp - cible_bp };
  });
}

async function ecrirePoint(db: Base, viewerId: string, date: string, valeur: number, verse: number) {
  const ex = await db
    .prepare('SELECT id FROM point WHERE viewer_id = ? AND date = ?')
    .bind(viewerId, date)
    .first<{ id: string }>();
  if (ex) {
    await db
      .prepare('UPDATE point SET valeur_cents = ?, versements_cumules_cents = ? WHERE id = ? AND viewer_id = ?')
      .bind(valeur, verse, ex.id, viewerId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO point (id, viewer_id, date, valeur_cents, versements_cumules_cents)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(nouvelId(), viewerId, date, valeur, verse)
      .run();
  }
}

// ---------------------------------------------------------------- aperçu de la performance du mois

export interface PointRef {
  date: string;
  valeurCents: number;
  verseCents: number;
}
export interface Apercu {
  date: string;
  valeurCents: number;
  verseCents: number;
  precedent: PointRef | null;
  /** Performance du mois que le point implique, en centièmes de point ; null sans point antérieur. */
  perfBp: number | null;
  /** Au-delà de ±20 % : l'écran le signale, la confirmation reste possible. */
  forte: boolean;
  /** Un point existe déjà à cette date : il sera remplacé. */
  remplace: boolean;
}

const SEUIL_PERF_BP = 2000;

/** Le dernier point strictement antérieur à la date. */
export async function pointPrecedent(db: Base, viewerId: string, date: string): Promise<PointRef | null> {
  const r = await db
    .prepare(
      `SELECT date, valeur_cents, versements_cumules_cents FROM point
        WHERE viewer_id = ? AND date < ? ORDER BY date DESC LIMIT 1`,
    )
    .bind(viewerId, date)
    .first<{ date: string; valeur_cents: number; versements_cumules_cents: number }>();
  return r ? { date: r.date, valeurCents: r.valeur_cents, verseCents: r.versements_cumules_cents } : null;
}

/** Même formule que performanceEnchainee : (valeur − précédente − flux) / précédente, flux = variation des versements. */
export function perfDuMois(prec: PointRef | null, valeurCents: number, verseCents: number): number | null {
  if (!prec || prec.valeurCents <= 0) return null;
  const gain = valeurCents - prec.valeurCents - (verseCents - prec.verseCents);
  return Math.round((gain * 10000) / prec.valeurCents);
}

export async function apercuPoint(
  db: Base,
  viewerId: string,
  date: string,
  valeurCents: number,
  verseCents: number,
): Promise<Apercu> {
  const precedent = await pointPrecedent(db, viewerId, date);
  const perfBp = perfDuMois(precedent, valeurCents, verseCents);
  const existant = await db
    .prepare('SELECT 1 AS ok FROM point WHERE viewer_id = ? AND date = ?')
    .bind(viewerId, date)
    .first();
  return {
    date, valeurCents, verseCents, precedent, perfBp,
    forte: perfBp !== null && Math.abs(perfBp) > SEUIL_PERF_BP,
    remplace: existant !== null,
  };
}

/**
 * Un champ « versements » vide signifie « inchangé depuis le point précédent », et zéro
 * seulement s'il n'existe aucun point antérieur. Rien n'est écrit tant que la performance
 * du mois n'a pas été affichée et confirmée (confirmer = 1).
 */
async function enregistrerPoint(
  db: Base,
  viewerId: string,
  f: FormData,
): Promise<{ erreurs: Erreurs; apercu?: Apercu }> {
  const e: Erreurs = {};
  const date = lireDate(texte(f.get('date'), 10));
  if (!date) e.date = MSG_DATE;
  const valeur = lireEuros(texte(f.get('valeur'), 20));
  if (valeur === null) e.valeur = MSG_EUROS;
  const verseS = texte(f.get('verse'), 20);
  const verseSaisi = verseS ? lireEuros(verseS) : undefined;
  if (verseSaisi === null) e.verse = MSG_EUROS;
  if (Object.keys(e).length) return { erreurs: e };
  const verse = verseSaisi ?? (await pointPrecedent(db, viewerId, date!))?.verseCents ?? 0;
  if (texte(f.get('confirmer'), 1) !== '1') {
    return { erreurs: {}, apercu: await apercuPoint(db, viewerId, date!, valeur!, verse) };
  }
  await ecrirePoint(db, viewerId, date!, valeur!, verse);
  return { erreurs: {} };
}

/** Fichier : date;valeur_eur;versements_cumules_eur. Tout ou rien. */
// ---------------------------------------------------------------- nouvel arrêté

export function pointAu(db: Base, viewerId: string, date: string): Promise<Point | null> {
  return db
    .prepare(
      `SELECT id, viewer_id, date, valeur_cents, versements_cumules_cents
         FROM point WHERE viewer_id = ? AND date = ?`,
    )
    .bind(viewerId, date)
    .first<Point>();
}

/**
 * Un arrêté mensuel en un seul formulaire : valeurs des enveloppes et des lignes, et point du
 * mois. Les champs sont numérotés dans l'ordre de enveloppesDuViewer / lignesDesEnveloppes.
 * Une enveloppe qui a des lignes vaut la somme de ses lignes. Rien n'est écrit sans que la
 * performance du mois ait été montrée (perf_vue) puis confirmée ; l'écriture est une seule
 * transaction : arrete_le des enveloppes et des lignes, et le point à cette date.
 */
async function enregistrerArrete(
  db: Base,
  viewerId: string,
  f: FormData,
): Promise<{ erreurs: Erreurs; apercu?: Apercu }> {
  const e: Erreurs = {};
  const date = lireDate(texte(f.get('date'), 10));
  if (!date) return { erreurs: { date: MSG_DATE } };
  const envs = await enveloppesDuViewer(db, viewerId);
  const lignes = await lignesDesEnveloppes(db, envs.map((x) => x.id));
  const g = (nom: string, max = 20) => texte(f.get(nom), max);

  const requetes: Requete[] = [];
  const valoEnv = new Map<string, number>();
  lignes.forEach((l, j) => {
    if (g(`l${j}_id`, 64) !== l.id) { e.general = 'Les données ont changé : rechargez la page.'; return; }
    const valo = lireEuros(g(`l${j}_valo`));
    if (valo === null) e[`l${j}_valo`] = MSG_EUROS;
    const pvS = g(`l${j}_pv`);
    const pv = pvS ? lireEuros(pvS) : null;
    if (pvS && pv === null) e[`l${j}_pv`] = MSG_EUROS;
    const fraisS = g(`l${j}_frais`);
    const frais = fraisS ? lireBp(fraisS) : null;
    if (fraisS && frais === null) e[`l${j}_frais`] = MSG_PCT;
    if (valo === null) return;
    valoEnv.set(l.enveloppe_id, (valoEnv.get(l.enveloppe_id) ?? 0) + valo);
    requetes.push(
      db
        .prepare('UPDATE ligne SET valorisation_cents = ?, pv_cents = ?, frais_bp = ?, arrete_le = ? WHERE id = ? AND enveloppe_id = ?')
        .bind(valo, pv, frais, date, l.id, l.enveloppe_id),
    );
  });
  let somme = 0;
  envs.forEach((env, i) => {
    if (g(`e${i}_id`, 64) !== env.id) { e.general = 'Les données ont changé : rechargez la page.'; return; }
    const perfS = g(`e${i}_perf`);
    const perf = perfS ? lireBp(perfS) : null;
    if (perfS && perf === null) e[`e${i}_perf`] = MSG_PCT;
    let total: number;
    if (lignes.some((l) => l.enveloppe_id === env.id)) total = valoEnv.get(env.id) ?? 0;
    else {
      const v = lireEuros(g(`e${i}_valo`));
      if (v === null) { e[`e${i}_valo`] = MSG_EUROS; return; }
      total = v;
    }
    somme += total;
    requetes.push(
      db
        .prepare('UPDATE enveloppe SET valorisation_cents = ?, perf_bp = ?, arrete_le = ? WHERE id = ? AND viewer_id = ?')
        .bind(total, perf, date, env.id, viewerId),
    );
  });

  const existant = await pointAu(db, viewerId, date);
  const valeurS = g('valeur');
  // Valeur du point laissée telle que proposée, sans point existant : elle suit la somme recalculée.
  const valeur = !existant && (valeurS === '' || valeurS === g('valeur_init')) ? somme : lireEuros(valeurS);
  if (valeur === null) e.valeur = MSG_EUROS;
  const verseS = g('verse');
  const verseSaisi = verseS ? lireEuros(verseS) : undefined;
  if (verseSaisi === null) e.verse = MSG_EUROS;
  if (Object.keys(e).length) return { erreurs: e };

  const verse = verseSaisi ?? (await pointPrecedent(db, viewerId, date))?.verseCents ?? 0;
  const apercu = await apercuPoint(db, viewerId, date, valeur!, verse!);
  if (g('confirmer', 1) !== '1' || g('perf_vue', 12) !== String(apercu.perfBp ?? 'nc')) {
    return { erreurs: {}, apercu };
  }
  requetes.push(
    db
      .prepare(
        `INSERT INTO point (id, viewer_id, date, valeur_cents, versements_cumules_cents)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(viewer_id, date) DO UPDATE SET
           valeur_cents = excluded.valeur_cents, versements_cumules_cents = excluded.versements_cumules_cents`,
      )
      .bind(nouvelId(), viewerId, date, valeur, verse),
  );
  await db.batch(requetes);
  return { erreurs: {} };
}

async function importerPoints(db: Base, viewerId: string, f: FormData): Promise<Erreurs> {
  const fichier = f.get('fichier');
  if (!(fichier instanceof File) || fichier.size === 0) return { fichier: 'Choisissez un fichier CSV.' };
  if (fichier.size > 200000) return { fichier: 'Fichier trop volumineux (200 Ko au plus).' };
  let rows = lireCsv(await fichier.text());
  if (rows.length && /date/i.test(rows[0][0])) rows = rows.slice(1);
  if (rows.length === 0) return { fichier: 'Aucune ligne à importer.' };
  if (rows.length > 400) return { fichier: '400 lignes au plus par import.' };
  const problemes: string[] = [];
  const points: [string, number, number | undefined][] = [];
  rows.forEach((r, i) => {
    const date = lireDate(r[0] ?? '');
    const valeur = lireEuros(r[1] ?? '');
    // Colonne vide : versements inchangés depuis le point précédent.
    const verse = (r[2] ?? '').trim() ? lireEuros(r[2]) : undefined;
    if (!date || valeur === null || verse === null) problemes.push(`ligne ${i + 1}`);
    else points.push([date, valeur, verse]);
  });
  if (problemes.length) {
    return { fichier: `Lignes invalides : ${problemes.slice(0, 8).join(', ')}. Colonnes : date;valeur_eur;versements_cumules_eur. Rien n'a été enregistré.` };
  }
  points.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [d, v, c] of points) {
    await ecrirePoint(db, viewerId, d, v, c ?? (await pointPrecedent(db, viewerId, d))?.verseCents ?? 0);
  }
  return {};
}

async function enregistrerMouvement(db: Base, viewerId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const date = lireDate(texte(f.get('date'), 10));
  if (!date) e.date = MSG_DATE;
  const libelle = texte(f.get('libelle'), 160);
  if (!libelle) e.libelle = 'Libellé requis.';
  const montantS = texte(f.get('montant'), 20);
  const montant = montantS ? lireEuros(montantS) : null;
  if (montantS && montant === null) e.montant = MSG_EUROS;
  const statut = texte(f.get('statut'), 30);
  if (!STATUTS.some(([k]) => k === statut)) e.statut = 'Choisissez un statut dans la liste.';
  const termine = statut === 'execute' || statut === 'archive';
  const etape = termine ? 0 : entier(f.get('etape'), 1, 3);
  const enCours = termine ? 0 : texte(f.get('en_cours'), 1) === '1' ? 1 : 0;
  if (Object.keys(e).length) return e;
  await db
    .prepare(
      `INSERT INTO mouvement (id, viewer_id, date, libelle, enveloppe, montant_cents, statut, en_cours, etape, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      nouvelId(), viewerId, date, libelle,
      texte(f.get('enveloppe'), 120) || null,
      montant, statut, enCours, etape,
      texte(f.get('detail'), 1000) || null,
    )
    .run();
  return {};
}

// ---------------------------------------------------------------- import CSV global

export const COLONNES_IMPORT = [
  'viewer_email', 'enveloppe', 'ligne', 'classe', 'valorisation_eur', 'pv_eur', 'frais_pct', 'arrete_le',
];
const IMPORT_MAX_LIGNES = 250;

export interface LigneImport {
  n: number;
  action: 'création' | 'mise à jour' | 'erreur';
  motif: string;
  email: string;
  enveloppe: string;
  ligne: string;
  classe: string;
  valorisation_cents: number | null;
  pv_cents: number | null;
  frais_bp: number | null;
  arrete_le: string | null;
  viewerId: string | null;
  enveloppeId: string | null;
  ligneId: string | null;
}

export async function analyserImport(
  db: Base,
  tenantId: string,
  source: string,
): Promise<{ fatal?: string; lignes: LigneImport[] }> {
  let rows = lireCsv(source);
  if (rows.length && rows[0][0].trim().toLowerCase() === 'viewer_email') {
    const ok = COLONNES_IMPORT.every((c, i) => (rows[0][i] ?? '').trim().toLowerCase() === c);
    if (!ok) return { fatal: `En-tête attendu : ${COLONNES_IMPORT.join(';')}`, lignes: [] };
    rows = rows.slice(1);
  }
  if (rows.length === 0) return { fatal: 'Le fichier ne contient aucune ligne.', lignes: [] };
  if (rows.length > IMPORT_MAX_LIGNES) {
    return { fatal: `${IMPORT_MAX_LIGNES} lignes au plus par fichier (${rows.length} reçues).`, lignes: [] };
  }

  const { results: viewers } = await db
    .prepare(`SELECT id, email FROM utilisateur WHERE tenant_id = ? AND role = 'viewer'`)
    .bind(tenantId)
    .all<{ id: string; email: string }>();
  const parEmail = new Map(viewers.map((v) => [v.email.toLowerCase(), v.id]));

  const cache = new Map<string, { envs: Map<string, string>; lignes: Map<string, string> }>();
  const etatViewer = async (viewerId: string) => {
    let c = cache.get(viewerId);
    if (!c) {
      const envs = await enveloppesDuViewer(db, viewerId);
      const lignes = await lignesDesEnveloppes(db, envs.map((x) => x.id));
      c = {
        envs: new Map(envs.map((x) => [norm(x.libelle), x.id])),
        lignes: new Map(lignes.map((l) => [`${l.enveloppe_id}|${norm(l.libelle)}`, l.id])),
      };
      cache.set(viewerId, c);
    }
    return c;
  };

  const vues = new Set<string>();
  const sortie: LigneImport[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((x) => x.trim());
    const l: LigneImport = {
      n: i + 1, action: 'erreur', motif: '',
      email: (r[0] ?? '').toLowerCase(), enveloppe: r[1] ?? '', ligne: r[2] ?? '', classe: r[3] ?? '',
      valorisation_cents: null, pv_cents: null, frais_bp: null, arrete_le: null,
      viewerId: null, enveloppeId: null, ligneId: null,
    };
    const motifs: string[] = [];
    if (r.length !== COLONNES_IMPORT.length) motifs.push(`${COLONNES_IMPORT.length} colonnes attendues, ${r.length} reçues`);
    l.viewerId = parEmail.get(l.email) ?? null;
    if (!l.viewerId) motifs.push('viewer inconnu dans ce tenant');
    if (!l.enveloppe) motifs.push('enveloppe vide');
    if (!l.ligne) motifs.push('ligne vide');
    l.classe = norm(l.classe);
    if (!estClasse(l.classe)) motifs.push(`classe inconnue (${CLASSES.map(([k]) => k).join(', ')})`);
    l.valorisation_cents = lireEuros(r[4] ?? '');
    if (l.valorisation_cents === null) motifs.push('valorisation invalide');
    if ((r[5] ?? '') !== '') {
      l.pv_cents = lireEuros(r[5]);
      if (l.pv_cents === null) motifs.push('plus-value invalide');
    }
    if ((r[6] ?? '') !== '') {
      l.frais_bp = lireBp(r[6]);
      if (l.frais_bp === null) motifs.push('frais invalides');
    }
    l.arrete_le = lireDate(r[7] ?? '');
    if (!l.arrete_le) motifs.push('date d\'arrêté invalide');
    if (!motifs.length && l.viewerId) {
      const cle = `${l.viewerId}|${norm(l.enveloppe)}|${norm(l.ligne)}`;
      if (vues.has(cle)) motifs.push('doublon dans le fichier');
      vues.add(cle);
      const etat = await etatViewer(l.viewerId);
      l.enveloppeId = etat.envs.get(norm(l.enveloppe)) ?? null;
      l.ligneId = l.enveloppeId ? (etat.lignes.get(`${l.enveloppeId}|${norm(l.ligne)}`) ?? null) : null;
    }
    if (motifs.length) l.motif = motifs.join(' ; ');
    else l.action = l.ligneId ? 'mise à jour' : 'création';
    sortie.push(l);
  }
  return { lignes: sortie };
}

/** Écrit un import déjà prévisualisé. Refuse tout le fichier s'il reste une erreur. */
export async function appliquerImport(
  db: Base,
  tenantId: string,
  utilisateurId: string,
  nomFichier: string,
  source: string,
): Promise<{ ecrites: number } | { erreur: string }> {
  const a = await analyserImport(db, tenantId, source);
  if (a.fatal) return { erreur: a.fatal };
  if (a.lignes.some((l) => l.action === 'erreur')) {
    return { erreur: 'Le fichier contient des erreurs : corrigez-le et déposez-le de nouveau.' };
  }
  const nouvelles = new Map<string, string>(); // viewer|enveloppe -> id créé pendant l'import
  const touchees = new Set<string>();
  for (const l of a.lignes) {
    let envId = l.enveloppeId ?? nouvelles.get(`${l.viewerId}|${norm(l.enveloppe)}`) ?? null;
    if (!envId) {
      envId = nouvelId();
      await db
        .prepare(
          `INSERT INTO enveloppe (id, viewer_id, libelle, etablissement, ouverte_en, valorisation_cents,
                                  perf_bp, arrete_le, rang)
           VALUES (?, ?, ?, NULL, NULL, 0, NULL, ?,
                   (SELECT COALESCE(MAX(rang), 0) + 1 FROM enveloppe WHERE viewer_id = ?))`,
        )
        .bind(envId, l.viewerId, l.enveloppe, l.arrete_le, l.viewerId)
        .run();
      nouvelles.set(`${l.viewerId}|${norm(l.enveloppe)}`, envId);
    }
    touchees.add(envId);
    if (l.ligneId) {
      await db
        .prepare(
          `UPDATE ligne SET classe = ?, valorisation_cents = ?, pv_cents = ?, frais_bp = ?, arrete_le = ?
            WHERE id = ? AND enveloppe_id = ?`,
        )
        .bind(l.classe, l.valorisation_cents, l.pv_cents, l.frais_bp, l.arrete_le, l.ligneId, envId)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO ligne (id, enveloppe_id, libelle, classe, valorisation_cents, pv_cents, frais_bp,
                              arrete_le, rang)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?,
                   (SELECT COALESCE(MAX(rang), 0) + 1 FROM ligne WHERE enveloppe_id = ?))`,
        )
        .bind(nouvelId(), envId, l.ligne, l.classe, l.valorisation_cents, l.pv_cents, l.frais_bp, l.arrete_le, envId)
        .run();
    }
  }
  for (const id of touchees) await recalculerEnveloppe(db, id);
  await db
    .prepare(
      `INSERT INTO import_csv (id, tenant_id, utilisateur_id, nom_fichier, lignes, cree_le)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(nouvelId(), tenantId, utilisateurId, nomFichier || 'import.csv', a.lignes.length, maintenant())
    .run();
  return { ecrites: a.lignes.length };
}
