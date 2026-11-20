// Module de suivi, côté client : la liste des contacts (lot 03), le kanban des sujets et le parcours de
// prospection (lot 05). JavaScript écrit à la main, aucun framework, aucun domaine externe : tout passe par
// /api/suivi (lot 02), les trois vues travaillent sur le même état chargé (/api/suivi/etat).
//
// Principe : l'état du serveur (`serveur`) n'est jamais modifié par une saisie. Chaque modification entre
// dans la file d'écritures de src/scripts/commun.ts (une file par objet) ; ce qui s'affiche est l'état du
// serveur recouvert des écritures encore en file. Une écriture qui échoue reste donc visible, marquée,
// jusqu'à ce qu'elle passe ou que l'utilisateur l'abandonne : rien ne disparaît sans qu'il le sache.

import {
  api, brancher, clesMarquees, couleurMembre, ecrituresEnFile, ECRAN_LISTES, empiler, estTerminal, fileExistante, h, liaison,
  marque, MARQUEUR, reseauRetabli, sansPerdreLeClic, toutesOps, toutRejouer,
  type Corps, type Enfant, type Attribut, type Marqueurs,
} from './commun';

// ---------------------------------------------------------------- types

interface Portail { cents: number; le: string | null }
interface Contact {
  id: string;
  nom: string;
  prenom: string | null;
  email: string | null;
  tel: string | null;
  metier: string | null;
  structure: string | null;
  responsable_id: string | null;
  relance: string | null;
  dernier_echange: string | null;
  type_echange: string | null;
  avoirs_cents: number | null;
  avoirs_le: string | null;
  apporteur_id: string | null;
  viewer_id: string | null;
  archive: number;
  etape: string | null;
  types: string[];
  avoirs_portail: Portail | null;
}
interface Sujet { id: string; contact_id: string; statut: string; echeance: string | null; texte: string; archive: number; cree_le: string; fait_le: string | null }
interface Membre { id: string; nom: string; initiale: string; couleur: string; actif: number }
interface ValeurListe { cle: string; libelle: string; ordre: number }
interface Seuils { sans_echange: number; relance: number; arrete: number }
interface Etat {
  version: number;
  /** Faux pour le rôle `lecture` : aucun déplacement n'est proposé (glisser-déposer, boutons, liste). */
  peut_ecrire?: boolean;
  seuils: Seuils;
  /** Clés terminales par liste (colonne `terminal` de liste_valeur), actives ou non. */
  terminaux: Record<string, string[]>;
  /** Rôles que le code attend de certaines valeurs (colonne `marqueur`), sur les valeurs actives seulement. */
  marqueurs: Marqueurs;
  contacts: Contact[];
  sujets: Sujet[];
  membres: Membre[];
  listes: Record<string, ValeurListe[]>;
}

type Indicateur = 'vus' | 'ouverts' | 'encours' | 'attente' | 'retard' | 'relance' | 'sans' | 'avoirs';
type Vue = 'liste' | 'kanban' | 'parcours';

// ---------------------------------------------------------------- état

let serveur: Etat | null = null;
let version = 0;
const nouveaux: Contact[] = [];
let nTemp = 0;

let indicateur: Indicateur | null = null;
let membreFiltre: string | null = null;
let recherche = '';
const CLE_VUE = 'suivi.vue';
let vue: Vue = vueRetenue();
let archives = false;

const INTERVALLE_MS = 10000;
/** Les sujets clos ne restent dans le kanban que ce nombre de jours (date de clôture). */
const JOURS_CLOS = 30;

/** La vue choisie la dernière fois ; le stockage du navigateur peut manquer ou refuser, la liste est alors la vue. */
function vueRetenue(): Vue {
  try {
    const v = window.localStorage.getItem(CLE_VUE);
    if (v === 'liste' || v === 'kanban' || v === 'parcours') return v;
  } catch { /* stockage indisponible */ }
  return 'liste';
}
function retenirVue(v: Vue): void {
  try {
    window.localStorage.setItem(CLE_VUE, v);
  } catch { /* stockage indisponible */ }
}

// ---------------------------------------------------------------- utilitaires

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function aujourdhui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const jourUtc = (iso: string): number => {
  const [a, m, j] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, j);
};
const ecartJours = (de: string, a: string): number => Math.round((jourUtc(a) - jourUtc(de)) / 86400000);
const ajouterJours = (iso: string, n: number): string => new Date(jourUtc(iso) + n * 86400000).toISOString().slice(0, 10);

const MOIS = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function dateCourte(iso: string): string {
  const annee = Number(iso.slice(0, 4));
  return MOIS.format(new Date(jourUtc(iso))) + (annee !== new Date().getFullYear() ? ` ${annee}` : '');
}

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euros = (cents: number): string => EUROS.format(cents / 100);
function eurosCompact(cents: number): string {
  const m = cents / 100 / 1_000_000;
  return Math.abs(m) >= 1 ? `${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€` : euros(cents);
}

/** « 12 345,67 » → 1234567. Virgule décimale seulement, deux décimales au plus (même règle que gestion.ts). */
function lireEuros(s: string): number | null {
  const m = /^(-?)(\d{1,12})(?:[,.](\d{1,2}))?$/.exec(s.replace(/[\s  €]/g, ''));
  if (!m) return null;
  const v = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] && v ? -v : v;
}
const formEuros = (cents: number | null): string =>
  cents === null ? '' : `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, '0')}`;

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

/** Le contact tel que l'utilisateur doit le voir : état du serveur recouvert des écritures en file. */
function appliquer(c: Contact): Contact {
  const f = fileExistante('contact', c.id);
  if (!f) return c;
  const v: Contact = { ...c };
  for (const op of f.ops) if (op.kind === 'patch') Object.assign(v, op.corps);
  return v;
}

const tousContacts = (): Contact[] => (serveur ? [...serveur.contacts, ...nouveaux].map(appliquer) : []);

/** Le sujet tel que l'utilisateur doit le voir, de la même façon : un sujet avancé depuis le kanban change aussitôt partout. */
function appliquerSujet(x: Sujet): Sujet {
  const f = fileExistante('sujet', x.id);
  if (!f) return x;
  const v: Sujet = { ...x };
  for (const op of f.ops) Object.assign(v, op.corps);
  return v;
}

const tousSujets = (): Sujet[] => (serveur ? serveur.sujets.map(appliquerSujet) : []);

interface Avoirs { cents: number; le: string | null; portail: boolean }
function avoirsDe(c: Contact): Avoirs | null {
  // Contact du portail : sans arrêté il n'y a pas d'avoirs à afficher (ni à compter).
  if (c.viewer_id) return c.avoirs_portail && c.avoirs_portail.le !== null ? { ...c.avoirs_portail, portail: true } : null;
  return c.avoirs_cents === null || c.avoirs_cents === undefined ? null : { cents: c.avoirs_cents, le: c.avoirs_le, portail: false };
}

