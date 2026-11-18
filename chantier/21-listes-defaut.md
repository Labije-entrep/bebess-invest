# Listes de référence par défaut

Les valeurs posées à la création d'un cabinet. Elles sont **modifiables par le
cabinet** au lot 09 : ce sont des points de départ, pas des constantes.

`cle` ne change jamais après la création : c'est elle qui est stockée dans les
enregistrements. `libelle` est affiché et peut être renommé. `ordre` fixe
l'affichage, y compris l'ordre des colonnes du kanban et du parcours.

## Deux listes à reprendre à l'identique

`classe_actif` et `statut_mouvement` existent déjà dans `src/lib/gestion.ts`
(`CLASSES` et `STATUTS`). Reprends **exactement** ces clés : les seeds, l'import CSV
et le calcul d'allocation en dépendent. Une clé renommée casserait les données
existantes.

### classe_actif
| cle | libelle | ordre |
| --- | --- | --- |
| `actions` | Actions | 1 |
| `obligations` | Obligations | 2 |
| `immobilier` | Immobilier | 3 |
| `private_equity` | Private equity | 4 |
| `liquidites` | Liquidités | 5 |

### statut_mouvement
| cle | libelle | ordre |
| --- | --- | --- |
| `en_preparation` | En préparation | 1 |
| `transmis` | Transmis | 2 |
| `chez_etablissement` | Chez l'établissement | 3 |
| `execute` | Exécuté | 4 |
| `archive` | Archivé | 5 |

## Les sept autres

### type_contact
| cle | libelle | ordre |
| --- | --- | --- |
| `client` | Client | 1 |
| `prospect` | Prospect | 2 |
| `prescripteur` | Prescripteur | 3 |
| `partenaire` | Partenaire | 4 |
| `interne` | Interne | 5 |

Un contact peut en porter plusieurs : c'est la table `contact_type`.

### statut_sujet
| cle | libelle | ordre |
| --- | --- | --- |
| `afaire` | À faire | 1 |
| `encours` | En cours | 2 |
| `attente` | En attente | 3 |
| `fait` | Fait | 4 |

Cet ordre est aussi celui des colonnes du kanban et celui du cycle quand on clique
sur un statut pour le faire avancer. Le dernier revient au premier.

### etape
| cle | libelle | ordre |
| --- | --- | --- |
| `contact` | Premier contact | 1 |
| `rdv` | RDV | 2 |
| `proposition` | Proposition | 3 |
| `signe` | Signé | 4 |
| `perdu` | Perdu | 5 |

Ordre des colonnes de la vue Parcours. `perdu` est une sortie, pas une étape
d'avancement : affiche-la en dernier et en retrait.

### type_echange
| cle | libelle | ordre |
| --- | --- | --- |
| `rdv` | RDV | 1 |
| `tel` | Appel | 2 |
| `visio` | Visio | 3 |
| `mail` | E-mail | 4 |

### metier
| cle | libelle | ordre |
| --- | --- | --- |
| `notaire` | Notaire | 1 |
| `avocat` | Avocat | 2 |
| `expert_comptable` | Expert-comptable | 3 |
| `banquier` | Banquier | 4 |
| `assureur` | Assureur | 5 |
| `agent_immobilier` | Agent immobilier | 6 |
| `cgp` | Conseiller en gestion de patrimoine | 7 |
| `commissaire_comptes` | Commissaire aux comptes | 8 |
| `autre` | Autre | 9 |

Renseigné surtout sur les prescripteurs.

### categorie_doc
| cle | libelle | ordre |
| --- | --- | --- |
| `reglementaire` | Réglementaire | 1 |
| `modeles` | Modèles et contrats | 2 |
| `juridique` | Juridique | 3 |
| `fiscal` | Fiscal | 4 |
| `autre` | Autre | 5 |

Il s'agit de la bibliothèque **interne** du cabinet, sans rapport avec la table
`document` des viewers.

### type_portefeuille
| cle | libelle | ordre |
| --- | --- | --- |
| `personne` | Personne physique | 1 |
| `holding` | Holding | 2 |
| `sci` | SCI | 3 |
| `assurance_vie` | Assurance-vie | 4 |
| `autre` | Autre | 5 |

C'est une étiquette, pas un modèle juridique : ni quotes-parts, ni règles de
consolidation, ni détention croisée.
