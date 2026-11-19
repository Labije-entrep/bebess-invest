// Module de suivi, côté client : la fiche d'un contact (lot 04). JavaScript écrit à la main, aucun
// framework, aucun domaine externe : tout passe par /api/suivi (lot 02).
//
// Même principe que la liste (src/scripts/suivi.ts) : l'état du serveur (`serveur`) n'est jamais modifié
// par une saisie. Chaque modification entre dans une file d'écritures (une file par contact, par sujet ou
// par échange) ; ce qui s'affiche est l'état du serveur recouvert des écritures encore en file. Une écriture
// qui échoue reste donc visible, marquée, jusqu'à ce qu'elle passe ou que l'utilisateur l'abandonne.
//
// La file d'écritures est celle de src/scripts/commun.ts, la même que celle de la liste et du kanban :
// ici elle sert trois entités (contact, sujet, échange).

import {
  api, brancher, clesMarquees, couleurMembre, empiler, estTerminal, fileExistante, h, liaison, marque as marqueEcriture, MARQUEUR,
  reseauRetabli, sansPerdreLeClic, toutesOps, toutRejouer, ecrituresEnFile,
  type Corps, type Entite, type Enfant, type Marqueurs,
} from './commun';

// ---------------------------------------------------------------- types

interface Contact {
  id: string;
  nom: string;
  prenom: string | null;
  email: string | null;
  tel: string | null;
  structure: string | null;
  responsable_id: string | null;
  binome_id: string | null;
  apporteur_id: string | null;
  relance: string | null;
  etape: string | null;
  archive: number;
  types: string[];
}
interface Sujet {
  id: string;
  contact_id: string;
  texte: string;
  statut: string;
  echeance: string | null;
  origine: string | null;
  cree_le: string;
  fait_le: string | null;
  archive: number;
}
interface Echange { id: string; contact_id: string; date: string; type: string; note: string | null; cree_le: string }
interface Membre { id: string; nom: string; initiale: string; couleur: string; actif: number }
interface ValeurListe { cle: string; libelle: string; ordre: number }
interface Etat {
  version: number;
  /** Clés terminales par liste (colonne `terminal` de liste_valeur), actives ou non. */
  terminaux: Record<string, string[]>;
  /** Rôles que le code attend de certaines valeurs (colonne `marqueur`), sur les valeurs actives seulement. */
  marqueurs: Marqueurs;
  contacts: Contact[];
  sujets: Sujet[];
  echanges: Echange[];
  membres: Membre[];
  listes: Record<string, ValeurListe[]>;
}

// ---------------------------------------------------------------- état

const racineFiche = document.getElementById('fiche');
const ID = racineFiche?.dataset.id ?? '';

let serveur: Etat | null = null;
let version = 0;
let absent = false;
const provisoiresSujets: Sujet[] = [];
const provisoiresEchanges: Echange[] = [];
let nTemp = 0;

/** Sujet à montrer à l'arrivée (adresse en #sujet-<id>) : celui que la passerelle vient de créer ou de retrouver. */
const sujetVise = location.hash.startsWith('#sujet-') ? location.hash.slice('#sujet-'.length) : '';
let sujetMontre = false;

const INTERVALLE_MS = 10000;
/** Un sujet est clos quand son statut est terminal dans statut_sujet : la décision est celle de commun.ts. */
const estClos = (s: Sujet): boolean => estTerminal(serveur?.terminaux, 'statut_sujet', s.statut);

/** Champ en cours de modification en place. `enregistrer` renvoie un message d'erreur, ou null si c'est écrit. */
interface Edition {
  cle: string;
  valeur: string;
  initial: string;
  message?: string;
  enregistrer: (v: string) => string | null;
}
let edition: Edition | null = null;
const formSujet = { ouvert: false, texte: '', echeance: '', message: '' };
const formEchange = { ouvert: false, date: '', type: '', note: '', message: '' };

// ---------------------------------------------------------------- utilitaires

function aujourdhui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const jourUtc = (iso: string): number => {
  const [a, m, j] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, j);
};
const FORMAT_COURT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const FORMAT_LONG = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const avecAnnee = (iso: string, f: Intl.DateTimeFormat): string =>
  f.format(new Date(jourUtc(iso))) + (Number(iso.slice(0, 4)) !== new Date().getFullYear() ? ` ${iso.slice(0, 4)}` : '');
