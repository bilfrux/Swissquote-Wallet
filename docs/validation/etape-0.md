# Étape 0 : faisabilité du module de recovery (10 octobre 2026)

## Environnement

- **Où :** fork Anvil d'Ethereum Sepolia (`anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com`), bloc 11885123. Le fork exécute le **bytecode réellement déployé** sur Sepolia. **Rien n'a été envoyé sur le vrai Sepolia** : il n'y a ni clé financée ni clé d'API bundler dans l'environnement.
- **Clés :** les clés de test publiques d'Anvil (mnémonique « test … junk »). Aucun secret.
- **Bibliothèques :** abstractionkit 0.4.3 (adresses des modules, init code du Safe, adresse du signataire passkey), viem 2.57.4 (appels, EIP-712). Aucune cryptographie écrite à la main.
- **Hors du test :** bundler, paymaster et UserOperations, réservés à l'étape 2. Les transactions du Safe passent ici par `execTransaction`, appelé directement par le propriétaire EOA.

## Commandes

```bash
cd scripts/feasibility
npm install
npm run fork        # dans un autre terminal
npm run recovery    # sortie complète : docs/validation/etape-0-sortie.txt
```

Vérification du code déployé, faite sur le vrai Sepolia en lecture seule :

```bash
cast call <module> 'VERSION()(string)' --rpc-url https://ethereum-sepolia-rpc.publicnode.com
# 0x949d…8c66 (3 min), 0x3827…541c (3 j), 0x088f…25f2 (7 j), 0x9Bac…f25b (14 j) : "0.0.1", 13 606 octets chacun
```

## Modules sur Sepolia

| Délai | Adresse | Version | Délai mesuré |
| --- | --- | --- | --- |
| 3 min | 0x949d01d424bE050D09C16025dd007CB59b3A8c66 | 0.0.1 | 180 s |
| 3 j | 0x38275826E1933303E508433dD5f289315Da2541c | 0.0.1 | 259 200 s |
| 7 j | 0x088f6cfD8BB1dDb1BB069CCb3fc1A98927D233f2 | 0.0.1 | non mesuré |
| 14 j | 0x9BacD92F4687Db306D7ded5d4513a51EA05df25b | 0.0.1 | 1 209 600 s |

Contrats passkey de Safe utilisés : factory 0xF7488fFbe67327ac9f37D5F722d83Fc900852Fbf, vérificateur FCL 0x445a0683e494ea0c5AF3E83c5159fBE47Cf9e765 (valeurs par défaut de `SafeAccountV0_3_0`).

## Résultats

| # | Point | Verdict |
| --- | --- | --- |
| 1 | Safe 1.4.1 créé avec une EOA propriétaire | fonctionne |
| 2 | Trois instances (3 min, 3 j, 14 j) activées sur le même Safe, 2 guardians et seuil 2 chacune | fonctionne |
| 2b | Hash EIP-712 calculé par viem identique à `getRecoveryHash` du module | fonctionne |
| 3a | Même adresse enregistrée deux fois dans une instance : refusé (`GS: duplicate guardian`) | fonctionne |
| 3b | Même signature comptée deux fois : refusé (`duplicate signers/invalid ordering`) | fonctionne |
| 3c | Signature d'une instance rejouée sur une autre : refusé (`Invalid guardian signature`) | fonctionne |
| 4a-e | Swissquote seule : ne peut ni lancer, ni exécuter, ni agir hors de ses instances, ni s'ajouter un complice, ni finaliser | fonctionne |
| 5a-d | 14 j lancée par Swissquote + tiers : délai appliqué on-chain (refus à J+13), annulation par le propriétaire, rejeu des signatures refusé | fonctionne |
| 6a-b | Recovery complète backup + Swissquote vers une nouvelle EOA (3 min) : l'ancien propriétaire est refusé (`GS026`), le nouveau signe | fonctionne |
| 6c | Une recovery 14 j en attente survit à la recovery 3 min et remplace le **nouveau** propriétaire si on ne l'annule pas | danger confirmé |
| 6d | Annulation sur toutes les instances par le nouveau propriétaire : la 14 j ne finalise plus | fonctionne |
| 7a | Changement de guardian : immédiat, aucun délai imposé par le module | confirmé |
| 7b | Retirer un guardian n'annule pas la recovery qu'il a lancée (v0.0.1) | danger confirmé |
| 9 | Swissquote disparue : backup + tiers récupèrent sur l'instance 3 j | fonctionne |
| 8a | Adresse du signataire passkey (SDK) = adresse renvoyée par la factory | fonctionne |
| 8b | Recovery finalisée vers le signataire passkey non déployé | fonctionne |
| 8c | Déploiement du signataire passkey après coup, par n'importe qui | fonctionne |
| — | Signature d'une transaction par la nouvelle passkey après recovery | **non testé** (demande un vrai WebAuthn dans un navigateur) |
| — | Même scénario sur le vrai Sepolia, et via bundler et paymaster | **non testé** |

## Lecture du code du module (v0.0.1, commit audité 113d3c0)

| Action | Qui | Condition |
| --- | --- | --- |
| Confirmer (`confirmRecovery`) | un guardian de l'instance, pour lui-même | — |
| Confirmer par signatures (`multiConfirmRecovery`) | n'importe qui, qui relaie des signatures EIP-712 de guardians | signatures valides (ECDSA ou EIP-1271), signataires triés et sans doublon |
| Exécuter, c'est-à-dire lancer le délai (`executeRecovery` ou `_execute = true`) | **n'importe qui** | confirmations au moins égales au seuil, au nonce courant |
| Finaliser (`finalizeRecovery`) | **n'importe qui** | délai écoulé |
| Annuler (`cancelRecovery`) | le Safe uniquement (transaction du propriétaire) | une recovery est en attente |
| Invalider les confirmations (`invalidateNonce`) | le Safe uniquement | — |
| Modifier les guardians et le seuil | le Safe uniquement, module activé | aucun délai |

- **Le seuil :** `getRecoveryApprovals` compte les guardians **actuels** qui ont confirmé le hash `(wallet, newOwners, newThreshold, nonce)`. Le domaine EIP-712 inclut chainId et l'adresse du module, donc une signature ne vaut que pour une instance.
- **Le nonce** avance à chaque exécution et à chaque `invalidateNonce`. En 0.0.1, `cancelRecovery` ne fait **pas** avancer le nonce : les confirmations collectées mais pas encore exécutées survivent à une annulation. Il faut appeler aussi `invalidateNonce`.
- **Remplacement d'une recovery en cours :** il faut **strictement plus** d'approbations. Avec 2 guardians et un seuil de 2, c'est impossible : seul le propriétaire peut l'annuler.
- **Ce que le module ne garantit pas en 0.0.1 :** il ne valide pas les nouveaux propriétaires avant `finalize` (audit M-01) ; il n'annule pas une recovery quand la configuration des guardians change (L-03, cf. 7b) ; il manque 12 autres correctifs, intégrés en 0.2.0 (septembre 2026) mais **non déployés** aux adresses du SDK.
- **Non vérifié :** l'identité octet par octet entre le bytecode déployé et le source 113d3c0. L'équivalence est déduite de `VERSION = 0.0.1`, des sélecteurs et du comportement observé.
