import type { APIRoute } from 'astro';
import { ENTITES, modifier, supprimer } from '../../../../lib/api-suivi';

export const prerender = false;

export const PATCH: APIRoute = (ctx) => modifier(ctx, ENTITES.sujet);
export const DELETE: APIRoute = (ctx) => supprimer(ctx, ENTITES.sujet);
