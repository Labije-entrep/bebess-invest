// Les thèmes d'un cabinet. Liste fermée : le cabinet choisit un NOM, jamais une valeur de couleur. Chaque nom correspond
// à un bloc :root[data-cabinet-theme="<nom>"] de src/styles/app.css, dont le contraste a été mesuré (chantier/ETAT.md).
// Fichier pur, sans import : le serveur (layouts, écran des réglages) et le test de contraste s'y réfèrent.

export interface Theme {
  id: string;
  libelle: string;
  description: string;
  /**
   * Les trois couleurs du thème sur lesquelles un accent personnalisé doit rester lisible (--fond, --marine, --texte de app.css, recopiées ici
   * pour que le serveur calcule le contraste ; tests/personnalisation.test.ts vérifie qu'elles n'ont pas dérivé de app.css).
   */
  fond: string;
  marine: string;
  texte: string;
  /** Un thème sombre éclaircit l'accent pour ses survols, un thème clair l'assombrit. */
  sombre: boolean;
}

export const THEMES: Theme[] = [
  { id: 'maison', libelle: 'Maison', description: 'Sombre, marine profond et laiton : le thème d’origine.', fond: '#070a10', marine: '#0d1829', texte: '#e6e1d6', sombre: true },
  { id: 'nuit', libelle: 'Nuit', description: 'Sombre, noir bleuté et accent bleu.', fond: '#090b11', marine: '#121826', texte: '#e7e9ef', sombre: true },
  { id: 'foret', libelle: 'Forêt', description: 'Sombre, vert profond et accent feuille.', fond: '#08110d', marine: '#10201a', texte: '#e4e9e0', sombre: true },
  { id: 'pierre', libelle: 'Pierre', description: 'Sombre, gris chaud et accent grès.', fond: '#161412', marine: '#221f1c', texte: '#ece8e1', sombre: true },
  { id: 'clair', libelle: 'Clair', description: 'Clair, fond ivoire et accent or foncé.', fond: '#f8f5ef', marine: '#ede8dc', texte: '#1d1b17', sombre: false },
];

export const THEME_DEFAUT = 'maison';

/** Un thème connu, ou le thème par défaut : une valeur inconnue en base ne casse jamais une page. */
/** Le thème d'un NOM connu, ou null : sert à valider un choix venu d'un formulaire (jamais une valeur de couleur). */
export const themeConnu = (v: unknown): string | null => THEMES.find((t) => t.id === v)?.id ?? null;

/** Le thème de l'espace client : le choix du client s'il est connu, sinon le thème du cabinet, sinon le défaut. */
export const themeEffectif = (choixClient: unknown, themeCabinet: unknown): string => themeConnu(choixClient) ?? themeValide(themeCabinet);

export const themeValide = (v: unknown): string => THEMES.find((t) => t.id === v)?.id ?? THEME_DEFAUT;
