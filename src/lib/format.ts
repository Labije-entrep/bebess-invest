// Formats d'affichage en français. Tout part de chaînes ISO et d'entiers :
// aucun flottant pour l'argent, aucun objet Date.

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const NBSP = ' ';
const NNBSP = ' ';

function groupes(entier: number): string {
  // Séparateur de milliers : espace fine insécable, comme fr-FR.
  return String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

/** 123456 -> "1 235 €" ; 5090 -> "50,90 €". Pas de décimale au-dessus de 1 000 €. */
export function euros(cents: number): string {
  const signe = cents < 0 ? '−' : '';
  const abs = Math.abs(Math.trunc(cents));
  if (abs > 100000) {
    return `${signe}${groupes(Math.floor((abs + 50) / 100))}${NBSP}€`;
  }
  const entier = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${signe}${groupes(entier)},${frac}${NBSP}€`;
}

/** 160200 -> "1 602,00 €" : toujours les centimes. Pour un bon ou un détail de facture, où l'arrondi à l'euro de `euros` serait faux. */
export function eurosPrecis(cents: number): string {
  const signe = cents < 0 ? '−' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${signe}${groupes(Math.floor(abs / 100))},${String(abs % 100).padStart(2, '0')}${NBSP}€`;
}

/** 640 -> "6,40 %". */
export function pourcent(bp: number): string {
  const signe = bp < 0 ? '−' : '';
  const abs = Math.abs(Math.trunc(bp));
  const frac = String(abs % 100).padStart(2, '0');
  return `${signe}${Math.floor(abs / 100)},${frac}${NNBSP}%`;
}

function parties(iso: string): { a: number; m: number; j: number } {
  const [a, m, j] = iso.slice(0, 10).split('-');
  return { a: Number(a), m: Number(m), j: Number(j ?? 1) || 1 };
}

/** "2026-11-15" -> "15/11/2026". */
export function dateCourte(iso: string): string {
  const { a, m, j } = parties(iso);
  return `${String(j).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

/** "2026-11-15" -> "15 novembre 2026" ; le 1er du mois -> "1er". */
export function dateLongue(iso: string): string {
  const { a, m, j } = parties(iso);
  return `${j === 1 ? '1er' : j} ${MOIS[m - 1]} ${a}`;
}

/** "2026-11-15" ou "2026-11" -> "novembre 2026". */
export function moisAn(iso: string): string {
  const { a, m } = parties(iso);
  return `${MOIS[m - 1]} ${a}`;
}
