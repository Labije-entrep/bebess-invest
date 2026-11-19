// Module de suivi, côté client : ce que la liste (suivi.ts), la fiche (fiche.ts) et le kanban partagent.
// JavaScript écrit à la main, aucun framework, aucun domaine externe.
//
// - la file d'écritures : une file par objet (contact, sujet, échange), reprises à 2, 5, 10 puis 30 s,
//   marqueur d'échec avec Réessayer et Abandonner ;
// - le rendu qui n'avale pas un clic ;
// - la décision « ce statut est-il terminal ? », lue dans les listes chargées.
//
// La page qui l'utilise se branche une fois (`brancher`) : elle dit comment s'affiche son état, comment
// elle intègre ce que le serveur renvoie et comment elle retire une copie provisoire.

// ---------------------------------------------------------------- DOM

export type Enfant = Node | string | null | undefined | false;
export type Attribut = string | number | boolean | null | undefined | ((e: Event) => void);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, Attribut> = {}, ...enfants: Enfant[]): HTMLElementTagNameMap[K] {
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

// ---------------------------------------------------------------- réseau

export async function api(url: string, init: RequestInit = {}): Promise<Response> {
  const entetes: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (init.body !== undefined) entetes['Content-Type'] = 'application/json';
  return fetch(url, { ...init, headers: entetes, credentials: 'same-origin', cache: 'no-store' });
}

/** État de la liaison avec le serveur, partagé entre la file et la page. */
export const liaison = {
  /** Le dernier appel n'a pas abouti. */
  ko: false,
  /** Le serveur a répondu 401 : la session a expiré. */
  sessionPerdue: false,
  /** Version de la dernière écriture passée : un état plus ancien serait un retour en arrière. */
  versionMin: 0,
};

// ---------------------------------------------------------------- listes

/**
 * Une valeur de liste est-elle terminale ? Les clés terminales viennent du serveur (`terminaux`, colonne
 * `terminal` de liste_valeur), jamais du code. Une liste sans valeur terminale ne clôt rien : on ne
 * devine pas en prenant la dernière valeur.
 */
export function estTerminal(terminaux: Record<string, string[]> | undefined, liste: string, cle: string): boolean {
  return terminaux?.[liste]?.includes(cle) ?? false;
}

/**
 * Les clés (actives) qui portent un marqueur de liste. Jamais une clé écrite en dur : le rôle (parcours, en_cours…)
 * est déclaré dans la table de référence du cabinet et servi par /api/suivi/etat (`marqueurs`).
 */
export { clesMarquees, MARQUEUR, type Marqueurs } from '../lib/marqueurs';

/** Adresse de l'écran qui permet de poser un marqueur. */
export const ECRAN_LISTES = '/gestionnaire/reglages?onglet=listes';

/**
 * Couleur d'un membre : un jeton de la palette des graphiques (« serie-1 » à « serie-5 »), donc elle suit le thème du
 * cabinet. Une valeur plus ancienne (couleur littérale) est rendue telle quelle, sans y toucher.
 */
export const couleurMembre = (c: string): string => (/^serie-[1-5]$/.test(c) ? `var(--${c})` : c);

// ---------------------------------------------------------------- file d'écritures

export type Corps = Record<string, unknown>;
export type Entite = 'contact' | 'sujet' | 'echange';
export interface Op {
  kind: 'create' | 'patch';
  corps: Corps;
  /** attente : pas encore partie, ou à renvoyer. envoi : en vol. refus : rejetée, en attente d'une décision. */
  etat: 'attente' | 'envoi' | 'refus';
  tentatives: number;
  message?: string;
}
export interface FileOps { entite: Entite; cle: string; ops: Op[]; actif: boolean; minuteur: number | null }

export interface Branchement {
  rendre(): void;
  rendreEtat(): void;
  /** Une écriture est passée : l'élément renvoyé par le serveur rejoint l'état du serveur de la page. */
  integrer(entite: Entite, item: { id: string }): void;
  /** Un élément créé a son identifiant définitif, ou sa création est abandonnée : la copie provisoire disparaît. */
  retirerProvisoire(entite: Entite, cle: string): void;
}

const DELAIS_MS = [2000, 5000, 10000, 30000];
const files = new Map<string, FileOps>();
let page: Branchement | null = null;

export function brancher(b: Branchement): void {
  page = b;
}

const cleFile = (entite: Entite, id: string): string => `${entite}:${id}`;
const delaiPour = (op: Op): number => DELAIS_MS[Math.min(op.tentatives, DELAIS_MS.length - 1)];

function fileDe(entite: Entite, id: string): FileOps {
  let f = files.get(cleFile(entite, id));
  if (!f) {
    f = { entite, cle: id, ops: [], actif: false, minuteur: null };
    files.set(cleFile(entite, id), f);
  }
  return f;
}

export const fileExistante = (entite: Entite, id: string): FileOps | undefined => files.get(cleFile(entite, id));
export const toutesOps = (): Op[] => [...files.values()].flatMap((f) => f.ops);
export const ecrituresEnFile = (): boolean => [...files.values()].some((f) => f.ops.length > 0);

/** Ajoute une modification ; fusionne avec la dernière si elle n'est pas encore partie. */
export function empiler(entite: Entite, id: string, kind: Op['kind'], corps: Corps): void {
  const f = fileDe(entite, id);
  const derniere = f.ops[f.ops.length - 1];
  if (derniere && derniere.etat === 'attente' && derniere.tentatives === 0) Object.assign(derniere.corps, corps);
  else f.ops.push({ kind, corps: { ...corps }, etat: 'attente', tentatives: 0 });
  page!.rendre();
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
  page!.rendreEtat();
  let reponse: Response;
  try {
    reponse = await api(op.kind === 'create' ? `/api/suivi/${f.entite}` : `/api/suivi/${f.entite}/${encodeURIComponent(f.cle)}`, {
      method: op.kind === 'create' ? 'POST' : 'PATCH',
      body: JSON.stringify(op.corps),
    });
  } catch {
    liaison.ko = true;
    return rejouer(f, op, delaiPour(op));
  }
  if (reponse.ok) {
    reseauRetabli();
    const r = (await reponse.json()) as { item: { id: string }; version: number };
    liaison.versionMin = Math.max(liaison.versionMin, r.version);
    f.ops.shift();
    page!.integrer(f.entite, r.item);
    if (op.kind === 'create') {
      // L'élément a maintenant son identifiant définitif : la file le suit, la copie provisoire disparaît.
      page!.retirerProvisoire(f.entite, f.cle);
      files.delete(cleFile(f.entite, f.cle));
      f.cle = r.item.id;
      files.set(cleFile(f.entite, f.cle), f);
    }
    f.actif = false;
    if (f.ops.length === 0) files.delete(cleFile(f.entite, f.cle));
    page!.rendre();
    void pomper(f);
    return;
  }
  let corps: { erreur?: string } = {};
  try {
    corps = (await reponse.json()) as { erreur?: string };
  } catch { /* corps non JSON */ }
  if (reponse.status === 401) {
    liaison.sessionPerdue = true;
    return rejouer(f, op, 10000);
  }
  if (reponse.status === 429 || reponse.status >= 500) {
    const attente = Number(reponse.headers.get('Retry-After'));
    return rejouer(f, op, Number.isFinite(attente) && attente > 0 ? attente * 1000 : delaiPour(op));
  }
  // 4xx : la requête elle-même est refusée, la renvoyer telle quelle ne changerait rien.
  op.etat = 'refus';
  op.message = corps.erreur ?? `Refusé (${reponse.status}).`;
  f.actif = false;
  page!.rendre();
}

function rejouer(f: FileOps, op: Op, delai: number): void {
  op.etat = 'attente';
  op.tentatives += 1;
  f.actif = false;
  f.minuteur = window.setTimeout(() => void pomper(f), delai);
  page!.rendre();
}

function reessayer(f: FileOps): void {
  const op = f.ops[0];
  if (!op) return;
  op.etat = 'attente';
  op.tentatives = 0;
  op.message = undefined;
  page!.rendre();
  void pomper(f);
}

function abandonner(f: FileOps): void {
  const op = f.ops.shift();
  if (op?.kind === 'create') {
    // Un élément jamais créé n'existe nulle part ailleurs : on l'efface avec ses modifications.
    page!.retirerProvisoire(f.entite, f.cle);
    f.ops.length = 0;
  }
  if (f.minuteur !== null) window.clearTimeout(f.minuteur);
  f.minuteur = null;
  if (f.ops.length === 0) files.delete(cleFile(f.entite, f.cle));
  page!.rendre();
  void pomper(f);
}

/** Une réponse vient d'arriver : si le réseau était tombé, les écritures qui attendaient leur délai repartent aussitôt. */
export function reseauRetabli(): void {
  const etait = liaison.ko || liaison.sessionPerdue;
  liaison.ko = false;
  liaison.sessionPerdue = false;
  if (etait) toutRejouer();
}

export function toutRejouer(): void {
  for (const f of files.values()) if (f.ops[0]?.etat === 'attente') void pomper(f);
}

/** Marqueur d'une écriture non passée : « Enregistrement… », « Non envoyé… », ou le refus avec ses deux issues. */
export function marque(entite: Entite, id: string, classe: string): HTMLElement | null {
  const f = fileExistante(entite, id);
  const op = f?.ops.find((o) => o.etat === 'refus') ?? f?.ops[0];
  if (!f || !op) return null;
  if (op.etat === 'refus') {
    return h('span', { class: `${classe} refus`, role: 'alert' },
      `Non enregistré : ${op.message ?? 'refusé'}`,
      h('button', { type: 'button', onclick: () => reessayer(f) }, 'Réessayer'),
      h('button', { type: 'button', onclick: () => abandonner(f) }, 'Abandonner'));
  }
  return h('span', { class: classe }, op.tentatives > 0 ? 'Non envoyé · nouvelle tentative en cours' : 'Enregistrement…');
}

// ---------------------------------------------------------------- rendu

/**
 * Un clic n'existe que si le bouton visé par l'appui est encore là au relâchement. Un rendu qui reconstruit la
 * page entre les deux (typiquement : l'appui fait perdre le focus à un champ en cours d'édition, dont la
 * fermeture déclenche un rendu) fait donc perdre le clic. Tant qu'un bouton de souris est enfoncé, le rendu
 * est mis de côté ; il part juste après le relâchement, une fois le clic distribué. Un clic qui rend lui-même
 * remplace ce rendu en attente. Au plus 600 ms d'attente, si le relâchement ne vient jamais.
 */
export function sansPerdreLeClic(rendu: () => void): () => void {
  let appui = false;
  let enAttente = false;
  let secours: number | null = null;
  const vider = (): void => {
    enAttente = false;
    if (secours !== null) window.clearTimeout(secours);
    secours = null;
  };
  const lancer = (): void => {
    if (!enAttente) return;
    vider();
    rendu();
  };
  const relache = (): void => {
    if (!appui) return;
    appui = false;
    if (enAttente) window.setTimeout(lancer, 0);
  };
  document.addEventListener('mousedown', () => { appui = true; }, true);
  document.addEventListener('mouseup', relache, true);
  document.addEventListener('dragend', relache, true);
  document.addEventListener('contextmenu', relache, true);
  window.addEventListener('blur', relache);
  return () => {
    if (appui) {
      enAttente = true;
      secours ??= window.setTimeout(() => { appui = false; lancer(); }, 600);
      return;
    }
    vider();
    rendu();
  };
}
