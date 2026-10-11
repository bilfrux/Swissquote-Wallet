# Étape 38 — Passkey bancaire activée à la création du wallet

## Modification

`client/src/wallet/CreateWallet.tsx` : après l'enregistrement du compte chez Swissquote, si le wallet vient du
Client Wallet et que le compte n'a aucune passkey (`passkeyStatus().count === 0`), `registerPasskey()` est appelée
automatiquement. Un refus ou une erreur ne bloque pas la création ; l'activation manuelle (« Enable a passkey »)
et celle au premier montant élevé restent possibles. Le Client Wallet (:5180) n'est pas modifié : il garde la graine,
la signature et « Simulate losing this device ». Aucune clé dans `client/` (invariant 5 inchangé).

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npx tsc -p client` | succès, aucune erreur |

## Non validé

- **Le parcours navigateur n'a pas été exécuté** (création du wallet, prompt WebAuthn, affichage « enabled » dans
  la sécurité du compte). À tester avec Touch ID ou un authentificateur virtuel Chrome.
