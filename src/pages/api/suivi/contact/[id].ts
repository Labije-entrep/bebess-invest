import type { APIRoute } from 'astro';
import { ENTITES, modifier, supprimer } from '../../../../lib/api-suivi';

export const prerender = false;

export const PATCH: APIRoute = (ctx) => modifier(ctx, ENTITES.contact);
export const DELETE: APIRoute = (ctx) => supprimer(ctx, ENTITES.contact);
