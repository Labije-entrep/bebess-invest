import type { APIRoute } from 'astro';
import { creer, ENTITES } from '../../../../lib/api-suivi';

export const prerender = false;

export const POST: APIRoute = (ctx) => creer(ctx, ENTITES.sujet);
