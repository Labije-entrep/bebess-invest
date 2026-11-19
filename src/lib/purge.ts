// La suppression du J+75 (lot 12) : RÉELLE, pas un drapeau. Les données du cabinet et de ses clients finaux sont effacées ; les objets
// R2 aussi ; le nom de domaine personnalisé est libéré chez Cloudflare.
//
// Effacés : comptes (personnel, support, clients finaux), sessions et jetons, dossiers, portefeuilles, valorisations, mouvements,
// documents et rapports, consultations, fiches, imports, contacts et suivi, actus, notes, contenus du site, listes, réglages,
// incidents, domaines, suspensions. Conservés : la ligne du locataire (la raison sociale, et avec elle le SIREN, l'adresse et le contact
// de facturation, lot 13 : aucune requête ci-dessous n'y touche, hors `domaine`), son contrat et ses bons (donc la facture
// d'installation et l'historique du contrat), les PDF de ses factures (`factures/<locataire>/`, hors du préfixe vidé par `viderR2`),
// ses parrainages, et le JOURNAL — qui ne contient aucune donnée de client final (journal.ts :
// rien d'autre que des identifiants, des types, des dates et des montants du contrat) ; il n'y a donc rien à y retirer, et ses
// déclencheurs d'écriture seule ne sont ni contournés ni touchés : aucune instruction ci-dessous ne vise `evenement`, sinon pour y écrire.
//
// L'ordre est celui des clés étrangères. R2 et Cloudflare passent AVANT la base : si l'un échoue, la base n'a pas bougé et la passe
// suivante recommence ; si la base échoue, R2 et Cloudflare sont déjà vides, ce qui se rejoue sans dommage. Les lignes de la base partent
// dans UN `batch` : tout ou rien.

import { libererHoteCloudflare } from './admin';
import { STATUTS_EN_COURS } from './contrat';
import type { Contexte } from './envois';
import type { Bucket } from './fichiers';
import { EVENEMENT, requeteEvenement } from './journal';

export type ResultatPurge = { etat: 'purge'; objets: number; domaines: number } | { etat: 'bloque'; raison: string };

// Chaque requête a UN seul « ? » : l'identifiant du locataire.
const DU_LOCATAIRE = '(SELECT id FROM utilisateur WHERE tenant_id = ?)';
const DES_PORTEFEUILLES = '(SELECT id FROM portefeuille WHERE tenant_id = ?)';
const REQUETES: string[] = [
  `DELETE FROM jeton_connexion WHERE utilisateur_id IN ${DU_LOCATAIRE}`,
  `DELETE FROM session WHERE utilisateur_id IN ${DU_LOCATAIRE}`,
  // Le journal de consultation (lot 01) est celui des viewers : il part avec eux, ses clés étrangères l'exigent.
  `DELETE FROM consultation WHERE viewer_id IN ${DU_LOCATAIRE}`,
  `DELETE FROM mouvement WHERE viewer_id IN ${DU_LOCATAIRE}`,
  `DELETE FROM document WHERE viewer_id IN ${DU_LOCATAIRE}`,
  `DELETE FROM point WHERE portefeuille_id IN ${DES_PORTEFEUILLES}`,
  `DELETE FROM cible WHERE portefeuille_id IN ${DES_PORTEFEUILLES}`,
  `DELETE FROM ligne WHERE enveloppe_id IN (SELECT e.id FROM enveloppe e WHERE e.portefeuille_id IN ${DES_PORTEFEUILLES})`,
  `DELETE FROM enveloppe WHERE portefeuille_id IN ${DES_PORTEFEUILLES}`,
  'DELETE FROM portefeuille WHERE tenant_id = ?',
  `DELETE FROM fiche WHERE utilisateur_id IN ${DU_LOCATAIRE}`,
  'DELETE FROM import_csv WHERE tenant_id = ?',
  'UPDATE contact SET apporteur_id = NULL WHERE tenant_id = ?',
  'DELETE FROM contact_type WHERE tenant_id = ?',
  'DELETE FROM sujet WHERE tenant_id = ?',
  'DELETE FROM echange WHERE tenant_id = ?',
  'DELETE FROM contact WHERE tenant_id = ?',
  'DELETE FROM membre WHERE tenant_id = ?',
  'DELETE FROM actu WHERE tenant_id = ?',
  'DELETE FROM note_marche WHERE tenant_id = ?',
  'DELETE FROM page_contenu WHERE tenant_id = ?',
  'DELETE FROM document_interne WHERE tenant_id = ?',
  'DELETE FROM liste_valeur WHERE tenant_id = ?',
  'DELETE FROM reglage WHERE tenant_id = ?',
  'DELETE FROM version_locataire WHERE tenant_id = ?',
  'DELETE FROM incident WHERE tenant_id = ?',
  'DELETE FROM suspension WHERE tenant_id = ?',
  'DELETE FROM domaine WHERE tenant_id = ?',
  'DELETE FROM utilisateur WHERE tenant_id = ?',
  // L'hôte d'origine ne désigne plus personne : il se libère (la ligne du locataire, elle, reste).
  'UPDATE tenant SET domaine = NULL WHERE id = ?',
];