const dateCourte = (iso: string): string => avecAnnee(iso, FORMAT_COURT);
const dateLongue = (iso: string): string => avecAnnee(iso, FORMAT_LONG);

/** AAAA-MM-JJ qui existe vraiment au calendrier (le champ date du navigateur renvoie '' pour le reste). */
function dateValide(s: string): boolean {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!r) return false;
  const x = new Date(Date.UTC(+r[1], +r[2] - 1, +r[3]));
  return x.getUTCFullYear() === +r[1] && x.getUTCMonth() === +r[2] - 1 && x.getUTCDate() === +r[3];
}

// ---------------------------------------------------------------- réseau

async function charger(): Promise<boolean> {
  try {
    const r = await api('/api/suivi/etat');
    if (r.status === 401) {
      liaison.sessionPerdue = true;
      rendreEtat();
      return false;
    }
    if (!r.ok) throw new Error(String(r.status));
    const e = (await r.json()) as Etat;
    reseauRetabli();
    // Une écriture de cette session est déjà passée : un état plus ancien serait un retour en arrière.
    if (e.version < liaison.versionMin) {
      window.setTimeout(() => void charger(), 500);
      return false;
    }
    serveur = e;
    version = e.version;
    absent = !e.contacts.some((c) => c.id === ID);
    rendre();
    return true;
  } catch {
    liaison.ko = true;
    rendreEtat();
    return false;
  }
}

async function sonder(): Promise<void> {
  try {
    const r = await api('/api/suivi/version', { headers: { 'If-None-Match': `"v${version}"` } });
    if (r.status === 304) {
      reseauRetabli();
    } else if (r.status === 401) {
      liaison.sessionPerdue = true;
    } else if (r.ok) {
      reseauRetabli();
      const v = ((await r.json()) as { version: number }).version;
      if (v !== version) await charger();
    }
  } catch {
    liaison.ko = true;
  }
  rendreEtat();
}

let minuterie: number | null = null;
function demarrerSondage(): void {
  if (minuterie === null) minuterie = window.setInterval(() => void sonder(), INTERVALLE_MS);
}
function arreterSondage(): void {
  if (minuterie !== null) window.clearInterval(minuterie);
  minuterie = null;
}

// ---------------------------------------------------------------- lecture de l'état affiché

/** L'élément tel que l'utilisateur doit le voir : état du serveur recouvert des écritures en file. */
function appliquer<T extends { id: string }>(entite: Entite, x: T): T {
  const f = fileExistante(entite, x.id);
  if (!f) return x;
  const v = { ...x };
  for (const op of f.ops) Object.assign(v, op.corps);
  return v;
}

const contactAffiche = (): Contact | null => {
  const c = serveur?.contacts.find((x) => x.id === ID);
  return c ? appliquer('contact', c) : null;
};
const sujetsAffiches = (): Sujet[] =>
  serveur
    ? [...serveur.sujets.filter((s) => s.contact_id === ID), ...provisoiresSujets].map((s) => appliquer('sujet', s)).filter((s) => s.archive === 0)
    : [];
const echangesAffiches = (): Echange[] =>
  serveur
    ? [...serveur.echanges.filter((e) => e.contact_id === ID), ...provisoiresEchanges].map((e) => appliquer('echange', e))
    : [];

const liste = (nom: string): ValeurListe[] => serveur?.listes[nom] ?? [];

/** Le marqueur (en_cours, en_attente) que porte ce statut dans la liste du cabinet, ou rien : la couleur ne dépend jamais d'une clé. */
const marqueurDuStatut = (cle: string): string | undefined =>
  [MARQUEUR.EN_COURS, MARQUEUR.EN_ATTENTE].find((m) => clesMarquees(serveur?.marqueurs, 'statut_sujet', m).includes(cle));
const libelle = (nom: string, cle: string | null): string =>
  cle === null ? '' : (liste(nom).find((v) => v.cle === cle)?.libelle ?? cle);
const nomComplet = (c: Contact): string => `${c.nom.toLocaleUpperCase('fr')}${c.prenom ? ` ${c.prenom}` : ''}`;

/** Statut suivant dans l'ordre de statut_sujet ; le dernier revient au premier. Statut inconnu : le premier. */
function statutSuivant(courant: string): string | null {
  const l = liste('statut_sujet');
  if (l.length === 0) return null;
  const i = l.findIndex((v) => v.cle === courant);
  return l[(i + 1) % l.length].cle;
}

