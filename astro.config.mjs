import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Le domaine final : il sert aux URL canoniques,
// aux balises de partage et aux liens hreflang.
// Le plan de site est /sitemap.xml, généré depuis la base.
const SITE = 'https://www.bebess-invest.fr';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  site: SITE,
  trailingSlash: 'never',
  build: { format: 'file' },
});
