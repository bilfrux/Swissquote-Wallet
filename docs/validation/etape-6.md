# Étape 6 : interface bancaire et Wallet du client

## Livré

| Élément | Emplacement |
| --- | --- |
| **Wallet du client** : implémentation de référence d'un wallet externe (en production : wallet matériel ou appli téléphone). Un seul processus (API + interface Vite en middleware), stockage propre `client-wallet/data/` (mode 600, ignoré par git). Graine `@scure/bip39` affichée une fois ; seule la clé publique étendue est transmise ; signature après un écran de confirmation (chemin, sorties, montants, frais) ; refus du chemin de recovery ; API sans CORS qui refuse toute autre origine avant exécution ; « Simuler la perte de cet appareil » | `client-wallet/` (port 5180) |
| **Appli de la banque** : connexion e-banking simulée, Aperçu (patrimoine, tuile Bitcoin), Comptes (CHF fictifs), Wallet crypto (création, solde, réception, envoi signé par le Wallet du client, coins et délai, sécurité), recovery en écran à part, Démo · Attaques (regtest) | `client/src/` (`bank/`, `wallet/`, `recovery/`, `lib/walletBridge.ts`) |
| Pont banque ↔ wallet : fenêtre + `postMessage`, origines vérifiées des deux côtés | `client/src/lib/walletBridge.ts`, `client-wallet/src/ui/App.tsx` |
| bank-mock : connexion (`/auth/login`), profil et comptes CHF fictifs (`/me`), comptes Bitcoin du client connecté (`/wallet/accounts`), nom du tiers | `bank-mock/src/bank.ts`, `server.ts`, `db.ts` |
| Console guardian : « Créer mon identité de tiers » (phrase affichée une fois, clé publique) | `guardian-console/src/Console.tsx` |
| `npm run demo` lance aussi le Wallet du client | `package.json` |

Retiré : `client/src/wallet/AccountSetup.tsx` (saisie manuelle des trois clés), remplacé par `CreateWallet.tsx`. Il reste dans l'historique git (`779a5bd`).

## Commandes

```bash
npm run regtest:up
npm run demo                                          # pour la console guardian utilisée par le test
CONSOLE_URL=http://localhost:5175 npm run validate:6:ui   # pile isolée : bank-mock :4110, wallet :5190, appli :5191
npm run validate:inv5
npm run validate:1 && npm run validate:2 && npm run validate:3 && npm run test:attacks   # non-régression
npm run typecheck                                     # 7 projets
```

(`CONSOLE_URL` : le port 5174 était occupé sur ce poste par un autre processus, la console a pris le 5175.)

## Résultats (`etape-6-ui-sortie.txt`)

| # | Critère | Verdict |
| --- | --- | --- |
| 6-1 | Console : identité de tiers créée, 24 mots affichés une fois puis masqués, clé publique fournie | fonctionne |
| 6-2 | Connexion e-banking simulée (mauvais mot de passe refusé), aperçu avec comptes CHF et tuile « Créer mon wallet » | fonctionne |
| 6-3 | Wallet du client : 24 mots générés et affichés une fois (identiques à la graine stockée) ; la banque reçoit la clé publique ; politique enregistrée dans le wallet (délai 6, tiers « Marie Dupont ») | fonctionne |
| 6-4 | La phrase du client n'est ni dans le stockage ni dans la page de l'appli, ni dans la base de Swissquote ; seule la clé publique est chez Swissquote | fonctionne |
| 6-5 | Réception : 0,5 BTC visibles | fonctionne |
| 6-6 | Envoi : le refus dans le wallet remonte à l'appli ; écran de confirmation (« votre clé seule », destination, 0,1 BTC, « change (votre compte) », frais) ; signé, diffusé, confirmé | fonctionne |
| 6-7 | Depuis l'origine de la banque : lecture de l'API du wallet bloquée (CORS) ; POST refusé avant exécution (403 « origine refusée ») | fonctionne |
| 6-8 | Aperçu : tuile Bitcoin avec solde et contre-valeur CHF (cours simulé) | fonctionne |
| 6-9 | Perte du wallet (effacé du Wallet du client), puis recovery depuis un nouveau profil : re-KYC, nouveau wallet créé par le Wallet du client, Swissquote + tiers (console), **refus réel `non-BIP68-final` avant D**, succès à D, nouveau wallet actif avec les fonds | fonctionne |
| 6-10 | Onglet « Démo · Attaques » avec les trois scénarios | fonctionne |
| 6-11 | Aucune erreur dans les consoles des navigateurs, hors les deux refus volontaires du test (mauvais mot de passe en 6-2, appel interdit en 6-7) | fonctionne |
| 6-12 | Le Wallet du client refuse de signer un PSBT de recovery, même appelé directement (400 « chemin de recovery ») | fonctionne |
| Inv. 5 | 19 graines de la machine (dont celles du Wallet du client) et leurs clés privées de compte absentes de `client/` et du bundle ; témoin positif 18/18 fichiers | fonctionne (`etape-6-invariant-5-sortie.txt`) |
| Régressions | `validate:1` 6/6, `validate:2` 8/8, `validate:3` 3/3, `test:attacks` 4/4 ; typage des 7 projets | fonctionne (`etape-6-regressions-sortie.txt`) |