const libelle = (liste: string, cle: string | null): string =>
  cle === null ? '' : (serveur?.listes[liste]?.find((v) => v.cle === cle)?.libelle ?? cle);

/** « ouvert » : tout sujet non archivé dont le statut n'est pas terminal dans statut_sujet (voir estTerminal). */
const estClos = (s: Sujet): boolean => estTerminal(serveur?.terminaux, 'statut_sujet', s.statut);
const estOuvert = (s: Sujet): boolean => s.archive === 0 && !estClos(s);

interface Calcul {
  actifs: Contact[];
  sujetsDe: Map<string, Sujet[]>;
  compte: Record<Indicateur, number>;
  avoirsTotal: number;
  filtres: Record<Indicateur, (c: Contact) => boolean>;
  /** Indicateurs sans valeur qui les porte : le message qui remplace leur chiffre. Jamais un zéro silencieux. */
  manques: Partial<Record<Indicateur, string>>;
}

function calculer(): Calcul {
  const s = serveur!;
  const aujourd = aujourdhui();
  const actifs = tousContacts().filter((c) => c.archive === 0);
  const ids = new Set(actifs.map((c) => c.id));
  const sujetsDe = new Map<string, Sujet[]>();
  for (const x of tousSujets()) {
    if (x.archive !== 0 || !ids.has(x.contact_id)) continue;
    sujetsDe.set(x.contact_id, [...(sujetsDe.get(x.contact_id) ?? []), x]);
  }
  const tous = [...sujetsDe.values()].flat();
  const enRetard = (x: Sujet): boolean => estOuvert(x) && x.echeance !== null && x.echeance < aujourd;
  const limite = ajouterJours(aujourd, s.seuils.relance);
  const a = (c: Contact, f: (x: Sujet) => boolean): boolean => (sujetsDe.get(c.id) ?? []).some(f);
  // « En cours » et « En attente » : les statuts qui portent ces marqueurs dans la liste du cabinet. Sans eux, rien à compter.
  const enCours = new Set(clesMarquees(s.marqueurs, 'statut_sujet', MARQUEUR.EN_COURS));
  const enAttente = new Set(clesMarquees(s.marqueurs, 'statut_sujet', MARQUEUR.EN_ATTENTE));
  const manques: Partial<Record<Indicateur, string>> = {};
  if (enCours.size === 0) manques.encours = 'Aucun statut n’est marqué « Indicateur En cours ».';
  if (enAttente.size === 0) manques.attente = 'Aucun statut n’est marqué « Indicateur En attente ».';
  const filtres: Record<Indicateur, (c: Contact) => boolean> = {
    vus: (c) => c.dernier_echange === aujourd,
    ouverts: (c) => a(c, estOuvert),
    encours: (c) => a(c, (x) => enCours.has(x.statut)),
    attente: (c) => a(c, (x) => enAttente.has(x.statut)),
    retard: (c) => a(c, enRetard),
    relance: (c) => c.relance !== null && c.relance <= limite,
    sans: (c) => c.dernier_echange === null || ecartJours(c.dernier_echange, aujourd) >= s.seuils.sans_echange,
    avoirs: (c) => avoirsDe(c) !== null,
  };
  const compte: Record<Indicateur, number> = {
    vus: actifs.filter(filtres.vus).length,
    ouverts: tous.filter(estOuvert).length,
    encours: tous.filter((x) => enCours.has(x.statut)).length,
    attente: tous.filter((x) => enAttente.has(x.statut)).length,
    retard: tous.filter(enRetard).length,
    relance: actifs.filter(filtres.relance).length,
    sans: actifs.filter(filtres.sans).length,
    avoirs: actifs.filter(filtres.avoirs).length,
  };
  const avoirsTotal = actifs.reduce((t, c) => t + (avoirsDe(c)?.cents ?? 0), 0);
  return { actifs, sujetsDe, compte, avoirsTotal, filtres, manques };
}

// ---------------------------------------------------------------- rendu

const corps = (): HTMLElement => document.getElementById('suivi-corps')!;
let dialogue: HTMLDialogElement | null = null;