/**
 * Provenance d'un sujet créé depuis le portail, lue dans `origine` (« ecart:<classe>:<date> »,
 * « arrete:<portefeuille>:<date> »). Une origine d'une autre forme est affichée telle quelle.
 */
function provenance(origine: string): string {
  const p = origine.split(':');
  const date = p.length >= 3 && dateValide(p[p.length - 1]) ? ` du ${dateCourte(p[p.length - 1])}` : '';
  if (p[0] === 'ecart' && date) return `créé depuis l’écart d’allocation${date}`;
  if (p[0] === 'arrete' && date) return `créé depuis l’arrêté périmé${date}`;
  return `origine : ${origine}`;
}

// ---------------------------------------------------------------- rendu

const corps = (): HTMLElement => document.getElementById('fiche-corps')!;
let enRendu = false;

function rendreEtat(): void {
  const el = document.getElementById('fiche-etat');
  if (!el) return;
  let etat = 'ajour';
  let texte = 'À jour';
  const ops = toutesOps();
  const refus = ops.filter((o) => o.etat === 'refus').length;
  const enAttente = ops.filter((o) => o.etat !== 'refus');
  const nonPartie = enAttente.filter((o) => o.tentatives > 0).length;
  if (!serveur) {
    etat = liaison.ko || liaison.sessionPerdue ? 'horsligne' : 'chargement';
    texte = liaison.ko ? 'Hors connexion' : liaison.sessionPerdue ? 'Connexion perdue' : 'Chargement…';
  } else if (refus > 0) {
    etat = 'refus';
    texte = `${refus} modification${refus > 1 ? 's' : ''} refusée${refus > 1 ? 's' : ''}`;
  } else if (liaison.ko || liaison.sessionPerdue || nonPartie > 0) {
    etat = 'horsligne';
    texte = `${liaison.sessionPerdue ? 'Connexion perdue' : 'Hors connexion'}${enAttente.length ? ` · ${enAttente.length} en attente d'envoi` : ''}`;
  } else if (enAttente.length > 0) {
    etat = 'attente';
    texte = 'Enregistrement…';
  }
  el.dataset.etat = etat;
  const t = el.querySelector('[data-texte]');
  if (t) t.textContent = texte;
  const alertes = document.getElementById('fiche-alertes');
  if (alertes) {
    alertes.querySelector('[data-session]')?.remove();
    if (liaison.sessionPerdue) {
      alertes.prepend(
        h('p', { class: 'info alerte', role: 'alert', 'data-session': '' },
          'Votre session a expiré. Reconnectez-vous dans un autre onglet : les modifications en attente repartiront ensuite d\'elles-mêmes.'),
      );
    }
  }
}

const marque = (entite: Entite, id: string): HTMLElement | null => marqueEcriture(entite, id, 'fiche-marque');

function avatar(m: Membre | undefined, pleine: boolean): HTMLElement | null {
  if (!m) return null;
  const a = h('b', { class: `fiche-avatar${pleine ? ' pleine' : ''}`, 'aria-hidden': 'true' }, m.initiale);
  if (pleine) a.style.backgroundColor = couleurMembre(m.couleur);
  return a;
}

// ----- champ modifiable en place

interface ParamsChamp {
  cle: string;
  etiquette: string;
  valeur: string;
  affichage: Enfant;
  type?: 'text' | 'email' | 'tel' | 'date' | 'select';
  options?: [string, string][];
  large?: boolean;
  enregistrer: (v: string) => string | null;
}

function ouvrirEdition(p: ParamsChamp): void {
  edition = { cle: p.cle, valeur: p.valeur, initial: p.valeur, enregistrer: p.enregistrer };
  rendre();
}

/** Ferme l'édition. Avec `valider`, enregistre d'abord : un refus de validation garde le champ ouvert. */
function fermerEdition(cle: string, valider: boolean): void {
  if (!edition || edition.cle !== cle || enRendu) return;
  const e = edition;
  if (valider && e.valeur.trim() !== e.initial) {
    const message = e.enregistrer(e.valeur.trim());
    if (message) {
      e.message = message;
      rendre();
      return;
    }
  }
  edition = null;
  rendre();
}

