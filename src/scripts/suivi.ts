// Module de suivi, côté client : la liste des contacts (lot 03). JavaScript écrit à la main, aucun
// framework, aucun domaine externe : tout passe par /api/suivi (lot 02).
//
// Principe : l'état du serveur (`serveur`) n'est jamais modifié par une saisie. Chaque modification entre
// dans une file d'écritures par contact (`files`) ; ce qui s'affiche est l'état du serveur recouvert des
// écritures encore en file. Une écriture qui échoue reste donc visible, marquée, jusqu'à ce qu'elle passe
// ou que l'utilisateur l'abandonne : rien ne disparaît sans qu'il le sache.

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
  types: string[];
  avoirs_portail: Portail | null;
}
interface Sujet { id: string; contact_id: string; statut: string; echeance: string | null; texte: string; archive: number }
interface Membre { id: string; nom: string; initiale: string; couleur: string; actif: number }
interface ValeurListe { cle: string; libelle: string; ordre: number }
interface Seuils { sans_echange: number; relance: number; arrete: number }
interface Etat {
  version: number;
  seuils: Seuils;
  contacts: Contact[];
  sujets: Sujet[];
  membres: Membre[];
  listes: Record<string, ValeurListe[]>;
}

type Corps = Record<string, unknown>;
interface Op {
  kind: 'create' | 'patch';
  corps: Corps;
  /** attente : pas encore partie, ou à renvoyer. envoi : en vol. refus : rejetée, en attente d'une décision. */
  etat: 'attente' | 'envoi' | 'refus';
  tentatives: number;
  message?: string;
}
interface FileOps { cle: string; ops: Op[]; actif: boolean; minuteur: number | null }

type Indicateur = 'vus' | 'ouverts' | 'encours' | 'attente' | 'retard' | 'relance' | 'sans' | 'avoirs';
type Vue = 'liste' | 'kanban' | 'parcours';

// ---------------------------------------------------------------- état

let serveur: Etat | null = null;
let version = 0;
let versionMin = 0;
const nouveaux: Contact[] = [];
const files = new Map<string, FileOps>();
let nTemp = 0;

let indicateur: Indicateur | null = null;
let membreFiltre: string | null = null;
let recherche = '';
let vue: Vue = 'liste';
let archives = false;
let reseauKO = false;
let sessionPerdue = false;

const DELAIS_MS = [2000, 5000, 10000, 30000];
const INTERVALLE_MS = 10000;

// ---------------------------------------------------------------- utilitaires

type Enfant = Node | string | null | undefined | false;
type Attribut = string | number | boolean | null | undefined | ((e: Event) => void);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, Attribut> = {}, ...enfants: Enfant[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const e of enfants) if (e) el.append(e);
  return el;
}

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

async function api(url: string, init: RequestInit = {}): Promise<Response> {
  const entetes: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (init.body !== undefined) entetes['Content-Type'] = 'application/json';
  return fetch(url, { ...init, headers: entetes, credentials: 'same-origin', cache: 'no-store' });
}

