// Réglages d'un cabinet (lot 09) : seuils, identité, mentions légales, symboles de marché, membres de l'équipe.
// Les listes de référence ont leur propre fichier (listes-admin.ts). Tout est borné au locataire ; toute valeur passe par
// bind() ; une valeur vide retire le réglage et laisse revenir la valeur par défaut.
//
// Clés de `reglage` utilisées par le lot : theme, nom_affiche, logo_cle, symboles, seuil_sans_echange, seuil_relance,
// seuil_arrete, seuil_ecart_bp, et les mentions légales (raison_sociale, orias, statut_reglementaire, association, mediateur,
// hebergeur, contact_rgpd).

import type { Base, Requete } from './db';
import { REPLI_ECART_BP } from './fiche';
import { lireBp, maintenant, nouvelId, texte, type Erreurs } from './gestion';
import { SYMBOLES_DEFAUT, symbolesDe, type SymboleSuivi, type TypeSymbole } from './cours';
import { THEMES } from './themes';
import { incrementerVersion } from './version';
import { REPLI } from './suivi';

// ---------------------------------------------------------------- lecture / écriture d'un réglage

export async function reglagesDe(db: Base, tenantId: string, cles: readonly string[]): Promise<Record<string, string>> {
  const { results } = await db
    .prepare(`SELECT cle, valeur FROM reglage WHERE tenant_id = ? AND cle IN (${cles.map(() => '?').join(', ')})`)
    .bind(tenantId, ...cles)
    .all<{ cle: string; valeur: string }>();
  return Object.fromEntries(results.map((r) => [r.cle, r.valeur]));
}

/** Pose le réglage, ou le retire si la valeur est vide (retour à la valeur par défaut). */
function poser(db: Base, tenantId: string, cle: string, valeur: string): Requete {
  return valeur === ''
    ? db.prepare('DELETE FROM reglage WHERE tenant_id = ? AND cle = ?').bind(tenantId, cle)
    : db
        .prepare('INSERT INTO reglage (tenant_id, cle, valeur) VALUES (?, ?, ?) ON CONFLICT (tenant_id, cle) DO UPDATE SET valeur = excluded.valeur')
        .bind(tenantId, cle, valeur);
}

// ---------------------------------------------------------------- seuils

export interface DefSeuil {
  cle: string;
  champ: string;
  libelle: string;
  unite: string;
  /** Valeur par défaut, dans l'unité de stockage (jours, ou centièmes de point pour l'écart). */
  defaut: number;
  centiemes: boolean;
  aide: string;
}

export const SEUILS: DefSeuil[] = [
  {
    cle: 'seuil_sans_echange', champ: 'sans_echange', libelle: 'Sans échange depuis', unite: 'jours', defaut: REPLI.sans_echange, centiemes: false,
    aide: 'Un contact sans échange depuis ce nombre de jours (ou sans aucun échange) est compté par l’indicateur « Sans échange » du suivi.',
  },
  {
    cle: 'seuil_relance', champ: 'relance', libelle: 'À rappeler sous', unite: 'jours', defaut: REPLI.relance, centiemes: false,
    aide: 'Une relance prévue dans ce délai, ou déjà dépassée, est comptée par l’indicateur « À rappeler » du suivi.',
  },
  {
    cle: 'seuil_arrete', champ: 'arrete', libelle: 'Arrêté périmé au-delà de', unite: 'jours', defaut: REPLI.arrete, centiemes: false,
    aide: 'Au-delà, la date d’arrêté d’un portefeuille passe en rouge, le tableau de bord le signale et la fiche propose un sujet.',
  },
  {
    cle: 'seuil_ecart_bp', champ: 'ecart', libelle: 'Écart d’allocation au-delà de', unite: 'points de pourcentage', defaut: REPLI_ECART_BP, centiemes: true,
    aide: 'Une classe dont la part réelle s’écarte de sa cible de plus que cela est signalée sur la fiche, qui propose un sujet.',
  },
];

