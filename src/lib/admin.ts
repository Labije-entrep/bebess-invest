// Console de l'éditeur (lot 10) : /admin. Réservée au rôle éditeur, à qui il revient d'ouvrir un cabinet, de lui rattacher
// ses noms d'hôte, de suivre ses incidents, de l'exporter et, s'il le faut, de le suspendre.
//
// Contrairement au reste du portail, une page de la console parle de PLUSIEURS cabinets : le cabinet visé vient de
// l'adresse, jamais de l'hôte. Le rôle éditeur est donc contrôlé à chaque page et à chaque route (gardeAdmin), en plus du
// middleware, et chaque requête ci-dessous porte l'identifiant du cabinet visé. Requêtes préparées uniquement.
//
// Aucun texte n'est généré : les messages sont des gabarits fixes. Aucune suspension n'est jamais posée par le code seul.

import { demanderLien } from './auth';
import type { Base, Requete, Utilisateur } from './db';
import { creerMailer, envDe, type Env } from './mail';
import { requetesListesDefaut } from './listes-defaut';
import { noterIncident } from './incidents';
import { THEMES, THEME_DEFAUT } from './themes';

// ---------------------------------------------------------------- garde

export interface GardeAdmin {
  db: Base;
  env: Env;
  utilisateur: Utilisateur;
}

/**
 * Session d'éditeur exigée. Sans session : la connexion ; autre rôle : 403. Un POST doit porter un Origin identique à
 * l'hôte (ici, son absence est refusée aussi : un formulaire du navigateur l'envoie toujours).
 */
export function gardeAdmin(a: {
  locals: unknown;
  request: Request;
  url: URL;
  redirect: (chemin: string) => Response;
}): GardeAdmin | Response {
  const l = a.locals as { utilisateur: Utilisateur | null };
  if (!l.utilisateur) return a.redirect('/connexion');
  if (l.utilisateur.role !== 'editeur') return new Response('Accès refusé.', { status: 403 });
  if (a.request.method !== 'GET' && a.request.method !== 'HEAD') {
    const origine = a.request.headers.get('Origin');
    if (!origine || new URL(origine).host !== a.url.host) return new Response('Origine refusée.', { status: 403 });
  }
  const env = envDe(a.locals);
  return { db: env.DB, env, utilisateur: l.utilisateur };
}

export const introuvable = (): Response => new Response('Introuvable.', { status: 404 });