Captures : `captures/etape-6-*.png` (connexion, aperçu, phrase du wallet, wallet, écran de confirmation, envoi, refus de recovery avant D, nouveau wallet).

## Défauts trouvés par le test et corrigés

- **Course entre scans** (appli) : à la bascule vers le nouveau wallet après recovery, un scan obsolète de l'ancien compte écrasait le solde par 0. Correction : la vue est remontée à chaque changement de compte, et seule la réponse du dernier scan est prise en compte.
- **Effacement du wallet** (Wallet du client) : le DELETE était refusé (415) par le contrôle anti-requêtes « simples », et l'erreur n'était pas affichée. Correction : contrôle limité aux POST (un DELETE d'une autre origine exige un pré-contrôle CORS, qui échoue), et erreur affichée.
- **Rechargement à chaud** : deux instances du wallet se disputaient le port HMR de Vite. Correction : le HMR passe par le serveur HTTP du wallet.

## Limites

- Le Wallet du client de référence stocke la graine **en clair** (fichier en mode 600), sans code ni chiffrement. En production : wallet matériel ou appli téléphone avec élément sécurisé.
- Dans la démo, un même processus Wallet du client sert aux deux « appareils » : l'ancien wallet est effacé avant la création du nouveau.
- Les tests Chrome des étapes 1 à 4 visaient l'interface précédente : leurs commandes npm sont retirées, les fichiers restent pour l'historique.
- Le client CH-0001 de la base de démo `bank-mock/data` contient 12 comptes regtest créés par les tests précédents ; le test de l'étape 6 utilise une pile isolée et le client CH-0002.

## Suite : interface au style Swissquote, ordinateur et téléphone

À partir des deux captures de référence fournies par l'équipe (plateforme web et appli mobile Swissquote) :

| Élément | Ordinateur | Téléphone (< 820 px) |
| --- | --- | --- |
| Navigation | En-tête blanc (marque, menu Accueil / Banque / Crypto / Démo avec soulignement rouge, compte, « Déconnexion » en rouge), rail d'icônes rouges à gauche, barre d'état en bas | Boutons ronds en haut, barre d'onglets en bas (onglet actif en rouge) |
| Accueil | « Vue d'ensemble » : bandeau de chiffres, lignes Comptes / Crypto / Dernières opérations, graphique d'évolution avec sélecteur de période | Valeur totale centrée, carte avec montant, drapeau, variation, graphique, sélecteur 1S…Tout, tuiles 2×2 (Comptes, Crypto, Cash, Épargne), boutons ronds (Recevoir, Envoyer, Opérations) |
| Crypto | Bandeau (solde, contre-valeur, prochaine ouverture de la recovery), cartes Recevoir / Sécurité / Coins / Envoyer | Solde centré, boutons ronds (Recevoir, Envoyer, Sécurité), cartes empilées |

Choix : marque **redessinée** (rond rouge et mot-symbole), sans les fichiers officiels de Swissquote, à remplacer par le kit de marque s'il est fourni. Chiffres au format suisse (`36’309.84`). La variation du jour et la courbe de l'accueil sont **simulées** et étiquetées comme telles. Le Wallet du client garde son propre style. La console guardian a désormais sa propre feuille de style (`guardian-console/src/console.css`).

| Vérification | Commande | Verdict |
| --- | --- | --- |
| Parcours complet, version ordinateur (1280×1000) | `CONSOLE_URL=http://localhost:5175 npm run validate:6:ui` | fonctionne, 12/12 (`etape-6-ui-sortie.txt`) |
| Parcours complet, version téléphone (390×844, tactile) | `MOBILE=1 CONSOLE_URL=http://localhost:5175 npm run validate:6:ui` | fonctionne, 12/12 (`etape-6-ui-mobile-sortie.txt`) |
| Invariant 5 après la refonte | `npm run validate:inv5` | fonctionne |
| Typage des 7 projets | `npm run typecheck` | fonctionne |

Captures : `captures/etape-6-desktop-*.png` et `captures/etape-6-mobile-*.png`. Les captures `captures/etape-6-[1-8]-*.png` montrent l'interface avant la refonte.
