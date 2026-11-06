/* =====================================================================
   Configuration bilingue : routes et libelles d'interface.
   ---------------------------------------------------------------------
   Ce fichier ne contient PAS de contenu editorial — celui-ci vit dans
   src/data/<langue>/cabinet.yaml et dans les notes de marche.
   On trouve ici uniquement la mecanique : adresses des pages et
   libelles de navigation, de boutons et de formulaire.
   ===================================================================== */

export const LANGUES = ['fr', 'en'] as const;
export type Langue = (typeof LANGUES)[number];

export const NOM_LANGUE: Record<Langue, string> = { fr: 'Français', en: 'English' };
export const CODE_HREFLANG: Record<Langue, string> = { fr: 'fr-FR', en: 'en' };

/* Les pages du site et leur adresse dans chaque langue.
   Les adresses anglaises sont volontairement en anglais : c'est ce que
   lisent les moteurs de recherche et les visiteurs internationaux. */
export const ROUTES = {
  accueil: { fr: '/', en: '/en' },
  approche: { fr: '/approche', en: '/en/approach' },
  parcours: { fr: '/parcours', en: '/en/about' },
  notes: { fr: '/notes', en: '/en/insights' },
  contact: { fr: '/contact', en: '/en/contact' },
  mentions: { fr: '/mentions-legales', en: '/en/legal' },
} as const;

export type Page = keyof typeof ROUTES;

export const route = (page: Page, langue: Langue) => ROUTES[page][langue];

/* Adresse d'une note de marche */
export const routeNote = (slug: string, langue: Langue) =>
  langue === 'fr' ? `/notes/${slug}` : `/en/insights/${slug}`;

export const MENU: Page[] = ['accueil', 'approche', 'parcours', 'notes', 'contact'];