const maintenant = (): string => new Date().toISOString();
const texte = (v: FormDataEntryValue | null, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ID = /^[\w-]{1,64}$/;

// ---------------------------------------------------------------- tableau de bord

export interface Cabinet {
  id: string;
  nom: string;
  domaine: string | null;
  cree_le: string;
  suspendu_le: string | null;
  viewers: number;
  contacts: number;
  /** Date de l'arrêté le plus récent, tous portefeuilles du cabinet (point, enveloppe). */
  dernier_arrete: string | null;
  dernier_incident: string | null;
}

const PF = 'SELECT pf.id FROM portefeuille pf WHERE pf.tenant_id = t.id';

const SQL_CABINETS = `
  SELECT t.id, t.nom, t.domaine, t.cree_le,
         (SELECT sp.debut_le FROM suspension sp WHERE sp.tenant_id = t.id AND sp.fin_le IS NULL) AS suspendu_le,
         (SELECT COUNT(*) FROM utilisateur u WHERE u.tenant_id = t.id AND u.role = 'viewer') AS viewers,
         (SELECT COUNT(*) FROM contact c WHERE c.tenant_id = t.id AND c.archive = 0) AS contacts,
         (SELECT MAX(d) FROM (
            SELECT p.date AS d FROM point p WHERE p.portefeuille_id IN (${PF})
            UNION ALL
            SELECT e.arrete_le FROM enveloppe e WHERE e.portefeuille_id IN (${PF})
         )) AS dernier_arrete,
         (SELECT MAX(i.cree_le) FROM incident i WHERE i.tenant_id = t.id) AS dernier_incident
    FROM tenant t`;

/** Tous les cabinets, avec ce qu'il faut pour voir lequel a décroché. */
export async function cabinets(db: Base): Promise<Cabinet[]> {
  const { results } = await db.prepare(`${SQL_CABINETS} ORDER BY t.nom, t.id`).bind().all<Cabinet>();
  return results;
}

export async function cabinetDe(db: Base, id: string): Promise<Cabinet | null> {
  if (!ID.test(id)) return null;
  return db.prepare(`${SQL_CABINETS} WHERE t.id = ?`).bind(id).first<Cabinet>();
}

export interface Gestionnaire {
  id: string;
  nom: string;
  email: string;
  actif: number;
}

export async function gestionnairesDe(db: Base, tenantId: string): Promise<Gestionnaire[]> {
  const { results } = await db
    .prepare("SELECT id, nom, email, actif FROM utilisateur WHERE tenant_id = ? AND role = 'gestionnaire' ORDER BY nom")
    .bind(tenantId)
    .all<Gestionnaire>();
  return results;
}

// ---------------------------------------------------------------- créer un cabinet

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ETIQUETTE = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOTE = new RegExp(`^${ETIQUETTE}(?:\\.${ETIQUETTE})*$`);

/** Un nom d'hôte seul, en minuscules : ni schéma, ni chemin, ni port. Null s'il n'est pas valable. */
export function normaliserHote(brut: string): string | null {
  const h = brut.trim().toLowerCase().replace(/\.$/, '');
  return h.length > 0 && h.length <= 253 && HOTE.test(h) ? h : null;
}

/** Un nom d'hôte est pris s'il est l'hôte d'origine d'un cabinet ou une ligne de `domaine`, validée ou non. */
async function hotePris(db: Base, hote: string): Promise<boolean> {
  const r = await db
    .prepare('SELECT 1 AS ok FROM tenant WHERE domaine = ? UNION ALL SELECT 1 FROM domaine WHERE hote = ?')
    .bind(hote, hote)
    .first();
  return r !== null;
}

export type Erreurs = Record<string, string>;

export interface CabinetCree {
  id: string;
  hote: string;
  nom: string;
  gestionnaire: { id: string; nom: string; email: string };
}

/**
 * Crée le cabinet en UNE transaction (`batch` de D1 : tout ou rien) : le locataire, son nom d'hôte d'origine (validé : c'est
 * celui que le Worker sert), son thème, ses listes de référence par défaut avec leurs marqueurs, sa ligne de version et
 * son premier gestionnaire. L'envoi du lien se fait après : s'il échoue, le cabinet reste créé (voir lienPremierGestionnaire).
 */
export async function creerCabinet(db: Base, f: FormData): Promise<{ erreurs: Erreurs } | CabinetCree> {
  const erreurs: Erreurs = {};
  const nom = texte(f.get('nom'), 120);
  const hote = normaliserHote(texte(f.get('hote'), 253));
  const gNom = texte(f.get('gestionnaire_nom'), 120);
  const gEmail = texte(f.get('gestionnaire_email'), 254).toLowerCase();
  const theme = texte(f.get('theme'), 32) || THEME_DEFAUT;

  if (!nom) erreurs.nom = 'Le nom du cabinet est requis.';
  if (!hote) erreurs.hote = 'Nom d’hôte invalide : lettres, chiffres, tirets et points, sans schéma ni port (ex. patrimoine.cabinet.fr).';
  else if (await hotePris(db, hote)) erreurs.hote = 'Ce nom d’hôte est déjà utilisé par un cabinet.';
  if (!gNom) erreurs.gestionnaire_nom = 'Le nom du gestionnaire est requis.';
  if (!EMAIL.test(gEmail)) erreurs.gestionnaire_email = 'Adresse e-mail invalide.';
  else if (await db.prepare('SELECT 1 AS ok FROM utilisateur WHERE email = ?').bind(gEmail).first()) {
    erreurs.gestionnaire_email = 'Cette adresse est déjà utilisée.';
  }
  if (!THEMES.some((t) => t.id === theme)) erreurs.theme = 'Thème inconnu.';
  if (Object.keys(erreurs).length || !hote) return { erreurs };

  const id = `tnt_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const gId = crypto.randomUUID();
  const now = maintenant();
  const requetes: Requete[] = [
    db.prepare('INSERT INTO tenant (id, nom, domaine, cree_le) VALUES (?, ?, ?, ?)').bind(id, nom, hote, now),
    db
      .prepare("INSERT INTO domaine (hote, tenant_id, principal, valide_le, statut, declare_le, verifie_le) VALUES (?, ?, 1, ?, 'actif', ?, ?)")
      .bind(hote, id, now, now, now),
    db.prepare("INSERT INTO reglage (tenant_id, cle, valeur) VALUES (?, 'theme', ?)").bind(id, theme),
    ...requetesListesDefaut(db, id),
    db.prepare('INSERT INTO version_locataire (tenant_id, version) VALUES (?, 1)').bind(id),
    db
      .prepare("INSERT INTO utilisateur (id, tenant_id, email, nom, role, actif, cree_le) VALUES (?, ?, ?, ?, 'gestionnaire', 1, ?)")
      .bind(gId, id, gEmail, gNom, now),
  ];
  try {
    await db.batch(requetes);
  } catch {
    // Nom d'hôte ou adresse pris entre la vérification et l'écriture : rien n'a été écrit.
    return { erreurs: { general: 'Le cabinet n’a pas été créé : le nom d’hôte ou l’adresse vient d’être pris. Rien n’a été écrit.' } };
  }
  return { id, hote, nom, gestionnaire: { id: gId, nom: gNom, email: gEmail } };
}

/**
 * Prépare le lien de première connexion du gestionnaire et l'envoie. Renvoie true si le mail est parti. Un échec n'annule
 * rien : le cabinet existe, et l'incident « mail_refuse » est écrit pour lui. `origine` : schéma et port de la requête de
 * l'éditeur (le port n'existe qu'en développement), appliqués à l'hôte du nouveau cabinet.
 */
export async function lienPremierGestionnaire(
  locals: unknown,
  c: CabinetCree,
  origineRequete: URL,
): Promise<boolean> {
  const { DB } = envDe(locals);
  try {
    const jeton = await demanderLien(DB, c.id, c.gestionnaire.email);
    if (!jeton) throw new Error('lien non préparé');
    const port = origineRequete.port ? `:${origineRequete.port}` : '';
    const lien = `${origineRequete.protocol}//${c.hote}${port}/connexion/${jeton}`;
    await creerMailer(envDe(locals), c.hote).envoyer(
      c.gestionnaire.email,
      'Votre espace gestionnaire est ouvert',
      `Bonjour ${c.gestionnaire.nom},\n\nLe cabinet « ${c.nom} » vient d'être ouvert sur BeBess'Invest et vous en êtes le gestionnaire.\n\nVoici votre lien de première connexion, valable 15 minutes et utilisable une seule fois :\n\n${lien}\n\nAucun mot de passe n'est nécessaire.`,
    );
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'erreur';
    console.error('[admin] envoi du lien du premier gestionnaire impossible :', message);
    await noterIncident(DB, c.id, 'mail_refuse', `Lien de première connexion non envoyé à ${c.gestionnaire.email} : ${message}`);
    return false;
  }
}

