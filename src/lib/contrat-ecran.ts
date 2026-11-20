// Les écritures du contrat depuis la console de l'éditeur (lot 14) : un formulaire par rubrique de la fiche du cabinet, un `action` par
// formulaire. Ce fichier LIT les formulaires (euros → centimes, pourcentages → centièmes de point, dates) et appelle les fonctions de
// contrat.ts, qui portent tous les garde-fous ; il n'en ajoute aucun et ne calcule aucun prix (l'aperçu du prorata est celui de
// facturation.ts). Rien ici ne génère de texte : un retour est un code fixe, traduit par une table.
//
// L'appelant (la route POST de la fiche) a déjà vérifié le rôle éditeur et borné le cabinet. Chaque écriture part avec son événement
// (contrat.ts) ; seuls les refus du gel sont journalisés à part, comme avant.

import type { Base } from './db';
import {
  annulerPreavis, CHAMPS_PRIX, contratEnCours, creerContrat, enregistrerPreavis, MESSAGES_CONTRAT, modifierFormule, modifierPrix, poserDpa, poserGelTarif,
  poserMiseEnProduction, poserStatutFondateur, retirerStatutFondateur, signerContrat, basculerModule, saisirRemise, type CodeContrat, type Module, type Prix,
} from './contrat';
import { apercuComplementaire, parrainagesValides, signalerBonsAnnulesParPreavis, traiterBonsApresEffet } from './facturation';
import type { Acteur } from './journal';
import { REMISE_MAX, tauxParrainage } from './tarif';

export type CodeSucces =
  | 'contrat_ouvert' | 'formule_enregistree' | 'prix_enregistres' | 'module_active' | 'module_desactive' | 'remise_enregistree' | 'remise_plafonnee'
  | 'gel_pose' | 'dpa_pose' | 'production_posee' | 'fondateur_pose' | 'fondateur_retire' | 'desactivation_programmee' | 'desactivation_annulee'
  | 'preavis_enregistre' | 'preavis_reconduit' | 'preavis_annule' | 'contrat_signe';

export const MESSAGES_SUCCES: Record<CodeSucces, string> = {
  contrat_ouvert: 'Contrat ouvert, en brouillon. Les quatre prix sont recopiés sur le contrat : ils n’existent nulle part ailleurs.',
  formule_enregistree: 'Contrat enregistré.',
  prix_enregistres: 'Prix enregistrés.',
  module_active: 'Module activé.',
  module_desactive: 'Module désactivé tout de suite : ce contrat n’a pas encore de date anniversaire, aucune période n’est facturée. Les données du module restent en base.',
  desactivation_programmee:
    'Désactivation enregistrée. Le module reste actif jusqu’à la date anniversaire indiquée dans le tableau : la période déjà facturée va à son terme, sans remboursement, et le module ne figure plus sur le bon suivant. Elle s’annule d’ici là ; les données restent en base.',
  desactivation_annulee: 'Désactivation annulée : le module reste actif.',
  remise_enregistree: 'Remise enregistrée.',
  remise_plafonnee: 'Remise enregistrée, PLAFONNÉE : la remise totale (parrainage + commerciale) ne dépasse jamais 50 %.',
  gel_pose: 'Gel du tarif enregistré.',
  dpa_pose: 'Date de signature du DPA enregistrée. La mise en production est maintenant possible.',
  production_posee: 'Mise en production posée : le contrat passe en essai de 45 jours.',
  fondateur_pose: 'Statut fondateur posé : frais d’installation à 0, tarif gelé 24 mois après la signature. Aucun pourcentage de remise.',
  fondateur_retire: 'Statut fondateur retiré. Le gel du tarif déjà posé reste en place : un gel ne se raccourcit jamais.',
  preavis_enregistre: 'Préavis enregistré : il a été reçu au moins 30 jours avant la date anniversaire, la résiliation prend effet à cette date. Le contrat reste actif jusque-là ; elle s’annule d’ici là.',
  preavis_reconduit:
    'Préavis enregistré, mais reçu MOINS de 30 jours avant la date anniversaire : le contrat est reconduit pour douze mois, la résiliation ne prendra effet qu’à l’anniversaire suivant. Aucun remboursement au prorata. Elle s’annule d’ici là.',
  contrat_signe: 'Contrat signé : il est actif, son début de service (la date anniversaire) est posé. Le traitement quotidien pose le bon de la période dans les 30 jours avant son début ; les drapeaux des modules reprennent la main.',
  preavis_annule: 'Résiliation annulée : le contrat se poursuit, sans préavis enregistré.',
};

