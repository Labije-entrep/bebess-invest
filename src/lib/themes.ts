// Les thèmes d'un cabinet. Liste fermée : le cabinet choisit un NOM, jamais une valeur de couleur. Chaque nom correspond
// à un bloc :root[data-cabinet-theme="<nom>"] de src/styles/app.css, dont le contraste a été mesuré (chantier/ETAT.md).
// Fichier pur, sans import : le serveur (layouts, écran des réglages) et le test de contraste s'y réfèrent.

export interface Theme {
  id: string;
  libelle: string;
  description: string;
}

export const THEMES: Theme[] = [
  { id: 'maison', libelle: 'Maison', description: 'Sombre, marine profond et laiton : le thème d’origine.' },
  { id: 'nuit', libelle: 'Nuit', description: 'Sombre, noir bleuté et accent bleu.' },
  { id: 'foret', libelle: 'Forêt', description: 'Sombre, vert profond et accent feuille.' },
  { id: 'pierre', libelle: 'Pierre', description: 'Sombre, gris chaud et accent grès.' },
  { id: 'clair', libelle: 'Clair', description: 'Clair, fond ivoire et accent or foncé.' },
];

export const THEME_DEFAUT = 'maison';

/** Un thème connu, ou le thème par défaut : une valeur inconnue en base ne casse jamais une page. */
export const themeValide = (v: unknown): string => THEMES.find((t) => t.id === v)?.id ?? THEME_DEFAUT;