/** Vide le bucket de tout ce qui commence par `<locataire>/` : la barre finale empêche d'effleurer un locataire dont l'id commence pareil. */
async function viderR2(bucket: Bucket, tenantId: string): Promise<number> {
  const prefix = `${tenantId}/`;
  let effaces = 0;
  for (let tour = 0; tour < 10_000; tour++) {
    const { objects } = await bucket.list({ prefix, limit: 1000 });
    if (objects.length === 0) return effaces;
    await bucket.delete(objects.map((o) => o.key));
    effaces += objects.length;
  }
  throw new Error('R2 : la suppression ne se termine pas');
}

export async function purgerCabinet(ctx: Contexte, contratId: string, tenantId: string): Promise<ResultatPurge> {
  const { db, env } = ctx;
  // Trois gardes, avant tout geste irréversible : le contrat est bien celui d'un essai non converti, le cabinet n'en a pas de nouveau
  // en cours, et il n'héberge pas un compte éditeur (on ne supprime pas sa propre console).
  const contrat = await db.prepare('SELECT statut FROM contrat WHERE id = ? AND tenant_id = ?').bind(contratId, tenantId).first<{ statut: string }>();
  if (contrat?.statut !== 'essai_non_converti') return { etat: 'bloque', raison: 'le contrat n’est pas un essai non converti' };
  const enCours = await db
    .prepare(`SELECT 1 AS ok FROM contrat WHERE tenant_id = ? AND statut IN (${STATUTS_EN_COURS.map((x) => `'${x}'`).join(',')})`)
    .bind(tenantId)
    .first();
  if (enCours) return { etat: 'bloque', raison: 'le cabinet a un nouveau contrat en cours' };
  const editeur = await db.prepare("SELECT 1 AS ok FROM utilisateur WHERE tenant_id = ? AND role = 'editeur'").bind(tenantId).first();
  if (editeur) return { etat: 'bloque', raison: 'le cabinet héberge un compte éditeur' };

  // Cloudflare d'abord : un domaine qu'on n'a pas pu libérer reste désigné par sa ligne, et la passe suivante le retentera.
  const { results: domaines } = await db.prepare('SELECT hote, cf_id FROM domaine WHERE tenant_id = ? AND cf_id IS NOT NULL').bind(tenantId).all<{ hote: string; cf_id: string }>();
  for (const d of domaines) {
    const r = await libererHoteCloudflare(env, d.cf_id);
    if (!r.ok) return { etat: 'bloque', raison: `domaine ${d.hote} non libéré : ${r.message}` };
  }
  const objets = await viderR2(env.FICHIERS, tenantId);

  await db.batch([
    ...REQUETES.map((sql) => db.prepare(sql).bind(tenantId)),
    // La marque « purgé » et l'événement partent avec les suppressions : le cabinet est purgé si et seulement si elles ont toutes eu lieu.
    db.prepare("INSERT INTO envoi_automatique (cle, tenant_id, reserve_le, envoye_le) VALUES (?, ?, ?, ?)").bind(`purge:${contratId}`, tenantId, ctx.maintenant, ctx.maintenant),
    requeteEvenement(db, {
      tenantId, type: EVENEMENT.CABINET_PURGE, acteur: null, cible: { type: 'cabinet', id: tenantId },
      detail: { contrat_id: contratId, objets_r2: objets, domaines_liberes: domaines.length },
    }),
  ]);
  return { etat: 'purge', objets, domaines: domaines.length };
}