/** Valeur saisie à afficher : jours tels quels, centièmes de point en points avec virgule. */
export function formSeuil(d: DefSeuil, n: number): string {
  return d.centiemes ? String(n / 100).replace('.', ',') : String(n);
}

export async function seuilsSaisis(db: Base, tenantId: string): Promise<Record<string, string>> {
  const lu = await reglagesDe(db, tenantId, SEUILS.map((s) => s.cle));
  return Object.fromEntries(SEUILS.map((s) => [s.champ, /^\d+$/.test((lu[s.cle] ?? '').trim()) && Number(lu[s.cle]) > 0 ? formSeuil(s, Number(lu[s.cle])) : '']));
}

export async function enregistrerSeuils(db: Base, tenantId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const q: Requete[] = [];
  for (const s of SEUILS) {
    const v = texte(f.get(s.champ), 12);
    if (v === '') {
      q.push(poser(db, tenantId, s.cle, ''));
      continue;
    }
    if (s.centiemes) {
      const bp = lireBp(v);
      if (bp === null || bp < 1 || bp > 10000) e[s.champ] = 'Un nombre de points entre 0,01 et 100, avec virgule (ex. 5 ou 2,5).';
      else q.push(poser(db, tenantId, s.cle, String(bp)));
    } else if (!/^\d{1,4}$/.test(v) || Number(v) < 1) e[s.champ] = 'Un nombre entier de jours, de 1 à 9999.';
    else q.push(poser(db, tenantId, s.cle, String(Number(v))));
  }
  if (Object.keys(e).length) return e;
  await db.batch(q);
  await incrementerVersion(db, tenantId); // le module de suivi relit les seuils dans /api/suivi/etat
  return {};
}

// ---------------------------------------------------------------- mentions légales

export interface DefMention {
  cle: string;
  libelle: string;
  /** Intitulé sur le site public, en français et en anglais : fixé ici, jamais saisi. */
  fr: string;
  en: string;
  long: boolean;
  max: number;
  aide?: string;
}

export const MENTIONS: DefMention[] = [
  { cle: 'raison_sociale', libelle: 'Raison sociale', fr: 'Raison sociale', en: 'Company name', long: false, max: 200 },
  { cle: 'orias', libelle: 'Numéro ORIAS', fr: 'Numéro ORIAS', en: 'ORIAS number', long: false, max: 40 },
  {
    cle: 'statut_reglementaire', libelle: 'Statut réglementaire', fr: 'Statut réglementaire', en: 'Regulatory status', long: true, max: 800,
    aide: 'Par exemple les qualités exercées et l’autorité de contrôle.',
  },
  { cle: 'association', libelle: 'Association agréée', fr: 'Association agréée', en: 'Approved association', long: true, max: 800 },
  { cle: 'mediateur', libelle: 'Médiateur', fr: 'Médiateur', en: 'Mediator', long: true, max: 800 },
  { cle: 'hebergeur', libelle: 'Hébergeur', fr: 'Hébergeur', en: 'Hosting provider', long: true, max: 800 },
  {
    cle: 'contact_rgpd', libelle: 'Contact RGPD', fr: 'Données personnelles : contact', en: 'Personal data: contact', long: true, max: 800,
    aide: 'L’adresse ou le service à qui s’adresser pour exercer ses droits sur ses données.',
  },
];

/** Mentions renseignées (valeurs non vides), par clé. */
export async function mentionsDe(db: Base, tenantId: string): Promise<Record<string, string>> {
  const lu = await reglagesDe(db, tenantId, MENTIONS.map((m) => m.cle));
  return Object.fromEntries(Object.entries(lu).filter(([, v]) => v.trim() !== ''));
}

export async function enregistrerMentions(db: Base, tenantId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const q: Requete[] = [];
  for (const m of MENTIONS) {
    const v = String(f.get(m.cle) ?? '').replace(/\r\n?/g, '\n').trim();
    if (v.length > m.max) e[m.cle] = `${m.max} caractères au plus.`;
    else q.push(poser(db, tenantId, m.cle, v));
  }
  if (Object.keys(e).length) return e;
  await db.batch(q);
  return {};
}

