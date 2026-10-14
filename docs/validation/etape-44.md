# Étape 44 — Biométrie (WebAuthn PRF) du Client Wallet dans un vrai navigateur

## Objectif

Hypothèse critique non vérifiée aux étapes 36-37 (reprise de la validation faite sur la branche modele-2-guardians, commit d1edc91) : le navigateur rend-il le secret PRF qui chiffre la phrase ?

## Modifications

- `scripts/validate/etape-44-prf.ts` (`npm run validate:44`) : Chrome headless, authentificateur virtuel CDP
  (`hasPrf: true`), code de l'interface (`client-wallet/src/ui/bio.ts`) chargé par Vite dans la page du wallet isolé (:5196).
- `client-wallet/src/ui/bio.ts` : délai de 60 s sur les demandes WebAuthn. Observé pendant ce test : sans authentificateur
  (passkey supprimée), `navigator.credentials.get` attendait sans fin.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:44` (regtest) | 5/5 (`etape-44-sortie.txt`) |

Observé : passkey du wallet créée avec l'extension PRF, secret de 32 octets, identique à la demande suivante ; la graine
stockée se déchiffre avec ce secret ; vraie signature d'un PSBT regtest ; un autre sel donne un autre secret (403) ;
authentificateur retiré : aucun secret, aucune signature.

## Non validé

- **Touch ID réel** (authentificateur de la plateforme macOS dans Chrome) : non exécuté, nécessite le doigt de l'utilisateur.
  À vérifier à la main avant la démo : Client Wallet (http://localhost:5180) → créer un wallet depuis la banque, puis signer.
