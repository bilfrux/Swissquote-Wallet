# Étape 37 — Réparer le commit 36 et valider le coffre biométrique

## Problème trouvé

Le commit 36 (`4426b6e`) ne compilait pas seul : `client-wallet/src/server.ts` importait `sealBio`, `openBio`,
`validBio`, `validPrf` et le champ `StoredWallet.bio`, définis uniquement dans `vault.ts` et `store.ts`, restés
non commités. Vérifié en exportant `HEAD` dans un dossier propre : `tsc -p client-wallet` donnait des erreurs TS2305
et TS2339. L'étape 36 n'avait été validée que par `typecheck` sur un arbre de travail qui contenait ces fichiers.

## Modifications

- Commit de `client-wallet/src/vault.ts` et `store.ts` (coffre biométrique HKDF + AES-256-GCM).
- Commentaires corrigés : le PIN n'est plus qu'un ancien format conservé pour la migration vers la biométrie
  (ils disaient « l'un, l'autre ou les deux »).
- Nouveau test serveur `scripts/validate/etape-37-bio.ts` (`npm run validate:37`).

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run typecheck` | succès |
| `cd client-wallet && npx vite build` | succès |
| `git diff --check` | succès |
| `npm run validate:37` (regtest, wallet isolé :5197) | 8/8 (`etape-37-sortie.txt`) |
| `npm run validate:inv5` | succès (aucune clé privée dans `client/`) |
| `npm run validate:8:pin` | **échoue** (voir ci-dessous) |

`validate:37` couvre : création refusée sans biométrie valide ; graine chiffrée sur disque sans mot en clair ;
vue publique sans secret ; signature refusée avec un mauvais secret, sans secret ou avec un PIN ; vraie signature
d'un PSBT regtest avec le bon secret ; blocage 60 s après 5 échecs ; migration d'un ancien wallet PIN (PIN supprimé
ensuite) ; protection d'un ancien wallet en clair.

## Non validé

- **La biométrie WebAuthn/PRF dans le navigateur n'a pas été exécutée.** Le test serveur remplace la sortie PRF par
  32 octets aléatoires. Touch ID / authentificateur virtuel Chrome : à tester.
- `validate:8:pin` est obsolète : il crée un wallet avec un PIN, désormais refusé par design (étape 36). Il est conservé
  comme trace historique, remplacé par `validate:37`.
- `validate:6:ui`, `validate:17`, `validate:18` (parcours navigateur) saisissent encore un PIN : **non relancés, très
  probablement à adapter** à la biométrie. Les étapes 25 à 36 n'ont pas eu de test navigateur.
