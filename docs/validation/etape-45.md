# Étape 45 — Parcours complet dans Chrome avec la biométrie et le verrou crypto

## Problème

`validate:6:ui` saisissait encore un PIN (refusé par design depuis l'étape 36) et se connectait par passkey (route
retirée à l'étape 27). Le parcours complet n'avait pas été rejoué depuis : biométrie du Client Wallet (étape 36),
verrou crypto (étape 38), wallets propres à l'appareil (étape 40).

## Modifications

- `scripts/validate/etape-6-ui.ts` : chaque fenêtre du Client Wallet reçoit un authentificateur virtuel avec PRF
  (étape 44) ; plus de PIN. Le test 6-17 vérifie désormais le verrou crypto : route crypto refusée (403) avec la seule
  session, biométrie activée depuis l'écran verrouillé, puis accès. Nouvel appareil : recovery ouverte depuis
  « I lost my device or my biometrics ». Diagnostic (texte des pages) en cas d'échec.
- `client-wallet/src/ui/App.tsx` : la disponibilité de la biométrie est revérifiée au clic sur « Generate my secret
  phrase ». Défaut observé sur téléphone : vérifiée seulement à l'ouverture de la fenêtre, une réponse négative
  (authentificateur pas encore prêt) laissait le bouton désactivé pour toujours.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:6:ui` | 19/19 (`etape-45-ui-ordinateur-sortie.txt`) |
| `MOBILE=1 npm run validate:6:ui` | 20/20 (`etape-45-ui-telephone-sortie.txt`) |
| `npx tsc -p client-wallet` | succès |

Captures `captures/etape-6-*` mises à jour (nouvelle : `2b-crypto-verrouille`).

## Non validé

- Touch ID réel (authentificateur virtuel de Chrome uniquement).
- `validate:17` et `validate:18` (Ethereum, Sepolia) saisissent encore un PIN : traités à une étape suivante.
