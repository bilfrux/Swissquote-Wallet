# Étape 10 (A1) : authentification par passkey et montants élevés

Sujet 4 de la track : « How the client proves who they are before signing […] Show how a high-value transaction differs from a small one ».

## Livré

| Élément | Emplacement |
| --- | --- |
| Passkeys WebAuthn (`@simplewebauthn/server` 14.0.3 et `/browser` 14.0.0, aucune crypto maison) : enregistrement, connexion, step-up ; vérification de l'utilisateur exigée, défis à usage unique (5 min), compteur anti-clonage | `bank-mock/src/passkeys.ts`, routes `/auth/passkey/*`, `/auth/stepup/*` |
| Connexion « Se connecter avec une passkey » ; activation dans « Mon compte » | `client/src/bank/Login.tsx`, `client/src/ui/AccountSecurity.tsx`, `Shell.tsx` |
| Montant élevé (≥ 0,2 BTC envoyé hors du compte) côté appli : avertissement, ré-authentification par passkey (activation sur place si besoin), enregistrement et alerte chez Swissquote ; non bloquant si Swissquote est injoignable | `client/src/lib/bank.ts` (`stepUp`), `wallet/Send.tsx` |
| Montant élevé côté Wallet du client : bannière, PIN + 6 derniers caractères de l'adresse, **vérifiés par le serveur du wallet** | `client-wallet/src/server.ts`, `ui/App.tsx` |

## Résultats

| # | Critère | Verdict |
| --- | --- | --- |
| 10-1 | Wallet : 0,25 BTC marqué « montant élevé » ; signature refusée sans les 6 caractères ou avec des caractères faux, acceptée avec les bons | fonctionne (`etape-10-sortie.txt`) |
| 10-2 | Wallet : 0,05 BTC signé avec le seul PIN | fonctionne |
| 10-3 | Swissquote : step-up impossible sans passkey, sans session, ou avec une assertion inventée | fonctionne |
| 6-17 | Chrome (authentificateur virtuel WebAuthn de Chrome) : passkey activée, déconnexion, connexion par passkey | fonctionne (ordinateur et téléphone) |
| 6-18 | Chrome : envoi de 0,25 BTC, avertissement, step-up passkey (« Montant élevé confirmé par passkey »), 6 caractères + PIN dans le wallet, diffusion | fonctionne (ordinateur et téléphone) |
| Parcours complet | `validate:6:ui` : 17/17 sur ordinateur, 18/18 sur téléphone | fonctionne |
| Non-régression | `validate:1` à `validate:8:alerts`, `test:attacks`, `validate:inv5` ; typage | fonctionne |
| — | Montant élevé avec Swissquote injoignable : l'appli poursuit, le wallet applique seul ses contrôles | **non testé** dans l'interface (logique écrite ; la signature par le wallet ne dépend pas de Swissquote, cf. 10-1) |

## Limites (écrites dans le README)

- Sur Bitcoin, **aucune différence on-chain** selon le montant : le chemin client `pk(CLIENT)` ne connaît pas les montants. Les contrôles sont applicatifs (Swissquote) et dans le signataire (Wallet du client).
- Une nouvelle passkey peut être ajoutée par une session ouverte. Une vraie banque exigerait une vérification supplémentaire pour un nouvel appareil.
- Dans le test, la biométrie est simulée par l'authentificateur virtuel de Chrome.