function champ(p: ParamsChamp): HTMLElement {
  if (!edition || edition.cle !== p.cle) {
    return h('button', {
      type: 'button', class: 'fiche-champ', 'data-f': p.cle, 'aria-label': `Modifier : ${p.etiquette}`,
      onclick: () => ouvrirEdition(p),
    }, p.affichage);
  }
  const e = edition;
  const commun = {
    id: `edit-${p.cle}`, 'data-f': p.cle, 'aria-label': p.etiquette,
    onkeydown: (ev: Event) => {
      const k = (ev as KeyboardEvent).key;
      if (k === 'Escape') {
        ev.preventDefault();
        fermerEdition(p.cle, false);
      } else if (k === 'Enter' && p.type !== 'select') {
        ev.preventDefault();
        fermerEdition(p.cle, true);
      }
    },
    onblur: () => fermerEdition(p.cle, true),
  };
  let saisie: HTMLInputElement | HTMLSelectElement;
  if (p.type === 'select') {
    saisie = h('select', {
      ...commun, class: 'champ fiche-saisie',
      onchange: (ev: Event) => {
        e.valeur = (ev.target as HTMLSelectElement).value;
        fermerEdition(p.cle, true);
      },
    }, h('option', { value: '' }, '—'),
    ...(p.options ?? []).map(([v, l]) => h('option', { value: v, selected: e.valeur === v }, l)));
  } else {
    saisie = h('input', {
      ...commun, class: `champ fiche-saisie${p.large ? ' large' : ''}`, type: p.type ?? 'text', value: e.valeur, autocomplete: 'off',
      oninput: (ev: Event) => { e.valeur = (ev.target as HTMLInputElement).value; },
      onchange: p.type === 'date' ? (ev: Event) => { e.valeur = (ev.target as HTMLInputElement).value; fermerEdition(p.cle, true); } : null,
    });
  }
  return h('span', {}, saisie, e.message && h('span', { class: 'fiche-erreur', role: 'alert' }, e.message));
}

// ----- en-tête

