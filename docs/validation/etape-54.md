# Étape 54 — Parcours Ethereum complet sur le vrai Sepolia, et un bug de comparaison d'adresses

## Problème

`validate:17` et `validate:18` saisissaient un PIN (refusé depuis l'étape 36) et dépendaient de la pile de démo en cours
(ports 4000/5180, wallets PIN de l'étape 8). Le parcours Ethereum n'avait pas été rejoué depuis la biométrie, le verrou
crypto, la confirmation de politique (47) ni le refus des changements de gardiens (48).

## Modifications

- `scripts/validate/etape-54-evm-ui.ts` (`npm run validate:54`) : reprend 17 et 18 sur une pile isolée (bank-mock :4440
  avec verrou actif, Client Wallet :5220, appli :5221, console :5222), biométrie par authentificateur virtuel PRF. Les
  anciens `validate:17`/`validate:18` sont conservés comme traces, remplacés par celui-ci.
- **Bug trouvé par ce test** : `.map(getAddress)` passe l'index du tableau en second argument, que viem lit comme un
  chainId (casse EIP-1191). Vérifié : `getAddress(a) === getAddress(a, 1)` → `false`. Dans `bank-mock/src/server.ts`, le
  contrôle « la nouvelle clé ne doit être ni le propriétaire ni un gardien » comparait donc des adresses mal casées dès le
  2e élément de la liste. Avec l'ordre observé du module (contact en tête, puis Swissquote, couvert par une égalité à part),
  ce n'était pas exploitable, mais cela ne tenait qu'à cet ordre. Corrigé en `.map((a) => getAddress(a))` dans bank-mock,
  le Client Wallet (propriétaires d'un Safe) et les tests 17, 18, 54.

## Validation exécutée

```bash
npm run validate:54   # vrai Sepolia, bundler et paymaster publics de Candide, ~10 min dont 3 min de délai
```

Résultat (`etape-54-sortie.txt`) : 9/9.
- Compte Ethereum ajouté depuis l'interface ; activation signée par biométrie, écran en clair ; Safe déployé sans ETH,
  gardiens Swissquote + contact, seuil 2 (activation `0x116aab02…`).
- Sur le Safe déployé, le Client Wallet refuse un appel inconnu, et `addGuardianWithThreshold(attaquant, 1)` (étape 48).
- Swissquote refuse sans re-KYC, vers le propriétaire, et vers chacun des deux gardiens.
- Demande relayée au contact, signée dans sa console. Recovery démarrée (`0x45f377a0…`), propriétaire inchangé pendant le
  délai, finalisée après 3 min (`0x00671661…`), nouveau propriétaire ; invalidation des signatures restantes (nonce 0 → 2).
- Aucune erreur de console, aucune réponse 5xx.

Exécutions précédentes du même test : deux échecs d'assertion, sans rapport avec l'application. 54-6 lisait l'ancienne
transaction affichée ; 54-2 est le bug `map(getAddress)` ci-dessus, présent aussi dans le test.

## Non validé

- Envoi d'USDC : le Safe neuf n'a pas d'USDC de test (faucet Circle à demander vers l'adresse du Safe).
- Touch ID réel (authentificateur virtuel).
