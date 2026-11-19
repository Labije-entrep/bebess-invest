// Écran des listes de référence (lot 09) : ajouter, renommer, réordonner, désactiver, poser les marqueurs.
//
// - La clé d'une valeur ne change jamais : c'est elle que portent les enregistrements. On renomme le libellé.
// - Une valeur utilisée ne se supprime jamais, elle se désactive : elle disparaît des choix mais reste lisible sur les fiches
//   anciennes. Seule une valeur que rien ne porte peut être supprimée.
// - Le drapeau `terminal` et les marqueurs se posent ici ; le code ne connaît aucune clé (src/lib/marqueurs.ts).
// - Toute requête est bornée au locataire ; le SQL des usages vient d'une table fermée, jamais de la saisie.

import type { Base, Requete } from './db';
import { texte, type Erreurs } from './gestion';
import type { Liste } from './listes-defaut';
import { marqueursDeLaListe, type DefMarqueur } from './marqueurs';
import { incrementerVersion } from './version';

export interface InfoListe {
  id: Liste;
  titre: string;
  /** Où la liste sert. */
  sert: string;
  /** Le drapeau « terminal », en une phrase, liste par liste. */
  terminal: string;
  /** Peut-on poser le drapeau terminal sur cette liste ? */
  terminable: boolean;
}

const SANS_TERMINAL = 'Le drapeau « terminal » ne sert pas sur cette liste.';

export const LISTES: InfoListe[] = [
  {
    id: 'statut_sujet', titre: 'Statuts des sujets', sert: 'Colonnes du kanban, statut d’un sujet sur la fiche, indicateurs du suivi.', terminable: true,
    terminal: 'Terminal : le sujet qui porte ce statut est clos, c’est-à-dire qu’il n’est plus compté parmi les sujets ouverts et qu’il date sa clôture.',
  },
  {
    id: 'etape', titre: 'Étapes de prospection', sert: 'Colonnes du parcours, étape d’un prospect sur la fiche.', terminable: true,
    terminal: 'Terminal : l’étape est une sortie du parcours, elle passe en dernier, en retrait, et un prospect qui s’y trouve n’avance plus.',
  },
  { id: 'type_contact', titre: 'Types de contact', sert: 'Types d’un contact (client, prospect, prescripteur…), pastilles de la liste du suivi, parcours.', terminable: false, terminal: SANS_TERMINAL },
  { id: 'metier', titre: 'Métiers', sert: 'Métier d’un contact.', terminable: false, terminal: SANS_TERMINAL },
  { id: 'type_echange', titre: 'Types d’échange', sert: 'Type d’un échange journalisé (rendez-vous, appel, e-mail…).', terminable: false, terminal: SANS_TERMINAL },
  { id: 'categorie_doc', titre: 'Catégories de document', sert: 'Rapports des viewers et bibliothèque interne.', terminable: false, terminal: SANS_TERMINAL },
  { id: 'classe_actif', titre: 'Classes d’actifs', sert: 'Lignes des enveloppes, allocation cible, répartition de l’espace client.', terminable: false, terminal: SANS_TERMINAL },
  { id: 'statut_mouvement', titre: 'Statuts de mouvement', sert: 'Mouvements affichés dans l’espace client.', terminable: false, terminal: SANS_TERMINAL },
  { id: 'type_portefeuille', titre: 'Types de portefeuille', sert: 'Personne, holding, SCI… : le type d’un portefeuille de viewer.', terminable: false, terminal: SANS_TERMINAL },
];

export const listeConnue = (v: string): InfoListe | undefined => LISTES.find((l) => l.id === v);

/**
 * Où une valeur de liste est portée : une requête par table qui la référence, chacune bornée au locataire (un seul « ? »)
 * et rendant (cle, n). Table fermée : aucune de ces requêtes n'est construite à partir de la saisie.
 */
