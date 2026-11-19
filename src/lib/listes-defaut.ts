// Valeurs par défaut des listes de référence, posées à la création d'un cabinet.
// Source : chantier/21-listes-defaut.md. Le cabinet peut ensuite les modifier (lot 09) ;
// `cle` ne change jamais, c'est elle qui est stockée dans les enregistrements.

import type { Base, Requete } from './db';

export type Liste =
  | 'type_contact' | 'metier' | 'etape' | 'type_echange' | 'statut_sujet'
  | 'categorie_doc' | 'classe_actif' | 'statut_mouvement' | 'type_portefeuille';

/**
 * [cle, libelle] ou [cle, libelle, 'terminal'] ; l'ordre est celui du tableau, à partir de 1.
 * « terminal » : la valeur clôt l'objet (statut_sujet) ou le fait sortir du parcours (etape).
 */
type ValeurDefaut = [cle: string, libelle: string, terminal?: 'terminal'];
export const LISTES_DEFAUT: Record<Liste, ValeurDefaut[]> = {
  classe_actif: [
    ['actions', 'Actions'],
    ['obligations', 'Obligations'],
    ['immobilier', 'Immobilier'],
    ['private_equity', 'Private equity'],
    ['liquidites', 'Liquidités'],
  ],
  statut_mouvement: [
    ['en_preparation', 'En préparation'],
    ['transmis', 'Transmis'],
    ['chez_etablissement', "Chez l'établissement"],
    ['execute', 'Exécuté'],
    ['archive', 'Archivé'],
  ],
  type_contact: [
    ['client', 'Client'],
    ['prospect', 'Prospect'],
    ['prescripteur', 'Prescripteur'],
    ['partenaire', 'Partenaire'],
    ['interne', 'Interne'],
  ],
  statut_sujet: [
    ['afaire', 'À faire'],
    ['encours', 'En cours'],
    ['attente', 'En attente'],
    ['fait', 'Fait', 'terminal'],
  ],
  etape: [
    ['contact', 'Premier contact'],
    ['rdv', 'RDV'],
    ['proposition', 'Proposition'],
    ['signe', 'Signé'],
    ['perdu', 'Perdu', 'terminal'],
  ],
  type_echange: [
    ['rdv', 'RDV'],
    ['tel', 'Appel'],
    ['visio', 'Visio'],
    ['mail', 'E-mail'],
  ],
  metier: [
    ['notaire', 'Notaire'],
    ['avocat', 'Avocat'],
    ['expert_comptable', 'Expert-comptable'],
    ['banquier', 'Banquier'],
    ['assureur', 'Assureur'],
    ['agent_immobilier', 'Agent immobilier'],
    ['cgp', 'Conseiller en gestion de patrimoine'],
    ['commissaire_comptes', 'Commissaire aux comptes'],
    ['autre', 'Autre'],
  ],
  categorie_doc: [
    ['reglementaire', 'Réglementaire'],
    ['modeles', 'Modèles et contrats'],
    ['juridique', 'Juridique'],
    ['fiscal', 'Fiscal'],
    ['autre', 'Autre'],
  ],
  type_portefeuille: [
    ['personne', 'Personne physique'],
    ['holding', 'Holding'],
    ['sci', 'SCI'],
    ['assurance_vie', 'Assurance-vie'],
    ['autre', 'Autre'],
  ],
};

/** Les requêtes qui posent les listes par défaut d'un nouveau cabinet (à passer à db.batch). */
export function requetesListesDefaut(db: Base, tenantId: string): Requete[] {
  const out: Requete[] = [];
  for (const [liste, valeurs] of Object.entries(LISTES_DEFAUT)) {
    valeurs.forEach(([cle, libelle, terminal], i) => {
      out.push(
        db
          .prepare('INSERT INTO liste_valeur (tenant_id, liste, cle, libelle, ordre, actif, terminal) VALUES (?, ?, ?, ?, ?, 1, ?)')
          .bind(tenantId, liste, cle, libelle, i + 1, terminal ? 1 : 0),
      );
    });
  }
  return out;
}
