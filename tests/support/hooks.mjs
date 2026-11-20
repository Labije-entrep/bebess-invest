// Chargeur du banc : ce qu'il faut pour faire tourner le code du dépôt tel quel sous Node, sans aucune dépendance.
//
//   - les imports sans extension (`from './db'`, écrits pour Vite) se résolvent vers le fichier .ts voisin ;
//   - `astro:middleware` est remplacé par l'identité (`defineMiddleware(f) === f`), `astro/app` et le gestionnaire Cloudflare par des
//     doublures que le banc pilote (le vrai Worker de src/worker.ts s'exécute, pas ses imports) ;
//   - `import.meta.env` (Vite) est fixé comme le fait wrangler.cron.toml : production, pas développement ;
//   - un fichier .astro n'est pas un module : son en-tête (le code entre les deux `---`) devient une fonction `(Astro) => …`
//     qui rend soit la Response du `return Astro.redirect(…)`, soit les variables de l'en-tête. Le gabarit HTML n'est pas rendu.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DOUBLURES = {
  'astro:middleware': 'export const defineMiddleware = (f) => f;',
  'astro/app': 'export class App { constructor(manifest) { this.manifest = manifest; } }',
  '@astrojs/cloudflare/handler': 'export const handle = (...a) => globalThis.__banc_handle(...a);',
};

export async function resolve(specifier, context, suivant) {
  if (specifier in DOUBLURES) return { url: `banc-doublure:${specifier}`, shortCircuit: true };
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier.split('/').pop())) {
    for (const fin of ['.ts', '/index.ts']) {
      try {
        return await suivant(specifier + fin, context);
      } catch {
        /* suivant */
      }
    }
  }
  return suivant(specifier, context);
}

/** L'en-tête d'un .astro, converti en module. Les imports de .astro, de .css et de polices sont retirés : rien n'en sert ici. */
function moduleAstro(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  const entete = m ? m[1] : '';
  const imports = [];
  let corps = entete.replace(/^import\s[\s\S]*?from\s+['"]([^'"]+)['"];?[ \t]*$/gm, (tout, depuis) => {
    if (!/\.(astro|css)$/.test(depuis) && !depuis.startsWith('@fontsource')) imports.push(tout);
    return '';
  });
  corps = corps.replace(/^export\s+/gm, '');
  const noms = [...corps.matchAll(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[=:]/gm)].map((x) => x[1]);
  const rendu = noms.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  return `${imports.join('\n')}\nexport default async function (Astro) {\n${corps}\nreturn { rendu: { ${rendu} } };\n}\n`;
}

export async function load(url, context, suivant) {
  if (url.startsWith('banc-doublure:')) {
    return { format: 'module', source: DOUBLURES[url.slice('banc-doublure:'.length)], shortCircuit: true };
  }
  if (url.endsWith('.astro')) {
    // Le code de l'en-tête est du TypeScript : il passe par le même retrait des types que les .ts.
    const source = moduleAstro(readFileSync(fileURLToPath(url), 'utf8'));
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  const r = await suivant(url, context);
  if (url.endsWith('.ts') && r.source) {
    const texte = String(r.source);
    if (texte.includes('import.meta.env')) {
      return { ...r, source: texte.replaceAll('import.meta.env', '({ DEV: false, PROD: true })') };
    }
  }
  return r;
}

export const racineDepot = pathToFileURL(new URL('../../', import.meta.url).pathname).href;
