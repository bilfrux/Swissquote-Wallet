# Étape 51 — Test de l'invariant 5 : ce qu'il couvre vraiment, et les clés Ethereum

## Problème (audit, vérifié en exécution avant correction)

`scripts/validate/invariant-5.ts` ne lisait que le champ `mnemonic` en clair. Sur la machine, les 21 wallets du Client
Wallet étaient chiffrés (17 PIN, 4 biométrie, 0 en clair) : aucune de leurs graines n'était cherchée, alors que le
libellé disait « y compris celles du Wallet du client ». Aucune clé privée Ethereum n'était cherchée, y compris celle du
gardien Swissquote (dérivée de sa graine, chemin m/44'/60'/0'/0/0).

## Modification

- Pour chaque graine en clair trouvée (bank-mock, contacts et clients de test dans `.local`, anciens wallets non
  protégés) : la phrase, le tprv du compte Bitcoin **et la clé privée Ethereum** (hexadécimale, avec et sans `0x`).
- Les graines chiffrées du Client Wallet sont comptées et annoncées comme non cherchables en clair ; le libellé ne
  prétend plus les couvrir.
- Témoin positif de plus : une clé Ethereum isolée et un tprv glissés dans des fichiers de test doivent être trouvés.
- Motif générique `0x` + 64 hex dans `client/src`. Imports interdits étendus à Ethereum : `@sq/evm/keys`,
  `viem/accounts`, `mnemonicToAccount`, `privateKeyToAccount`, `signOp(`.
- `INV5_SEED_DIRS` : dossiers de données supplémentaires (autre copie du dépôt où tournent les démos).

## Validation exécutée

```bash
INV5_SEED_DIRS="<dépôt principal>/bank-mock/data:<dépôt principal>/client-wallet/data:<dépôt principal>/.local" npm run validate:inv5
```

Résultat (`etape-51-sortie.txt`) : 4/4. 25 graines en clair (100 secrets cherchés, dont les clés Ethereum) ; témoins
25/25 fichiers et 2/2 fichiers plantés détectés ; rien dans `client/src`, `client/dist`, `client/index.html`,
`client/vite.config.ts` ; 42 graines du Client Wallet chiffrées (non cherchées en clair) ; aucun import interdit.
