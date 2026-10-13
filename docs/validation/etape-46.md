# Étape 46 — Exposition réseau et effacement du wallet

## Problème (audit)

`server.listen(PORT)` écoutait sur toutes les interfaces. Observé avant correction : `curl http://192.168.1.194:5180/api/wallets`
→ 200 (21 wallets listés) depuis l'adresse du réseau local. Une requête sans en-tête `Origin` passait le contrôle : depuis
le même Wi-Fi, `DELETE /api/wallets/:id` effaçait la graine sans aucune authentification. bank-mock (`*:4000`), le serveur
d'attaques et le RPC de bitcoind (`0.0.0.0:18443`, identifiants de test) étaient aussi exposés.

## Modifications

- `client-wallet/src/server.ts` : écoute sur `localhost` (`CLIENT_WALLET_HOST`) ; en-tête `Host` limité à
  `localhost`/`127.0.0.1`/`[::1]` sur le port du wallet, pour l'API et l'interface (contre le DNS rebinding : une page
  d'un autre domaine résolu en 127.0.0.1 lirait l'API en même origine, sans `Origin`) ; `DELETE /api/wallets/:id` exige
  le déverrouillage (biométrie), avec le même compteur d'échecs que la signature.
- `client-wallet/src/ui/App.tsx` : « Erase permanently » demande la biométrie.
- `bank-mock/src/server.ts` (`BANK_MOCK_HOST`) et `scripts/attacks/server.ts` (`ATTACKS_HOST`) : écoute sur `localhost`.
- `docker/regtest.yml` : RPC publié sur `127.0.0.1:18443`.
- `scripts/validate/etape-6-ui.ts` : l'effacement se fait depuis la fenêtre du wallet, qui détient sa passkey.

Pas d'exigence d'en-tête `Origin` pour les requêtes sans navigateur : en boucle locale, un processus local peut de toute
façon le fabriquer ; la protection utile est l'interface d'écoute et la biométrie sur les opérations destructrices.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:46` | 4/4 (`etape-46-sortie.txt`) |
| `npm run validate:6:ui` (régression) | 19/19 (`etape-46-regressions-sortie.txt`) |
| `npx tsc -p client-wallet && npx tsc -p bank-mock` | succès |

Observé : depuis 192.168.1.194, ports 5210, 4420, 4421 → `ECONNREFUSED` ; en boucle locale 200/200/404 ; Host
`attacker.example` → 403 (API et interface) ; effacement sans biométrie ou avec un mauvais secret → 403, wallet conservé ;
avec le bon secret → effacé.

## Non validé

- Le conteneur bitcoind déjà lancé garde l'ancienne publication (`0.0.0.0:18443`) jusqu'à sa recréation
  (`npm run regtest:down && npm run regtest:up`). Je ne l'ai pas recréé : cela effacerait la chaîne regtest utilisée par
  les démos en cours. Seule la configuration (`docker compose config`) est vérifiée.
- Les instances déjà lancées (ports 4000, 5180…) gardent l'ancien code jusqu'à leur redémarrage.