const USAGES: Record<Liste, string[]> = {
  type_contact: ['SELECT type AS cle, COUNT(*) AS n FROM contact_type WHERE tenant_id = ? GROUP BY type'],
  metier: ['SELECT metier AS cle, COUNT(*) AS n FROM contact WHERE tenant_id = ? AND metier IS NOT NULL GROUP BY metier'],
  etape: ['SELECT etape AS cle, COUNT(*) AS n FROM contact WHERE tenant_id = ? AND etape IS NOT NULL GROUP BY etape'],
  type_echange: [
    'SELECT type AS cle, COUNT(*) AS n FROM echange WHERE tenant_id = ? GROUP BY type',
    'SELECT type_echange AS cle, COUNT(*) AS n FROM contact WHERE tenant_id = ? AND type_echange IS NOT NULL GROUP BY type_echange',
  ],
  statut_sujet: ['SELECT statut AS cle, COUNT(*) AS n FROM sujet WHERE tenant_id = ? GROUP BY statut'],
  categorie_doc: [
    'SELECT d.categorie AS cle, COUNT(*) AS n FROM document d JOIN utilisateur u ON u.id = d.viewer_id WHERE u.tenant_id = ? GROUP BY d.categorie',
    'SELECT categorie AS cle, COUNT(*) AS n FROM document_interne WHERE tenant_id = ? GROUP BY categorie',
  ],
  classe_actif: [
    `SELECT l.classe AS cle, COUNT(*) AS n FROM ligne l JOIN enveloppe e ON e.id = l.enveloppe_id
       JOIN portefeuille p ON p.id = e.portefeuille_id WHERE p.tenant_id = ? GROUP BY l.classe`,
    'SELECT c.classe AS cle, COUNT(*) AS n FROM cible c JOIN portefeuille p ON p.id = c.portefeuille_id WHERE p.tenant_id = ? GROUP BY c.classe',
  ],
  statut_mouvement: ['SELECT m.statut AS cle, COUNT(*) AS n FROM mouvement m JOIN utilisateur u ON u.id = m.viewer_id WHERE u.tenant_id = ? GROUP BY m.statut'],
  type_portefeuille: ['SELECT type AS cle, COUNT(*) AS n FROM portefeuille WHERE tenant_id = ? GROUP BY type'],
};

export async function usagesDe(db: Base, tenantId: string, liste: Liste): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const sql of USAGES[liste]) {
    const { results } = await db.prepare(sql).bind(tenantId).all<{ cle: string; n: number }>();
    for (const r of results) out.set(r.cle, (out.get(r.cle) ?? 0) + r.n);
  }
  return out;
}

export interface ValeurAdmin {
  cle: string;
  libelle: string;
  ordre: number;
  actif: number;
  terminal: number;
  marqueur: string | null;
  /** Nombre d'enregistrements qui portent la valeur. */
  usages: number;
}

/** Toutes les valeurs d'une liste, actives ou non, dans l'ordre d'affichage. */
export async function valeursAdmin(db: Base, tenantId: string, liste: Liste): Promise<ValeurAdmin[]> {
  const { results } = await db
    .prepare(
      `SELECT cle, libelle, ordre, actif, terminal, marqueur FROM liste_valeur
        WHERE tenant_id = ? AND liste = ? ORDER BY ordre, cle`,
    )
    .bind(tenantId, liste)
    .all<Omit<ValeurAdmin, 'usages'>>();
  const usages = await usagesDe(db, tenantId, liste);
  return results.map((r) => ({ ...r, usages: usages.get(r.cle) ?? 0 }));
}

/** Marqueurs de la liste qu'aucune valeur ACTIVE ne porte : l'écran le dit, avec la conséquence. */
export function marqueursManquants(valeurs: ValeurAdmin[], liste: Liste): DefMarqueur[] {
  return marqueursDeLaListe(liste).filter((d) => !valeurs.some((v) => v.actif === 1 && v.marqueur === d.id));
}

// ---------------------------------------------------------------- écritures

const slug = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/**
 * Enregistre toutes les valeurs de la liste d'un coup (libellé, actif, terminal, marqueur), puis exécute le déplacement
 * demandé (`deplacer` = « monter:<cle> » ou « descendre:<cle> »). Les champs sont lus par rang (l0_cle, l0_libelle…) :
 * la clé de chaque rang doit être une valeur de CETTE liste, de CE locataire.
 */
