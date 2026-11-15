// Envoi d'e-mails. Deux pilotes, choisis par MAIL_DRIVER : "console" ou "scaleway". Aucun autre.

import type { Base } from './db';

/** Liaisons et variables du Worker (wrangler.toml, secrets, .dev.vars). */
export interface Env {
  DB: Base;
  MAIL_DRIVER?: string;
  SCW_SECRET_KEY?: string;
  SCW_PROJECT_ID?: string;
  SCW_REGION?: string;
  MAIL_FROM?: string;
}

export interface Mailer {
  envoyer(destinataire: string, sujet: string, texte: string): Promise<void>;
}

/** Lit l'environnement du Worker dans Astro.locals / context.locals (adaptateur Cloudflare). */
export function envDe(locals: unknown): Env {
  return (locals as { runtime: { env: Env } }).runtime.env;
}

const pilotConsole: Mailer = {
  async envoyer(destinataire, sujet, texte) {
    console.log(`\n[mail:console] À : ${destinataire}\n[mail:console] Sujet : ${sujet}\n${texte}\n`);
  },
};

function pilotScaleway(env: Env): Mailer {
  return {
    async envoyer(destinataire, sujet, texte) {
      const manquantes = (['SCW_SECRET_KEY', 'SCW_PROJECT_ID', 'MAIL_FROM'] as const).filter((nom) => !env[nom]);
      if (manquantes.length > 0) {
        throw new Error(
          `MAIL_DRIVER=scaleway mais variable(s) manquante(s) : ${manquantes.join(', ')}. Aucun e-mail envoyé.`,
        );
      }
      const region = env.SCW_REGION ?? 'fr-par';
      const reponse = await fetch(
        `https://api.scaleway.com/transactional-email/v1alpha1/regions/${region}/emails`,
        {
          method: 'POST',
          headers: { 'X-Auth-Token': env.SCW_SECRET_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: { email: env.MAIL_FROM!, name: "BeBess'Invest" },
            to: [{ email: destinataire }],
            subject: sujet,
            text: texte,
            project_id: env.SCW_PROJECT_ID,
          }),
        },
      );
      if (!reponse.ok) throw new Error(`Scaleway : réponse ${reponse.status}`);
    },
  };
}

export function creerMailer(env: Env): Mailer {
  const pilote = env.MAIL_DRIVER ?? (import.meta.env.DEV ? 'console' : 'scaleway');
  if (pilote === 'console') return pilotConsole;
  if (pilote === 'scaleway') return pilotScaleway(env);
  throw new Error(`MAIL_DRIVER inconnu : ${pilote}`);
}