// ---------------------------------------------------------------- domaines (Cloudflare for SaaS)

export interface Domaine {
  hote: string;
  principal: number;
  valide_le: string | null;
  cf_id: string | null;
  statut: string | null;
  detail: string | null;
  declare_le: string | null;
  verifie_le: string | null;
}

export async function domainesDe(db: Base, tenantId: string): Promise<Domaine[]> {
  const { results } = await db
    .prepare(
      `SELECT hote, principal, valide_le, cf_id, statut, detail, declare_le, verifie_le
         FROM domaine WHERE tenant_id = ? ORDER BY principal DESC, hote`,
    )
    .bind(tenantId)
    .all<Domaine>();
  return results;
}

export interface ConfigCloudflare {
  /** Vrai si le jeton, la zone ET la cible sont là : l'API est appelée. */
  pret: boolean;
  jeton: boolean;
  zone: boolean;
  /** Hôte que le cabinet pointe par CNAME, ou null s'il n'est pas configuré. */
  cible: string | null;
  /** Ce qui manque, par son nom de variable. */
  manque: string[];
}

export function configCloudflare(env: Env): ConfigCloudflare {
  const jeton = !!env.CF_API_TOKEN;
  const zone = !!env.CF_ZONE_ID;
  const cible = env.CF_CNAME_CIBLE?.trim() || null;
  const manque = [!jeton && 'CF_API_TOKEN', !zone && 'CF_ZONE_ID', !cible && 'CF_CNAME_CIBLE'].filter((x): x is string => !!x);
  return { pret: jeton && zone, jeton, zone, cible, manque };
}