// ---------------------------------------------------------------- identité

export async function identiteDe(db: Base, tenantId: string): Promise<{ nom_affiche: string; theme: string }> {
  const lu = await reglagesDe(db, tenantId, ['nom_affiche', 'theme']);
  return { nom_affiche: lu.nom_affiche ?? '', theme: lu.theme ?? '' };
}

export async function enregistrerIdentite(db: Base, tenantId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const nom = texte(f.get('nom_affiche'), 81);
  if (nom.length > 80) e.nom_affiche = '80 caractères au plus.';
  // Le thème est un NOM de la liste fermée de themes.ts, jamais une valeur : tout autre choix est refusé.
  const theme = texte(f.get('theme'), 30);
  if (!THEMES.some((t) => t.id === theme)) e.theme = 'Choisissez l’un des thèmes proposés.';
  if (Object.keys(e).length) return e;
  await db.batch([poser(db, tenantId, 'nom_affiche', nom), poser(db, tenantId, 'theme', theme)]);
  return {};
}

// ---------------------------------------------------------------- symboles de marché suivis

export const TYPES_SYMBOLE: [TypeSymbole, string][] = [
  ['cotation', 'Titre ou fonds coté'],
  ['change', 'Paire de devises'],
  ['matiere', 'Matière première'],
];
export const SYMBOLES_MAX = 50;

/** Symboles tels que le cabinet les a réglés, ou ceux par défaut ; `personnalise` dit lequel des deux. */
export async function symbolesReglage(db: Base, tenantId: string): Promise<{ symboles: SymboleSuivi[]; personnalise: boolean }> {
  // symbolesDe (cours.ts) est la seule lecture qui décide ce qui est suivi : on s'y fie, son repli aussi.
  const s = await symbolesDe(db, tenantId);
  return { symboles: s, personnalise: s !== SYMBOLES_DEFAUT };
}

const slug = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);

export async function enregistrerSymboles(db: Base, tenantId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const out: SymboleSuivi[] = [];
  const pris = new Set<string>();
  for (let i = 0; i < SYMBOLES_MAX + 5; i++) {
    if (!f.has(`s${i}_libelle`)) break;
    const libelle = texte(f.get(`s${i}_libelle`), 200);
    const source = texte(f.get(`s${i}_source`), 80);
    const typeS = texte(f.get(`s${i}_type`), 20);
    const cleSaisie = texte(f.get(`s${i}_cle`), 40);
    if (libelle === '' && source === '' && cleSaisie === '') continue; // ligne vide : retirée
    if (libelle === '' || libelle.length > 80) e[`s${i}`] = 'Un libellé de 1 à 80 caractères est requis.';
    else if (!/^[A-Za-z0-9_./-]{1,40}$/.test(source)) e[`s${i}`] = 'Symbole du fournisseur : lettres, chiffres, point, tiret, barre oblique (40 au plus).';
    else if (!TYPES_SYMBOLE.some(([t]) => t === typeS)) e[`s${i}`] = 'Type inconnu.';
    else {
      // L'identifiant d'un symbole existant ne change jamais (c'est la clé des cours déjà récupérés) ; celui d'un nouveau vient du libellé.
      let cle = cleSaisie;
      if (cle === '') {
        const base = slug(libelle) || 'symbole';
        cle = base;
        for (let n = 2; pris.has(cle); n++) cle = `${base.slice(0, 28)}_${n}`;
      }
      if (!/^[A-Za-z0-9_.-]{1,32}$/.test(cle)) e[`s${i}`] = 'Identifiant invalide.';
      else if (pris.has(cle)) e[`s${i}`] = 'Deux lignes portent le même identifiant.';
      else {
        pris.add(cle);
        out.push({ cle, libelle, type: typeS as TypeSymbole, source });
      }
    }
  }
  if (out.length === 0 && Object.keys(e).length === 0) e.general = 'Au moins un symbole est nécessaire ; sinon, rétablissez les symboles par défaut.';
  if (out.length > SYMBOLES_MAX) e.general = `${SYMBOLES_MAX} symboles au plus.`;
  if (Object.keys(e).length) return e;
  await poser(db, tenantId, 'symboles', JSON.stringify(out)).run();
  return {};
}