export type CodeRetour = CodeSucces | CodeContrat;
/** Tous les messages que la fiche sait afficher pour un retour d'écriture du contrat. */
export const MESSAGES_RETOUR: Record<string, string> = { ...MESSAGES_CONTRAT, ...MESSAGES_SUCCES };

export interface RetourContrat {
  code: CodeRetour;
  ok: boolean;
  /** Après l'activation d'un module : le bon complémentaire attendu (aperçu du prorata). */
  complementaire?: { mois: number; total_ht: number; anniversaire: string };
}

const ok = (code: CodeSucces, plus: Partial<RetourContrat> = {}): RetourContrat => ({ code, ok: true, ...plus });
const ko = (code: CodeContrat): RetourContrat => ({ code, ok: false });

// ---------------------------------------------------------------- lire un formulaire

const brut = (f: FormData, nom: string): string => {
  const v = f.get(nom);
  return typeof v === 'string' ? v.replace(/[\s  ]/g, '') : '';
};

/** « 79 », « 79,5 », « 79.50 » → des centimes entiers, sans passer par un flottant. Null si ce n'est pas un montant. */
export function euroEnCentimes(texte: string): number | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(texte);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0) : null;
}

/** « 25 », « 12,5 » → des centièmes de point (2500, 1250). Null si ce n'est pas un pourcentage de 0 à 100. */
export function pourcentEnCentiemes(texte: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(texte);
  const t = m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0) : null;
  return t !== null && t <= 10000 ? t : null;
}

const entier = (texte: string): number | null => (/^\d{1,6}$/.test(texte) ? Number(texte) : null);

// ---------------------------------------------------------------- appliquer

/**
 * Applique l'écriture que le formulaire demande. `action` : formule, module, remise, gel, dpa, production, signature, fondateur, fondateur_retirer, preavis, preavis_annuler.
 * Une saisie illisible est refusée AVANT toute écriture : rien n'est enregistré à moitié.
 */