function enteteContact(c: Contact): HTMLElement {
  const s = serveur!;
  const maj = (col: string) => (v: string): string | null => {
    empiler('contact', c.id, 'patch', { [col]: v === '' ? null : v });
    return null;
  };
  const texte = (col: 'prenom' | 'structure' | 'tel', etiquette: string, vide: string, type: 'text' | 'tel' = 'text') =>
    champ({
      cle: `contact:${col}`, etiquette, valeur: c[col] ?? '', type, enregistrer: maj(col),
      affichage: c[col] ? c[col] : h('span', { class: 'vide' }, vide),
    });

  const nom = champ({
    cle: 'contact:nom', etiquette: 'Nom', valeur: c.nom,
    affichage: c.nom.toLocaleUpperCase('fr'),
    enregistrer: (v) => (v === '' ? 'Le nom est requis.' : maj('nom')(v)),
  });
  const email = champ({
    cle: 'contact:email', etiquette: 'E-mail', valeur: c.email ?? '', type: 'email',
    affichage: c.email ? c.email : h('span', { class: 'vide' }, '+ e-mail'),
    enregistrer: (v) => (v !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Adresse e-mail invalide.' : maj('email')(v)),
  });

  const types = h('div', { class: 'fiche-types', role: 'group', 'aria-label': 'Types' },
    ...liste('type_contact').map((t) =>
      h('button', {
        type: 'button', class: 'fiche-type', 'aria-pressed': c.types.includes(t.cle) ? 'true' : 'false', 'data-f': `type:${t.cle}`,
        onclick: () => {
          const actuel = contactAffiche()?.types ?? [];
          const suivant = actuel.includes(t.cle) ? actuel.filter((x) => x !== t.cle) : [...actuel, t.cle];
          empiler('contact', ID, 'patch', { types: suivant.sort() });
        },
      }, t.libelle)));

  const parMembre = (col: 'responsable_id' | 'binome_id', etiquette: string, pleine: boolean): HTMLElement => {
    const courant = s.membres.find((m) => m.id === c[col]);
    const options = s.membres.filter((m) => m.actif === 1 || m.id === c[col]).map((m): [string, string] => [m.id, m.nom]);
    return cellule(etiquette,
      champ({
        cle: `contact:${col}`, etiquette, valeur: c[col] ?? '', type: 'select', options,
        affichage: courant ? h('span', {}, avatar(courant, pleine), courant.nom) : h('span', { class: 'vide' }, '—'),
        enregistrer: maj(col),
      }));
  };

  const apporteur = c.apporteur_id ? s.contacts.find((x) => x.id === c.apporteur_id) : undefined;
  const apportPar = cellule('Apporté par', h('span', {},
    apporteur && h('a', { href: `/gestionnaire/suivi/${encodeURIComponent(apporteur.id)}` }, nomComplet(appliquer('contact', apporteur))),
    champ({
      cle: 'contact:apporteur_id', etiquette: 'Apporté par', valeur: c.apporteur_id ?? '', type: 'select',
      options: s.contacts.filter((x) => x.id !== c.id).map((x): [string, string] => [x.id, nomComplet(x)]),
      affichage: apporteur ? h('span', { class: 'fiche-lien-modif' }, 'modifier') : h('span', { class: 'vide' }, '—'),
      enregistrer: maj('apporteur_id'),
    })));

  const relance = cellule('Prochaine relance', champ({
    cle: 'contact:relance', etiquette: 'Prochaine relance', valeur: c.relance ?? '', type: 'date',
    affichage: c.relance ? dateLongue(c.relance) : h('span', { class: 'vide' }, '—'),
    enregistrer: (v) => (v !== '' && !dateValide(v) ? 'Date invalide.' : maj('relance')(v)),
  }));

  // L'étape du parcours : seulement sur un prospect, avec les étapes actives de la liste (plus l'étape courante
  // si elle en est sortie, pour qu'elle reste lisible).
  const typesParcours = clesMarquees(serveur?.marqueurs, 'type_contact', MARQUEUR.PARCOURS);
  const etape = c.types.some((t) => typesParcours.includes(t))
    ? cellule('Étape', champ({
      cle: 'contact:etape', etiquette: 'Étape', valeur: c.etape ?? '', type: 'select',
      options: liste('etape').map((v): [string, string] => [v.cle, v.libelle]).concat(
        c.etape && !liste('etape').some((v) => v.cle === c.etape) ? [[c.etape, `${c.etape} (retirée de la liste)`]] : []),
      affichage: c.etape ? libelle('etape', c.etape) : h('span', { class: 'vide' }, 'Sans étape'),
      enregistrer: maj('etape'),
    }))
    : null;

  return h('div', {},
    h('div', { class: 'fiche-tete' },
      h('div', {},
        h('h1', {}, nom, ' ', texte('prenom', 'Prénom', '+ prénom')),
        h('p', { class: 'fiche-contact' },
          texte('structure', 'Structure', '+ structure'), ' · ', email, ' · ', texte('tel', 'Téléphone', '+ téléphone', 'tel')),
        marque('contact', c.id)),
      types),
    h('div', { class: 'fiche-bandeau' }, parMembre('responsable_id', 'En charge', true), parMembre('binome_id', 'Binôme', false), etape, apportPar, relance));
}

function cellule(etiquette: string, contenu: Enfant): HTMLElement {
  return h('div', { class: 'fiche-cellule' }, h('p', { class: 'etiquette' }, etiquette), h('p', { class: 'fiche-valeur' }, contenu));
}

// ----- sujets

function blocSujets(): HTMLElement {
  const aujourd = aujourdhui();
  const tous = sujetsAffiches();
  // Ouverts d'abord, par échéance (sans échéance en dernier), puis les faits ; à égalité, ordre de création.
  const tries = [...tous].sort((a, b) => {
    const fa = estClos(a) ? 1 : 0;
    const fb = estClos(b) ? 1 : 0;
    if (fa !== fb) return fa - fb;
    if ((a.echeance ?? '9999') !== (b.echeance ?? '9999')) return (a.echeance ?? '9999') < (b.echeance ?? '9999') ? -1 : 1;
    return a.cree_le < b.cree_le ? -1 : a.cree_le > b.cree_le ? 1 : 0;
  });

  const lignes = tries.map((s) => {
    const fait = estClos(s);
    const retard = !fait && s.echeance !== null && s.echeance < aujourd;
    const suivant = statutSuivant(s.statut);
    const majSujet = (col: string) => (v: string): string | null => {
      empiler('sujet', s.id, 'patch', { [col]: v === '' ? null : v });
      return null;
    };
    return h('div', { class: `fiche-ligne${fait ? ' fait' : ''}${s.id === sujetVise ? ' vise' : ''}`, id: `sujet-${s.id}` },
      h('button', {
        type: 'button', class: `fiche-statut${retard ? ' retard' : ''}`, 'data-marqueur': marqueurDuStatut(s.statut), 'data-terminal': fait, 'data-f': `statut:${s.id}`,
        'aria-label': `Statut : ${libelle('statut_sujet', s.statut)}${suivant ? `. Passer à « ${libelle('statut_sujet', suivant)} »` : ''}`,
        disabled: suivant === null,
        onclick: () => {
          const courant = sujetsAffiches().find((x) => x.id === s.id);
          const prochain = courant ? statutSuivant(courant.statut) : null;
          if (!courant || prochain === null) return;
          empiler('sujet', s.id, 'patch', { statut: prochain, fait_le: estTerminal(serveur?.terminaux, 'statut_sujet', prochain) ? aujourdhui() : null });
        },
      }, libelle('statut_sujet', s.statut)),
      h('span', { class: 'fiche-sujet' },
        champ({
          cle: `sujet:${s.id}:texte`, etiquette: 'Texte du sujet', valeur: s.texte, large: true, affichage: s.texte,
          enregistrer: (v) => (v === '' ? 'Le texte est requis.' : majSujet('texte')(v)),
        }),
        h('span', { class: 'fiche-sous' },
          'Échéance ',
          champ({
            cle: `sujet:${s.id}:echeance`, etiquette: 'Échéance', valeur: s.echeance ?? '', type: 'date',
            affichage: s.echeance ? dateCourte(s.echeance) : h('span', { class: 'vide' }, 'aucune'),
            enregistrer: (v) => (v !== '' && !dateValide(v) ? 'Date invalide.' : majSujet('echeance')(v)),
          }),
          retard && h('span', { class: 'alerte' }, ' · en retard'),
          fait && s.fait_le && ` · clos le ${dateCourte(s.fait_le)}`,
          s.origine && ` · ${provenance(s.origine)}`),
        marque('sujet', s.id)),
    );
  });

  return h('section', { class: 'fiche-bloc', 'aria-labelledby': 'fiche-h-sujets' },
    h('div', { class: 'fiche-bloc-tete' },
      h('h2', { id: 'fiche-h-sujets' }, 'Sujets'),
      h('button', {
        type: 'button', class: 'fiche-ajout', 'data-f': 'sujet:ajouter', 'aria-expanded': formSujet.ouvert ? 'true' : 'false',
        onclick: () => { formSujet.ouvert = !formSujet.ouvert; formSujet.message = ''; rendre(); },
      }, formSujet.ouvert ? 'Fermer' : '+ Ajouter')),
    formSujet.ouvert && formulaireSujet(),
    lignes.length ? h('div', {}, ...lignes) : h('p', { class: 'fiche-vide' }, 'Aucun sujet pour ce contact.'));
}

function formulaireSujet(): HTMLElement {
  const statuts = liste('statut_sujet');
  const form = h('form', { class: 'fiche-formulaire', novalidate: true },
    h('div', { class: 'grille' },
      h('div', { class: 'groupe' },
        h('label', { class: 'etiquette', for: 'fs-texte' }, 'Sujet'),
        h('input', {
          class: 'champ', id: 'fs-texte', 'data-f': 'fs:texte', value: formSujet.texte, autocomplete: 'off',
          oninput: (e) => { formSujet.texte = (e.target as HTMLInputElement).value; },
        })),
      h('div', { class: 'groupe' },
        h('label', { class: 'etiquette', for: 'fs-echeance' }, 'Échéance'),
        h('input', {
          class: 'champ', id: 'fs-echeance', 'data-f': 'fs:echeance', type: 'date', value: formSujet.echeance,
          oninput: (e) => { formSujet.echeance = (e.target as HTMLInputElement).value; },
        }))),
    formSujet.message && h('p', { class: 'erreur', role: 'alert' }, formSujet.message),
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn-plein', 'data-f': 'fs:envoyer' }, 'Ajouter')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const texte = formSujet.texte.trim();
    if (!texte) { formSujet.message = 'Le texte est requis.'; rendre(); return; }
    if (formSujet.echeance && !dateValide(formSujet.echeance)) { formSujet.message = 'Échéance invalide.'; rendre(); return; }
    if (statuts.length === 0) { formSujet.message = 'Aucun statut n’est défini pour les sujets.'; rendre(); return; }
    const cle = `tmp-${++nTemp}`;
    const nouveau: Corps = { contact_id: ID, texte, statut: statuts[0].cle };
    if (formSujet.echeance) nouveau.echeance = formSujet.echeance;
    provisoiresSujets.push({
      id: cle, contact_id: ID, texte, statut: statuts[0].cle, echeance: formSujet.echeance || null, origine: null,
      cree_le: new Date().toISOString(), fait_le: null, archive: 0,
    });
    formSujet.texte = '';
    formSujet.echeance = '';
    formSujet.message = '';
    empiler('sujet', cle, 'create', nouveau);
  });
  return form;
}