function rendreEtat(): void {
  const el = document.getElementById('suivi-etat');
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
  const alertes = document.getElementById('suivi-alertes');
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

function annoncer(message: string, annuler?: () => void): void {
  const zone = document.getElementById('suivi-alertes');
  if (!zone) return;
  zone.querySelector('[data-annonce]')?.remove();
  const p = h('p', { class: 'info', 'data-annonce': '' }, message);
  if (annuler) {
    p.append(' ', h('button', { class: 'btn', type: 'button', onclick: () => { p.remove(); annuler(); } }, 'Annuler'));
  }
  zone.append(p);
  window.setTimeout(() => p.remove(), 12000);
}

function rendreMaintenant(): void {
  const racine = corps();
  if (!serveur) return;
  const actif = document.activeElement as HTMLElement | null;
  const cible = focusDemande ?? actif?.dataset?.f ?? null;
  focusDemande = null;
  const c = calculer();
  const champRecherche = racine.querySelector<HTMLInputElement>('#suivi-q');
  const garde = champRecherche ? { debut: champRecherche.selectionStart, fin: champRecherche.selectionEnd } : null;

  const kpis = h('ul', { class: 'suivi-kpis', 'aria-label': 'Indicateurs du suivi' });
  const s = serveur.seuils;
  const defs: [Indicateur, string, boolean, Enfant][] = [
    ['vus', 'Vus aujourd’hui', false, h('span', { class: 'chiffre' }, String(c.compte.vus), h('small', {}, ` / ${c.actifs.length}`))],
    ['ouverts', 'Sujets ouverts', false, null],
    ['encours', 'En cours', false, null],
    ['attente', 'En attente', false, null],
    ['retard', 'En retard', true, null],
    ['relance', `À rappeler sous ${s.relance} j`, true, null],
    ['sans', `Sans échange ${s.sans_echange} j`, true, null],
    ['avoirs', `Avoirs suivis · ${c.compte.avoirs} fiche${c.compte.avoirs > 1 ? 's' : ''}`, false, h('span', { class: 'chiffre' }, eurosCompact(c.avoirsTotal))],
  ];
  for (const [id, nom, alerte, chiffre] of defs) {
    const manque = c.manques[id];
    if (manque) {
      // Pas de bouton ni de chiffre : un indicateur sans valeur à compter le dit, et dit où le régler.
      if (indicateur === id) indicateur = null;
      kpis.append(
        h('li', {},
          h('div', { class: 'suivi-kpi manque' },
            h('span', { class: 'chiffre', 'aria-hidden': 'true' }, '—'),
            h('span', { class: 'etiquette' }, nom),
            h('span', { class: 'suivi-kpi-message', role: 'status' }, manque, ' ', h('a', { href: ECRAN_LISTES }, 'Régler dans les listes'))),
        ),
      );
      continue;
    }
    const rouge = alerte && c.compte[id] > 0;
    kpis.append(
      h('li', {},
        h('button', {
          type: 'button',
          class: `suivi-kpi${rouge ? ' alerte' : ''}`,
          'aria-pressed': indicateur === id ? 'true' : 'false',
          'data-f': `kpi:${id}`,
          onclick: () => { indicateur = indicateur === id ? null : id; rendre(); },
        }, chiffre ?? h('span', { class: 'chiffre' }, String(c.compte[id])), h('span', { class: 'etiquette' }, nom)),
      ),
    );
  }

  const membres = serveur.membres.filter((m) => m.actif === 1);
  const outils = h('section', { class: 'suivi-outils', 'aria-label': 'Filtres' },
    h('div', { class: 'suivi-recherche' },
      h('label', { for: 'suivi-q', class: 'etiquette', style: 'position:absolute;left:-9999px' }, 'Rechercher'),
      h('input', {
        id: 'suivi-q', type: 'search', value: recherche, autocomplete: 'off',
        placeholder: 'Rechercher un nom, une structure, un sujet…',
        oninput: (e) => { recherche = (e.target as HTMLInputElement).value; rendre(); },
      }),
    ),
    h('div', { class: 'suivi-bascule', role: 'group', 'aria-label': 'Affichage' },
      ...(['liste', 'kanban', 'parcours'] as Vue[]).map((v) =>
        h('button', {
          type: 'button', 'aria-pressed': vue === v ? 'true' : 'false', 'data-f': `vue:${v}`,
          onclick: () => { vue = v; retenirVue(v); rendre(); },
        }, v === 'liste' ? 'Liste' : v === 'kanban' ? 'Kanban' : 'Parcours')),
    ),
    membres.length > 0 && h('div', { class: 'suivi-membres', role: 'group', 'aria-label': 'En charge' },
      h('span', { class: 'etiquette' }, 'En charge'),
      ...membres.map((m) =>
        h('button', {
          type: 'button', 'aria-pressed': membreFiltre === m.id ? 'true' : 'false', 'data-f': `membre:${m.id}`,
          onclick: () => { membreFiltre = membreFiltre === m.id ? null : m.id; rendre(); },
        }, avatar(m), m.nom)),
    ),
    h('label', { class: 'suivi-archives' },
      h('input', { type: 'checkbox', checked: archives, 'data-f': 'archives', onchange: (e) => { archives = (e.target as HTMLInputElement).checked; rendre(); } }),
      'Archivés'),
    h('button', { type: 'button', class: 'btn-plein suivi-nouveau', 'data-f': 'nouveau', onclick: (e) => ouvrirDialogue(null, e.currentTarget as HTMLElement) }, 'Nouveau contact'),
  );

  const principal = h('div', {}, vue === 'kanban' ? kanban(c) : vue === 'parcours' ? parcours(c) : liste(c));

  const note = h('p', { class: 'suivi-note' },
    `Les avoirs d’un contact rattaché au portail viennent de ses enveloppes et portent la date de son dernier arrêté ; ils ne sont pas saisis ici. Une date en rouge signale un arrêté de plus de ${s.arrete} jours.`);
  racine.replaceChildren(kpis, outils, principal, ...(vue === 'kanban' ? [] : [note]));

  // Le rendu reconstruit les nœuds : le focus (et la sélection du champ de recherche) est remis là où il était.
  if (cible) racine.querySelector<HTMLElement>(`[data-f="${CSS.escape(cible)}"]`)?.focus();
  else if (actif && actif.id === 'suivi-q') {
    const q = racine.querySelector<HTMLInputElement>('#suivi-q');
    q?.focus();
    if (q && garde?.debut != null && garde.fin != null) q.setSelectionRange(garde.debut, garde.fin);
  }
  rendreEtat();
}

function avatar(m: Membre | undefined): HTMLElement | null {
  if (!m) return null;
  const a = h('span', { class: 'suivi-avatar', 'aria-hidden': 'true' }, m.initiale);
  a.style.backgroundColor = couleurMembre(m.couleur);
  return a;
}

/**
 * Les contacts que les trois vues ont à montrer : archivés ou non selon la case, puis indicateur, membre en
 * charge et recherche. `base` : ceux qu'on aurait sans filtre (pour distinguer « rien » de « rien ne correspond »).
 */
function portee(c: Calcul): { base: Contact[]; visibles: Contact[]; q: string } {
  const q = norm(recherche.trim());
  const base = tousContacts().filter((x) => archives || x.archive === 0);
  const sujetsTous = new Map<string, Sujet[]>();
  for (const x of tousSujets()) if (x.archive === 0) sujetsTous.set(x.contact_id, [...(sujetsTous.get(x.contact_id) ?? []), x]);
  const visibles = base.filter((x) => {
    if (indicateur && !c.filtres[indicateur](x)) return false;
    if (membreFiltre && x.responsable_id !== membreFiltre) return false;
    if (q) {
      const texte = norm([x.nom, x.prenom, x.structure, ...(sujetsTous.get(x.id) ?? []).map((y) => y.texte)].filter(Boolean).join(' '));
      if (!texte.includes(q)) return false;
    }
    return true;
  });
  return { base, visibles, q };
}

function liste(c: Calcul): HTMLElement {
  const s = serveur!;
  const aujourd = aujourdhui();
  const limite = ajouterJours(aujourd, s.seuils.relance);
  const { base, visibles } = portee(c);
  if (visibles.length === 0) {
    return h('p', { class: 'suivi-vide' }, base.length === 0 ? 'Aucun contact pour l’instant. Créez le premier avec « Nouveau contact ».' : 'Aucun contact ne correspond à ces filtres.');
  }

  // Apports : pour un prescripteur, les contacts qu'il a apportés et leurs avoirs.
  const clients = new Set(clesMarquees(s.marqueurs, 'type_contact', MARQUEUR.CLIENT));
  const apports = new Map<string, Contact[]>();
  for (const x of c.actifs) if (x.apporteur_id) apports.set(x.apporteur_id, [...(apports.get(x.apporteur_id) ?? []), x]);

  const entete = (t: string, num = false) => h('th', { scope: 'col', class: num ? 'num' : undefined }, t);
  const tbody = h('tbody', {});
  for (const x of visibles) {
    const sujets = (c.sujetsDe.get(x.id) ?? []).filter(estOuvert);
    const retard = sujets.filter((y) => y.echeance !== null && y.echeance < aujourd).length;
    const membre = s.membres.find((m) => m.id === x.responsable_id);
    const av = avoirsDe(x);
    const apportes = apports.get(x.id) ?? [];
    const sous = [libelle('metier', x.metier), x.structure].filter(Boolean).join(' · ');
    const perime = av?.portail && av.le !== null && ecartJours(av.le, aujourd) > s.seuils.arrete;

    tbody.append(
      h('tr', { class: x.archive ? 'archive' : undefined },
        h('td', {},
          // Contact enregistré : le nom ouvre sa fiche (lot 04). Contact pas encore créé : pas de fiche, on garde la fenêtre.
          x.id.startsWith('tmp-')
            ? h('button', { type: 'button', class: 'suivi-nom', 'data-f': `nom:${x.id}`, onclick: (e) => ouvrirDialogue(x.id, e.currentTarget as HTMLElement) },
              `${x.nom.toLocaleUpperCase('fr')}${x.prenom ? ` ${x.prenom}` : ''}`)
            : h('a', { class: 'suivi-nom', 'data-f': `nom:${x.id}`, href: `/gestionnaire/suivi/${encodeURIComponent(x.id)}` },
              `${x.nom.toLocaleUpperCase('fr')}${x.prenom ? ` ${x.prenom}` : ''}`),
          !x.id.startsWith('tmp-') && h('button', { type: 'button', class: 'suivi-modifier', 'data-f': `modifier:${x.id}`, 'aria-label': `Modifier ${x.nom}`, onclick: (e) => ouvrirDialogue(x.id, e.currentTarget as HTMLElement) }, 'Modifier'),
          sous && h('span', { class: 'suivi-sous' }, sous),
          x.archive === 1 && h('span', { class: 'suivi-marque' }, 'Archivé'),
          marque('contact', x.id, 'suivi-marque'),
        ),
        h('td', {},
          ...x.types.map((t) => h('span', { class: `suivi-pastille${clients.has(t) ? ' client' : ''}` }, libelle('type_contact', t))),
          x.viewer_id && h('span', { class: 'suivi-portail' }, 'Portail'),
        ),
        h('td', {}, membre ? h('span', {}, avatar(membre), ' ', membre.nom) : '—'),
        h('td', { class: 'num' }, celluleAvoirs(x, av, apportes, perime)),
        h('td', {}, x.dernier_echange ? `${x.type_echange ? `${libelle('type_echange', x.type_echange)}, ` : ''}${dateCourte(x.dernier_echange)}` : '—'),
        h('td', {}, celluleRelance(x.relance, aujourd, limite)),
        h('td', {}, sujets.length === 0 ? '—' : retard > 0 ? h('span', { class: 'alerte' }, `${retard} en retard`) : `${sujets.length} ouvert${sujets.length > 1 ? 's' : ''}`),
      ),
    );
  }
  return h('div', { class: 'defile' },
    h('table', { class: 'table suivi-liste' },
      h('thead', {}, h('tr', {}, entete('Contact'), entete('Type'), entete('En charge'), entete('Avoirs', true), entete('Dernier échange'), entete('Relance'), entete('Sujets'))),
      tbody));
}

function celluleAvoirs(c: Contact, av: Avoirs | null, apportes: Contact[], perime: boolean | null | undefined): Enfant {
  if (av) {
    return h('span', {},
      h('span', { class: `gros${av.portail ? '' : ' saisi'}` }, euros(av.cents)),
      h('span', { class: `suivi-sous mono${perime ? ' perime' : ''}` },
        av.portail ? (av.le ? `au ${dateCourte(av.le)}` : 'aucun arrêté') : av.le ? `saisi au ${dateCourte(av.le)}` : 'saisi à la main'));
  }
  if (c.viewer_id) return h('span', {}, '—', h('span', { class: 'suivi-sous mono perime' }, 'aucun arrêté'));
  if (apportes.length > 0) {
    const total = apportes.reduce((t, c) => t + (avoirsDe(c)?.cents ?? 0), 0);
    return h('span', {}, `${apportes.length} apport${apportes.length > 1 ? 's' : ''}`, total > 0 && h('span', { class: 'suivi-sous mono' }, eurosCompact(total)));
  }
  return '—';
}

function celluleRelance(r: string | null, aujourd: string, limite: string): Enfant {
  if (!r) return '—';
  if (r < aujourd) return h('span', { class: 'alerte' }, `${dateCourte(r)} · en retard`);
  return r <= limite ? h('span', { style: 'color: var(--accent-clair)' }, dateCourte(r)) : dateCourte(r);
}

// ---------------------------------------------------------------- kanban et parcours

const nomComplet = (c: Contact): string => `${c.nom.toLocaleUpperCase('fr')}${c.prenom ? ` ${c.prenom}` : ''}`;

function lienContact(x: Contact): HTMLElement {
  // Un contact pas encore créé n'a pas de fiche.
  return x.id.startsWith('tmp-')
    ? h('span', { class: 'suivi-nom' }, nomComplet(x))
    : h('a', { class: 'suivi-nom', href: `/gestionnaire/suivi/${encodeURIComponent(x.id)}` }, nomComplet(x));
}

/** Cible de dépôt d'une colonne : ce qu'elle accepte (sujets ou contacts) et ce qui se passe à l'arrivée d'une carte. */
interface Depot { type: 'sujet' | 'contact'; cle: string; deposer: (id: string, cle: string) => void }

function colonneDe(classe: string, id: string, titre: string, entete: Enfant[], cartes: HTMLElement[], vide: string, pied?: string, depot?: Depot): HTMLElement {
  const colonne = h('section', { class: `suivi-colonne ${classe}`.trim(), 'aria-labelledby': id },
    h('header', {}, h('h2', { id }, titre), ...entete),
    cartes.length ? h('ul', { class: 'suivi-cartes' }, ...cartes) : h('p', { class: 'suivi-colonne-vide' }, vide),
    pied && h('p', { class: 'suivi-colonne-pied' }, pied));
  if (depot && peutEcrire()) brancherDepot(colonne, depot);
  return colonne;
}

// ---------------------------------------------------------------- glisser-déposer
// L'API HTML5 native, sans bibliothèque. Le glisser-déposer s'ajoute aux boutons et à la liste « Déplacer vers… »
// de chaque carte, il ne les remplace pas : au clavier et au toucher, ce sont eux qui font le déplacement.
// Un dépôt appelle le même code que ces boutons (deplacerSujet, deplacerContact) : même file d'écritures, mêmes règles.

/** Ce qui est en train d'être glissé. Les dépôts d'une carte d'une autre nature (sujet sur le parcours) sont ignorés. */
let glisse: { type: 'sujet' | 'contact'; id: string } | null = null;
let renduDiffere = false;
/** Le `data-f` à refocaliser au prochain rendu : la carte déplacée, que le rendu reconstruit dans sa nouvelle colonne. */
let focusDemande: string | null = null;

const peutEcrire = (): boolean => serveur?.peut_ecrire !== false;

function classe(el: HTMLElement, nom: string, actif: boolean): void {
  const autres = el.className.split(/\s+/).filter((c) => c && c !== nom);
  el.className = (actif ? [...autres, nom] : autres).join(' ');
}

function finGlisse(): void {
  glisse = null;
  for (const e of corps().querySelectorAll<HTMLElement>('.glisse')) classe(e, 'glisse', false);
  for (const e of corps().querySelectorAll<HTMLElement>('.cible')) classe(e, 'cible', false);
  if (renduDiffere) {
    renduDiffere = false;
    rendre();
  }
}

/** Rend une carte glissable : elle porte son identifiant et sa nature. */
function brancherCarte(carte: HTMLElement, type: 'sujet' | 'contact', id: string): void {
  if (!peutEcrire() || id.startsWith('tmp-')) return; // un contact pas encore créé n'a pas d'identifiant définitif
  carte.setAttribute('draggable', 'true');
  carte.addEventListener('dragstart', (e) => {
    const ev = e as DragEvent;
    glisse = { type, id };
    ev.dataTransfer?.setData('text/plain', id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    classe(carte, 'glisse', true);
  });
  carte.addEventListener('dragend', finGlisse);
}

function brancherDepot(colonne: HTMLElement, depot: Depot): void {
  const accepte = (): boolean => glisse !== null && glisse.type === depot.type;
  const survol = (e: Event): void => {
    if (!accepte()) return;
    e.preventDefault(); // sans cela le navigateur refuse le dépôt
    const ev = e as DragEvent;
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    classe(colonne, 'cible', true);
  };
  colonne.addEventListener('dragenter', survol);
  colonne.addEventListener('dragover', survol);
  colonne.addEventListener('dragleave', (e) => {
    const vers = (e as DragEvent).relatedTarget as Node | null;
    if (!vers || !colonne.contains?.(vers)) classe(colonne, 'cible', false);
  });
  colonne.addEventListener('drop', (e) => {
    if (!accepte()) return;
    e.preventDefault();
    classe(colonne, 'cible', false);
    const { id } = glisse!;
    depot.deposer(id, depot.cle);
  });
}

/**
 * Les gestes de déplacement d'une carte, communs au kanban et au parcours : reculer, avancer d'un cran (boutons), et
 * « Déplacer vers… » qui saute n'importe où (liste déroulante, au clavier comme au toucher). Rien pour le rôle `lecture`.
 */
function gestesDeplacement(
  data: string, intitule: string, courante: string | null, cibles: ValeurListe[], precedent: ValeurListe | null, suivant: ValeurListe | null,
  deplacer: (cle: string) => void,
): Enfant[] {
  if (!peutEcrire()) return [];
  const autres = cibles.filter((v) => v.cle !== courante);
  return [
    precedent && h('button', {
      type: 'button', class: 'suivi-avancer suivi-reculer', 'data-f': `reculer:${data}`,
      'aria-label': `Ramener ${intitule} à « ${precedent.libelle} »`,
      onclick: () => deplacer(precedent.cle),
    }, `← ${precedent.libelle}`),
    suivant && h('button', {
      type: 'button', class: 'suivi-avancer', 'data-f': data,
      'aria-label': `Passer ${intitule} à « ${suivant.libelle} »`,
      onclick: () => deplacer(suivant.cle),
    }, `→ ${suivant.libelle}`),
    autres.length > 0 && h('select', {
      class: 'suivi-saut', 'data-f': `saut:${data}`, 'aria-label': `Déplacer ${intitule} vers…`,
      onchange: (e) => {
        const choix = e.target as HTMLSelectElement;
        if (choix.value) deplacer(choix.value);
      },
    }, h('option', { value: '' }, 'Déplacer vers…'), ...autres.map((v) => h('option', { value: v.cle }, v.libelle))),
  ];
}

/**
 * Une colonne de sujets clos n'affiche que ceux clos depuis JOURS_CLOS jours ; les autres ne sont que comptés.
 * Date de clôture : `fait_le`, à défaut la date de création (un sujet clos ne l'a pas été avant d'être créé :
 * créé récemment, il a été clos récemment). Sans l'une ni l'autre qui soit récente, il compte parmi les anciens.
 */
function bornerClos(items: Sujet[]): { recents: Sujet[]; pied: string | undefined } {
  const limite = ajouterJours(aujourdhui(), -JOURS_CLOS);
  const recents = items.filter((x) => (x.fait_le ?? x.cree_le.slice(0, 10)) >= limite);
  const n = items.length - recents.length;
  return { recents, pied: n > 0 ? `${n} sujet${n > 1 ? 's' : ''} clos plus ancien${n > 1 ? 's' : ''}` : undefined };
}

const nombre = (n: number): HTMLElement => h('span', { class: 'suivi-colonne-n' }, String(n));

/** Une colonne par statut de statut_sujet, dans l'ordre de la liste ; les sujets dont le statut n'y est plus dans une colonne à part. */
function kanban(c: Calcul): HTMLElement {
  const s = serveur!;
  const { visibles, q } = portee(c);
  const statuts = s.listes.statut_sujet ?? [];
  const parId = new Map(visibles.map((x) => [x.id, x]));
  const sujets = tousSujets()
    .filter((x) => {
      const ct = parId.get(x.contact_id);
      if (!ct || x.archive !== 0) return false;
      // Une recherche qui ne tient qu'au texte d'un sujet ne garde que ce sujet, pas toutes les cartes du contact.
      return !q || norm([ct.nom, ct.prenom, ct.structure].filter(Boolean).join(' ')).includes(q) || norm(x.texte).includes(q);
    })
    .sort((a, b) => {
      const ea = a.echeance ?? '9999';
      const eb = b.echeance ?? '9999';
      return ea !== eb ? (ea < eb ? -1 : 1) : a.cree_le < b.cree_le ? -1 : a.cree_le > b.cree_le ? 1 : 0;
    });
  const connus = new Set(statuts.map((v) => v.cle));
  const colonnes = statuts.map((v, i) => {
    const terminale = estTerminal(s.terminaux, 'statut_sujet', v.cle);
    const tous = sujets.filter((x) => x.statut === v.cle);
    const { recents, pied } = terminale ? bornerClos(tous) : { recents: tous, pied: undefined };
    return colonneDe(terminale ? 'terminale' : '', `kb-${i}`, v.libelle,
      [nombre(recents.length)], recents.map((x) => carteSujet(x, parId.get(x.contact_id)!, false)), 'Aucun sujet', pied,
      { type: 'sujet', cle: v.cle, deposer: deplacerSujet });
  });
  // Un statut retiré de la liste mais terminal clôt encore ses sujets : même bornage que sa colonne d'origine.
  const hors = sujets.filter((x) => !connus.has(x.statut));
  if (hors.length > 0) {
    const ouverts = hors.filter((x) => !estClos(x));
    const { recents, pied } = bornerClos(hors.filter(estClos));
    const visibles = hors.filter((x) => ouverts.includes(x) || recents.includes(x));
    colonnes.push(colonneDe('hors', 'kb-hors', 'Statut hors liste', [nombre(visibles.length)], visibles.map((x) => carteSujet(x, parId.get(x.contact_id)!, true)), '', pied));
  }
  if (colonnes.length === 0) return h('p', { class: 'suivi-vide' }, 'Aucun statut n’est défini pour les sujets.');
  return h('div', {}, aideDeplacement(), h('div', { class: 'suivi-colonnes', role: 'group', 'aria-label': 'Sujets par statut' }, ...colonnes));
}

function carteSujet(x: Sujet, ct: Contact, hors: boolean): HTMLElement {
  const retard = !estClos(x) && x.echeance !== null && x.echeance < aujourdhui();
  const statuts = serveur?.listes.statut_sujet ?? [];
  const i = statuts.findIndex((v) => v.cle === x.statut);
  // Les cibles sont les statuts ACTIFS de la liste (celle que sert /api/suivi/etat) : un statut désactivé n'est jamais proposé.
  const carte = h('li', { class: 'suivi-carte', 'data-f': `carte:${x.id}`, tabindex: '-1' },
    h('p', { class: 'suivi-carte-texte' }, x.texte),
    h('p', { class: 'suivi-carte-sous' }, lienContact(ct)),
    h('p', { class: 'suivi-carte-sous' },
      x.echeance ? `Échéance ${dateCourte(x.echeance)}` : 'Sans échéance',
      retard && h('span', { class: 'alerte' }, ' · en retard')),
    hors && h('p', { class: 'suivi-carte-sous' }, `Le statut « ${x.statut} » n’est plus dans la liste.`),
    marque('sujet', x.id, 'suivi-marque'),
    // Boutons (avancer, reculer) et liste « Déplacer vers… » : le déplacement au clavier et au toucher ; le glisser-déposer s'y ajoute.
    h('div', { class: 'suivi-deplacer' },
      ...gestesDeplacement(`avancer:${x.id}`, `« ${x.texte} »`, x.statut, statuts, i > 0 ? statuts[i - 1] : null, i >= 0 ? (statuts[i + 1] ?? null) : null,
        (cle) => deplacerSujet(x.id, cle))));
  brancherCarte(carte, 'sujet', x.id);
  return carte;
}

/**
 * Le sujet passe à n'importe quel statut actif de la liste : le suivant, le précédent, ou un saut (« À faire » → « Fait »).
 * Entrant dans un statut terminal il prend la date du jour comme date de clôture (gardée s'il l'était déjà : clos → clos) ;
 * sortant d'un statut terminal (réouverture) il la perd, et redevient « ouvert » dans les indicateurs.
 */
function deplacerSujet(id: string, cle: string): void {
  const s = serveur;
  const x = tousSujets().find((y) => y.id === id);
  if (!s || !x || !peutEcrire() || x.statut === cle) return;
  const cible = (s.listes.statut_sujet ?? []).find((v) => v.cle === cle);
  if (!cible) return; // pas dans la liste active : refusé aussi par le serveur
  const clos = estTerminal(s.terminaux, 'statut_sujet', cle);
  focusDemande = `carte:${id}`;
  empiler('sujet', id, 'patch', { statut: cle, fait_le: clos ? (estClos(x) && x.fait_le ? x.fait_le : aujourdhui()) : null });
  annoncer(`« ${x.texte} » déplacé vers « ${cible.libelle} ».`, () => {
    empiler('sujet', id, 'patch', { statut: x.statut, fait_le: x.fait_le });
  });
}

/**
 * Une colonne par étape de la liste etape, les prospects rangés dedans, leurs avoirs et le total par colonne.
 * Une étape terminale est une sortie (perdu, par défaut) : elle passe en dernier, en retrait. Les prospects
 * sans étape, ou dont l'étape a quitté la liste, ont une colonne à part au début : on ne les perd pas de vue.
 *
 * Les contacts rangés sont ceux dont un type porte le marqueur « parcours » (colonne `marqueur` de liste_valeur) :
 * aucune clé n'est écrite en dur. Si aucun type actif ne le porte, on le dit au lieu d'afficher un parcours vide.
 */
function parcours(c: Calcul): HTMLElement {
  const s = serveur!;
  const typesParcours = new Set(clesMarquees(s.marqueurs, 'type_contact', MARQUEUR.PARCOURS));
  if (typesParcours.size === 0) {
    return h('p', { class: 'suivi-vide', role: 'status' },
      'Aucun type de contact n’est marqué « Alimente le parcours » : le parcours n’a personne à ranger. ',
      h('a', { href: ECRAN_LISTES }, 'Poser le marqueur dans les listes'), '.');
  }
  const etapes = s.listes.etape ?? [];
  if (etapes.length === 0) return h('p', { class: 'suivi-vide' }, 'Aucune étape de prospection n’est définie.');
  const aujourd = aujourdhui();
  const prospects = portee(c).visibles.filter((x) => x.types.some((t) => typesParcours.has(t)));
  const sortie = (v: ValeurListe): boolean => estTerminal(s.terminaux, 'etape', v.cle);
  const connues = new Set(etapes.map((v) => v.cle));

  // Étape suivante : la suivante parmi les étapes qui ne sont pas des sorties, dans l'ordre de la liste, et la précédente de
  // la même façon (reculer). Un prospect sans étape (ou d'une étape retirée) entre à la première ; la dernière étape n'a pas de
  // suite, et une sortie (« perdu ») n'est le suivant d'aucune étape ni n'a de suivant : on y va et on en revient par
  // « Déplacer vers… » ou par le glisser-déposer, jamais par un « suivant » qui le déciderait à la place du conseiller.
  const enAvant = etapes.filter((v) => !sortie(v));
  const voisins = (x: Contact): { precedent: ValeurListe | null; suivant: ValeurListe | null } => {
    if (x.etape === null || !connues.has(x.etape)) return { precedent: null, suivant: enAvant[0] ?? null };
    const i = enAvant.findIndex((v) => v.cle === x.etape);
    return i >= 0 ? { precedent: enAvant[i - 1] ?? null, suivant: enAvant[i + 1] ?? null } : { precedent: null, suivant: null };
  };

  const colonne = (classe: string, id: string, titre: string, items: Contact[], hors: boolean, tag?: string, cle?: string): HTMLElement => {
    const total = items.reduce((t, x) => t + (avoirsDe(x)?.cents ?? 0), 0);
    return colonneDe(classe, id, titre,
      [tag && h('span', { class: 'suivi-colonne-tag' }, tag), nombre(items.length), h('span', { class: 'suivi-colonne-total' }, euros(total))],
      items.map((x) => {
        const av = avoirsDe(x);
        const membre = s.membres.find((m) => m.id === x.responsable_id);
        const sous = [libelle('metier', x.metier), x.structure].filter(Boolean).join(' · ');
        const perime = av?.portail && av.le !== null && ecartJours(av.le, aujourd) > s.seuils.arrete;
        const { precedent, suivant } = voisins(x);
        const carte = h('li', { class: 'suivi-carte', 'data-f': `carte:${x.id}`, tabindex: '-1' },
          h('p', { class: 'suivi-carte-texte' }, lienContact(x)),
          sous && h('p', { class: 'suivi-carte-sous' }, sous),
          h('p', { class: 'suivi-carte-avoirs' }, celluleAvoirs(x, av, [], perime)),
          membre && h('p', { class: 'suivi-carte-sous' }, avatar(membre), ' ', membre.nom),
          hors && x.etape && h('p', { class: 'suivi-carte-sous' }, `L’étape « ${x.etape} » n’est plus dans la liste.`),
          marque('contact', x.id, 'suivi-marque'),
          h('div', { class: 'suivi-deplacer' },
            ...gestesDeplacement(`etape:${x.id}`, nomComplet(x), x.etape, etapes, precedent, suivant, (cle) => deplacerContact(x.id, cle))));
        brancherCarte(carte, 'contact', x.id);
        return carte;
      }),
      'Aucun prospect', undefined, cle === undefined ? undefined : { type: 'contact', cle, deposer: deplacerContact });
  };

  const colonnes: HTMLElement[] = [];
  const sans = prospects.filter((x) => x.etape === null || !connues.has(x.etape));
  if (sans.length > 0) colonnes.push(colonne('hors', 'pc-hors', 'Sans étape', sans, true));
  [...etapes.filter((v) => !sortie(v)), ...etapes.filter(sortie)].forEach((v, i) => {
    colonnes.push(colonne(sortie(v) ? 'sortie' : '', `pc-${i}`, v.libelle, prospects.filter((x) => x.etape === v.cle), false, sortie(v) ? 'Sortie' : undefined, v.cle));
  });
  return h('div', {}, aideDeplacement(), h('div', { class: 'suivi-colonnes', role: 'group', 'aria-label': 'Prospects par étape' }, ...colonnes));
}

/** Le contact passe à n'importe quelle étape active de la liste : suivante, précédente, ou un saut (« Premier contact » → « Proposition »). */
function deplacerContact(id: string, cle: string): void {
  const s = serveur;
  const x = tousContacts().find((y) => y.id === id);
  if (!s || !x || !peutEcrire() || x.etape === cle) return;
  const cible = (s.listes.etape ?? []).find((v) => v.cle === cle);
  if (!cible) return; // pas dans la liste active : refusé aussi par le serveur
  focusDemande = `carte:${id}`;
  empiler('contact', id, 'patch', { etape: cle });
  annoncer(`${nomComplet(x)} déplacé vers « ${cible.libelle} ».`, () => {
    empiler('contact', id, 'patch', { etape: x.etape });
  });
}

const aideDeplacement = (): HTMLElement | false =>
  peutEcrire() && h('p', { class: 'suivi-note' },
    'Glissez une carte vers une colonne pour la déplacer. Sans souris : les boutons fléchés de la carte, ou la liste « Déplacer vers… », vont à n’importe quelle colonne.');

// ---------------------------------------------------------------- fenêtre de saisie

interface Valeurs {
  nom: string; prenom: string; structure: string; email: string; tel: string;
  metier: string; responsable_id: string; relance: string; avoirs: string; types: string[];
}

function valeursDe(c: Contact | null): Valeurs {
  return {
    nom: c?.nom ?? '', prenom: c?.prenom ?? '', structure: c?.structure ?? '', email: c?.email ?? '', tel: c?.tel ?? '',
    metier: c?.metier ?? '', responsable_id: c?.responsable_id ?? '', relance: c?.relance ?? '',
    avoirs: formEuros(c?.avoirs_cents ?? null), types: [...(c?.types ?? [])].sort(),
  };
}

function ouvrirDialogue(id: string | null, declencheur: HTMLElement): void {
  if (!serveur) return;
  const contact = id ? (tousContacts().find((c) => c.id === id) ?? null) : null;
  if (id && !contact) return;
  const initial = valeursDe(contact);
  const liePortail = !!contact?.viewer_id;
  dialogue?.remove();
  const d = h('dialog', { class: 'suivi-dialogue', 'aria-labelledby': 'suivi-dlg-titre' });
  dialogue = d;

  const champ = (nom: keyof Valeurs, etiquette: string, type = 'text', extra: Record<string, Attribut> = {}) =>
    h('div', { class: 'groupe' },
      h('label', { class: 'etiquette', for: `dlg-${nom}` }, etiquette),
      h('input', { class: 'champ', id: `dlg-${nom}`, name: nom, type, value: initial[nom] as string, ...extra }));
  const choix = (nom: 'metier' | 'responsable_id', etiquette: string, options: [string, string][]) =>
    h('div', { class: 'groupe' },
      h('label', { class: 'etiquette', for: `dlg-${nom}` }, etiquette),
      h('select', { class: 'champ', id: `dlg-${nom}`, name: nom },
        h('option', { value: '' }, '—'),
        ...options.map(([v, l]) => h('option', { value: v, selected: initial[nom] === v }, l))));

  const erreur = h('p', { class: 'erreur', role: 'alert' });
  const form = h('form', { novalidate: true },
    h('h2', { id: 'suivi-dlg-titre' }, contact ? 'Modifier le contact' : 'Nouveau contact'),
    h('div', { class: 'grille' },
      champ('nom', 'Nom', 'text', { required: true, autocomplete: 'off' }),
      champ('prenom', 'Prénom', 'text', { autocomplete: 'off' }),
      champ('structure', 'Structure', 'text', { autocomplete: 'off' }),
      choix('metier', 'Métier', (serveur.listes.metier ?? []).map((v) => [v.cle, v.libelle])),
      champ('email', 'E-mail', 'email', { autocomplete: 'off' }),
      champ('tel', 'Téléphone', 'tel', { autocomplete: 'off' }),
      choix('responsable_id', 'En charge', serveur.membres.filter((m) => m.actif === 1 || m.id === initial.responsable_id).map((m) => [m.id, m.nom])),
      champ('relance', 'Relance', 'date'),
    ),
    h('fieldset', {},
      h('legend', { class: 'etiquette' }, 'Type'),
      h('div', { class: 'coches' },
        ...(serveur.listes.type_contact ?? []).map((t) =>
          h('label', {}, h('input', { type: 'checkbox', name: 'types', value: t.cle, checked: initial.types.includes(t.cle) }), t.libelle))),
    ),
    liePortail
      ? h('p', { class: 'aide' }, 'Les avoirs de ce contact viennent de son portail : ils ne se saisissent pas ici.')
      : champ('avoirs', 'Avoirs (€)', 'text', { inputmode: 'decimal', autocomplete: 'off' }),
    erreur,
    h('div', { class: 'actions' },
      h('button', { type: 'submit', class: 'btn-plein' }, 'Enregistrer'),
      h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Fermer'),
      contact && h('button', { type: 'button', class: 'btn', onclick: () => { archiver(contact, contact.archive === 0); d.close(); } },
        contact.archive === 0 ? 'Archiver' : 'Désarchiver'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const lu = lireFormulaire(form);
    const message = valider(lu, liePortail);
    if (message) {
      erreur.textContent = message;
      return;
    }
    enregistrer(contact, initial, lu, liePortail);
    d.close();
  });
  d.addEventListener('close', () => {
    d.remove();
    if (dialogue === d) dialogue = null;
    const retour = document.querySelector<HTMLElement>(`[data-f="${CSS.escape(declencheur.dataset.f ?? '')}"]`);
    (retour ?? declencheur).focus?.();
  });
  d.append(form);
  document.getElementById('suivi')!.append(d);
  d.showModal();
  form.querySelector<HTMLInputElement>('#dlg-nom')?.focus();
}

function lireFormulaire(form: HTMLFormElement): Valeurs {
  const v = (n: string): string => (form.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() ?? '';
  return {
    nom: v('nom'), prenom: v('prenom'), structure: v('structure'), email: v('email'), tel: v('tel'),
    metier: v('metier'), responsable_id: v('responsable_id'), relance: v('relance'), avoirs: v('avoirs'),
    types: [...form.querySelectorAll<HTMLInputElement>('input[name="types"]:checked')].map((i) => i.value).sort(),
  };
}

function valider(v: Valeurs, liePortail: boolean): string | null {
  if (!v.nom) return 'Le nom est requis.';
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return 'Adresse e-mail invalide.';
  if (!liePortail && v.avoirs && lireEuros(v.avoirs) === null) return 'Avoirs : un montant en euros, avec une virgule pour les centimes.';
  return null;
}

/** Corps d'écriture : à la création tout ce qui est renseigné, à la modification seulement ce qui a changé. */
function enregistrer(contact: Contact | null, initial: Valeurs, v: Valeurs, liePortail: boolean): void {
  const creation = contact === null;
  const corps: Corps = {};
  const pose = (cle: string, avant: string, apres: string): void => {
    if (creation ? apres !== '' : avant !== apres) corps[cle] = apres === '' ? null : apres;
  };
  pose('nom', initial.nom, v.nom);
  pose('prenom', initial.prenom, v.prenom);
  pose('structure', initial.structure, v.structure);
  pose('email', initial.email, v.email);
  pose('tel', initial.tel, v.tel);
  pose('metier', initial.metier, v.metier);
  pose('responsable_id', initial.responsable_id, v.responsable_id);
  pose('relance', initial.relance, v.relance);
  if (creation ? v.types.length > 0 : initial.types.join() !== v.types.join()) corps.types = v.types;
  if (!liePortail && (creation ? v.avoirs !== '' : initial.avoirs !== v.avoirs)) {
    const cents = v.avoirs === '' ? null : lireEuros(v.avoirs);
    corps.avoirs_cents = cents;
    corps.avoirs_le = cents === null ? null : aujourdhui();
  }
  if (!creation && Object.keys(corps).length === 0) return;
  if (creation) {
    const cle = `tmp-${++nTemp}`;
    nouveaux.push({
      id: cle, nom: v.nom, prenom: null, email: null, tel: null, metier: null, structure: null, responsable_id: null, relance: null,
      dernier_echange: null, type_echange: null, avoirs_cents: null, avoirs_le: null, apporteur_id: null, viewer_id: null,
      archive: 0, etape: null, types: [], avoirs_portail: null, ...(corps as Partial<Contact>),
    });
    empiler('contact', cle, 'create', corps);
  } else {
    empiler('contact', contact.id, 'patch', corps);
  }
}

function archiver(c: Contact, archive: boolean): void {
  empiler('contact', c.id, 'patch', { archive: archive ? 1 : 0 });
  const nom = `${c.nom.toLocaleUpperCase('fr')}${c.prenom ? ` ${c.prenom}` : ''}`;
  annoncer(`${nom} : contact ${archive ? 'archivé' : 'désarchivé'}.`, () => empiler('contact', c.id, 'patch', { archive: archive ? 0 : 1 }));
}

/** Le rendu attend le relâchement d'un clic en cours : voir sansPerdreLeClic (commun.ts). */
const rendre = sansPerdreLeClic(() => {
  // Redessiner en plein glissement annulerait le geste : le rendu attend la fin du glissement (voir finGlisse).
  if (glisse) renduDiffere = true;
  else rendreMaintenant();
});

// ---------------------------------------------------------------- démarrage

function demarrer(): void {
  const racine = document.getElementById('suivi-corps');
  if (!racine) return;
  brancher({
    rendre,
    rendreEtat,
    integrer: (entite, item) => {
      if (!serveur) return;
      if (entite === 'contact') {
        const i = serveur.contacts.findIndex((c) => c.id === item.id);
        const entier = { ...(i >= 0 ? serveur.contacts[i] : {}), ...item } as Contact;
        if (i >= 0) serveur.contacts[i] = entier;
        else serveur.contacts.push(entier);
        serveur.contacts.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
      } else if (entite === 'sujet') {
        const i = serveur.sujets.findIndex((x) => x.id === item.id);
        const entier = { ...(i >= 0 ? serveur.sujets[i] : {}), ...item } as Sujet;
        if (i >= 0) serveur.sujets[i] = entier;
        else serveur.sujets.push(entier);
      }
    },
    retirerProvisoire: (entite, cle) => {
      if (entite !== 'contact') return;
      const i = nouveaux.findIndex((c) => c.id === cle);
      if (i >= 0) nouveaux.splice(i, 1);
    },
  });
  const ecran = (message: string, retour = false): void => {
    racine.replaceChildren(h('p', { class: 'suivi-vide' }, message, retour && h('button', { type: 'button', class: 'btn', onclick: () => void initial() }, 'Réessayer')));
  };
  const initial = async (): Promise<void> => {
    if (!(await charger())) ecran(liaison.sessionPerdue ? 'Votre session a expiré : reconnectez-vous.' : 'Le suivi n’a pas pu être chargé. ', !liaison.sessionPerdue);
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
