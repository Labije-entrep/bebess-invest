# Lot 02 — API JSON et synchronisation

Crée l'API du module sous `src/pages/api/suivi/`. Elle sert les rôles gestionnaire
et éditeur, jamais un viewer. Elle réutilise la session et le cloisonnement par
locataire du middleware : aucune nouvelle authentification.

## Points d'entrée

- `GET /api/suivi/version` → `{ version }`. Réponse minuscule, avec ETag.
- `GET /api/suivi/etat` → contacts, sujets, échanges, membres, listes, version.
- `POST /api/suivi/contact`, `PATCH` et `DELETE /api/suivi/contact/:id`
- Les mêmes trois pour `sujet` et `echange`.

## Règles

- `PATCH` ne reçoit que les champs modifiés et n'écrit que ceux-là. Deux associés qui
  modifient deux champs d'une même fiche ne s'écrasent pas.
- Toute écriture pose `maj_le` et appelle `incrementerVersion`.
- Toute valeur de liste passe par `valeurValide`. Refus : `422` avec les valeurs
  admises.
- Tout identifiant reçu est vérifié comme appartenant au locataire avant usage.
- Limite de débit par session : 120 écritures par minute, `429` au-delà.

## Vérification

Deux navigateurs connectés au même cabinet : l'un écrit, l'autre voit la version
changer en moins de quinze secondes. Puis un identifiant d'un autre locataire en
`PATCH` : `404`, pas `403`, et rien d'écrit.
