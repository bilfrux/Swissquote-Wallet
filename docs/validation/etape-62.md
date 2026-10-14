# Étape 62 — README : nouvelles fonctionnalités

## Modifications

- `README.md` : nouvelle section « Features » (pour le client, et protections contre une appli bancaire compromise) ;
  lignes « Change of trusted contact » et « Swissquote keys » dans le tableau réel / simulé ; démarrage : vérification
  Touch ID (`npm run check:touchid`), `regtest:up` conserve la chaîne et `regtest:down` l'efface ; parcours de démo : verrou
  crypto, confirmation de la politique par empreinte, clients de démo CH-0004 à CH-0006 avec leur re-KYC, changement de
  contact, Ethereum ; preuves des étapes 56, 57, 58, 61 ; limites mises à jour (contact Ethereum, clés par compte, Touch ID).
- `docs/handoff.md` : étapes 56 à 62 et ce qui reste à faire à la main.

## Validation

Documentation seulement. Vérifié : chaque commande citée existe dans `package.json` (`check:touchid`, `validate:56`,
`57`, `58`, `61`) ; les identifiants de démo correspondent à `bank-mock/src/bank.ts` et `kyc.ts` (vérifiés en exécution
par `validate:61`, test 61-3).
