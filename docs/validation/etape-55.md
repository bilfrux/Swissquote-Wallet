# Étape 55 — Documentation alignée sur le code, non-régression complète

## Modifications

- `README.md` : Client Wallet (politique confirmée par empreinte et biométrie, boucle locale, refus des changements de
  gardiens) ; preuve de propriété signée par biométrie (« automatique » était faux) ; verrou crypto à la place de la
  connexion par passkey retirée ; tableau des preuves complété (étapes 44 à 54, `validate:8:pin`/`17`/`18` remplacés) ;
  limites : changement de contact Bitcoin fait / Ethereum refusé, clé Swissquote commune à tous les clients
  (traçabilité on-chain), empreinte comparée par le client, authentificateur virtuel seulement.
- `docs/threat-model.md` : lignes périmées corrigées (PIN, connexion passkey, invariant 5) ; nouvelles menaces avec leur
  preuve : clé de contact substituée par l'appli (47), réseau local (46), relais RPC (49), demande substituée et plusieurs
  destinataires (50), retraits simultanés, frais de recovery, re-KYC (52), changements de gardiens Ethereum (48, 54) ;
  risques résiduels mis à jour.
- `docs/architecture.md` : exposition réseau, relais RPC filtré, confirmation de la politique.
- `docs/handoff.md` : branche, étapes 38 à 55, dernière vérification, restes.
- `.env.example` : interfaces d'écoute, origines, verrou crypto, garde-fous de bank-mock, seuils, Ethereum.
- `scripts/validate/etape-1-regtest.ts` : charge le portefeuille Bitcoin Core s'il est déjà sur le disque (échec observé
  après un redémarrage du nœud : « Database already exists »).

## Validation exécutée

Suite complète sur le code final (`etape-55-regressions-sortie.txt`) : `typecheck`, `validate:inv5`, `1`, `2`, `3`,
`6:ui` (ordinateur 19/19, téléphone 20/20), `7`, `8:alerts`, `9:budget`, `10`, `11`, `12`, `test:attacks`, `37`, `38`,
`40` à `44`, `46` à `50`, `52`, `53` : tous réussis. `validate:1` a d'abord échoué (portefeuille Bitcoin Core déjà sur le
disque), corrigé puis 6/6. `validate:54` (vrai Sepolia) : 9/9 à l'étape 54, sans modification de code depuis.

## Non validé

- `validate:9`, test 9-6 : dépend des données de démo signet ; échoue aussi sur le code d'avant la remédiation.
- Touch ID réel ; envoi d'USDC (Safe de test sans USDC) ; signet de bout en bout dans l'interface (`validate:8:signet`).
