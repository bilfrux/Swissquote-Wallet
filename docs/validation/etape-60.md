# Étape 60 — bitcoind regtest publié sur la boucle locale, sans perdre la chaîne

## Contexte

L'étape 46 avait changé `docker/regtest.yml` (`127.0.0.1:18443:18443`), mais le conteneur en cours publiait encore le RPC
(identifiants de test) sur `0.0.0.0:18443`. Le recréer avec `npm run regtest:down` aurait effacé la chaîne (`down -v`
supprime le volume) utilisée par les démos.

## Opération

1. État relevé : hauteur 2821, meilleur bloc `69b0f5d55f10f334c609e11b6b2d4…`, portefeuilles chargés `miner`, `sq-omnibus`,
   `client-core`, deux `sq-watch-*`.
2. Sauvegarde du dossier de données (`docker cp …:/home/bitcoin/.bitcoin/regtest`, 39 Mo, dans le dossier temporaire de la
   session, hors dépôt).
3. `docker compose -f docker/regtest.yml up -d` : le conteneur est recréé avec la nouvelle publication ; Docker Compose
   conserve le volume anonyme de l'image (`/home/bitcoin/.bitcoin`).
4. Portefeuilles rechargés.

## Validation exécutée

| Contrôle | Résultat observé |
| --- | --- |
| `getblockcount` / `getbestblockhash` après | 2821, même bloc : chaîne conservée |
| `docker ps` | `127.0.0.1:18443->18443/tcp` |
| `curl http://192.168.1.194:18443/` | connexion refusée |
| `getbalance` sur `sq-omnibus` | 58,718 BTC (portefeuille de garde intact) |

## À savoir

Pour recréer le conteneur après un changement de `docker/regtest.yml`, utiliser `npm run regtest:up` (conserve la chaîne),
pas `npm run regtest:down` (efface le volume).