interface ReponseCf {
  success?: boolean;
  errors?: { message?: string }[];
  result?: {
    id?: string;
    status?: string;
    ssl?: { status?: string; validation_errors?: { message?: string }[] };
    verification_errors?: string[];
    ownership_verification?: { name?: string; value?: string };
  };
}

type ResultatCf = { ok: true; reponse: ReponseCf } | { ok: false; message: string };

/** Appel à l'API de Cloudflare, côté serveur seulement. Le jeton ne sort jamais dans un message. */
async function appelCf(env: Env, methode: 'GET' | 'POST' | 'DELETE', chemin: string, corps?: unknown): Promise<ResultatCf> {
  try {
    const base = (env.CF_API_URL ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');
    const r = await fetch(`${base}/zones/${encodeURIComponent(env.CF_ZONE_ID ?? '')}/custom_hostnames${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await r.json().catch(() => ({}))) as ReponseCf;
    if (!r.ok || json.success === false) {
      return { ok: false, message: `Cloudflare : ${json.errors?.[0]?.message ?? `réponse ${r.status}`}` };
    }
    return { ok: true, reponse: json };
  } catch (e) {
    return { ok: false, message: `Cloudflare injoignable : ${e instanceof Error ? e.message : 'erreur'}` };
  }
}

/** Traduit la réponse de Cloudflare en état de la console : actif seulement si l'hôte ET son certificat le sont. */
function etatCf(r: NonNullable<ReponseCf['result']>): { statut: 'actif' | 'en_attente' | 'erreur'; detail: string } {
  const hote = r.status ?? 'inconnu';
  const ssl = r.ssl?.status ?? 'inconnu';
  const lignes = [`Hôte : ${hote}. Certificat : ${ssl}.`];
  const erreurs = [...(r.verification_errors ?? []), ...(r.ssl?.validation_errors ?? []).map((e) => e.message ?? '')].filter(Boolean);
  if (erreurs.length) lignes.push(erreurs.join(' '));
  const o = r.ownership_verification;
  if (o?.name && o.value) lignes.push(`Enregistrement TXT à poser : ${o.name} = ${o.value}`);
  const bloque = /timed_out|blocked|deleted|moved/.test(`${hote} ${ssl}`);
  const actif = hote === 'active' && ssl === 'active';
  return { statut: actif ? 'actif' : bloque ? 'erreur' : 'en_attente', detail: lignes.join(' ') };
}

/** Résultat d'une action de la console : un code fixe (jamais du texte venu de l'extérieur dans l'adresse de retour). */
export type ResultatAction = { ok: boolean; code: CodeAction };

export type CodeAction =
  | 'valide' | 'en_cours' | 'declare_sans_jeton' | 'retire' | 'cloudflare' | 'hote_invalide' | 'hote_pris' | 'domaine_inconnu'
  | 'principal' | 'retrait_sans_jeton' | 'suspendu' | 'leve' | 'motif' | 'cabinet_inconnu' | 'editeur' | 'deja_suspendu' | 'pas_suspendu';

export const MESSAGES_ACTION: Record<CodeAction, string> = {
  valide: 'Domaine validé par Cloudflare : il ouvre le cabinet.',
  en_cours: 'Domaine déclaré : la validation chez Cloudflare est en cours. Le cabinet doit poser l’enregistrement CNAME indiqué ; revenez sur « Vérifier ».',
  declare_sans_jeton: 'Domaine déclaré, mais le jeton Cloudflare n’est pas configuré : rien n’a été demandé à Cloudflare, rien n’est validé. L’enregistrement CNAME à poser est indiqué.',
  retire: 'Domaine retiré.',
  cloudflare: 'Cloudflare a refusé ou n’a pas répondu : le détail est dans la colonne Validation et dans les incidents.',
  hote_invalide: 'Nom d’hôte invalide : lettres, chiffres, tirets et points, sans schéma ni port.',
  hote_pris: 'Ce nom d’hôte est déjà utilisé.',
  domaine_inconnu: 'Domaine inconnu pour ce cabinet.',
  principal: 'L’hôte d’origine du cabinet ne se retire pas.',
  retrait_sans_jeton: 'Le jeton Cloudflare est absent : le domaine ne peut pas être retiré chez Cloudflare, il est donc conservé.',
  suspendu: 'Cabinet suspendu : ses gestionnaires ne peuvent plus entrer ; les espaces de ses viewers restent en ligne.',
  leve: 'Suspension levée : les gestionnaires peuvent de nouveau entrer.',
  motif: 'Le motif est obligatoire.',
  cabinet_inconnu: 'Cabinet inconnu.',
  editeur: 'Ce cabinet héberge un compte éditeur : il ne se suspend pas.',
  deja_suspendu: 'Ce cabinet est déjà suspendu.',
  pas_suspendu: 'Ce cabinet n’est pas suspendu.',
};

const ok = (code: CodeAction): ResultatAction => ({ ok: true, code });
const ko = (code: CodeAction): ResultatAction => ({ ok: false, code });

/** Interroge Cloudflare (ou crée le « custom hostname » s'il n'existe pas encore) et enregistre l'état. */
async function synchroniser(db: Base, env: Env, tenantId: string, d: Domaine): Promise<ResultatAction> {
  const cfg = configCloudflare(env);
  if (!cfg.pret) {
    await db
      .prepare('UPDATE domaine SET statut = ?, detail = ? WHERE hote = ? AND tenant_id = ?')
      .bind('en_attente', `Jeton Cloudflare absent (${cfg.manque.join(', ')}) : la validation n’a pas été demandée.`, d.hote, tenantId)
      .run();
    return ko('declare_sans_jeton');
  }
  const reponse = d.cf_id
    ? await appelCf(env, 'GET', `/${encodeURIComponent(d.cf_id)}`)
    : await appelCf(env, 'POST', '', { hostname: d.hote, ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } });
  const now = maintenant();
  if (!reponse.ok || !reponse.reponse.result) {
    const message = reponse.ok ? 'Cloudflare : réponse vide.' : reponse.message;
    await db
      .prepare("UPDATE domaine SET statut = 'erreur', detail = ?, verifie_le = ? WHERE hote = ? AND tenant_id = ?")
      .bind(message.slice(0, 500), now, d.hote, tenantId)
      .run();
    await noterIncident(db, tenantId, 'domaine_echec', `${d.hote} : ${message}`);
    return ko('cloudflare');
  }
  const r = reponse.reponse.result;
  const etat = etatCf(r);
  // valide_le est la seule vérité du routage : posée quand Cloudflare dit actif, retirée sinon (certificat expiré, hôte retiré).
  await db
    .prepare('UPDATE domaine SET cf_id = ?, statut = ?, detail = ?, valide_le = ?, verifie_le = ? WHERE hote = ? AND tenant_id = ?')
    .bind(r.id ?? d.cf_id, etat.statut, etat.detail, etat.statut === 'actif' ? (d.valide_le ?? now) : null, now, d.hote, tenantId)
    .run();
  return ok(etat.statut === 'actif' ? 'valide' : 'en_cours');
}

/** Déclare un nom d'hôte pour le cabinet. Il n'ouvre rien tant que Cloudflare ne l'a pas validé. */
export async function declarerDomaine(db: Base, env: Env, tenantId: string, brut: string): Promise<ResultatAction> {
  const hote = normaliserHote(brut);
  if (!hote) return ko('hote_invalide');
  if (await hotePris(db, hote)) return ko('hote_pris');
  try {
    await db
      .prepare("INSERT INTO domaine (hote, tenant_id, principal, valide_le, statut, declare_le) VALUES (?, ?, 0, NULL, 'en_attente', ?)")
      .bind(hote, tenantId, maintenant())
      .run();
  } catch {
    return ko('hote_pris');
  }
  const d = (await domainesDe(db, tenantId)).find((x) => x.hote === hote);
  if (!d) return ko('domaine_inconnu');
  const r = await synchroniser(db, env, tenantId, d);
  // Déclaré dans tous les cas : sans jeton, la ligne et le CNAME à poser existent, la validation viendra plus tard.
  return r.ok ? r : { ok: r.code === 'declare_sans_jeton', code: r.code };
}

export async function verifierDomaine(db: Base, env: Env, tenantId: string, hote: string): Promise<ResultatAction> {
  const d = (await domainesDe(db, tenantId)).find((x) => x.hote === hote);
  if (!d) return ko('domaine_inconnu');
  return synchroniser(db, env, tenantId, d);
}

/** Retire un domaine déclaré. L'hôte d'origine du cabinet ne se retire pas : il sert à entrer. */
export async function retirerDomaine(db: Base, env: Env, tenantId: string, hote: string): Promise<ResultatAction> {
  const d = (await domainesDe(db, tenantId)).find((x) => x.hote === hote);
  if (!d) return ko('domaine_inconnu');
  if (d.principal === 1) return ko('principal');
  if (d.cf_id) {
    if (!configCloudflare(env).pret) return ko('retrait_sans_jeton');
    const r = await appelCf(env, 'DELETE', `/${encodeURIComponent(d.cf_id)}`);
    if (!r.ok && !/not found|10000|1551/i.test(r.message)) {
      await noterIncident(db, tenantId, 'domaine_echec', `${hote} : ${r.message}`);
      return ko('cloudflare');
    }
  }
  await db.prepare('DELETE FROM domaine WHERE hote = ? AND tenant_id = ? AND principal = 0').bind(hote, tenantId).run();
  return ok('retire');
}

// ---------------------------------------------------------------- suspension

export interface Suspension {
  id: string;
  motif: string;
  debut_le: string;
  par_nom: string | null;
  fin_le: string | null;
  fin_par_nom: string | null;
}

export async function suspensionsDe(db: Base, tenantId: string): Promise<Suspension[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.motif, s.debut_le, u.nom AS par_nom, s.fin_le, v.nom AS fin_par_nom
         FROM suspension s
         JOIN utilisateur u ON u.id = s.par
         LEFT JOIN utilisateur v ON v.id = s.fin_par
        WHERE s.tenant_id = ?
        ORDER BY s.debut_le DESC, s.id DESC`,
    )
    .bind(tenantId)
    .all<Suspension>();
  return results;
}

/**
 * Suspend le cabinet : action explicite, motif obligatoire, horodatée. Les accès des gestionnaires deviennent inopérants
 * (HORS_SUSPENSION, auth.ts) ; les espaces des viewers restent en ligne : ils ne sont pas partie au litige commercial.
 * Refusée pour un cabinet qui héberge un compte éditeur : on ne se coupe pas de sa propre console.
 */
export async function suspendre(db: Base, tenantId: string, motifBrut: string, parId: string): Promise<ResultatAction> {
  const motif = motifBrut.trim().slice(0, 500);
  if (!motif) return ko('motif');
  if (!(await cabinetDe(db, tenantId))) return ko('cabinet_inconnu');
  const editeur = await db.prepare("SELECT 1 AS ok FROM utilisateur WHERE tenant_id = ? AND role = 'editeur'").bind(tenantId).first();
  if (editeur) return ko('editeur');
  try {
    await db
      .prepare('INSERT INTO suspension (id, tenant_id, motif, debut_le, par) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), tenantId, motif, maintenant(), parId)
      .run();
  } catch {
    return ko('deja_suspendu');
  }
  return ok('suspendu');
}

export async function leverSuspension(db: Base, tenantId: string, parId: string): Promise<ResultatAction> {
  const r = await db
    .prepare('UPDATE suspension SET fin_le = ?, fin_par = ? WHERE tenant_id = ? AND fin_le IS NULL RETURNING id')
    .bind(maintenant(), parId, tenantId)
    .first();
  return r ? ok('leve') : ko('pas_suspendu');
}
