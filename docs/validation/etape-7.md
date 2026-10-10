# Étape 7 : preuve de propriété et client de démo vierge

## Vérification préalable (demandée avant de coder)

| Élément | Preuve exécutée | Résultat |
| --- | --- | --- |
| Panneau d'attaques à 3 boutons | Chrome sur la pile de démo : comptage et exécution du bouton 2 | 3 boutons ; le n°2 renvoie « ⛔ Refusé (conforme) », `non-BIP68-final` |
| Invariant 1 | `npm run test:attacks` | 4/4 conformes ; Swissquote seule rejetée sur les deux chemins après D |
| Invariant 5 | `npm run validate:inv5` | 4/4 contrôles, avec témoin positif |
| README, threat model, schéma d'architecture | fichiers présents ; 2 schémas Mermaid rendus | présents, rendu OK |

## Livré

| Élément | Emplacement |
| --- | --- |
| Défi et vérification (usage unique, 10 min ; clé recalculée depuis le xpub enregistré ; `Verifier.verifySignature(…, strict = true)`) | `bank-mock/src/server.ts` (`/ownership/challenge`, `/ownership/verify`), table `ownership_challenges` |
| Signature du défi après un écran de confirmation qui affiche le message en entier (BIP-322 « simple », `Signer.sign`) | `client-wallet/src/server.ts` (`/api/prove`), `client-wallet/src/ui/App.tsx` |
| Bouton « Prouver à Swissquote que je contrôle cette adresse », avec la phrase exacte de ce qui est prouvé | `client/src/wallet/Account.tsx` |
| Adresse P2WPKH de la clé client (clé publique seulement) | `packages/bitcoin/src/ownership.ts` |
| Client vierge `CH-0003` (Léa Martin, `demo0003` ; re-KYC `Martin` / `1992-03-21` / `246810`) | `bank-mock/src/bank.ts`, `kyc.ts` |
| Correction : les textes très longs (adresses) élargissaient la page sur téléphone | `client/src/index.css` |

Bibliothèque : `bip322-js` 4.0.0, installée seulement dans `client-wallet`, `bank-mock` et à la racine (tests). Elle n'est pas dans l'appli.

## Ce qui est prouvé

- **Prouvé** : le client détient la clé privée de sa clé client à l'index i (signature BIP-322 vérifiée pour l'adresse P2WPKH de cette clé). D'après la politique enregistrée, cette clé suffit seule à dépenser l'adresse n°i du compte (chemin client).
- **Pas prouvé** : ce n'est pas une signature de l'adresse P2WSH du compte elle-même (non gérée par `bip322-js`) ; le lien clé → adresse repose sur le descripteur connu de Swissquote. Rien sur l'identité de la personne : elle est rattachée au client par la session bancaire.

## Commandes et résultats

```bash
npm run validate:7                                                   # etape-7-sortie.txt
CONSOLE_URL=http://localhost:5175 npm run validate:6:ui              # etape-6-ui-sortie.txt
MOBILE=1 CONSOLE_URL=http://localhost:5175 npm run validate:6:ui     # etape-6-ui-mobile-sortie.txt
```

| # | Critère | Verdict |
| --- | --- | --- |
| 7-1 | CH-0003 : connexion, 2 comptes CHF, **0 compte Bitcoin** (vérifié aussi sur la pile de démo, en regtest et en signet) | fonctionne |
| 7-2 | Preuve valide pour l'adresse n°3 : défi, signature du Wallet du client, vérification stricte | fonctionne |
| 7-3 | Rejeu d'un défi déjà utilisé : 409 | fonctionne |
| 7-4 | Signature d'un message différent du défi : refusée | fonctionne |
| 7-5 | Signature du bon défi par une autre clé : refusée | fonctionne |
| 7-6 | Bonne clé mais format BIP-137 ancien : refusé (mode strict) | fonctionne |
| 7-7 | Défi demandé par un autre client pour ce compte : 403 | fonctionne |
| 7-8 | Le Wallet du client refuse un compte qui n'est pas sur l'appareil : 404 | fonctionne |
| 6-13 | Dans l'interface, sur ordinateur et sur téléphone : défi affiché en entier dans le wallet, signé, « Propriété vérifiée » | fonctionne |
| 6-14 | Téléphone : aucune page plus large que l'écran (390 px) | fonctionne |
| Parcours complet | `validate:6:ui` sur CH-0003 : 13/13 sur ordinateur, 14/14 sur téléphone | fonctionne |
| Non-régression | `validate:1` 6/6, `validate:2` 8/8, `validate:3` 3/3, `test:attacks` 4/4, `validate:inv5` 4/4, typage des 7 projets | fonctionne (`etape-7-regressions-sortie.txt`) |
