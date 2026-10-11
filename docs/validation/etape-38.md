# Étape 38 — La partie crypto du site exige la biométrie du client

## Problème

Jusqu'ici, la session bancaire (identifiant + mot de passe) suffisait pour utiliser la partie crypto du site. Toute
personne qui détenait cette session pouvait, sans le consentement du client : retirer le BTC du compte crypto Swissquote
vers une adresse déjà prouvée, enregistrer un xpub ou une adresse Ethereum de son choix (qui devenait « le wallet du
client » à l'écran), ou demander une preuve de propriété. Un simple écran de verrouillage dans l'interface n'aurait rien
changé : ces routes sont appelables sans interface.

## Modification

- **bank-mock vérifie la biométrie** (`bank-mock/src/cryptoLock.ts`, routes `/auth/crypto-unlock/*`). Le client fait une
  assertion WebAuthn (passkey, vérification de l'utilisateur exigée : Touch ID, Face ID, Windows Hello) ; elle est
  vérifiée par `@simplewebauthn/server` (aucune cryptographie écrite ici). Le serveur marque alors la session comme
  déverrouillée. Le déverrouillage expire après 10 min d'inactivité (`BANK_MOCK_CRYPTO_IDLE_MS`).
- **Deux niveaux**. `full` (passkey) : toutes les routes crypto. `recovery` (re-KYC, appareil ou passkey perdus) :
  seulement les comptes, l'enregistrement d'un nouveau compte et le relais. Pas de retrait du compte crypto ni de
  preuve de propriété. Le re-KYC ne rétrograde jamais une session déjà `full`.
- **Routes verrouillées** : tout `/custody*`, `/ownership/*` (full) ; `/wallet/accounts`, `/accounts/register`,
  `/evm/accounts`, `/evm/accounts/register`, `/evm/accounts/sync`, `/relay` (recovery suffit).
- `/accounts/register` n'accepte plus un simple identifiant sans session (repli réservé aux anciens scripts, voir plus bas).
- **Enrôlement de la passkey** : la première s'enregistre avec la seule session ; ensuite il faut être déjà
  déverrouillé. Sans cela, un détenteur du mot de passe ajouterait sa propre passkey.
- **Interface** : `client/src/wallet/CryptoGate.tsx` affiche « Crypto is locked » (« La partie crypto est verrouillée »)
  avant tout contenu crypto. Les soldes crypto de l'accueil restent masqués tant que ce n'est pas déverrouillé. Chaque
  déverrouillage crée une notification pour le client.
- **Appareil perdu** : « J'ai perdu mon appareil ou ma biométrie » ouvre la recovery. À la fin, une nouvelle passkey est
  enregistrée sur le nouvel appareil, ce qui redonne l'accès complet.
- **Swissquote injoignable** : le verrou ne peut pas être vérifié ; l'interface reste ouverte avec un bandeau. Rien de ce
  que bank-mock protège n'est alors atteignable, et toute dépense exige quand même la biométrie du Client Wallet
  (invariant 4 : le client dépense seul, même si Swissquote est arrêtée).

## Validation exécutée

```bash
npm run typecheck
npm run build
git diff --check
npm run validate:38        # sortie : docs/validation/etape-38-sortie.txt
```

Résultat observé : typecheck, build et `git diff --check` réussissent ; `validate:38` : 8 critères sur 8 réussis.

| # | Critère | Observé |
| --- | --- | --- |
| 38-1 | Session par mot de passe seule : 8 routes crypto refusées ; enregistrement par identifiant sans session refusé ; `/me` reste ouvert | 403 ×8 ; 401 ; 200 |
| 38-2 | Interface verrouillée sans contenu crypto ; activation de la passkey, puis accès ; la session est acceptée par le serveur | contenu crypto avant : 0 ; `/wallet/accounts` après : 200 |
| 38-3 | Autre session par mot de passe (client déjà doté d'une passkey) : routes refusées, ajout d'une passkey refusé | 403 ; 403 |
| 38-4 | Le serveur reverrouille après inactivité (8 s dans le test) | 200 puis 403 |
| 38-5 | Nouvelle connexion : verrouillée, puis déverrouillée par la passkey existante | `/wallet/accounts` 200 ; `/custody/withdraw` passe le verrou (refus métier 400, montant minimal) |
| 38-6 | Appareil perdu : le re-KYC ouvre la recovery, pas le compte crypto Swissquote | `/wallet/accounts` 200 ; `/custody`, `/custody/withdraw`, `/ownership/challenge` : 403 |
| 38-7 | Aucune erreur JavaScript | aucune |
| 38-8 | Quitter l'onglet Crypto, ou masquer la page du navigateur, reverrouille côté serveur ; y revenir redemande la biométrie | 403 après changement d'onglet ; 403 après page masquée (événement `visibilitychange` simulé) |

Reverrouillage (ajouté après coup) : changer d'onglet de l'appli (Home, Banking…) ou masquer la page du navigateur
reverrouille tout de suite. Conséquence : un envoi en cours dans l'onglet Crypto est abandonné si on quitte la page.
La page masquée n'a été testée que par l'événement simulé, pas en changeant réellement d'onglet dans Chrome.

Captures : `captures/etape-38-1-crypto-verrouille.png`, `etape-38-2-crypto-deverrouille.png`, `etape-38-3-recovery-sans-biometrie.png`.

Non-régression exécutée (verrou désactivé par `BANK_MOCK_CRYPTO_LOCK=off`, ajouté au lancement de bank-mock des scripts
des étapes 2, 7, 8-alerts, 11, 12) : `validate:11` 6/6 et `validate:12` 2/2 réussissent.

## Limites

- **bank-mock est le serveur de Swissquote.** Le verrou protège contre un détenteur de la session (mot de passe volé,
  session détournée). Il n'empêche pas Swissquote elle-même d'agir sur ses propres données. Pour les fonds en
  self-custody, la protection reste la biométrie du Client Wallet et la politique on-chain (Swissquote seule ne peut rien
  dépenser) ; le compte crypto « en garde » est, par nature, détenu par Swissquote.
- **Première passkey = confiance au premier usage.** Quelqu'un qui a le mot de passe et arrive avant le client peut
  enregistrer sa propre passkey. Un vrai déploiement exigerait une vérification supplémentaire à l'enrôlement.
- **Repli re-KYC** : réponses de re-KYC statiques (mock). Il ouvre seulement le niveau `recovery` et notifie le client.
- La biométrie est simulée par l'authentificateur virtuel de Chrome (comme aux étapes 6 et 10).
- **Non testé** : l'interface avec bank-mock arrêté (logique écrite, bandeau non observé) ; la fin d'une recovery avec
  enregistrement d'une nouvelle passkey (le re-KYC l'est, 38-6, pas la recovery complète).
- **`validate:7` échoue, sans lien avec cette étape** : il crée un wallet avec un PIN, refusé depuis l'étape 36
  (biométrie obligatoire). `validate:6:ui` n'a pas été relancé (même cause probable). Non corrigé ici.
- **Constatés par l'audit, non corrigés** (hors périmètre de cette étape) : `/guardian/sign` et `/relay` (lecture et
  retour de signature) ne demandent pas de session ; le step-up A1 n'est qu'indicatif (rien ne le vérifie côté serveur
  pour bloquer, et n'est pas lié au montant) ; la route `policy` du Client Wallet s'applique sans confirmation et
  peut fausser l'écran de signature ; les anciens wallets du Client Wallet sans protection ou protégés par PIN signent
  encore sans biométrie au niveau de l'API ; le retrait du compte crypto a une course entre contrôle du solde et débit.
