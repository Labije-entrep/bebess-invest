# Labije Cab : contrat d'interface

```
== db.ts
tenantParHote(db, hote: string): Promise<Tenant|null>
utilisateurParEmail(db, email: string): Promise<Utilisateur|null>
utilisateurParId(db, id: string): Promise<Utilisateur|null>
viewersDuTenant(db, tenantId: string): Promise<Utilisateur[]>
ficheDuViewer(db, tenantId: string, viewerId: string): Promise<Fiche|null>
enveloppesDuViewer(db, viewerId: string): Promise<Enveloppe[]>
lignesDesEnveloppes(db, enveloppeIds: string[]): Promise<Ligne[]>
ciblesDuViewer(db, viewerId: string): Promise<Cible[]>
pointsDuViewer(db, viewerId: string): Promise<Point[]>
mouvementsDuViewer(db, viewerId: string): Promise<Mouvement[]>
documentsDuViewer(db, viewerId: string): Promise<Document[]>
pageContenu(db, tenantId: string, cle: string, langue = 'fr'): Promise<PageContenu|null>
notesPubliees(db, tenantId: string, langue = 'fr'): Promise<NoteMarche[]>
db: Base ; Role = 'editeur'|'associe'|'collaborateur'|'lecture'|'support_editeur'|'viewer' (qui peut quoi : src/lib/roles.ts) ; Utilisateur {id,tenant_id,email,nom,role,actif:number,cree_le}
Autres types : une interface par table du schéma, mêmes noms de colonnes (ids string, *_cents et *_bp number)
== auth.ts
COOKIE = 'bbs'
accueilDuRole(role: Role): string
demanderLien(db, tenantId: string, email: string): Promise<string|null>
jetonValide(db, jeton: string, tenantId: string): Promise<boolean>
consommerJeton(db, cookies: AstroCookies, jeton: string, tenantId: string): Promise<Utilisateur|null>
sessionCourante(db, cookies: AstroCookies): Promise<Utilisateur|null>
deconnecter(db, cookies: AstroCookies): Promise<void>
== format.ts
euros(cents: number): string ; pourcent(bp: number): string
dateCourte(iso: string): string ; dateLongue(iso: string): string ; moisAn(iso: string): string
== app.css
.wrap conteneur centré borné ; .section bloc espacé vertical ; .filet trait séparateur horizontal
.etiquette légende petites capitales ; .chiffre grand nombre serif
.btn bouton contour or ; .btn-plein bouton plein or ; .champ champ saisie pleine largeur
.table tableau chiffres alignés ; .table td.num / th.num cellule alignée droite
== middleware.ts : locals
utilisateur: Utilisateur|null ; tenant: Tenant|null
```
