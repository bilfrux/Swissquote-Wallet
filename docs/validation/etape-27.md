# Étape 27 — Retrait de la connexion par passkey

## Modification

La connexion au compte Swissquote simulé utilise uniquement le formulaire
client ID + mot de passe. Le bouton « Connexion avec une passkey » et les
routes backend dédiées à cette connexion ont été retirés.

La passkey reste utilisée pour :

- la ré-authentification des montants élevés ;
- le compte smart wallet et ses opérations de récupération ;
- l'enregistrement et le step-up dans l'application bancaire.

## Validation exécutée

Commande :

```bash
npm run typecheck
```

Résultat observé : succès.

Commande :

```bash
npm run build
```

Résultat observé : succès.

## Résultat attendu

La page de connexion n'affiche plus de bouton de connexion par passkey.
Après connexion classique, le step-up passkey des montants élevés reste
disponible.