export async function enregistrerListe(db: Base, tenantId: string, liste: Liste, f: FormData): Promise<Erreurs> {
  const info = listeConnue(liste);
  if (!info) return { general: 'Liste inconnue.' };
  const valeurs = await valeursAdmin(db, tenantId, liste);
  const parCle = new Map(valeurs.map((v) => [v.cle, v]));
  const defs = marqueursDeLaListe(liste);
  const e: Erreurs = {};
  const maj: { cle: string; libelle: string; actif: number; terminal: number; marqueur: string | null }[] = [];

  for (let i = 0; f.has(`l${i}_cle`); i++) {
    const cle = texte(f.get(`l${i}_cle`), 64);
    const ancien = parCle.get(cle);
    if (!ancien) {
      e[`l${i}`] = 'Valeur inconnue pour cette liste.';
      continue;
    }
    const libelle = texte(f.get(`l${i}_libelle`), 120);
    if (libelle === '' || libelle.length > 80) {
      e[`l${i}`] = 'Un libellé de 1 à 80 caractères est requis.';
      continue;
    }
    const marqueur = texte(f.get(`l${i}_marqueur`), 30);
    if (marqueur !== '' && !defs.some((d) => d.id === marqueur)) {
      e[`l${i}`] = 'Marqueur inconnu pour cette liste.';
      continue;
    }
    maj.push({
      cle,
      libelle,
      actif: f.get(`l${i}_actif`) === '1' ? 1 : 0,
      // Le drapeau terminal n'existe que sur les listes où il a un sens : ailleurs, ce qui est déjà en base est conservé tel quel.
      terminal: info.terminable ? (f.get(`l${i}_terminal`) === '1' ? 1 : 0) : ancien.terminal,
      marqueur: marqueur === '' ? null : marqueur,
    });
  }

  // Un marqueur « unique » ne se pose que sur une valeur.
  for (const d of defs.filter((x) => x.unique)) {
    const porteurs = maj.filter((m) => m.marqueur === d.id);
    if (porteurs.length > 1) e.general = `Le marqueur « ${d.libelle} » ne peut être posé que sur une seule valeur.`;
  }
  if (Object.keys(e).length) return e;

  // Déplacement : on échange la valeur avec sa voisine dans l'ordre actuel, puis on renumérote de 1 à n.
  const ordre = [...valeurs].map((v) => v.cle);
  const [sens, cible] = texte(f.get('deplacer'), 80).split(':');
  const i = ordre.indexOf(cible ?? '');
  if ((sens === 'monter' || sens === 'descendre') && i >= 0) {
    const j = sens === 'monter' ? i - 1 : i + 1;
    if (j >= 0 && j < ordre.length) [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
  }

  const q: Requete[] = maj.map((m) =>
    db
      .prepare('UPDATE liste_valeur SET libelle = ?, actif = ?, terminal = ?, marqueur = ?, ordre = ? WHERE tenant_id = ? AND liste = ? AND cle = ?')
      .bind(m.libelle, m.actif, m.terminal, m.marqueur, ordre.indexOf(m.cle) + 1, tenantId, liste, m.cle),
  );
  await db.batch(q);
  await incrementerVersion(db, tenantId);
  return {};
}

/** Ajoute une valeur à la fin de la liste. La clé vient du libellé (jamais saisie) et reste unique dans la liste. */
export async function ajouterValeur(db: Base, tenantId: string, liste: Liste, f: FormData): Promise<Erreurs> {
  const libelle = texte(f.get('nouveau_libelle'), 120);
  if (libelle === '' || libelle.length > 80) return { nouveau: 'Un libellé de 1 à 80 caractères est requis.' };
  const base = slug(libelle);
  if (base === '') return { nouveau: 'Le libellé doit contenir au moins une lettre ou un chiffre.' };
  const prises = new Set((await valeursAdmin(db, tenantId, liste)).map((v) => v.cle));
  let cle = base;
  for (let n = 2; prises.has(cle); n++) cle = `${base.slice(0, 36)}_${n}`;
  await db
    .prepare(
      `INSERT INTO liste_valeur (tenant_id, liste, cle, libelle, ordre, actif, terminal, marqueur)
       VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(ordre) FROM liste_valeur WHERE tenant_id = ? AND liste = ?), 0) + 1, 1, 0, NULL)`,
    )
    .bind(tenantId, liste, cle, libelle, tenantId, liste)
    .run();
  await incrementerVersion(db, tenantId);
  return {};
}

/** Supprime une valeur que rien ne porte. Une valeur utilisée se désactive : jamais de suppression qui laisserait des fiches sans libellé. */
export async function supprimerValeur(db: Base, tenantId: string, liste: Liste, f: FormData): Promise<Erreurs> {
  const cle = texte(f.get('cle'), 64);
  const v = (await valeursAdmin(db, tenantId, liste)).find((x) => x.cle === cle);
  if (!v) return { general: 'Valeur inconnue pour cette liste.' };
  if (v.usages > 0) {
    return { general: `« ${v.libelle} » est utilisée ${v.usages} fois : elle ne se supprime pas, désactivez-la (elle disparaît des choix et reste lisible sur les fiches existantes).` };
  }
  await db.prepare('DELETE FROM liste_valeur WHERE tenant_id = ? AND liste = ? AND cle = ?').bind(tenantId, liste, cle).run();
  await incrementerVersion(db, tenantId);
  return {};
}
