// L'identité de facturation d'un cabinet (lot 13) : sa raison sociale (`tenant.nom`), son SIREN, son adresse et son contact de
// facturation. C'est ce que le bon à facturer porte pour qu'on puisse taper la facture sans rien chercher ailleurs.
//
// Le locataire EST l'entité juridique, et il y a un contrat par SIREN : ces champs sont sur `tenant`. Un SIREN absent n'empêche pas
// de créer le cabinet ; il le signale sur le bon, qui ne s'émet pas incomplet sans qu'on le confirme (facturation.ts, emettreBon).
//
// Le journal ne reçoit JAMAIS les valeurs : seulement les NOMS des champs modifiés. Le contact de facturation est une personne.

import type { Base } from './db';
import { EVENEMENT, requeteEvenement, type Acteur } from './journal';
import { erreurSiren, MESSAGES_SIREN, normaliserSiren } from './siren';

export interface IdentiteFacturation {
  raison_sociale: string;
  siren: string | null;
  adresse_facturation: string | null;
  contact_facturation: string | null;
}

export type ChampIdentite = 'siren' | 'adresse_facturation' | 'contact_facturation';
export const CHAMPS_IDENTITE: ChampIdentite[] = ['siren', 'adresse_facturation', 'contact_facturation'];
export const LIBELLES_IDENTITE: Record<ChampIdentite, string> = {
  siren: 'SIREN',
  adresse_facturation: 'Adresse de facturation',
  contact_facturation: 'Contact de facturation',
};

export type SaisieIdentite = Record<ChampIdentite, string>;
export type ErreursIdentite = Partial<Record<ChampIdentite, string>>;

/** Ce qui manque à une identité pour qu'un bon soit complet, dans l'ordre du bon. */
export const identiteManquante = (i: Pick<IdentiteFacturation, ChampIdentite>): ChampIdentite[] =>
  CHAMPS_IDENTITE.filter((c) => !(i[c] ?? '').trim());

const texte = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Lit les trois champs d'un formulaire. Aucune base ici : l'unicité du SIREN se vérifie à part (`sirenPris`). */
export function lireIdentite(f: FormData): { valeurs: SaisieIdentite; erreurs: ErreursIdentite } {
  const brut = texte(f.get('siren'), 40);
  const valeurs: SaisieIdentite = {
    siren: brut === '' ? '' : normaliserSiren(brut),
    adresse_facturation: texte(f.get('adresse_facturation'), 400),
    contact_facturation: texte(f.get('contact_facturation'), 200),
  };
  const erreurs: ErreursIdentite = {};
  if (brut !== '') {
    const e = erreurSiren(brut);
    if (e) erreurs.siren = MESSAGES_SIREN[e];
  }
  return { valeurs, erreurs };
}

/** Un autre cabinet porte-t-il déjà ce SIREN ? Un contrat par SIREN : il ne se partage pas. */
export async function sirenPris(db: Base, siren: string, sauf?: string): Promise<boolean> {
  const r = await db
    .prepare('SELECT 1 AS ok FROM tenant WHERE siren = ? AND id <> ?')
    .bind(siren, sauf ?? '')
    .first();
  return r !== null;
}

export const MESSAGE_SIREN_PRIS = 'Ce SIREN est déjà celui d’un autre cabinet : il n’y a qu’un contrat par SIREN.';

export function identiteFacturation(db: Base, tenantId: string): Promise<IdentiteFacturation | null> {
  return db
    .prepare('SELECT nom AS raison_sociale, siren, adresse_facturation, contact_facturation FROM tenant WHERE id = ?')
    .bind(tenantId)
    .first<IdentiteFacturation>();
}

export type ResultatIdentite =
  | { ok: true; modifies: ChampIdentite[] }
  | { ok: false; code: 'cabinet_inconnu' | 'siren_pris' }
  | { ok: false; code: 'invalide'; erreurs: ErreursIdentite };

/**
 * Pose l'identité de facturation (la console de l'éditeur). Un champ vide se range à NULL. L'écriture et son événement partent dans le
 * même `batch` ; sans changement, ni l'une ni l'autre.
 */
export async function poserIdentite(db: Base, tenantId: string, f: FormData, acteur: Acteur): Promise<ResultatIdentite> {
  const { valeurs, erreurs } = lireIdentite(f);
  if (Object.keys(erreurs).length) return { ok: false, code: 'invalide', erreurs };
  const avant = await identiteFacturation(db, tenantId);
  if (!avant) return { ok: false, code: 'cabinet_inconnu' };
  if (valeurs.siren && (await sirenPris(db, valeurs.siren, tenantId))) return { ok: false, code: 'siren_pris' };
  const modifies = CHAMPS_IDENTITE.filter((c) => (avant[c] ?? '') !== valeurs[c]);
  if (modifies.length === 0) return { ok: true, modifies };
  try {
    await db.batch([
      db
        .prepare('UPDATE tenant SET siren = ?, adresse_facturation = ?, contact_facturation = ? WHERE id = ?')
        .bind(valeurs.siren || null, valeurs.adresse_facturation || null, valeurs.contact_facturation || null, tenantId),
      requeteEvenement(
        db,
        { tenantId, type: EVENEMENT.IDENTITE_FACTURATION, acteur, cible: { type: 'cabinet', id: tenantId }, detail: { champs: modifies } },
        true,
      ),
    ]);
  } catch {
    // Le SIREN a été pris entre la vérification et l'écriture : rien n'a été écrit.
    return { ok: false, code: 'siren_pris' };
  }
  return { ok: true, modifies };
}
