// Point d'entrée du Worker de traitement quotidien (lot 12) : wrangler.cron.toml. UN seul Cron Trigger, aucune route (pas de `fetch`).
//
// Il est séparé du site parce que le site est un projet Cloudflare Pages, et que Pages n'accepte pas de Cron Trigger : wrangler refuse
// `[triggers]` dans une configuration Pages (« Configuration file for Pages projects does not support "triggers" »). Les deux se
// partagent la même base D1 et le même bucket R2 ; le code du traitement est celui de src/lib/traitement.ts.

import type { Env } from './lib/mail';
import { traitementQuotidien } from './lib/traitement';

interface Contexte {
  waitUntil(promesse: Promise<unknown>): void;
}

export default {
  async scheduled(_evenement: unknown, env: Env, contexte: Contexte): Promise<void> {
    contexte.waitUntil(traitementQuotidien(env));
  },
};