export async function appliquerContrat(db: Base, tenantId: string, f: FormData, acteur: Acteur, jour = new Date().toISOString().slice(0, 10)): Promise<RetourContrat> {
  const action = brut(f, 'action');

  if (action === 'formule') {
    const periodicite = brut(f, 'periodicite');
    const acces_inclus = entier(brut(f, 'acces_inclus'));
    const frais_installation = euroEnCentimes(brut(f, 'frais_installation'));
    const prix = Object.fromEntries(CHAMPS_PRIX.map((k) => [k, euroEnCentimes(brut(f, k))])) as Record<keyof Prix, number | null>;
    if (periodicite !== 'mensuelle' && periodicite !== 'annuelle') return ko('periodicite');
    if (acces_inclus === null || frais_installation === null || CHAMPS_PRIX.some((k) => prix[k] === null)) return ko('montant_invalide');
    const prixOk = prix as Prix;

    const c = await contratEnCours(db, tenantId);
    if (!c) {
      const r = await creerContrat(db, tenantId, { periodicite, acces_inclus, frais_installation, ...prixOk }, acteur);
      return r.ok ? ok('contrat_ouvert') : ko(r.code);
    }
    // Les prix d'abord : sous gel, le refus tombe avant toute autre écriture, et rien n'est enregistré.
    const prixModifies = CHAMPS_PRIX.some((k) => prixOk[k] !== c[k]);
    if (prixModifies) {
      const r = await modifierPrix(db, tenantId, prixOk, acteur);
      if (!r.ok) return ko(r.code);
    }
    const r = await modifierFormule(db, tenantId, { periodicite, acces_inclus, frais_installation }, acteur);
    if (r.ok) return ok('formule_enregistree');
    if (r.code === 'inchange') return prixModifies ? ok('prix_enregistres') : ko('inchange');
    return ko(r.code);
  }

  if (action === 'module') {
    const module = brut(f, 'module');
    if (module !== 'pilotage' && module !== 'site') return ko('inchange');
    const actif = brut(f, 'actif') === '1';
    const r = await basculerModule(db, tenantId, module as Module, actif, acteur);
    if (!r.ok) return ko(r.code);
    if (!actif) return ok(r.effet === 'programme' ? 'desactivation_programmee' : 'module_desactive');
    if (r.effet === 'annule') return ok('desactivation_annulee');
    const apercu = await apercuComplementaire(db, r.contrat, module as Module, jour);
    return ok('module_active', apercu ? { complementaire: apercu } : {});
  }

  if (action === 'remise') {
    const saisi = pourcentEnCentiemes(brut(f, 'remise_commerciale'));
    if (saisi === null) return ko('taux_invalide');
    const c = await contratEnCours(db, tenantId);
    if (!c) return ko('aucun_contrat');
    // Le total est plafonné à 50 % : une remise commerciale n'est jamais conservée au-delà du plafond, et la part du parrainage compte.
    const commerciale = Math.min(saisi, REMISE_MAX);
    const parrainage = tauxParrainage(await parrainagesValides(db, tenantId));
    const motif = typeof f.get('remise_motif') === 'string' ? (f.get('remise_motif') as string) : '';
    const revue = typeof f.get('remise_revue_le') === 'string' ? (f.get('remise_revue_le') as string).trim() : '';
    const r = await saisirRemise(db, tenantId, { commerciale_taux: commerciale, motif, revue_le: revue || null }, acteur);
    if (!r.ok) return ko(r.code);
    return ok(saisi > REMISE_MAX || parrainage + commerciale > REMISE_MAX ? 'remise_plafonnee' : 'remise_enregistree');
  }

  if (action === 'gel') {
    // Une date vide n'efface pas un gel : c'est une tentative de l'effacer, refusée comme telle (`gel_efface`).
    const date = brut(f, 'tarif_gele_jusqu_au');
    const r = await poserGelTarif(db, tenantId, date === '' ? null : date, acteur);
    return r.ok ? ok('gel_pose') : ko(r.code);
  }

  if (action === 'dpa') {
    const r = await poserDpa(db, tenantId, brut(f, 'dpa_signe_le'), acteur);
    return r.ok ? ok('dpa_pose') : ko(r.code);
  }

  if (action === 'production') {
    const r = await poserMiseEnProduction(db, tenantId, brut(f, 'date_mise_en_production'), acteur);
    return r.ok ? ok('production_posee') : ko(r.code);
  }

  if (action === 'signature') {
    const r = await signerContrat(db, tenantId, brut(f, 'date_signature'), acteur, jour);
    return r.ok ? ok('contrat_signe') : ko(r.code);
  }

  if (action === 'fondateur') {
    const r = await poserStatutFondateur(db, tenantId, brut(f, 'signe_le'), acteur);
    return r.ok ? ok('fondateur_pose') : ko(r.code);
  }

  if (action === 'fondateur_retirer') {
    const r = await retirerStatutFondateur(db, tenantId, acteur);
    return r.ok ? ok('fondateur_retire') : ko(r.code);
  }

  if (action === 'preavis') {
    const r = await enregistrerPreavis(db, tenantId, brut(f, 'preavis_recu_le'), acteur, jour);
    if (!r.ok) return ko(r.code);
    // Le bon de la période suivante a pu être posé avant le préavis (J-30 de l'anniversaire, les deux le même jour) : brouillon annulé, émis signalé.
    if (r.contrat.resiliation_effet_le) await traiterBonsApresEffet(db, tenantId, r.contrat.id, r.contrat.resiliation_effet_le, acteur);
    return ok(r.reconduit ? 'preavis_reconduit' : 'preavis_enregistre');
  }

  if (action === 'preavis_annuler') {
    const avant = await contratEnCours(db, tenantId);
    const r = await annulerPreavis(db, tenantId, acteur, jour);
    if (!r.ok) return ko(r.code);
    if (avant?.resiliation_effet_le) await signalerBonsAnnulesParPreavis(db, tenantId, avant.id, avant.resiliation_effet_le);
    return ok('preavis_annule');
  }

  return ko('inchange');
}
