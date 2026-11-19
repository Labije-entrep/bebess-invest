// Marqueurs de liste : le rôle que le code attend d'une valeur, déclaré dans la table de référence
// (liste_valeur.marqueur) et non supposé par la clé. Le code ne connaît JAMAIS la clé d'une valeur de liste :
// il demande « quelle valeur de statut_sujet porte le marqueur en_cours ? » et la table répond.
//
// Ce fichier est pur (aucun import d'exécution) : le serveur et les scripts du navigateur le partagent.
// Le vocabulaire est fermé : un marqueur n'existe que s'il est déclaré ici, et seulement pour la liste indiquée.
// Une valeur porte au plus un marqueur. Un marqueur « unique » ne se pose que sur une valeur ; `clos` peut
// se poser sur plusieurs (un mouvement exécuté et un mouvement archivé sont tous deux terminés).
//
// Un marqueur ne vaut que sur une valeur ACTIVE : désactiver la valeur qui le porte, c'est retirer le rôle, et
// les écrans le disent (« aucune valeur ne porte… ») au lieu d'afficher un zéro ou de deviner une autre valeur.

export type ListeMarquee = 'type_contact' | 'statut_sujet' | 'statut_mouvement' | 'type_portefeuille';

export interface DefMarqueur {
  id: string;
  /** Nom du rôle, tel qu'il s'affiche dans la liste déroulante des réglages. */
  libelle: string;
  unique: boolean;
  /** Ce que fait le code de la valeur qui le porte, en une phrase. */
  effet: string;
  /** Ce qui se passe quand aucune valeur active ne le porte, en une phrase : le message affiché à la place du résultat. */
  sans: string;
}

/** Les identifiants, pour le code qui s'en sert (jamais une clé de liste). */
export const MARQUEUR = {
  PARCOURS: 'parcours',
  CLIENT: 'client',
  EN_COURS: 'en_cours',
  EN_ATTENTE: 'en_attente',
  CLOS: 'clos',
  DEFAUT: 'defaut',
} as const;

export const MARQUEURS: Record<ListeMarquee, DefMarqueur[]> = {
  type_contact: [
    {
      id: MARQUEUR.PARCOURS,
      libelle: 'Alimente le parcours',
      unique: true,
      effet: 'Les contacts de ce type sont rangés dans le parcours de prospection, et l’étape ne se pose que sur eux.',
      sans: 'Le parcours n’a personne à ranger et l’étape ne peut se poser sur aucun contact.',
    },
    {
      id: MARQUEUR.CLIENT,
      libelle: 'Client',
      unique: true,
      effet: 'Sa pastille est mise en avant dans la liste du suivi.',
      sans: 'Aucune pastille n’est mise en avant dans la liste du suivi.',
    },
  ],
  statut_sujet: [
    {
      id: MARQUEUR.EN_COURS,
      libelle: 'Indicateur En cours',
      unique: true,
      effet: 'Le statut compté par l’indicateur « En cours » du suivi ; son étiquette est colorée sur la fiche.',
      sans: 'L’indicateur « En cours » du suivi n’a rien à compter : il affiche ce message au lieu d’un chiffre.',
    },
    {
      id: MARQUEUR.EN_ATTENTE,
      libelle: 'Indicateur En attente',
      unique: true,
      effet: 'Le statut compté par l’indicateur « En attente » du suivi.',
      sans: 'L’indicateur « En attente » du suivi n’a rien à compter : il affiche ce message au lieu d’un chiffre.',
    },
  ],
  statut_mouvement: [
    {
      id: MARQUEUR.CLOS,
      libelle: 'Mouvement terminé',
      unique: false,
      effet: 'Un mouvement saisi avec ce statut est terminé : il n’affiche plus de barre d’avancement ni de mention « en cours ».',
      sans: 'Aucun statut ne termine un mouvement : un mouvement exécuté garde sa barre d’avancement et sa mention « en cours » tant qu’on ne les retire pas à la main.',
    },
  ],
  type_portefeuille: [
    {
      id: MARQUEUR.DEFAUT,
      libelle: 'Type par défaut',
      unique: true,
      effet: 'Le type du portefeuille créé avec un nouveau viewer ou à la promotion d’un contact.',
      sans: 'Un nouveau viewer ne peut pas être créé, ni un contact promu : le portefeuille de départ n’aurait pas de type.',
    },
  ],
};

export const marqueursDeLaListe = (liste: string): DefMarqueur[] => MARQUEURS[liste as ListeMarquee] ?? [];

/** Marqueurs actifs d'un cabinet : liste → marqueur → clés des valeurs actives qui le portent. */
export type Marqueurs = Record<string, Record<string, string[]>>;

export const clesMarquees = (m: Marqueurs | undefined, liste: string, marqueur: string): string[] => m?.[liste]?.[marqueur] ?? [];
