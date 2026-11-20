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
  replaceChildren(...noeuds: (Noeud | string)[]): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.append(...noeuds);
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
  /** Attend que le script ait fini de charger l'état et de dessiner. */
  pret(): Promise<void>;
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
  return {
    racine,
    corps,
    async pret() {
      for (let i = 0; i < 200 && corps.children.length === 0; i++) await new Promise((r) => setImmediate(r));
      if (corps.children.length === 0) throw new Error('le script de suivi n\'a rien dessiné');
    },
  };
}
