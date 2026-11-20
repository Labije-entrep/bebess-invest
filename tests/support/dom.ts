// Un navigateur de poche, juste de quoi faire tourner src/scripts/suivi.ts (le module de suivi côté client) : des éléments, du texte,
// des écouteurs, `querySelector` pour `#id` et `[attr="valeur"]`. Aucune mise en page, aucun événement réel : un clic est un appel.
// Les minuteries sont neutralisées (le script en pose une de 10 s pour sonder le serveur : elle ne doit pas retenir le processus).

class Noeud {
  parent: Element | null = null;
  get textContent(): string {
    return '';
  }
}
class Texte extends Noeud {
  constructor(readonly data: string) {
    super();
  }
  override get textContent(): string {
    return this.data;
  }
}

export class Element extends Noeud {
  attrs = new Map<string, string>();
  children: Noeud[] = [];
  className = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  écouteurs = new Map<string, ((e: unknown) => void)[]>();
  [propriete: string]: unknown;
  constructor(readonly tag: string) {
    super();
  }
  get id(): string {
    return this.attrs.get('id') ?? '';
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  append(...noeuds: (Noeud | string)[]): void {
    for (const n of noeuds) {
      const noeud = typeof n === 'string' ? new Texte(n) : n;
      noeud.parent?.retirer(noeud);
      noeud.parent = this;
      this.children.push(noeud);
    }
  }
  prepend(...noeuds: (Noeud | string)[]): void {
    const avant = [...this.children];
    this.replaceChildren(...noeuds, ...(avant as Noeud[]));
  }
  /** Appelé après chaque `replaceChildren` : c'est le signal « le script a dessiné » que `Page.pret` attend. */
  surRemplacement: (() => void) | null = null;
  replaceChildren(...noeuds: (Noeud | string)[]): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.append(...noeuds);
    this.surRemplacement?.();
  }
  retirer(n: Noeud): void {
    this.children = this.children.filter((c) => c !== n);
    n.parent = null;
  }
  remove(): void {
    this.parent?.retirer(this);
  }
  addEventListener(type: string, f: (e: unknown) => void): void {
    this.écouteurs.set(type, [...(this.écouteurs.get(type) ?? []), f]);
  }
  click(): void {
    for (const f of this.écouteurs.get('click') ?? []) f({ target: this, currentTarget: this });
  }
  focus(): void {}
  override get textContent(): string {
    return this.children.map((c) => c.textContent).join('');
  }
  /** Les éléments descendants, dans l'ordre du document. */
  descendants(): Element[] {
    return this.children.flatMap((c) => (c instanceof Element ? [c, ...c.descendants()] : []));
  }
  querySelectorAll(sel: string): Element[] {
    const id = /^#([\w-]+)$/.exec(sel);
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    const classe = /^\.([\w-]+)$/.exec(sel);
    return this.descendants().filter((e) =>
      id ? e.id === id[1] : attr ? (attr[2] === undefined ? e.attrs.has(attr[1]) : e.attrs.get(attr[1]) === attr[2]) : classe ? e.className.split(/\s+/).includes(classe[1]) : e.tag === sel,
    );
  }
  querySelector(sel: string): Element | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

/** Le texte visible d'un élément, avec un espace entre les éléments voisins, et les blancs ramenés à un seul. */
export function texte(n: Noeud): string {
  const brut = (x: Noeud): string => (x instanceof Element ? x.children.map(brut).join(' ') : x.textContent);
  return brut(n).replace(/\s+/g, ' ').trim();
}

export interface Page {
  racine: Element;
  corps: Element;
  /**
   * Attend que le script ait dessiné la page du suivi : le SIGNAL est le premier `replaceChildren` sur `#suivi-corps`, que le script appelle
   * pour dessiner (rendreMaintenant) comme pour afficher son écran d'erreur (ecran). Aucune attente d'un nombre de tours : le chargement du
   * premier module, les appels au chiffrement et le fil des chargeurs prennent un temps qui varie d'une version de Node et d'une machine à
   * l'autre, et un script en retard continuerait de dessiner dans la page du test SUIVANT (les `document` et `window` sont des globales).
   * `delaiMax` n'est qu'un garde-fou contre un script bloqué : il échoue bruyamment, il ne sert pas à attendre.
   */
  pret(delaiMax?: number): Promise<void>;
}

/** Installe `document` et `window` sur globalThis, avec la structure de la page du suivi, et renvoie la page. */
export function installerPage(vue: 'liste' | 'kanban' | 'parcours' = 'liste'): Page {
  const racine = new Element('div');
  const mk = (id: string): Element => {
    const e = new Element('div');
    e.setAttribute('id', id);
    return e;
  };
  const suivi = mk('suivi');
  const corps = mk('suivi-corps');
  suivi.append(mk('suivi-etat'), mk('suivi-alertes'), corps);
  racine.append(suivi);
  const stockage = new Map<string, string>([['suivi.vue', vue]]);
  const g = globalThis as Record<string, unknown>;
  g.document = {
    getElementById: (id: string) => racine.descendants().find((e) => e.id === id) ?? null,
    createElement: (tag: string) => new Element(tag),
    querySelector: (sel: string) => racine.querySelector(sel),
    addEventListener: () => {},
    activeElement: null,
    hidden: false,
  };
  g.window = {
    localStorage: { getItem: (k: string) => stockage.get(k) ?? null, setItem: (k: string, v: string) => void stockage.set(k, v) },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {},
  };
  g.CSS = { escape: (s: string) => s };
  let dessine!: () => void;
  const signal = new Promise<void>((resolve) => (dessine = resolve));
  corps.surRemplacement = () => dessine();
  return {
    racine,
    corps,
    async pret(delaiMax = 30_000) {
      let minuteur: NodeJS.Timeout | undefined;
      const bloque = new Promise<never>((_, rejeter) => {
        minuteur = setTimeout(() => rejeter(new Error(`le script de suivi n'a rien dessiné en ${delaiMax} ms (bloqué : aucun appel à replaceChildren sur #suivi-corps)`)), delaiMax);
      });
      try {
        await Promise.race([signal, bloque]);
      } finally {
        clearTimeout(minuteur);
      }
      // Le script dessine aussi son écran d'erreur (état introuvable, session perdue) : ce n'est pas « la page ». On le dit tout de suite,
      // avec son texte, au lieu de laisser le test échouer plus loin sur un élément absent.
      if (!corps.querySelector('.suivi-kpis')) throw new Error(`le script de suivi a affiché un écran d'erreur au lieu de la page : « ${texte(corps)} »`);
    },
  };
}