export async function symbolesParDefaut(db: Base, tenantId: string): Promise<void> {
  await poser(db, tenantId, 'symboles', '').run();
}

// ---------------------------------------------------------------- membres de l'équipe

/** La palette des graphiques : un membre prend l'une de ces couleurs, jamais une valeur libre. */
export const PALETTE_MEMBRES = ['serie-1', 'serie-2', 'serie-3', 'serie-4', 'serie-5'] as const;

export interface MembreAdmin {
  id: string;
  nom: string;
  initiale: string;
  couleur: string;
  actif: number;
}

export async function membresAdmin(db: Base, tenantId: string): Promise<MembreAdmin[]> {
  const { results } = await db
    .prepare('SELECT id, nom, initiale, couleur, actif FROM membre WHERE tenant_id = ? ORDER BY actif DESC, nom, id')
    .bind(tenantId)
    .all<MembreAdmin>();
  return results;
}

const couleurDePalette = (v: string): boolean => (PALETTE_MEMBRES as readonly string[]).includes(v);
const initialeDe = (saisie: string, nom: string): string => (saisie || nom.charAt(0)).toLocaleUpperCase('fr').slice(0, 2);

/** Enregistre tous les membres d'un coup. Un membre ne se supprime pas (des fiches s'y réfèrent) : il se désactive. */
export async function enregistrerMembres(db: Base, tenantId: string, f: FormData): Promise<Erreurs> {
  const e: Erreurs = {};
  const existants = new Map((await membresAdmin(db, tenantId)).map((m) => [m.id, m]));
  const q: Requete[] = [];
  for (let i = 0; f.has(`m${i}_id`); i++) {
    const id = texte(f.get(`m${i}_id`), 64);
    const ancien = existants.get(id);
    if (!ancien) {
      e[`m${i}`] = 'Membre inconnu.';
      continue;
    }
    const nom = texte(f.get(`m${i}_nom`), 120);
    const couleur = texte(f.get(`m${i}_couleur`), 20);
    // Une couleur plus ancienne (littérale) reste admise tant qu'on ne la change pas ; sinon, uniquement la palette.
    if (nom === '') e[`m${i}`] = 'Le nom est requis.';
    else if (!couleurDePalette(couleur) && couleur !== ancien.couleur) e[`m${i}`] = 'Choisissez une couleur de la palette.';
    else {
      q.push(
        db
          .prepare('UPDATE membre SET nom = ?, initiale = ?, couleur = ?, actif = ? WHERE id = ? AND tenant_id = ?')
          .bind(nom, initialeDe(texte(f.get(`m${i}_initiale`), 4), nom), couleur, f.get(`m${i}_actif`) === '1' ? 1 : 0, id, tenantId),
      );
    }
  }
  if (Object.keys(e).length) return e;
  if (q.length) {
    await db.batch(q);
    await incrementerVersion(db, tenantId);
  }
  return {};
}

export async function ajouterMembre(db: Base, tenantId: string, f: FormData): Promise<Erreurs> {
  const nom = texte(f.get('nouveau_nom'), 120);
  const couleur = texte(f.get('nouveau_couleur'), 20);
  if (nom === '') return { nouveau: 'Le nom est requis.' };
  if (!couleurDePalette(couleur)) return { nouveau: 'Choisissez une couleur de la palette.' };
  await db
    .prepare('INSERT INTO membre (id, tenant_id, nom, initiale, couleur, actif, cree_le) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .bind(nouvelId(), tenantId, nom, initialeDe(texte(f.get('nouveau_initiale'), 4), nom), couleur, maintenant())
    .run();
  await incrementerVersion(db, tenantId);
  return {};
}
