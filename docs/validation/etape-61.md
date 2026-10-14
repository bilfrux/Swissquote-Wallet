# Étape 61 — Reprise du travail non commité du worktree de soumission : verrou crypto et clients de démo

## Origine

Le worktree `docs-soumission` contenait des modifications non commitées (11 oct.), utiles pour la démo. Elles sont
reprises ici telles quelles (patch appliqué, un conflit résolu dans `bank-mock/src/server.ts`), sans toucher à ce worktree :
- **correctif** (`client/src/lib/walletBridge.ts`, `client/src/App.tsx`) : pas de reverrouillage de la partie crypto
  pendant une demande au Client Wallet. Dans un vrai navigateur, la fenêtre du wallet passe devant et la page de la banque
  peut devenir « hidden » : le reverrouillage de l'étape 39 se déclenchait, et l'enregistrement du compte, juste après la
  création du wallet, était refusé (403 « crypto locked ») ;
- clients de démo vierges `CH-0004` (pitch, `pitch0004`), `CH-0005` (vidéo, `video0005`), `CH-0006` (second passage,
  `second0006`), avec re-KYC et avoirs Swissquote de démo ;
- passkey bancaire activée à la création du wallet (si aucune) ; journal des appels de bank-mock (diagnostic).

Non repris : `docs/qa-technique.md` et `docs/slides/` (non commités, hors code).

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:61` | 3/3 (`etape-61-sortie.txt`) |
| même test sans le correctif | 61-1 échoue : `403 /accounts/register`, compte non créé (`etape-61-avant-correction-sortie.txt`) |
| `validate:6:ui` ; `MOBILE=1` ; `validate:38` ; `validate:43` | 19/19 ; 20/20 ; 8/8 ; 6/6 (`etape-61-regressions-sortie.txt`) |
| `npm run typecheck` | succès |

En headless, la page ne se cache jamais : le test simule `visibilitychange` (« hidden » puis « visible ») pendant les
demandes au wallet. Hors demande au wallet, une page cachée reverrouille toujours (61-2). La 1re exécution en téléphone
a échoué (18/20) parce que CoinGecko a répondu HTTP 429 (service externe de prix) ; la 2e : 20/20.
