// Fichiers (R2). RÈGLE ABSOLUE : aucun objet n'est servi par une URL publique de R2. Le bucket n'a ni domaine
// public ni accès r2.dev ; tout passe par une route du Worker (src/pages/fichiers/…, src/pages/logo-cabinet.ts)
// qui contrôle d'abord la session, le locataire et le rôle.
//
// Toute clé commence par l'identifiant du locataire : `servir` et `supprimer` refusent une clé qui n'y
// commence pas, même si la base la contenait (défense en profondeur).

import type { Base } from './db';

// Forme minimale d'un bucket R2, pour ne pas dépendre d'un paquet de types (comme Base pour D1).
export interface ObjetR2 {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
}
export interface Bucket {
  put(cle: string, valeur: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(cle: string): Promise<ObjetR2 | null>;
  /** Une clé, ou jusqu'à 1000 d'un coup. */
  delete(cle: string | string[]): Promise<void>;
  /** Lister par préfixe (la purge d'un cabinet, lot 12). */
  list(options: { prefix?: string; limit?: number }): Promise<{ objects: { key: string }[] }>;
}

// ---------------------------------------------------------------- limites

/** Rapport PDF : 10 Mo. */
export const LIMITE_PDF = 10 * 1024 * 1024;
/** Logo : 512 Ko. */
export const LIMITE_LOGO = 512 * 1024;
/** Marge du corps multipart (champs, bornes) au-delà de la limite du fichier. */
const MARGE_CORPS = 64 * 1024;

export type Usage = 'pdf' | 'logo';
const LIMITES: Record<Usage, number> = { pdf: LIMITE_PDF, logo: LIMITE_LOGO };
const AUTORISES: Record<Usage, string[]> = {
  pdf: ['application/pdf'],
  // Pas de SVG : un SVG est du code (scripts), pas une image inerte.
  logo: ['image/png', 'image/jpeg', 'image/webp'],
};
const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type CodeRefus = 'absent' | 'trop_gros' | 'type_refuse' | 'vide';

export const MESSAGES_REFUS: Record<CodeRefus, string> = {
  absent: 'Aucun fichier reçu.',
  vide: 'Le fichier est vide.',
  trop_gros: 'Le fichier dépasse la taille autorisée (PDF : 10 Mo ; logo : 512 Ko).',
  type_refuse: 'Le contenu du fichier ne correspond pas à un type accepté (PDF ; logo : PNG, JPEG ou WebP), quelle que soit son extension.',
};

// ---------------------------------------------------------------- type réel

const commence = (o: Uint8Array, motif: number[], decalage = 0) => motif.every((v, i) => o[decalage + i] === v);

/** Type d'après le CONTENU (signature des premiers octets), jamais d'après le nom ou le type annoncé. */
export function typeReel(o: Uint8Array): string | null {
  if (commence(o, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (commence(o, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (commence(o, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // WebP : "RIFF" + taille sur 4 octets + "WEBP"
  if (commence(o, [0x52, 0x49, 0x46, 0x46]) && commence(o, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Refuse d'avance un corps manifestement trop gros, avant que le serveur ne le lise en entier. */
export function corpsTropGros(req: Request, usage: Usage): boolean {
  const n = Number(req.headers.get('content-length'));
  return Number.isFinite(n) && n > LIMITES[usage] + MARGE_CORPS;
}

export interface Depot {
  octets: ArrayBuffer;
  type: string;
}

/** Contrôle un fichier reçu d'un formulaire : présent, non vide, sous la limite, de type réel autorisé. */
export async function lireDepot(champ: FormDataEntryValue | null, usage: Usage): Promise<Depot | CodeRefus> {
  if (!champ || typeof champ === 'string' || champ.size === undefined) return 'absent';
  if (champ.size === 0) return 'vide';
  if (champ.size > LIMITES[usage]) return 'trop_gros';
  const octets = await champ.arrayBuffer();
  if (octets.byteLength > LIMITES[usage]) return 'trop_gros';
  const type = typeReel(new Uint8Array(octets, 0, Math.min(16, octets.byteLength)));
  if (!type || !AUTORISES[usage].includes(type)) return 'type_refuse';
  return { octets, type };
}

// ---------------------------------------------------------------- clés

const ID = /^[\w-]{1,64}$/;

export function cleDocument(tenantId: string, type: string): string {
  return `${tenantId}/documents/${crypto.randomUUID()}.${EXTENSIONS[type] ?? 'bin'}`;
}
export function cleLogoContact(tenantId: string, contactId: string, type: string): string {
  if (!ID.test(contactId)) throw new Error('identifiant de contact invalide');
  return `${tenantId}/contacts/${contactId}/${crypto.randomUUID()}.${EXTENSIONS[type] ?? 'bin'}`;
}
export function cleLogoCabinet(tenantId: string, type: string): string {
  return `${tenantId}/cabinet/logo-${crypto.randomUUID()}.${EXTENSIONS[type] ?? 'bin'}`;
}

/**
 * Le PDF d'une facture (lot 13). Rangé HORS du préfixe du locataire : `factures/<locataire>/<bon>.pdf`. La purge du J+75 vide
 * `<locataire>/` ; le bon d'un cabinet purgé reste (contrat, facture d'installation), son PDF aussi.
 */
export function cleFacture(tenantId: string, bonId: string): string {
  if (!ID.test(tenantId) || !ID.test(bonId)) throw new Error('identifiant invalide');
  return `factures/${tenantId}/${bonId}.pdf`;
}
export const cleDeFacture = (cle: string, tenantId: string): boolean =>
  tenantId.length > 0 && cle.startsWith(`factures/${tenantId}/`) && !cle.includes('..');

/** Une clé appartient au locataire si, et seulement si, elle commence par son identifiant suivi de « / ». */
export const cleDuTenant = (cle: string, tenantId: string): boolean =>
  tenantId.length > 0 && cle.startsWith(`${tenantId}/`) && !cle.includes('..');

// ---------------------------------------------------------------- lecture, écriture

export async function deposer(bucket: Bucket, cle: string, depot: Depot): Promise<void> {
  await bucket.put(cle, depot.octets, { httpMetadata: { contentType: depot.type } });
}

/** Supprime un objet du locataire. Une clé d'un autre locataire n'est jamais touchée. */
export async function supprimer(bucket: Bucket, tenantId: string, cle: string | null | undefined): Promise<void> {
  if (cle && cleDuTenant(cle, tenantId)) await bucket.delete(cle);
}

const nomSur = (titre: string): string =>
  (titre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'fichier');

export interface OptionsServir {
  /** Téléchargement (rapport) ou affichage (logo). */
  telechargement?: { nom: string };
  cache: string;
}

/** Sert un objet du locataire, ou 404. Le type annoncé est celui qui a été vérifié au dépôt. */
export async function servir(bucket: Bucket, tenantId: string, cle: string | null, o: OptionsServir): Promise<Response> {
  if (!cle || !cleDuTenant(cle, tenantId)) return new Response('Introuvable.', { status: 404 });
  return servirObjet(bucket, cle, o);
}

/** Sert la facture d'un locataire (`factures/<locataire>/…`), ou 404. Même réponse que `servir`, autre préfixe. */
export async function servirFacture(bucket: Bucket, tenantId: string, cle: string | null, o: OptionsServir): Promise<Response> {
  if (!cle || !cleDeFacture(cle, tenantId)) return new Response('Introuvable.', { status: 404 });
  return servirObjet(bucket, cle, o);
}

async function servirObjet(bucket: Bucket, cle: string, o: OptionsServir): Promise<Response> {
  const objet = await bucket.get(cle);
  if (!objet) return new Response('Introuvable.', { status: 404 });
  const type = objet.httpMetadata?.contentType ?? 'application/octet-stream';
  const ext = EXTENSIONS[type] ?? 'bin';
  const entetes: Record<string, string> = {
    'Content-Type': type,
    'Content-Length': String(objet.size),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': o.cache,
  };
  if (o.telechargement) {
    entetes['Content-Disposition'] = `attachment; filename="${nomSur(o.telechargement.nom)}.${ext}"`;
  }
  return new Response(objet.body, { status: 200, headers: entetes });
}

// ---------------------------------------------------------------- lectures en base (toujours bornées au locataire)

export interface DocumentFichier {
  id: string;
  viewer_id: string;
  titre: string;
  cle_fichier: string | null;
}

/**
 * Le document, s'il est du locataire. Pour un viewer, seulement s'il est à lui. Inconnu, étranger ou d'un
 * autre viewer : null, sans distinction (l'appelant répond 404).
 */
export function documentAccessible(
  db: Base,
  tenantId: string,
  utilisateur: { id: string; role: string },
  id: string,
): Promise<DocumentFichier | null> {
  if (!ID.test(id)) return Promise.resolve(null);
  const seulement = utilisateur.role === 'viewer';
  return db
    .prepare(
      `SELECT d.id, d.viewer_id, d.titre, d.cle_fichier
         FROM document d JOIN utilisateur u ON u.id = d.viewer_id
        WHERE d.id = ? AND u.tenant_id = ? ${seulement ? 'AND d.viewer_id = ?' : ''}`,
    )
    .bind(...(seulement ? [id, tenantId, utilisateur.id] : [id, tenantId]))
    .first<DocumentFichier>();
}

/** Clé du logo du cabinet (réglage logo_cle du locataire). */
export async function cleLogoDuCabinet(db: Base, tenantId: string): Promise<string | null> {
  const r = await db
    .prepare("SELECT valeur FROM reglage WHERE tenant_id = ? AND cle = 'logo_cle'")
    .bind(tenantId)
    .first<{ valeur: string }>();
  return r?.valeur && cleDuTenant(r.valeur, tenantId) ? r.valeur : null;
}

/** Adresse du logo du cabinet pour les pages, ou null s'il n'y en a pas. Le paramètre ne sert qu'à renouveler le cache. */
export async function urlLogoCabinet(db: Base, tenantId: string): Promise<string | null> {
  const cle = await cleLogoDuCabinet(db, tenantId);
  return cle ? `/logo-cabinet?v=${encodeURIComponent(cle.split('/').pop() ?? '')}` : null;
}