// ----- échanges

function blocEchanges(): HTMLElement {
  const tous = [...echangesAffiches()].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.cree_le < b.cree_le ? 1 : a.cree_le > b.cree_le ? -1 : 0);
  const lignes = tous.map((x) =>
    h('div', { class: 'fiche-echange' },
      h('span', { class: 'fiche-echange-quand' }, `${dateCourte(x.date)} · ${libelle('type_echange', x.type)}`),
      h('span', { class: 'fiche-echange-note' }, x.note ?? '', marque('echange', x.id))));

  return h('section', { class: 'fiche-bloc', 'aria-labelledby': 'fiche-h-echanges' },
    h('div', { class: 'fiche-bloc-tete' },
      h('h2', { id: 'fiche-h-echanges' }, 'Échanges'),
      h('button', {
        type: 'button', class: 'fiche-ajout', 'data-f': 'echange:ajouter', 'aria-expanded': formEchange.ouvert ? 'true' : 'false',
        onclick: () => {
          formEchange.ouvert = !formEchange.ouvert;
          formEchange.message = '';
          if (formEchange.ouvert && !formEchange.date) formEchange.date = aujourdhui();
          rendre();
        },
      }, formEchange.ouvert ? 'Fermer' : '+ Journaliser')),
    formEchange.ouvert && formulaireEchange(),
    lignes.length ? h('div', {}, ...lignes) : h('p', { class: 'fiche-vide' }, 'Aucun échange journalisé.'));
}

