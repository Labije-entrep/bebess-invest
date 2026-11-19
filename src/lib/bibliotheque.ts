// Bibliothèque interne du cabinet (lot 06) : table `document_interne`. Elle n'a aucun rapport avec la table
// `document` des viewers, qui porte les pièces partagées avec les clients : ne jamais les mélanger.
// Toute lecture et toute écriture est bornée au locataire.

import type { Base } from './db';

export interface DocumentInterne {
  id: string;
  titre: string;
  url: string | null;
  categorie: string;
  type: string | null;
  resume: string | null;
  ajoute_le: string;
}

export async function documentsInternes(db: Base, tenantId: string): Promise<DocumentInterne[]> {
  const { results } = await db
    .prepare(
      `SELECT id, titre, url, categorie, type, resume, ajoute_le FROM document_interne
        WHERE tenant_id = ? ORDER BY ajoute_le DESC, titre, id`,
    )
    .bind(tenantId)
    .all<DocumentInterne>();
  return results;
}

export interface SaisieDocument {
  titre: string;
  url: string | null;
  categorie: string;
  type: string | null;
  resume: string | null;
}

export async function creerDocument(db: Base, tenantId: string, v: SaisieDocument): Promise<void> {
  await db
    .prepare(
      `INSERT INTO document_interne (id, tenant_id, titre, url, categorie, type, resume, ajoute_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), tenantId, v.titre, v.url, v.categorie, v.type, v.resume, new Date().toISOString())
    .run();
}

export async function modifierDocument(db: Base, tenantId: string, id: string, v: SaisieDocument): Promise<void> {
  await db
    .prepare('UPDATE document_interne SET titre = ?, url = ?, categorie = ?, type = ?, resume = ? WHERE id = ? AND tenant_id = ?')
    .bind(v.titre, v.url, v.categorie, v.type, v.resume, id, tenantId)
    .run();
}

export async function supprimerDocument(db: Base, tenantId: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM document_interne WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche sur l'ensemble : titre, lien, libellé de la catégorie, type, résumé. Sans accents ni casse ; tous les mots doivent figurer. */
export function filtrer(docs: DocumentInterne[], q: string, libelleCategorie: (cle: string) => string): DocumentInterne[] {
  const mots = norm(q).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return docs;
  return docs.filter((d) => {
    const texte = norm([d.titre, d.url, libelleCategorie(d.categorie), d.type, d.resume].filter(Boolean).join(' '));
    return mots.every((m) => texte.includes(m));
  });
}
