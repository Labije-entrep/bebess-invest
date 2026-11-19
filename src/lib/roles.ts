// Les rôles (lot 11) : une seule table de vérité pour « qui peut quoi ». Tout garde de route, requête de suspension ou liste
// d'accès part d'ici : aucune route ne compare plus un rôle à une chaîne écrite en dur.
//
//   editeur          la console /admin. Hébergé dans un cabinet à lui ; jamais compté.
//   associe          le personnel du cabinet, tous les droits, y compris les réglages et l'abonnement (lot 13).
//   collaborateur    les droits de l'ancien « gestionnaire », sans les réglages ni l'abonnement.
//   lecture          voit ce que voit un collaborateur ; n'écrit rien.
//   support_editeur  le compte de support de l'éditeur, présent dans chaque cabinet. Se comporte comme un associe ;
//                    jamais compté, jamais affiché dans la liste des accès du cabinet, jamais dans son export.
//   viewer           le client final : /espace seulement.

import type { Role } from './db';

/** Écrit dans le cabinet : les droits de l'ancien gestionnaire. */
export const CABINET_ECRIT: Role[] = ['associe', 'collaborateur', 'support_editeur'];
/** Lit ce que lit le personnel du cabinet. */
export const CABINET_LIT: Role[] = [...CABINET_ECRIT, 'lecture'];
/** Les routes que l'éditeur partageait déjà avec le gestionnaire (API du suivi, fichiers, passerelle) : il y reste admis. */
export const GESTION_ECRIT: Role[] = [...CABINET_ECRIT, 'editeur'];
export const GESTION_LIT: Role[] = [...CABINET_LIT, 'editeur'];
/** Les réglages : l'associé, et le support qui se comporte comme lui. */
export const REGLAGES: Role[] = ['associe', 'support_editeur'];
/**
 * « Mon abonnement » (lot 13) : l'associé SEUL, support de l'éditeur compris. La page est dans les réglages, dont la garde laisse
 * entrer le support : c'est la page qui le refuse, par un 404. Le support n'y est jamais compté ni affiché non plus.
 */
export const ABONNEMENT: Role[] = ['associe'];

/**
 * L'export COMPLET d'un cabinet : la situation patrimoniale de tous ses clients en un fichier. L'associé le tire depuis son espace ;
 * l'éditeur depuis la console. Ni collaborateur, ni lecture, ni le support (qui se comporte comme un associé ailleurs, pas ici).
 */
export const EXPORT_COMPLET_CABINET: Role[] = ['associe'];
export const EXPORT_COMPLET_EDITEUR: Role[] = ['editeur'];
export const EXPORT_COMPLET: Role[] = [...EXPORT_COMPLET_CABINET, ...EXPORT_COMPLET_EDITEUR];

/** Les accès du cabinet : ce qui s'affiche dans sa liste et se compte. Ni le support, ni l'éditeur, ni les viewers. */
export const ACCES_CABINET: Role[] = ['associe', 'collaborateur', 'lecture'];
/** Parmi eux, ceux qui entrent dans le calcul du prix (lot 12) : `lecture` n'est jamais facturé. */
export const ACCES_FACTURABLES: Role[] = ['associe', 'collaborateur'];
/**
 * L'essai non converti (lot 12), à J+45 : le cabinet ET les espaces de ses clients finaux se ferment. Sont coupés ici, dès la
 * connexion : les viewers et le personnel sauf l'associé. L'associé garde UNE route (EXPORT_ESSAI_ECHU) : l'export de ses données,
 * qui reste ouvert jusqu'à la suppression de J+75. Ce mécanisme est l'OPPOSÉ de la suspension commerciale d'un cabinet sous contrat
 * (admin.ts), qui coupe le personnel et laisse les viewers en ligne : ne jamais les fusionner.
 */
export const ESSAI_ECHU_COUPES: Role[] = [...ACCES_CABINET.filter((r) => !EXPORT_COMPLET_CABINET.includes(r)), 'viewer'];
export const EXPORT_ESSAI_ECHU = '/gestionnaire/export/locataire';

/** Les comptes de l'éditeur : chacun de leurs accès aux données d'un cabinet est journalisé. */
export const COMPTES_EDITEUR: Role[] = ['editeur', 'support_editeur'];

export const aLeRole = (role: Role | undefined | null, parmi: readonly Role[]): boolean => !!role && parmi.includes(role);

/**
 * Liste de rôles pour une clause SQL « IN (…) ». Seules des constantes de ce fichier y passent : jamais une saisie.
 */
export const enSql = (roles: readonly Role[]): string => roles.map((r) => `'${r}'`).join(', ');

/** Un accès de cabinet se crée avec ces rôles ; support_editeur seulement par l'éditeur ou son support. */
export function roleCreable(acteur: { role: string } | null, role: Role): boolean {
  if (ACCES_CABINET.includes(role)) return true;
  return role === 'support_editeur' && (acteur === null || COMPTES_EDITEUR.includes(acteur.role as Role));
}
