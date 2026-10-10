# Étape 8 : interface sur signet, code PIN du Wallet du client, alertes

## N°1 : l'interface sur le vrai réseau signet

`npm run demo:signet` lance l'appli, la console et le Wallet du client en signet (lecture et diffusion via l'API Esplora de blockstream.info). Test : `npm run validate:8:signet -- create | spend | recover` (Chrome headless ; état de test dans `.local/signet-ui/`, ignoré par git).

| # | Critère | Verdict |
| --- | --- | --- |
| 8-1 | Signet, interface : wallet CH-0003 créé via le Wallet du client, solde lu sur signet, adresse `tb1qsd8naqffu8q4460kjvwd3nmu4svzw5tmg3xdv06q0nh6zeyl2xuq9m06j6` | fonctionne (`etape-8-signet-create-sortie.txt`) |
| 8-2 | Signet, interface : preuve de propriété vérifiée par Swissquote | fonctionne |
| 8-3 | Signet, interface : envoi signé dans le Wallet du client, diffusé, visible sur l'explorateur | **non testé** : en attente de signet BTC sur l'adresse ci-dessus (faucet) |
| 8-4 | Signet, interface : recovery Swissquote + tiers depuis un nouvel appareil | **non testé** : après 8-3 et 6 confirmations |

Ce wallet signet a été créé avant l'ajout du PIN : il est « non protégé » (graine en clair), ce que le Wallet du client signale.

## N°2 : code PIN du Wallet du client

Graine chiffrée au repos : `scrypt` (N = 32768, r = 8, p = 1) puis AES-256-GCM, avec `node:crypto` (OpenSSL). PIN de 6 à 12 chiffres, choisi à la création, demandé sur les écrans de signature et de preuve. Blocage de 60 s après 5 PIN faux. Pour un ancien wallet en clair : « Protéger par un code PIN ». Fichiers : `client-wallet/src/vault.ts`, `server.ts`, `store.ts`, `ui/App.tsx`.

| # | Critère (`npm run validate:8:pin`, Wallet isolé) | Verdict |
| --- | --- | --- |
| 8-5 | Création sans PIN : refusée | fonctionne |
| 8-6 | Ni la phrase, ni aucune paire de ses mots, ni aucun mot dans la partie chiffrée n'est écrit sur le disque ; le bon PIN redonne la phrase | fonctionne (stable sur 3 passages) |
| 8-7 | Signature avec un PIN faux ou absent : refusée, essais restants indiqués | fonctionne |
| 8-8 | Signature avec le bon PIN : PSBT signé | fonctionne |
| 8-9 | Après 5 PIN faux : blocage, même le bon PIN est refusé (429) | fonctionne |
| 8-10 | Ancien wallet en clair : signalé « non protégé », puis chiffré ; la phrase en clair disparaît du disque | fonctionne |

Limite : protège l'usage, pas un vol du fichier suivi d'une recherche exhaustive hors ligne d'un PIN à 6 chiffres. Correction du test en cours de route : la première version cherchait chaque mot isolé dans tout le fichier, et « label » ou « wallet » (mots BIP39 présents dans la structure du fichier) donnaient des faux positifs.

## N°3 : alertes au client

bank-mock surveille les comptes (regtest toutes les 30 s, signet toutes les 5 min, ou à la demande avec `POST /alerts/run`) et crée des alertes : coin à ≤ ⌈D/3⌉ blocs de l'ouverture, recovery ouverte, et **immédiatement** quand Swissquote signe une recovery. Elles s'affichent dans une cloche (en-tête sur ordinateur, bouton rond sur téléphone) et partent par email simulé (`outbox.log`). Fichiers : `bank-mock/src/alerts.ts`, `server.ts`, `client/src/ui/NotificationBell.tsx`.

| # | Critère (`npm run validate:8:alerts`, bank-mock isolé) | Verdict |
| --- | --- | --- |
| 8-11 | 1 confirmation (recovery dans 5 blocs) : aucune alerte | fonctionne |
| 8-12 | Recovery dans 2 blocs : alerte « bientôt », sans doublon au passage suivant | fonctionne |
| 8-13 | Recovery ouverte : alerte « ouverte » | fonctionne |
| 8-14 | Swissquote signe une recovery : alerte immédiate « Swissquote a signé une demande de recovery » | fonctionne |
| 8-15 | Chaque alerte part aussi par email simulé | fonctionne |
| 8-16 | Alertes marquées lues ; un autre client ne les voit pas | fonctionne |
| 6-15 | Dans l'interface, sur ordinateur et sur téléphone : l'**ancien appareil** voit la cloche s'allumer dès que Swissquote signe la recovery | fonctionne |

Limite : simple information. Elles dépendent de Swissquote, et l'email est simulé.

## Non-régression

Parcours complet `validate:6:ui` (avec PIN et alertes) : 14/14 sur ordinateur, 15/15 sur téléphone. `validate:1` 6/6, `validate:2` 8/8, `validate:3` 3/3, `test:attacks` 4/4, `validate:inv5` 4/4, `validate:7` 8/8 ; typage des 7 projets (`etape-8-regressions-sortie.txt`).