function formulaireEchange(): HTMLElement {
  const types = liste('type_echange');
  if (!formEchange.type && types.length) formEchange.type = types[0].cle;
  const form = h('form', { class: 'fiche-formulaire', novalidate: true },
    h('div', { class: 'grille' },
      h('div', { class: 'groupe' },
        h('label', { class: 'etiquette', for: 'fe-date' }, 'Date'),
        h('input', {
          class: 'champ', id: 'fe-date', 'data-f': 'fe:date', type: 'date', value: formEchange.date,
          oninput: (e) => { formEchange.date = (e.target as HTMLInputElement).value; },
        })),
      h('div', { class: 'groupe' },
        h('label', { class: 'etiquette', for: 'fe-type' }, 'Type'),
        h('select', {
          class: 'champ', id: 'fe-type', 'data-f': 'fe:type',
          onchange: (e) => { formEchange.type = (e.target as HTMLSelectElement).value; },
        }, ...types.map((t) => h('option', { value: t.cle, selected: formEchange.type === t.cle }, t.libelle))))),
    h('div', { class: 'groupe' },
      h('label', { class: 'etiquette', for: 'fe-note' }, 'Ce qui s’est dit'),
      h('p', { class: 'fiche-mention', id: 'fe-mention' }, 'Ces notes sont communicables à la personne concernée. S’en tenir aux faits professionnels.'),
      h('textarea', {
        class: 'champ', id: 'fe-note', 'data-f': 'fe:note', 'aria-describedby': 'fe-mention', maxlength: 5000,
        oninput: (e) => { formEchange.note = (e.target as HTMLTextAreaElement).value; },
      }, formEchange.note)),
    formEchange.message && h('p', { class: 'erreur', role: 'alert' }, formEchange.message),
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn-plein', 'data-f': 'fe:envoyer' }, 'Journaliser')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!dateValide(formEchange.date)) { formEchange.message = 'Une date est requise.'; rendre(); return; }
    if (!formEchange.type) { formEchange.message = 'Aucun type d’échange n’est défini.'; rendre(); return; }
    const note = formEchange.note.trim();
    const cle = `tmp-${++nTemp}`;
    const nouveau: Corps = { contact_id: ID, date: formEchange.date, type: formEchange.type };
    if (note) nouveau.note = note;
    provisoiresEchanges.push({
      id: cle, contact_id: ID, date: formEchange.date, type: formEchange.type, note: note || null, cree_le: new Date().toISOString(),
    });
    formEchange.note = '';
    formEchange.message = '';
    formEchange.ouvert = false;
    empiler('echange', cle, 'create', nouveau);
  });
  return form;
}