async function charger(): Promise<boolean> {
  try {
    const r = await api('/api/suivi/etat');
    if (r.status === 401) {
      sessionPerdue = true;
      rendreEtat();
      return false;
    }
    if (!r.ok) throw new Error(String(r.status));
    const e = (await r.json()) as Etat;
    reseauRetabli();
    // Une écriture de cette session est déjà passée : un état plus ancien serait un retour en arrière.
    if (e.version < versionMin) {
      window.setTimeout(() => void charger(), 500);
      return false;
    }
    serveur = e;
    version = e.version;
    rendre();
    return true;
  } catch {
    reseauKO = true;
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
      sessionPerdue = true;
    } else if (r.ok) {
      reseauRetabli();
      const v = ((await r.json()) as { version: number }).version;
      if (v !== version) await charger();
    }
  } catch {
    reseauKO = true;
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

// ---------------------------------------------------------------- file d'écritures

function fileDe(cle: string): FileOps {
  let f = files.get(cle);
  if (!f) {
    f = { cle, ops: [], actif: false, minuteur: null };
    files.set(cle, f);
  }
  return f;
}

/** Ajoute une modification ; fusionne avec la dernière si elle n'est pas encore partie. */
function empiler(cle: string, kind: Op['kind'], corps: Corps): void {
  const f = fileDe(cle);
  const derniere = f.ops[f.ops.length - 1];
  if (derniere && derniere.etat === 'attente' && derniere.tentatives === 0) Object.assign(derniere.corps, corps);
  else f.ops.push({ kind, corps: { ...corps }, etat: 'attente', tentatives: 0 });
  rendre();
  void pomper(f);
}

async function pomper(f: FileOps): Promise<void> {
  if (f.actif) return;
  const op = f.ops[0];
  if (!op || op.etat === 'refus') return;
  f.actif = true;
  if (f.minuteur !== null) {
    window.clearTimeout(f.minuteur);
    f.minuteur = null;
  }
  op.etat = 'envoi';
  rendreEtat();
  let reponse: Response;
  try {
    reponse = await api(op.kind === 'create' ? '/api/suivi/contact' : `/api/suivi/contact/${encodeURIComponent(f.cle)}`, {
      method: op.kind === 'create' ? 'POST' : 'PATCH',
      body: JSON.stringify(op.corps),
    });
  } catch {
    reseauKO = true;
    return rejouer(f, op, DELAIS_MS[Math.min(op.tentatives, DELAIS_MS.length - 1)]);
  }
  if (reponse.ok) {
    reseauRetabli();
    const r = (await reponse.json()) as { item: Contact; version: number };
    versionMin = Math.max(versionMin, r.version);
    f.ops.shift();
    if (serveur) {
      const i = serveur.contacts.findIndex((c) => c.id === r.item.id);
      const entier = { ...(i >= 0 ? serveur.contacts[i] : {}), ...r.item } as Contact;
      if (i >= 0) serveur.contacts[i] = entier;
      else serveur.contacts.push(entier);
      serveur.contacts.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    }
    if (op.kind === 'create') {
      // Le contact a maintenant son identifiant définitif : la file le suit, la copie provisoire disparaît.
      const i = nouveaux.findIndex((c) => c.id === f.cle);
      if (i >= 0) nouveaux.splice(i, 1);
      files.delete(f.cle);
      f.cle = r.item.id;
      files.set(f.cle, f);
    }
    f.actif = false;
    if (f.ops.length === 0) files.delete(f.cle);
    rendre();
    void pomper(f);
    return;
  }
  let corps: { erreur?: string } = {};
  try {
    corps = (await reponse.json()) as { erreur?: string };
  } catch { /* corps non JSON */ }
  if (reponse.status === 401) {
    sessionPerdue = true;
    return rejouer(f, op, 10000);
  }
  if (reponse.status === 429 || reponse.status >= 500) {
    const attente = Number(reponse.headers.get('Retry-After'));
    return rejouer(f, op, Number.isFinite(attente) && attente > 0 ? attente * 1000 : DELAIS_MS[Math.min(op.tentatives, DELAIS_MS.length - 1)]);
  }
  // 4xx : la requête elle-même est refusée, la renvoyer telle quelle ne changerait rien.
  op.etat = 'refus';
  op.message = corps.erreur ?? `Refusé (${reponse.status}).`;
  f.actif = false;
  rendre();
}

function rejouer(f: FileOps, op: Op, delai: number): void {
  op.etat = 'attente';
  op.tentatives += 1;
  f.actif = false;
  f.minuteur = window.setTimeout(() => void pomper(f), delai);
  rendre();
}

function reessayer(f: FileOps): void {
  const op = f.ops[0];
  if (!op) return;
  op.etat = 'attente';
  op.tentatives = 0;
  op.message = undefined;
  rendre();
  void pomper(f);
}

function abandonner(f: FileOps): void {
  const op = f.ops.shift();
  if (op?.kind === 'create') {
    // Un contact jamais créé n'existe nulle part ailleurs : on l'efface avec ses modifications.
    const i = nouveaux.findIndex((c) => c.id === f.cle);
    if (i >= 0) nouveaux.splice(i, 1);
    f.ops.length = 0;
  }
  if (f.minuteur !== null) window.clearTimeout(f.minuteur);
  f.minuteur = null;
  if (f.ops.length === 0) files.delete(f.cle);
  rendre();
  void pomper(f);
}

/** Une réponse vient d'arriver : si le réseau était tombé, les écritures qui attendaient leur délai repartent aussitôt. */
function reseauRetabli(): void {
  const etait = reseauKO || sessionPerdue;
  reseauKO = false;
  sessionPerdue = false;
  if (etait) toutRejouer();
}

function toutRejouer(): void {
  for (const f of files.values()) if (f.ops[0]?.etat === 'attente') void pomper(f);
}

// ---------------------------------------------------------------- lecture de l'état affiché

/** Le contact tel que l'utilisateur doit le voir : état du serveur recouvert des écritures en file. */
function appliquer(c: Contact): Contact {
  const f = files.get(c.id);
  if (!f) return c;
  const v: Contact = { ...c };
  for (const op of f.ops) if (op.kind === 'patch') Object.assign(v, op.corps);
  return v;
}

const tousContacts = (): Contact[] => (serveur ? [...serveur.contacts, ...nouveaux].map(appliquer) : []);

interface Avoirs { cents: number; le: string | null; portail: boolean }
function avoirsDe(c: Contact): Avoirs | null {
  // Contact du portail : sans arrêté il n'y a pas d'avoirs à afficher (ni à compter).
  if (c.viewer_id) return c.avoirs_portail && c.avoirs_portail.le !== null ? { ...c.avoirs_portail, portail: true } : null;
  return c.avoirs_cents === null || c.avoirs_cents === undefined ? null : { cents: c.avoirs_cents, le: c.avoirs_le, portail: false };
}

const libelle = (liste: string, cle: string | null): string =>
  cle === null ? '' : (serveur?.listes[liste]?.find((v) => v.cle === cle)?.libelle ?? cle);

/** « ouvert » : tout sujet non archivé dont le statut n'est pas « fait ». Les clés viennent de statut_sujet. */
const estOuvert = (s: Sujet): boolean => s.archive === 0 && s.statut !== 'fait';

interface Calcul {
  actifs: Contact[];
  sujetsDe: Map<string, Sujet[]>;
  compte: Record<Indicateur, number>;
  avoirsTotal: number;
  filtres: Record<Indicateur, (c: Contact) => boolean>;
}

function calculer(): Calcul {
  const s = serveur!;
  const aujourd = aujourdhui();
  const actifs = tousContacts().filter((c) => c.archive === 0);
  const ids = new Set(actifs.map((c) => c.id));
  const sujetsDe = new Map<string, Sujet[]>();
  for (const x of s.sujets) {
    if (x.archive !== 0 || !ids.has(x.contact_id)) continue;
    sujetsDe.set(x.contact_id, [...(sujetsDe.get(x.contact_id) ?? []), x]);
  }
  const tous = [...sujetsDe.values()].flat();
  const enRetard = (x: Sujet): boolean => estOuvert(x) && x.echeance !== null && x.echeance < aujourd;
  const limite = ajouterJours(aujourd, s.seuils.relance);
  const a = (c: Contact, f: (x: Sujet) => boolean): boolean => (sujetsDe.get(c.id) ?? []).some(f);
  const filtres: Record<Indicateur, (c: Contact) => boolean> = {
    vus: (c) => c.dernier_echange === aujourd,
    ouverts: (c) => a(c, estOuvert),
    encours: (c) => a(c, (x) => x.statut === 'encours'),
    attente: (c) => a(c, (x) => x.statut === 'attente'),
    retard: (c) => a(c, enRetard),
    relance: (c) => c.relance !== null && c.relance <= limite,
    sans: (c) => c.dernier_echange === null || ecartJours(c.dernier_echange, aujourd) >= s.seuils.sans_echange,
    avoirs: (c) => avoirsDe(c) !== null,
  };
  const compte: Record<Indicateur, number> = {
    vus: actifs.filter(filtres.vus).length,
    ouverts: tous.filter(estOuvert).length,
    encours: tous.filter((x) => x.statut === 'encours').length,
    attente: tous.filter((x) => x.statut === 'attente').length,
    retard: tous.filter(enRetard).length,
    relance: actifs.filter(filtres.relance).length,
    sans: actifs.filter(filtres.sans).length,
    avoirs: actifs.filter(filtres.avoirs).length,
  };
  const avoirsTotal = actifs.reduce((t, c) => t + (avoirsDe(c)?.cents ?? 0), 0);
  return { actifs, sujetsDe, compte, avoirsTotal, filtres };
}

// ---------------------------------------------------------------- rendu

const corps = (): HTMLElement => document.getElementById('suivi-corps')!;
let dialogue: HTMLDialogElement | null = null;

function rendreEtat(): void {
  const el = document.getElementById('suivi-etat');
  if (!el) return;
  let etat = 'ajour';
  let texte = 'À jour';
  const ops = [...files.values()].flatMap((f) => f.ops);
  const refus = ops.filter((o) => o.etat === 'refus').length;
  const enAttente = ops.filter((o) => o.etat !== 'refus');
  const nonPartie = enAttente.filter((o) => o.tentatives > 0).length;
  if (!serveur) {
    etat = reseauKO || sessionPerdue ? 'horsligne' : 'chargement';
    texte = reseauKO ? 'Hors connexion' : sessionPerdue ? 'Connexion perdue' : 'Chargement…';
  } else if (refus > 0) {
    etat = 'refus';
    texte = `${refus} modification${refus > 1 ? 's' : ''} refusée${refus > 1 ? 's' : ''}`;
  } else if (reseauKO || sessionPerdue || nonPartie > 0) {
    etat = 'horsligne';
    texte = `${sessionPerdue ? 'Connexion perdue' : 'Hors connexion'}${enAttente.length ? ` · ${enAttente.length} en attente d'envoi` : ''}`;
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
    if (sessionPerdue) {
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

function rendre(): void {
  const racine = corps();
  if (!serveur) return;
  const actif = document.activeElement as HTMLElement | null;
  const cible = actif?.dataset?.f ?? null;
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
          onclick: () => { vue = v; rendre(); },
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

  const principal = h('div', {});
  if (vue !== 'liste') {
    principal.append(h('p', { class: 'suivi-vide' }, `La vue ${vue === 'kanban' ? 'Kanban' : 'Parcours'} n’est pas encore disponible.`));
  } else {
    principal.append(liste(c));
  }

  racine.replaceChildren(kpis, outils, principal,
    h('p', { class: 'suivi-note' },
      `Les avoirs d’un contact rattaché au portail viennent de ses enveloppes et portent la date de son dernier arrêté ; ils ne sont pas saisis ici. Une date en rouge signale un arrêté de plus de ${s.arrete} jours.`));

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
  a.style.backgroundColor = m.couleur;
  return a;
}

function liste(c: Calcul): HTMLElement {
  const s = serveur!;
  const aujourd = aujourdhui();
  const limite = ajouterJours(aujourd, s.seuils.relance);
  const q = norm(recherche.trim());
  const base = tousContacts().filter((x) => archives || x.archive === 0);
  const sujetsTous = new Map<string, Sujet[]>();
  for (const x of s.sujets) if (x.archive === 0) sujetsTous.set(x.contact_id, [...(sujetsTous.get(x.contact_id) ?? []), x]);
  const visibles = base.filter((x) => {
    if (indicateur && !c.filtres[indicateur](x)) return false;
    if (membreFiltre && x.responsable_id !== membreFiltre) return false;
    if (q) {
      const texte = norm([x.nom, x.prenom, x.structure, ...(sujetsTous.get(x.id) ?? []).map((y) => y.texte)].filter(Boolean).join(' '));
      if (!texte.includes(q)) return false;
    }
    return true;
  });
  if (visibles.length === 0) {
    return h('p', { class: 'suivi-vide' }, base.length === 0 ? 'Aucun contact pour l’instant. Créez le premier avec « Nouveau contact ».' : 'Aucun contact ne correspond à ces filtres.');
  }

  // Apports : pour un prescripteur, les contacts qu'il a apportés et leurs avoirs.
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
    const f = files.get(x.id);
    const op = f?.ops.find((o) => o.etat === 'refus') ?? f?.ops[0];
    const sous = [libelle('metier', x.metier), x.structure].filter(Boolean).join(' · ');
    const perime = av?.portail && av.le !== null && ecartJours(av.le, aujourd) > s.seuils.arrete;

    tbody.append(
      h('tr', { class: x.archive ? 'archive' : undefined },
        h('td', {},
          h('button', { type: 'button', class: 'suivi-nom', 'data-f': `nom:${x.id}`, onclick: (e) => ouvrirDialogue(x.id, e.currentTarget as HTMLElement) },
            `${x.nom.toLocaleUpperCase('fr')}${x.prenom ? ` ${x.prenom}` : ''}`),
          sous && h('span', { class: 'suivi-sous' }, sous),
          x.archive === 1 && h('span', { class: 'suivi-marque' }, 'Archivé'),
          op && marque(f!, op),
        ),
        h('td', {},
          ...x.types.map((t) => h('span', { class: `suivi-pastille${t === 'client' ? ' client' : ''}` }, libelle('type_contact', t))),
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

function marque(f: FileOps, op: Op): HTMLElement {
  if (op.etat === 'refus') {
    return h('span', { class: 'suivi-marque refus', role: 'alert' },
      `Non enregistré : ${op.message ?? 'refusé'}`,
      h('button', { type: 'button', onclick: () => reessayer(f) }, 'Réessayer'),
      h('button', { type: 'button', onclick: () => abandonner(f) }, 'Abandonner'));
  }
  return h('span', { class: 'suivi-marque' }, op.tentatives > 0 ? 'Non envoyé · nouvelle tentative en cours' : 'Enregistrement…');
}

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
      archive: 0, types: [], avoirs_portail: null, ...(corps as Partial<Contact>),
    });
    empiler(cle, 'create', corps);
  } else {
    empiler(contact.id, 'patch', corps);
  }
}

function archiver(c: Contact, archive: boolean): void {
  empiler(c.id, 'patch', { archive: archive ? 1 : 0 });
  const nom = `${c.nom.toLocaleUpperCase('fr')}${c.prenom ? ` ${c.prenom}` : ''}`;
  annoncer(`${nom} : contact ${archive ? 'archivé' : 'désarchivé'}.`, () => empiler(c.id, 'patch', { archive: archive ? 0 : 1 }));
}

// ---------------------------------------------------------------- démarrage

function demarrer(): void {
  const racine = document.getElementById('suivi-corps');
  if (!racine) return;
  const ecran = (message: string, retour = false): void => {
    racine.replaceChildren(h('p', { class: 'suivi-vide' }, message, retour && h('button', { type: 'button', class: 'btn', onclick: () => void initial() }, 'Réessayer')));
  };
  const initial = async (): Promise<void> => {
    if (!(await charger())) ecran(sessionPerdue ? 'Votre session a expiré : reconnectez-vous.' : 'Le suivi n’a pas pu être chargé. ', !sessionPerdue);
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
    reseauKO = false;
    toutRejouer();
    void sonder();
  });
  window.addEventListener('offline', () => {
    reseauKO = true;
    rendreEtat();
  });
  window.addEventListener('beforeunload', (e) => {
    if ([...files.values()].some((f) => f.ops.length > 0)) e.preventDefault();
  });
}

demarrer();
