// Le SIREN (lot 13) : neuf chiffres, dont le dernier est une clé de contrôle (algorithme de Luhn). Fonction PURE : aucune base.
//
// Un SIREN se saisit avec ou sans espaces (« 443 061 841 ») ; il se range sans (« 443061841 »). Vide, il est permis : un cabinet se
// crée sans SIREN, et c'est le bon à facturer qui le signale (facturation.ts). Rempli, il doit être juste.

/** Les neuf chiffres, sans espace ni point : ce que la base range. */
export const normaliserSiren = (brut: string): string => brut.replace(/[\s.  ]/g, '');

/** Clé de Luhn : en partant de la droite, un chiffre sur deux est doublé (moins 9 s'il dépasse 9) ; la somme est un multiple de 10. */
export function luhn(chiffres: string): boolean {
  let somme = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let d = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    somme += d;
  }
  return somme % 10 === 0;
}

export type CodeSiren = 'format' | 'cle';

/** `null` : le SIREN est juste. Sinon la raison du refus. */
export function erreurSiren(brut: string): CodeSiren | null {
  const s = normaliserSiren(brut);
  if (!/^\d{9}$/.test(s)) return 'format';
  return luhn(s) ? null : 'cle';
}

export const sirenValide = (brut: string): boolean => erreurSiren(brut) === null;

export const MESSAGES_SIREN: Record<CodeSiren, string> = {
  format: 'SIREN invalide : il compte neuf chiffres.',
  cle: 'SIREN invalide : la clé de contrôle (le dernier chiffre) ne correspond pas.',
};

/** 443061841 → « 443 061 841 », pour l'affichage et le bon. */
export const afficherSiren = (siren: string): string => siren.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
