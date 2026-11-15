// Traitement unique du formulaire de contact, pour /contact et /en/contact : mêmes règles,
// même envoi par mail.ts. Seuls les messages et l'adresse de retour changent avec la langue.

import { creerMailer, envDe } from './mail';
import { chaine, chargerPage, type PageLue } from './site';
import { T, chemin, type Lg } from './publang';

export interface EtatContact {
  page: PageLue;
  vals: { nom: string; email: string; telephone: string; objet: string; message: string };
  erreurs: Record<string, string>;
  general: string;
  envoye: boolean;
  /** Renseigné quand la requête doit se terminer par une redirection (succès ou champ piège). */
  redirection: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function traiterContact(
  a: { locals: unknown; request: Request; url: URL },
  langue: Lg,
): Promise<EtatContact> {
  const env = envDe(a.locals);
  const tenant = (a.locals as { tenant: { id: string } | null }).tenant;
  const l = T[langue].contact;
  const page = await chargerPage(env.DB, tenant?.id, 'contact', langue);
  const etat: EtatContact = {
    page,
    vals: { nom: '', email: '', telephone: '', objet: '', message: '' },
    erreurs: {},
    general: '',
    envoye: a.url.searchParams.get('envoye') === '1',
    redirection: null,
  };
  const retour = `${chemin('contact', langue)}?envoye=1`;

  // Une page anglaise sans contenu anglais est redirigée par la page elle-même (méthode GET).
  if (a.request.method !== 'POST' || !tenant || !page.c) return etat;

  const f = await a.request.formData();
  const lire = (k: string) => String(f.get(k) ?? '').trim();
  const v = etat.vals;
  v.nom = lire('nom');
  v.email = lire('email');
  v.telephone = lire('telephone');
  v.objet = lire('objet');
  v.message = lire('message');

  // Champ piège : un robot le remplit, un humain ne le voit pas.
  if (lire('site')) {
    etat.redirection = retour;
    return etat;
  }

  const e = etat.erreurs;
  if (!v.nom || v.nom.length > 200) e.nom = l.eNom;
  if (!EMAIL.test(v.email) || v.email.length > 200) e.email = l.eEmail;
  if (v.telephone.length > 50) e.telephone = l.eTelephone;
  if (!v.objet || v.objet.length > 200) e.objet = l.eObjet;
  if (!v.message || v.message.length > 5000) e.message = l.eMessage;
  if (f.get('consentement') !== 'oui') e.consentement = l.eConsent;
  if (Object.keys(e).length > 0) return etat;

  // Aucun repli silencieux : l'adresse de réception se règle dans Contenus > Contact
  // (celle de la page française sert aussi à la version anglaise).
  let destinataire = chaine(page.c.destinataire).trim();
  if (!EMAIL.test(destinataire) && langue === 'en') {
    destinataire = chaine((await chargerPage(env.DB, tenant.id, 'contact', 'fr')).c?.destinataire).trim();
  }
  if (!EMAIL.test(destinataire)) {
    etat.general = l.eDestinataire;
    return etat;
  }
  try {
    const texte = [
      `Nom : ${v.nom}`,
      `E-mail : ${v.email}`,
      `Téléphone : ${v.telephone || 'non renseigné'}`,
      `Langue : ${langue}`,
      '',
      v.message,
    ].join('\n');
    await creerMailer(env).envoyer(destinataire, `Contact : ${v.objet.replace(/\s+/g, ' ')}`, texte);
    etat.redirection = retour;
  } catch {
    etat.general = l.eEnvoi;
  }
  return etat;
}
