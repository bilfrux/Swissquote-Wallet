# Étape 49 — Relais RPC regtest filtré

## Problème (audit)

Le proxy Vite `/regtest-rpc` (`client/vite.config.ts`) transmettait tout le RPC de bitcoind avec ses identifiants, y
compris `/wallet/sq-omnibus` (portefeuille de garde de Swissquote) et `stop`. L'appli, ou n'importe quel site par une
requête « simple » `text/plain` (CSRF), pouvait faire `sendtoaddress` depuis le portefeuille de garde, en contournant la
Travel Rule (regtest seulement).

## Modification

`client/vite.config.ts` : le proxy est remplacé par un relais (greffon Vite) qui n'accepte que :
- des requêtes JSON-RPC uniques en POST, de même origine (Origin étranger → 403), d'au plus 1 Mo ;
- au niveau du nœud : `getblockcount`, `validateaddress`, `scantxoutset`, `getrawtransaction`, `testmempoolaccept`,
  `sendrawtransaction`, `getdescriptorinfo`, `listwallets`, `listwalletdir`, `estimatesmartfee`, plus `loadwallet` et
  `createwallet` limités aux portefeuilles `sq-watch-*` en lecture seule (sans clés privées, vides) ;
- sur un portefeuille : `importdescriptors` et `listsinceblock`, seulement sur `sq-watch-*`.

C'est exactement la liste des appels de `BitcoindBackend` (packages/bitcoin) utilisés par l'appli.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:49` | 3/3 (`etape-49-sortie.txt`) |
| `npm run validate:6:ui` ; `MOBILE=1 npm run validate:6:ui` | 19/19 ; 20/20 |
| `npm run validate:43` | 6/6 |
| `npx tsc -p client` | succès |

Observé : `sendtoaddress` et `getbalance` sur `sq-omnibus` → 403 ; `stop`, `dumpwallet`, portefeuille avec clés,
`loadwallet sq-omnibus`, requête groupée → 403 ; nœud toujours en marche ; Origin `http://attacker.example` → 403.
Sorties de régression : `etape-49-regressions-sortie.txt`.
