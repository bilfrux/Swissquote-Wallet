# Étape 59 — Vérification Touch ID préparée (manuelle)

## Pourquoi

Tous les tests automatiques de la biométrie (étapes 44 à 58) utilisent l'authentificateur virtuel de Chrome avec
l'extension PRF. Ils prouvent le code, pas que l'authentificateur réel de la machine (Touch ID, via Chrome) rend le secret
PRF. Cela exige le doigt de l'utilisateur : ce n'est pas automatisable.

## Ajout

`scripts/demo/touchid-check.ts` (`npm run check:touchid`) : Client Wallet isolé (:5250), vraie fenêtre Chrome (pas
d'authentificateur virtuel), création de la passkey du wallet avec Touch ID, vérification que la graine se déchiffre avec le
secret rendu, puis vraie signature d'un PSBT regtest après un nouveau Touch ID. Prérequis : `npm run regtest:up`.

## Validation exécutée (14 oct. 2026, par l'utilisateur, Touch ID réel)

| Commande | Résultat observé |
| --- | --- |
| `npm run check:touchid` | 2/2 (`etape-59-sortie.txt`) |

Observé : authentificateur de plateforme disponible ; passkey du wallet créée avec Touch ID ; secret PRF rendu ; graine
chiffrée et déchiffrée avec ce secret ; après un nouveau Touch ID, PSBT regtest signé (une signature ajoutée).
L'hypothèse « la biométrie de l'appareil chiffre la graine » est donc vérifiée sur cette machine (macOS, Chrome).

Première exécution : la création et le secret ont réussi, la signature a échoué (« biometric check cancelled or not
recognised ») parce que la troisième demande de Touch ID a été annulée par l'utilisateur ; deuxième exécution : réussie.
