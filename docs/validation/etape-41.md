# Étape 41 — Kit de sortie : récupérer ses coins sans Swissquote

## Problème

Le wallet est lié à l'appareil, mais pour dépenser le client passait par le site Swissquote (préparation du PSBT,
lecture des coins, diffusion). Si le site, bank-mock ou le compte Swissquote n'existent plus, l'appareil et sa clé
restaient là sans moyen simple de s'en servir.

## Modification

Le **Client Wallet** (processus séparé, `localhost:5180`) a désormais un bouton « Emergency exit (works without
Swissquote) » pour chaque wallet protégé qui a une politique enregistrée :

- `POST /api/exit/prepare` : lit les coins du wallet sur la chaîne (bitcoind en regtest, API Esplora publique en
  signet, jamais Swissquote), construit un PSBT qui envoie **tous** les coins vers l'adresse choisie par le chemin
  « votre clé seule » (aucun délai, aucun guardian).
- Le PSBT passe par le **même écran de confirmation et la même signature biométrique** que tout envoi (`/api/describe`,
  `/api/sign`) : chemin affiché, adresse, frais, et confirmation des 6 derniers caractères au-delà de 0,2 BTC.
- `POST /api/exit/broadcast` : vérifie que le PSBT est bien un envoi « clé du client » de ce wallet, le finalise et le
  diffuse. Refus si le PSBT n'est pas entièrement signé.
- Rien dans `client-wallet/` ne contacte le site ni bank-mock.

## Validation exécutée

```bash
npm run typecheck
npm run validate:41      # sortie : docs/validation/etape-41-sortie.txt
```

Seuls le Client Wallet et bitcoind regtest sont lancés : ni le site ni bank-mock.
Résultat observé : typecheck sans erreur ; `validate:41` : 5 critères sur 5 réussis.

| # | Critère | Observé |
| --- | --- | --- |
| 41-1 | Wallet inconnu, adresse invalide, wallet sans politique : refusés | 404 ; 400 ; 409 |
| 41-2 | Préparation : 2 coins (0,4 BTC), chemin « clé seule », une sortie vers l'adresse choisie, montant élevé signalé | 200 ; 2 coins ; 40 000 000 sats ; chemin `client` |
| 41-3 | Sans secret biométrique : signature refusée ; PSBT non signé : diffusion refusée | 403 ; 400 |
| 41-4 | Signature (6 caractères exigés), diffusion, confirmation | mauvais caractères 400 ; l'adresse reçoit 0,39999566 BTC ; coins restants : 0 |
| 41-5 | Interface Chrome du Client Wallet seul : bouton, formulaire, écran de confirmation jusqu'à la demande de biométrie | chemin, montant (0,05 BTC) et adresse affichés ; 0 erreur JS |

Captures : `captures/etape-41-1-sortie-formulaire.png`, `etape-41-2-sortie-confirmation.png`.

## Limites (à lire)

- **Bitcoin seulement.** L'Ethereum/USDC (Safe, bundler, paymaster) n'a pas de kit de sortie. Non fait.
- **Il faut toujours l'appareil.** Le kit utilise la clé du Client Wallet et sa biométrie. Appareil perdu **et** Swissquote
  disparue : les fonds restent perdus, car la règle on-chain n'a pas changé (la recovery exige Swissquote).
  Le Client Wallet n'a pas de fonction d'import de phrase : noter la phrase ne permet pas, aujourd'hui, de la remettre
  dans ce wallet. Rien n'a été vérifié ici sur sa reprise dans un autre outil (Bitcoin Core, `tools/client-signer`).
- **La politique doit être enregistrée dans le wallet** (envoyée par le site à la création). Sans elle : 409.
- **Biométrie simulée** dans le test (secret PRF aléatoire, comme à l'étape 37) ; la biométrie WebAuthn réelle n'est pas
  exercée ici. Le chemin d'écran est vérifié jusqu'à la demande de biométrie, sans la valider.
- **Signet non testé** (Esplora public) : seul regtest l'a été.
- **Le kit est dans le Client Wallet, qui est servi par `npm run dev -w client-wallet`.** Il suppose donc le dépôt et ses
  dépendances. Un binaire autonome n'existe pas.
