import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

// Le domaine final : il sert au sitemap, aux URL canoniques,
// aux balises de partage et aux liens hreflang.
const SITE = 'https://www.bebess-invest.fr';

// Une langue non publiee reste hors du sitemap.
const site_ = yaml.load(readFileSync('./src/data/site.yaml', 'utf8'));
const anglaisPublie = site_?.langues?.en?.publie === true;

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  site: SITE,
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    sitemap({
      filter: (page) => anglaisPublie || !page.startsWith(`${SITE}/en`),
    }),
  ],
});
