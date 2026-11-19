// Site public bilingue : adresses et libellés fixes par langue. Les contenus viennent de la base
// (page_contenu et note_marche, colonne langue). Aucun texte français ne doit sortir sous /en.

import { dateLongue } from './format';

export type Lg = 'fr' | 'en';
export type Cle = 'accueil' | 'approche' | 'parcours' | 'contact' | 'notes' | 'mentions';

const CHEMINS: Record<Cle, Record<Lg, string>> = {
  accueil: { fr: '/', en: '/en' },
  approche: { fr: '/approche', en: '/en/approach' },
  parcours: { fr: '/parcours', en: '/en/about' },
  contact: { fr: '/contact', en: '/en/contact' },
  notes: { fr: '/notes', en: '/en/insights' },
  mentions: { fr: '/mentions-legales', en: '/en/legal' },
};

export const chemin = (cle: Cle, l: Lg): string => CHEMINS[cle][l];
export const cheminNote = (slug: string, l: Lg): string => `${CHEMINS.notes[l]}/${slug}`;

export function langueDe(chemin: string): Lg {
  return chemin === '/en' || chemin.startsWith('/en/') ? 'en' : 'fr';
}

const MOIS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-11-15" -> "15 novembre 2026" ou "15 November 2026". Calcul sur la chaîne. */
export function dateLongueLg(iso: string, l: Lg): string {
  if (l === 'fr') return dateLongue(iso);
  const [a, m, j] = iso.slice(0, 10).split('-').map(Number);
  return `${j} ${MOIS_EN[m - 1]} ${a}`;
}

export interface Libelles {
  nav: Record<'approche' | 'parcours' | 'notes' | 'contact' | 'espace', string>;
  menu: string;
  navAria: string;
  pied: string;
  mentions: string;
  legal: { etiquette: string; titre: string; vide: string };
  faq: string;
  toutesNotes: string;
  notesEtiquette: string;
  notesTitre: string;
  notesVide: string;
  erreur: { code: string; titre404: string; texte404: string; titre500: string; texte500: string; accueil: string };
  contact: {
    nom: string; email: string; telephone: string; objet: string; message: string; consentement: string;
    envoyer: string; envoye: string; merci: string; reponse: string; retour: string; piege: string;
    eNom: string; eEmail: string; eTelephone: string; eObjet: string; eMessage: string; eConsent: string;
    eDestinataire: string; eEnvoi: string;
  };
}

export const T: Record<Lg, Libelles> = {
  fr: {
    nav: { approche: 'Approche', parcours: 'Parcours', notes: 'Notes', contact: 'Contact', espace: 'Espace client' },
    menu: 'Menu',
    navAria: 'Navigation',
    pied: 'Pied de page',
    mentions: 'Mentions légales',
    legal: {
      etiquette: 'Informations légales',
      titre: 'Mentions légales',
      vide: 'Les mentions légales de ce cabinet ne sont pas encore renseignées.',
    },
    faq: 'Questions fréquentes',
    toutesNotes: 'Toutes les notes',
    notesEtiquette: 'Notes',
    notesTitre: 'Notes de marché',
    notesVide: "Aucune note n'est publiée pour le moment.",
    erreur: {
      code: 'Erreur',
      titre404: 'Page introuvable',
      texte404: "L'adresse demandée n'existe pas ou n'existe plus.",
      titre500: 'Une erreur est survenue',
      texte500: 'Le service rencontre un incident. Réessayez dans quelques instants.',
      accueil: "Retour à l'accueil",
    },
    contact: {
      nom: 'Nom', email: 'E-mail', telephone: 'Téléphone', objet: 'Objet', message: 'Message',
      consentement: "J'accepte que ces informations soient utilisées pour répondre à ma demande.",
      envoyer: 'Envoyer', envoye: 'Message envoyé', merci: 'Merci, votre message est parti.',
      reponse: 'Nous vous répondons dès que possible.', retour: "Retour à l'accueil", piege: 'Ne pas remplir',
      eNom: 'Indiquez votre nom.',
      eEmail: 'Indiquez une adresse e-mail valide.',
      eTelephone: 'Numéro trop long.',
      eObjet: "Indiquez l'objet de votre message.",
      eMessage: 'Écrivez votre message (5 000 caractères au plus).',
      eConsent: 'Votre accord est nécessaire pour traiter votre demande.',
      eDestinataire: "Le message n'a pas pu être envoyé : aucune adresse de réception n'est configurée.",
      eEnvoi: "Le message n'a pas pu être envoyé. Réessayez dans un instant.",
    },
  },
  en: {
    nav: { approche: 'Approach', parcours: 'About', notes: 'Insights', contact: 'Contact', espace: 'Client area' },
    menu: 'Menu',
    navAria: 'Navigation',
    pied: 'Footer',
    mentions: 'Legal notice',
    legal: {
      etiquette: 'Legal information',
      titre: 'Legal notice',
      vide: 'This firm’s legal notice has not been filled in yet.',
    },
    faq: 'Frequently asked questions',
    toutesNotes: 'All insights',
    notesEtiquette: 'Insights',
    notesTitre: 'Market notes',
    notesVide: 'No note has been published yet.',
    erreur: {
      code: 'Error',
      titre404: 'Page not found',
      texte404: 'The requested address does not exist or no longer exists.',
      titre500: 'Something went wrong',
      texte500: 'The service is having a problem. Please try again in a moment.',
      accueil: 'Back to home',
    },
    contact: {
      nom: 'Name', email: 'E-mail', telephone: 'Phone', objet: 'Subject', message: 'Message',
      consentement: 'I agree that this information may be used to reply to my request.',
      envoyer: 'Send', envoye: 'Message sent', merci: 'Thank you, your message has been sent.',
      reponse: 'We will reply as soon as possible.', retour: 'Back to home', piege: 'Do not fill in',
      eNom: 'Please enter your name.',
      eEmail: 'Please enter a valid e-mail address.',
      eTelephone: 'Number too long.',
      eObjet: 'Please enter the subject of your message.',
      eMessage: 'Please write your message (5,000 characters at most).',
      eConsent: 'Your consent is required to process your request.',
      eDestinataire: 'The message could not be sent: no receiving address is configured.',
      eEnvoi: 'The message could not be sent. Please try again in a moment.',
    },
  },
};
