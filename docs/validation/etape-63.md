# Étape 63 — Envoi d'USDC avec la biométrie dans le navigateur, et deux robustesses Ethereum

Reprend, sur `main`, ce qui manquait encore du travail fait en parallèle sur la branche `modele-2-guardians`
(ses étapes 40 et 41, commits `81d337e` et `13373a2`). Le reste de ce travail était déjà dans `main`, souvent en mieux :
refus d'un seuil de gardiens < 2 (étape 48, liste blanche plus stricte), correction de `.map(getAddress)` (étape 54),
parcours Ethereum biométrique (`validate:54`), `validate:6:ui` biométrique (étape 45).

## Ce qui manquait

- **Aucun test navigateur n'envoyait d'USDC depuis l'étape 36** (biométrie). `validate:54` déploie un Safe neuf, donc
  sans USDC. Or l'envoi est le geste de base du wallet, et l'étape 35 l'a modifié : « Send USDC » prépare l'opération
  puis ouvre lui-même le Client Wallet, ce qui peut être bloqué par le navigateur (cas observé à l'étape 17, essai 1).
- **AA25 `invalid account nonce`** : juste après une opération, le nœud public de Sepolia (répartiteur de charge) peut
  encore donner l'ancien nonce du Safe ; le bundler refuse alors l'estimation de l'opération suivante. Observé sur
  `modele-2-guardians` (opération préparée quelques secondes après une activation).
- **Arrêt du processus du Client Wallet** : `send` écrivait l'en-tête 200 avant de sérialiser la réponse. Une réponse
  non sérialisable (observé avec un `bigint` sur `modele-2-guardians`) faisait écrire un second en-tête, qui levait
  `ERR_HTTP_HEADERS_SENT` hors de tout `try` : le wallet s'arrêtait.

## Modifications

- `packages/evm/src/index.ts` : `buildSponsoredOp` réessaie jusqu'à 5 fois (3 s) sur AA25 seulement.
- `client-wallet/src/server.ts` : réponse sérialisée avant l'en-tête ; une erreur de sérialisation donne une 500.
- `scripts/validate/etape-63-evm-usdc-ui.ts` (`npm run validate:63`) : pile isolée dont le bank-mock tourne sur une
  **copie** de `bank-mock/data` (vraie clé Swissquote, compte et Safe de démo de CH-0003). Dans la copie seulement, la
  passkey bancaire de CH-0003 est retirée pour que le test active la sienne (authentificateur virtuel avec PRF).
  Le Safe de démo, qui détient des USDC, est récupéré vers une nouvelle clé biométrique, puis cette clé envoie 1 USDC.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:63` (vrai Sepolia) | 5/5 au premier essai (`etape-63-sortie.txt`) |
| `npm run typecheck` ; `validate:48` ; `validate:inv5` | succès ; 20/20 ; 4/4 (`etape-63-regressions-sortie.txt`) |
| `npm run validate:54` (vrai Sepolia) | 9/9 |

| # | Critère | Observé |
| --- | --- | --- |
| 63-1 | Safe de démo ouvert depuis l'interface après déverrouillage biométrique de la partie crypto : USDC, contact gardien, seuil 2 | `0x2929…23AA`, 52 USDC |
| 63-2 | Recovery (Swissquote avec sa vraie clé + contact) vers une nouvelle clé biométrique, USDC conservés | [finalisation](https://sepolia.etherscan.io/tx/0xbb4ea39690ba9b0f30201475b51521a2878e7e4b0da0389055ff4c0cc22d9793), propriétaire `0xea12…574f` |
| 63-3 | Signatures de gardiens restantes invalidées | nonce 22 → 24 |
| 63-4 | « Send USDC » ouvre lui-même le Client Wallet ; écran « Send 1 USDC », frais parrainés ; signé par biométrie | [envoi](https://sepolia.etherscan.io/tx/0x8abd579b6d2a7e0788fd527643a2e67339e2720bff9ba0449e8bae4eef3b1737), 52 → 51 USDC, 0 ETH, fenêtre ouverte directement : oui |
| 63-x | Aucune erreur de console, aucune réponse 5xx | aucune |

## Non validé

- Le correctif de `send` n'a pas de reproduction sur les routes actuelles (aucune ne renvoie de `bigint`) : il est
  défensif, vérifié par le typecheck et les parcours ci-dessus, pas par un test qui provoque l'erreur.
- La nouvelle tentative sur AA25 n'est pas journalisée : on ne sait pas si elle a servi pendant ces essais.
- Fenêtre du Client Wallet **neuve** après « Send USDC » : le test réutilise la fenêtre ouverte plus tôt (une passkey ne
  quitte pas son onglet avec son secret PRF). Si le navigateur bloquait une fenêtre neuve, le bandeau « Sign with my
  Client Wallet » resterait comme repli (lu dans le code, non exercé).
- Touch ID réel (étape 59 : vérification manuelle).

## Effet sur la démo

Le Safe de démo `0x2929…23AA` appartient maintenant à `0xea12…574f`, une clé qui n'existait que dans l'authentificateur
virtuel du test : elle ne peut plus signer. Pour le rendre à un wallet utilisable par Touch ID : recovery depuis
l'interface (3 min), c'est-à-dire l'histoire de la démo. Le registre de `bank-mock/data` (non modifié par le test) indique
encore l'ancien propriétaire jusqu'à la prochaine recovery ou synchronisation ; Swissquote relit de toute façon la chaîne
avant de signer.
