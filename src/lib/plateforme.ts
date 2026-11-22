// L'identité de la société éditrice de la plateforme (Labije Software), affichée sur la page publique /plateforme.
//
// Réglages GLOBAUX de l'éditeur (table `reglage_editeur`, clés « plateforme_… », aucun locataire), saisis dans la console (/admin/reglages), par l'éditeur
// seul. Chaque champ a une longueur bornée ; le SIREN est contrôlé (clé de Luhn) et le contact doit être une adresse e-mail. La page n'affiche QUE les
// lignes renseignées : jamais « à compléter » devant un client final ; c'est la console qui avertit quand l'identité est incomplète.
//
// Le contenu vient d'un réglage saisi : les gabarits l'insèrent comme TEXTE (échappé par Astro), jamais comme HTML.

import type { Base } from './db';
import type { Acteur } from './journal';
import { afficherSiren, erreurSiren, MESSAGES_SIREN, normaliserSiren } from './siren';

export interface ChampPlateforme {
  /** Clé dans `reglage_editeur`. */
  cle: string;
  /** Nom du champ de formulaire. */
  champ: string;
  libelle: string;
  max: number;
  /** Plusieurs lignes (adresse du siège, hébergeur). */
  long?: boolean;
  type?: 'siren' | 'email';
}

export const CHAMPS_PLATEFORME: ChampPlateforme[] = [
  { cle: 'plateforme_raison_sociale', champ: 'raison_sociale', libelle: 'Raison sociale', max: 120 },
  { cle: 'plateforme_forme_juridique', champ: 'forme_juridique', libelle: 'Forme juridique', max: 60 },
  { cle: 'plateforme_capital', champ: 'capital', libelle: 'Capital social', max: 60 },
  { cle: 'plateforme_siren', champ: 'siren', libelle: 'SIREN', max: 20, type: 'siren' },
  { cle: 'plateforme_siege', champ: 'siege', libelle: 'Siège social', max: 300, long: true },
  { cle: 'plateforme_directeur_publication', champ: 'directeur_publication', libelle: 'Directeur de la publication', max: 120 },
  { cle: 'plateforme_contact', champ: 'contact', libelle: 'Contact', max: 254, type: 'email' },
  { cle: 'plateforme_hebergeur', champ: 'hebergeur', libelle: 'Hébergeur', max: 300, long: true },
];

const CLES = CHAMPS_PLATEFORME.map((c) => c.cle);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Les valeurs renseignées (non vides), par `champ`. */
export async function identitePlateforme(db: Base): Promise<Record<string, string>> {
  const { results } = await db
    .prepare(`SELECT cle, valeur FROM reglage_editeur WHERE cle IN (${CLES.map(() => '?').join(', ')})`)
    .bind(...CLES)
    .all<{ cle: string; valeur: string }>();
  const parCle = Object.fromEntries(results.map((r) => [r.cle, r.valeur]));
  return Object.fromEntries(CHAMPS_PLATEFORME.filter((c) => (parCle[c.cle] ?? '').trim() !== '').map((c) => [c.champ, parCle[c.cle]]));
}

/** Les lignes à afficher sur la page publique : celles qui sont renseignées, dans l'ordre, SIREN mis en forme. Rien n'est inventé pour les autres. */
export function lignesPlateforme(valeurs: Record<string, string>): { libelle: string; valeur: string; long: boolean }[] {
  return CHAMPS_PLATEFORME.filter((c) => (valeurs[c.champ] ?? '').trim() !== '').map((c) => ({
    libelle: c.libelle,
    valeur: c.type === 'siren' ? afficherSiren(valeurs[c.champ]) : valeurs[c.champ],
    long: !!c.long,
  }));
}

/** Les libellés des champs non renseignés : ce que la console signale à l'éditeur avant une livraison. */
export const identitePlateformeManquante = (valeurs: Record<string, string>): string[] =>
  CHAMPS_PLATEFORME.filter((c) => (valeurs[c.champ] ?? '').trim() === '').map((c) => c.libelle);

const net = (v: unknown, long: boolean): string => {
  const t = typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '';
  return long ? t : t.replace(/\s+/g, ' ');
};

/** Valide un formulaire : valeurs nettoyées (par `champ`) et erreurs. Un champ vide est permis (il se retire). */
export function validerIdentitePlateforme(f: FormData): { valeurs: Record<string, string>; erreurs: Record<string, string> } {
  const valeurs: Record<string, string> = {};
  const erreurs: Record<string, string> = {};
  for (const c of CHAMPS_PLATEFORME) {
    let v = net(f.get(c.champ), !!c.long);
    if (v.length > c.max) erreurs[c.champ] = `${c.max} caractères au plus.`;
    else if (v !== '' && c.type === 'siren') {
      const e = erreurSiren(v);
      if (e) erreurs[c.champ] = MESSAGES_SIREN[e];
      else v = normaliserSiren(v);
    } else if (v !== '' && c.type === 'email' && !EMAIL.test(v)) erreurs[c.champ] = 'Adresse e-mail invalide.';
    valeurs[c.champ] = v;
  }
  return { valeurs, erreurs };
}

export type ResultatPlateforme = { ok: true } | { ok: false; code: 'interdit' } | { ok: false; code: 'invalide'; erreurs: Record<string, string> };

/** Enregistre l'identité (tout ou rien). Éditeur seulement : le rôle est contrôlé ICI, pas seulement par la route. Une valeur vide retire la ligne. */
export async function poserIdentitePlateforme(db: Base, f: FormData, acteur: Acteur): Promise<ResultatPlateforme> {
  if (acteur.role !== 'editeur') return { ok: false, code: 'interdit' };
  const { valeurs, erreurs } = validerIdentitePlateforme(f);
  if (Object.keys(erreurs).length) return { ok: false, code: 'invalide', erreurs };
  const now = new Date().toISOString();
  await db.batch(
    CHAMPS_PLATEFORME.map((c) =>
      valeurs[c.champ] === ''
        ? db.prepare('DELETE FROM reglage_editeur WHERE cle = ?').bind(c.cle)
        : db
            .prepare('INSERT INTO reglage_editeur (cle, valeur, maj_le, par) VALUES (?, ?, ?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le, par = excluded.par')
            .bind(c.cle, valeurs[c.champ], now, acteur.id),
    ),
  );
  return { ok: true };
}
