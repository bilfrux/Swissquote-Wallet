# Étape 59 — Vérification Touch ID préparée (manuelle)

## Pourquoi

Tous les tests automatiques de la biométrie (étapes 44 à 58) utilisent l'authentificateur virtuel de Chrome avec
l'extension PRF. Ils prouvent le code, pas que l'authentificateur réel de la machine (Touch ID, via Chrome) rend le secret
PRF. Cela exige le doigt de l'utilisateur : ce n'est pas automatisable.

## Ajout

`scripts/demo/touchid-check.ts` (`npm run check:touchid`) : Client Wallet isolé (:5250), vraie fenêtre Chrome (pas
d'authentificateur virtuel), création de la passkey du wallet avec Touch ID, vérification que la graine se déchiffre avec le
secret rendu, puis vraie signature d'un PSBT regtest après un nouveau Touch ID. Prérequis : `npm run regtest:up`.

## Validation

**Non exécutée** : elle demande trois poses du doigt. À lancer par l'utilisateur ; le résultat attendu est « Touch ID :
fonctionne avec le Client Wallet ». Si Chrome refuse le PRF pour la passkey de la plateforme, l'hypothèse « la biométrie
de l'appareil chiffre la graine » est fausse sur cette machine : à signaler avant la démo.