// ----- assemblage

function rendreMaintenant(): void {
  if (!serveur) return;
  const racine = corps();
  if (absent) {
    racine.replaceChildren(h('p', { class: 'fiche-vide' }, 'Ce contact n’existe plus. ', h('a', { href: '/gestionnaire/suivi' }, 'Retour à la liste')));
    rendreEtat();
    return;
  }
  const c = contactAffiche();
  if (!c) return;

  // Le rendu reconstruit les nœuds : le focus (et la sélection d'un champ de saisie) est remis là où il était.
  const actif = document.activeElement as HTMLElement | null;
  const cible = racine.contains(actif) ? (actif?.dataset?.f ?? null) : null;
  const saisie = actif instanceof HTMLInputElement || actif instanceof HTMLTextAreaElement ? actif : null;
  let selection: [number | null, number | null] | null = null;
  try {
    selection = saisie ? [saisie.selectionStart, saisie.selectionEnd] : null;
  } catch { /* type sans sélection (date, e-mail) */ }

  enRendu = true;
  try {
    racine.replaceChildren(enteteContact(c), blocSujets(), blocEchanges());
  } finally {
    enRendu = false;
  }

  // Un champ ouvert garde le focus ; sinon on remet le focus là où il était, avec sa sélection.
  const voulu = edition ? edition.cle : cible;
  const el = voulu ? racine.querySelector<HTMLElement>(`[data-f="${CSS.escape(voulu)}"]`) : null;
  if (el) {
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        if (selection && selection[0] !== null && selection[1] !== null && actif?.dataset?.f === voulu) el.setSelectionRange(selection[0], selection[1]);
        else if (el.type === 'text') el.setSelectionRange(el.value.length, el.value.length);
      } catch { /* type sans sélection */ }
    }
  }
  if (sujetVise && !sujetMontre) {
    const ligne = document.getElementById(`sujet-${sujetVise}`);
    if (ligne) {
      sujetMontre = true;
      ligne.scrollIntoView({ block: 'center' });
    }
  }
  rendreEtat();
}

/** Le rendu attend le relâchement d'un clic en cours : voir sansPerdreLeClic (commun.ts). */
const rendre = sansPerdreLeClic(rendreMaintenant);

// ---------------------------------------------------------------- démarrage

function demarrer(): void {
  const racine = document.getElementById('fiche-corps');
  if (!racine || !ID) return;
  brancher({
    rendre,
    rendreEtat,
    integrer: (entite, item) => {
      if (!serveur) return;
      const liste: { id: string }[] = entite === 'contact' ? serveur.contacts : entite === 'sujet' ? serveur.sujets : serveur.echanges;
      const i = liste.findIndex((x) => x.id === item.id);
      if (i >= 0) liste[i] = { ...liste[i], ...item };
      else liste.push(item);
    },
    retirerProvisoire: (entite, cle) => {
      const prov = entite === 'sujet' ? provisoiresSujets : provisoiresEchanges;
      const i = prov.findIndex((x) => x.id === cle);
      if (i >= 0) prov.splice(i, 1);
    },
  });
  const initial = async (): Promise<void> => {
    if (await charger()) return;
    racine.replaceChildren(
      h('p', { class: 'fiche-vide' },
        liaison.sessionPerdue ? 'Votre session a expiré : reconnectez-vous. ' : 'La fiche n’a pas pu être chargée. ',
        !liaison.sessionPerdue && h('button', { type: 'button', class: 'btn', onclick: () => void initial() }, 'Réessayer')));
  };
  void initial();
  demarrerSondage();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) arreterSondage();
    else {
      demarrerSondage();
      void sonder();
    }
  });
  window.addEventListener('online', () => {
    liaison.ko = false;
    toutRejouer();
    void sonder();
  });
  window.addEventListener('offline', () => {
    liaison.ko = true;
    rendreEtat();
  });
  window.addEventListener('beforeunload', (e) => {
    if (ecrituresEnFile()) e.preventDefault();
  });
}

demarrer();