export const ui = {
  fr: {
    menu: { accueil: 'Accueil', approche: 'Approche', parcours: 'Parcours', notes: 'Notes', contact: 'Contact', mentions: 'Mentions légales' },
    ouvrirMenu: 'Menu',
    changerLangue: 'Changer de langue',
    ctaEntete: 'Rendez-vous',
    ctaPrincipal: 'Demander un premier échange',
    ctaMethode: 'Lire la méthode',
    ctaParcours: 'Voir mon parcours',
    ctaContact: 'Me contacter',
    ctaRendezVous: 'Demander un rendez-vous',
    ctaCreneau: 'Choisir un créneau',
    ficheCabinet: 'Fiche cabinet',
    fiche: { structure: 'Structure', orias: 'Immatriculation ORIAS', statut: 'Statut réglementaire', mandats: 'Mandats suivis', mandatsVal: 'Sur sélection, nombre plafonné', reporting: 'Reporting', reportingVal: 'Écrit, trimestriel', premier: 'Premier rendez-vous', premierVal: 'Sans engagement' },
    accueilEyebrow: 'Gestion privée indépendante —',
    missionsTitre: 'Ce que je prends en charge',
    missionsChapeau: "Quatre missions, menées pour la même personne et consignées dans le même document. Rien n'est sous-traité à un réseau, rien n'est vendu sur catalogue.",
    positionnement: 'Positionnement',
    positionnementTitre: 'Un cabinet qui refuse de grossir trop vite',
    positionnementP1: "Un portefeuille bien suivi demande du temps : lire les relevés, appeler quand le marché bouge, reprendre le cadrage quand la vie change. Ce temps ne se divise pas à l'infini.",
    positionnementP2: "J'ai donc choisi de plafonner le nombre de mandats suivis plutôt que de diluer le service. Concrètement : vous avez mon numéro direct, vos comptes rendus sont rédigés par moi, et je connais votre dossier sans avoir à le rouvrir.",
    citation: "On ne juge pas un conseil à sa meilleure année, mais à la façon dont il se comporte la mauvaise.",
    citationSource: 'Principe de travail du cabinet',
    faqTitre: "Les questions qu'on me pose avant de signer",
    faqChapeau: 'Autant y répondre ici, en toutes lettres. Ces réponses engagent le cabinet.',
    premierEchange: 'Premier échange',
    premierEchangeTitre: 'Quarante-cinq minutes, sans engagement',
    premierEchangeTexte: "Un rendez-vous pour exposer votre situation et repartir avec un avis clair sur ce qui mérite d'être revu. S'il n'y a rien à faire, je vous le dirai.",
    approcheTitre: 'Une méthode en quatre temps, toujours la même',
    approcheChapeau: "Elle ne varie pas selon le montant confié. Ce qui varie, c'est le temps passé sur chaque étape et la complexité des supports retenus.",
    transparence: 'Transparence',
    honorairesTitre: 'Comment je suis rémunéré',
    honorairesChapeau: "Le sujet arrive toujours, autant le traiter en premier.",
    clienteleEyebrow: "À qui je m'adresse",
    clienteleTitre: 'Trois profils, trois préoccupations',
    trajectoire: 'Trajectoire',
    trajectoireTitre: "Ce que chaque étape m'a appris",
    trajectoireChapeau: "Plutôt qu'une liste de postes, ce que j'en ai retiré et qui sert vos portefeuilles aujourd'hui.",
    convictions: 'Convictions',
    convictionsTitre: 'Trois principes que je ne négocie pas',
    portraitAttente: ['Portrait', 'à réaliser', '— séance photo —'],
    notesEyebrow: 'Notes de marché',
    notesTitre: "Ce que je lis, ce que j'en retiens",
    notesChapeau: 'Une note courte par mois, sans jargon et sans prédiction. Chaque note est une page indexable : c\'est le moteur de référencement du site.',
    notesVides: 'Aucune note publiée pour le moment.',
    noteEyebrow: 'Note de marché —',
    toutesLesNotes: 'Toutes les notes',
    prendreRendezVous: 'Prendre rendez-vous',
    contactTitre: 'Parlons de votre situation',
    contactChapeau: "Décrivez en quelques lignes ce que vous détenez et ce qui vous préoccupe. Je réponds {delai} et je propose un premier échange de quarante-cinq minutes, sans engagement.",
    champs: { nom: 'Nom et prénom', telephone: 'Téléphone', email: 'Adresse e-mail', objet: 'Objet principal', message: 'Votre situation en quelques lignes', envoyer: 'Envoyer ma demande', envoi: 'Envoi…', envoye: 'Demande envoyée' },
    consentement: "J'accepte que ces informations soient utilisées pour me recontacter. Elles ne sont ni cédées ni utilisées à d'autres fins.",
    politique: 'Politique de confidentialité',
    erreurChamps: 'Merci de renseigner votre nom, votre e-mail et de cocher la case de consentement.',
    erreurEndpoint: "Le formulaire n'est pas encore relié : renseignez endpointFormulaire dans les réglages du site.",
    erreurEnvoi: "L'envoi a échoué. Écrivez-moi directement par e-mail, l'adresse figure à droite.",
    succesEnvoi: 'Message bien reçu. Je reviens vers vous sous deux jours ouvrés.',
    coord: { email: 'E-mail', telephone: 'Téléphone', adresse: 'Adresse', reponse: 'Réponse', linkedin: 'LinkedIn', profil: 'Profil professionnel' },
    mentionsEyebrow: 'Informations réglementaires',
    mentionsTitre: 'Mentions légales',
    mentionsChapeau: "Le contenu de cette page dépend du statut réglementaire exact du cabinet et doit être validé avant mise en ligne.",
    mentionsSections: { editeur: 'Éditeur du site', statut: 'Statut et immatriculation', assurance: 'Assurance et garantie financière', mediation: 'Médiation de la consommation', hebergement: 'Hébergement', donnees: 'Données personnelles', risques: 'Avertissement sur les risques' },
    siege: 'Siège',
    directeurPub: 'Directeur de la publication',
    donneesTexte: "Les informations transmises via le formulaire de contact servent uniquement à répondre à la demande.",
    donneesDroits: "Vous disposez d'un droit d'accès, de rectification et de suppression, exerçable par simple e-mail à",
    donneesCookies: "Le site ne dépose aucun cookie de mesure d'audience ni de publicité.",
    languePrevaut: '',
    erreur404: 'Erreur 404',
    titre404: "Cette page n'existe pas",
    texte404: "Le lien est peut-être ancien, ou l'adresse mal recopiée.",
    retourAccueil: "Retour à l'accueil",
  },

  en: {
    menu: { accueil: 'Home', approche: 'Approach', parcours: 'About', notes: 'Insights', contact: 'Contact', mentions: 'Legal notice' },
    ouvrirMenu: 'Menu',
    changerLangue: 'Change language',
    ctaEntete: 'Book a call',
    ctaPrincipal: 'Request an introductory call',
    ctaMethode: 'Read the method',
    ctaParcours: 'See my background',
    ctaContact: 'Get in touch',
    ctaRendezVous: 'Request a meeting',
    ctaCreneau: 'Pick a time',
    ficheCabinet: 'Practice at a glance',
    fiche: { structure: 'Legal entity', orias: 'ORIAS registration', statut: 'Regulatory status', mandats: 'Mandates', mandatsVal: 'Selective, capped in number', reporting: 'Reporting', reportingVal: 'Written, quarterly', premier: 'First meeting', premierVal: 'No commitment' },
    accueilEyebrow: 'Independent private wealth advisory —',
    missionsTitre: 'What I take on',
    missionsChapeau: 'Four engagements, handled by one person and recorded in a single document. Nothing is outsourced to a network, nothing is sold off a shelf.',
    positionnement: 'Positioning',
    positionnementTitre: 'A practice that declines to grow too fast',
    positionnementP1: 'A portfolio that is genuinely followed takes time: reading the statements, calling when markets move, revisiting the brief when life changes. That time cannot be divided indefinitely.',
    positionnementP2: 'So I cap the number of mandates rather than dilute the service. In practice: you have my direct line, your reports are written by me, and I know your file without having to reopen it.',
    citation: 'An adviser is not judged on their best year, but on how they behave in the worst one.',
    citationSource: 'Working principle of the practice',
    faqTitre: 'The questions I am asked before signing',
    faqChapeau: 'Better answered here, in full. These answers commit the practice.',
    premierEchange: 'Introductory call',
    premierEchangeTitre: 'Forty-five minutes, no commitment',
    premierEchangeTexte: 'A meeting to set out your situation and leave with a clear view of what deserves a second look. If nothing needs doing, I will say so.',
    approcheTitre: 'A four-step method, always the same',
    approcheChapeau: 'It does not change with the amount entrusted. What changes is the time spent on each step and the complexity of the instruments used.',
    transparence: 'Transparency',
    honorairesTitre: 'How I am paid',
    honorairesChapeau: 'The question always comes up, so it may as well come first.',
    clienteleEyebrow: 'Who I work with',
    clienteleTitre: 'Three profiles, three concerns',
    trajectoire: 'Track record',
    trajectoireTitre: 'What each step taught me',
    trajectoireChapeau: 'Rather than a list of positions, what I took from them that serves your portfolio today.',
    convictions: 'Convictions',
    convictionsTitre: 'Three principles I do not negotiate',
    portraitAttente: ['Portrait', 'to be taken', '— photo session —'],
    notesEyebrow: 'Market notes',
    notesTitre: 'What I read, and what I take from it',
    notesChapeau: 'One short note a month, without jargon and without forecasts. Each note is an indexable page: this is the search engine of the site.',
    notesVides: 'No notes published yet.',
    noteEyebrow: 'Market note —',
    toutesLesNotes: 'All notes',
    prendreRendezVous: 'Book a call',
    contactTitre: 'Let us talk about your situation',
    contactChapeau: 'Describe in a few lines what you hold and what concerns you. I reply {delai} and offer an introductory call of forty-five minutes, with no commitment.',
    champs: { nom: 'Full name', telephone: 'Telephone', email: 'Email address', objet: 'Main subject', message: 'Your situation in a few lines', envoyer: 'Send my request', envoi: 'Sending…', envoye: 'Request sent' },
    consentement: 'I agree that this information may be used to contact me. It is neither sold nor used for any other purpose.',
    politique: 'Privacy policy',
    erreurChamps: 'Please provide your name, your email address and tick the consent box.',
    erreurEndpoint: 'The form is not connected yet: set endpointFormulaire in the site settings.',
    erreurEnvoi: 'Sending failed. Please email me directly, the address is shown alongside.',
    succesEnvoi: 'Message received. I will come back to you within two working days.',
    coord: { email: 'Email', telephone: 'Telephone', adresse: 'Address', reponse: 'Reply', linkedin: 'LinkedIn', profil: 'Professional profile' },
    mentionsEyebrow: 'Regulatory information',
    mentionsTitre: 'Legal notice',
    mentionsChapeau: 'The content of this page depends on the exact regulatory status of the practice and must be validated before publication.',
    mentionsSections: { editeur: 'Publisher', statut: 'Status and registration', assurance: 'Insurance and financial guarantee', mediation: 'Consumer mediation', hebergement: 'Hosting', donnees: 'Personal data', risques: 'Risk warning' },
    siege: 'Registered office',
    directeurPub: 'Publication director',
    donneesTexte: 'Information submitted through the contact form is used solely to answer your enquiry.',
    donneesDroits: 'You have a right of access, rectification and erasure, exercisable by email to',
    donneesCookies: 'The site sets no analytics or advertising cookies.',
    // Mention obligatoire : le droit applicable est francais.
    languePrevaut: 'This page is a translation provided for information only. The French version is the legally binding one.',
    erreur404: 'Error 404',
    titre404: 'This page does not exist',
    texte404: 'The link may be out of date, or the address mistyped.',
    retourAccueil: 'Back to home',
  },
} as const;

export const t = (langue: Langue) => ui[langue];
