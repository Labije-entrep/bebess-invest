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

/** Hôtes de développement, sans le port. Hors d'eux, le pilote console refuse d'écrire. */
const HOTES_LOCAUX = ['localhost', '127.0.0.1'];

function pilotConsole(hote: string): Mailer {
  return {
    async envoyer(destinataire, sujet, texte) {
      // Ce pilote n'est choisi qu'en développement (`astro dev`), ou par MAIL_DRIVER=console posé
      // exprès pour essayer un build en local. Hors localhost, il lève : une production mal
      // configurée n'envoie plus aucun courriel (panne visible) au lieu d'écrire dans les journaux
      // de Cloudflare des liens de connexion encore valables (fuite silencieuse).
      if (!HOTES_LOCAUX.includes(hote.toLowerCase())) {
        throw new Error(
          `MAIL_DRIVER=console refusé sur l'hôte « ${hote} » : ce pilote ne sert qu'en local (localhost, 127.0.0.1). Aucun e-mail envoyé, rien écrit.`,
        );
      }
      console.log(`\n[mail:console] À : ${destinataire}\n[mail:console] Sujet : ${sujet}\n${texte}\n`);
    },
  };
}

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

/** `hote` : nom d'hôte de la requête en cours, sans le port (Astro.url.hostname). */
export function creerMailer(env: Env, hote: string): Mailer {
  const pilote = env.MAIL_DRIVER ?? (import.meta.env.DEV ? 'console' : 'scaleway');
  if (pilote === 'console') return pilotConsole(hote);
  if (pilote === 'scaleway') return pilotScaleway(env);
  throw new Error(`MAIL_DRIVER inconnu : ${pilote}`);
}
