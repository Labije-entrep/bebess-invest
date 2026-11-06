import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/* Une note de marche = un fichier Markdown dans src/content/notes/.
   Le nom du fichier devient l'URL : 2026-10-securiser-apres-baisse.md
   donne /notes/2026-10-securiser-apres-baisse */
const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    titre: z.string(),
    date: z.coerce.date(),
    chapeau: z.string(),
    // false = la note reste invisible sur le site (brouillon)
    publie: z.boolean().default(true),
    description: z.string().optional(),
  }),
});

export const collections = { notes };
