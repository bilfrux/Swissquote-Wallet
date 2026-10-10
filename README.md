# Swissquote · wallet Bitcoin self-custody avec recovery à deux guardians

> « La banque construit l'outil, mais ne tient jamais les clés. »

Le client se connecte à son e-banking Swissquote (simulé, au style de la plateforme et de l'appli Swissquote, en version ordinateur et téléphone), ouvre l'onglet **Crypto** et crée son wallet Bitcoin. La graine est générée dans **son** « Wallet du client », une appli séparée qui représente un wallet matériel ou une appli téléphone : la banque ne reçoit que la clé publique. Le client dépense seul, à tout moment, après confirmation dans son wallet. Si le client perd sa clé, **Swissquote et un tiers de confiance choisi par le client** peuvent ensemble déplacer ses coins vers un nouveau compte, mais **seulement pour des coins restés immobiles D blocs**. Ces règles ne sont pas appliquées par Swissquote : elles sont écrites dans le script Bitcoin et imposées par le consensus.

```
or( pk(CLIENT), and( pk(SWISSQUOTE), and( pk(TIERS), older(D) ) ) )      P2WSH, Miniscript
```

Démo : D = 6 blocs. Valeur visée en production (hypothèse, paramètre) : environ 6 mois (≈ 26 000 blocs).

## Réel ou mocké

| Élément | Statut | Détail |
| --- | --- | --- |
| Politique Miniscript, adresses, PSBT, délai `older(D)` | **Réel** | Compilateur de référence (sipa), `@bitcoinerlab/descriptors`, `@scure/btc-signer`. Aucune cryptographie maison |
| Nœud Bitcoin | **Réel** | bitcoind 29 en regtest (Docker) ; signet via l'API Esplora de blockstream.info |
| Transactions signet | **Réel** | Dépense du client [9203045e…](https://blockstream.info/signet/tx/9203045ed6d150a225821dff8c4287601f94d0c065ec975a795e92f637e6d248) ; recovery Swissquote + tiers refusée avant D (`non-BIP68-final`), puis diffusée à D : [d26b94de…](https://blockstream.info/signet/tx/d26b94de30f36cbfa8b1a7f39976bf74a09e7afafda09b7a66a916b37326c519) |
| Appli de la banque | **Réel** (wallet) / **mocké** (banque) | `client/` : e-banking simulé au style Swissquote (connexion, accueil avec graphique simulé, comptes CHF), onglet Crypto réel. Aucune clé privée, uniquement des clés publiques et des PSBT |
| **Wallet du client** | **Implémentation de référence** | `client-wallet/` : appli séparée (processus et stockage propres) qui représente le wallet matériel ou l'appli téléphone du client. Graine générée par `@scure/bip39`, affichée une fois, puis **chiffrée par un code PIN** (scrypt + AES-256-GCM, `node:crypto`) ; PIN demandé à chaque signature, blocage 60 s après 5 erreurs ; signature seulement après un écran de confirmation (sorties, montants, frais, chemin) ; API fermée aux autres origines |
| Signataire externe réel | **Réel** | Bitcoin Core 29 (`walletprocesspsbt`), validé en regtest |
| Signataire en ligne de commande | **Outil de test** | `tools/client-signer` : signataire utilisé par les scripts de validation (il lit la phrase à l'exécution et ne stocke rien) |
| Backend Swissquote (guardian) | **Mocké**, processus séparé | `bank-mock/` : clé propre dans son stockage, re-KYC mocké (dossiers de test), signature limitée aux recoveries vers un compte du même client |
| Connexion e-banking, comptes et opérations CHF, re-KYC, cours BTC/CHF | **Mocké** | Clients de test codés en dur (`bank-mock/src/bank.ts`, `kyc.ts`) |
| Console du tiers de confiance | **Réel** (logique), démo | `guardian-console/` : création de l'identité du tiers (phrase affichée une fois), décodage et signature ; la phrase n'est jamais conservée |
| Authentification et montants élevés | **Réel** (WebAuthn, `@simplewebauthn`) | Connexion à la banque par **passkey** (biométrie ou verrouillage de l'appareil) ou mot de passe mocké. **Au-delà de 0,2 BTC** : ré-authentification par passkey auprès de Swissquote (enregistrée, alerte au client), puis, dans le Wallet du client, PIN **et** ressaisie des 6 derniers caractères de l'adresse de destination (contrôle appliqué par le serveur du wallet) |
| Historique et frais | **Réel** | Historique du compte (reçu, envoyé, rafraîchissement, recovery) lu sur la chaîne : Esplora en signet, wallet bitcoind en lecture seule (descripteurs publics) en regtest. Frais estimés par le réseau (préréglages Économique / Normal / Rapide), jamais sous 1 sat/vB |
| Alertes au client | **Réel** (surveillance) / **email simulé** | bank-mock surveille les comptes (regtest toutes les 30 s, signet toutes les 5 min) : coin bientôt ou déjà dépensable par Swissquote + tiers, et alerte immédiate quand Swissquote signe une recovery. Cloche dans l'appli et email simulé (`bank-mock/data/outbox.log`) |
| Preuve de propriété d'adresse | **Réel** | Défi émis par bank-mock, signé par le Wallet du client (BIP-322 « simple », `bip322-js`), vérifié en mode strict. Ce qui est prouvé est détaillé ci-dessous |
| Compte crypto Swissquote et transferts (Travel Rule) | **Mocké** (registre) / **réel** (on-chain, regtest) | Avoirs en garde chez Swissquote (offre actuelle) ; « Transférer » vers le wallet : Swissquote n'envoie qu'après une **preuve de propriété** signée automatiquement par le Wallet du client, depuis un portefeuille omnibus bitcoind ; dépôts crédités seulement s'ils viennent d'un wallet enregistré du client. Regtest uniquement |
| Panneau « Attaques » | **Réel**, démo regtest | Scénarios exécutés contre bitcoind avec des graines jetables (`scripts/attacks/`) |
| Ethereum, Taproot, gasless, dApp, DeFi | **Hors périmètre** | Non développés (voir « Perspectives ») |

## Lancer la démo (trois commandes)

Prérequis : Node 24, Docker.

```bash
npm install
npm run regtest:up      # bitcoind 29 regtest dans Docker
npm run demo            # banque :5173 · console du tiers :5174 · Wallet du client :5180 · bank-mock :4000 · attaques :4200
```

Si un port de Vite est déjà pris, la console prend le suivant (affiché dans le terminal). Les ports fixes sont configurables (`.env.example`).

### Parcours de démo

1. **Le tiers** ouvre la console (http://localhost:5174), clique sur « Créer mon identité de tiers », note sa phrase et transmet sa clé publique au client.
2. **Le client** se connecte à la banque (http://localhost:5173) : identifiant `CH-0003`, mot de passe `demo0003`. C'est le client de démo **vierge**, sans aucun compte Bitcoin. `CH-0001` et `CH-0002` contiennent des comptes créés par les tests.
3. **Crypto → Créer mon wallet** : saisir le nom et la clé du tiers, puis « Créer mon wallet avec le Wallet du client ». Dans la fenêtre du Wallet du client, choisir un code PIN : le wallet génère la phrase, l'affiche une fois, puis la chiffre. Le client confirme l'avoir notée ; seule la clé publique revient à la banque.
4. **Recevoir** : `npm run regtest -- fund <adresse affichée> 0.5`, puis « Actualiser ».
   **Preuve de propriété** : « Prouver à Swissquote que je contrôle cette adresse ». Le Wallet du client affiche le défi en entier, le client signe, Swissquote vérifie.
5. **Envoyer** : préparer l'envoi (simulation en clair), « Signer avec mon Wallet du client », vérifier l'écran de confirmation du wallet, signer, puis diffuser. `npm run regtest -- mine 1` confirme la transaction.
6. **Perte du wallet** : dans le Wallet du client (http://localhost:5180), « Simuler la perte de cet appareil ». Puis, dans un autre profil de navigateur, se reconnecter et cliquer sur « J'ai perdu mon wallet ». Re-KYC mocké de CH-0003 : `Martin`, `1992-03-21`, `246810`. Ensuite : nouveau wallet, signature Swissquote, signature du tiers dans sa console, diffusion. **Le réseau refuse** (`non-BIP68-final`) ; après `npm run regtest -- mine 6`, diffuser à nouveau : accepté.
7. **Alertes** : la cloche de l'en-tête signale un coin bientôt dépensable par Swissquote + tiers, ou une recovery signée par Swissquote (y compris sur l'ancien appareil).
8. **Démo** : les trois boutons d'attaque.

Sur le vrai réseau signet : `npm run demo:signet` (sans onglet Démo). Il faut des signet BTC, à obtenir d'un faucet.

Le logo est le logo officiel fourni par l'équipe (`client/public/`). L'interface s'adapte à la largeur : version téléphone sous 820 px (barre d'onglets en bas), version ordinateur au-delà (menu, rail latéral, barre d'état).

## Preuves

Toutes les affirmations de ce dépôt renvoient à une exécution consignée dans `docs/validation/` (commandes, sorties brutes, captures).

| Commande | Ce qu'elle prouve |
| --- | --- |
| `npm run validate:1` / `validate:1:signet` | Politique, adresses, dépense du client par signataire externe (client-signer, Bitcoin Core), signet |
| `npm run validate:2` | bank-mock, re-KYC, refus de Swissquote, bank-mock arrêté → le client dépense seul |
| `npm run validate:3` / `validate:3:signet` | Recovery refusée avant D et acceptée à D, rafraîchissement, recovery réelle sur signet |
| `npm run test:attacks` | Les trois attaques et l'invariant 1 contre le consensus |
| `npm run validate:6:ui` (et `MOBILE=1 npm run validate:6:ui`) | Parcours complet dans Chrome sur une pile isolée, en version ordinateur et téléphone : connexion, création du wallet via le Wallet du client, envoi confirmé dans le wallet, API du wallet fermée à la banque, perte du wallet et recovery |
| `npm run validate:7` | Preuve de propriété (valide, et refus : rejeu, message altéré, autre clé, format BIP-137, autre client) ; client vierge CH-0003 |
| `npm run validate:9` | Historique (classement et montants de chaque type de transaction, en regtest ; réception réelle en signet) et estimation des frais (regtest et signet réel) |
| `npm run validate:10` | Montants élevés dans le wallet (refus sans confirmation renforcée) et cas d'échec du step-up passkey chez Swissquote |
| `npm run validate:11` | Transferts compte Swissquote ↔ wallet : refus sans preuve de propriété ou vers une adresse étrangère, retrait après preuve, enregistrement Travel Rule, dépôts crédités ou mis en attente selon la provenance |
| `npm run validate:8:pin` | Code PIN : graine chiffrée sur le disque, PIN faux refusé, blocage après 5 erreurs, ancien wallet protégé |
| `npm run validate:8:alerts` | Alertes : seuil, sans doublon, recovery ouverte, recovery signée par Swissquote, email simulé, étanchéité entre clients |
| `npm run validate:8:signet -- create\|spend\|recover` | Parcours de l'interface sur le vrai réseau signet |
| `npm run validate:inv5` | Aucune clé privée ni graine dans `client/` et son bundle (avec témoin positif) |

Les tests Chrome des étapes 1 à 4 visaient l'interface précédente (commit `779a5bd`) ; ils sont remplacés par `validate:6:ui`.

Voir aussi : [docs/threat-model.md](docs/threat-model.md), [docs/architecture.md](docs/architecture.md), [docs/ia.md](docs/ia.md).

## Qui applique quoi : authentification et montants élevés

| Contrôle | Appliqué par | Ce qu'il empêche | Limite |
| --- | --- | --- | --- |
| Passkey de connexion (WebAuthn, vérification de l'utilisateur exigée) | Swissquote (bank-mock) | Accès à l'appli avec un simple mot de passe volé | Ne protège pas les fonds : la clé Bitcoin est dans le Wallet du client |
| Ré-authentification par passkey au-delà de 0,2 BTC | Swissquote, via l'appli | Envoi important depuis une session ouverte par un tiers ; traçabilité et alerte | **Non bloquante si Swissquote est injoignable**, sinon le client ne pourrait plus dépenser seul (invariant 4) |
| PIN + 6 derniers caractères de l'adresse au-delà de 0,2 BTC | **Wallet du client** (le signataire) | Signature à l'aveugle, adresse substituée par une appli compromise | Un attaquant qui détient la graine contourne tout contrôle applicatif |
| Différence on-chain selon le montant | **Aucune sur Bitcoin** : le chemin `pk(CLIENT)` ne connaît pas les montants | — | Sur EVM, un module ou un guard du Safe peut imposer une limite on-chain (perspective) |

## Ce que prouve la preuve de propriété (et ce qu'elle ne prouve pas)

Swissquote émet un défi à usage unique (10 min) qui nomme le client et l'adresse n°i de son compte. Le Wallet du client le signe avec sa **clé client** à l'index i. Swissquote recalcule cette clé depuis le xpub enregistré, sans faire confiance à l'appli, et vérifie la signature en mode strict.

- **Prouvé** : le client détient la clé privée de sa clé client à l'index i (signature BIP-322 « simple », vérifiée pour l'adresse P2WPKH de cette clé). D'après la politique enregistrée par Swissquote, cette clé suffit **seule** à dépenser l'adresse n°i (chemin client).
- **Pas prouvé** : ce n'est **pas** une signature BIP-322 de l'adresse P2WSH du compte elle-même, car `bip322-js` ne gère pas P2WSH. Le lien entre la clé et l'adresse repose sur le descripteur que Swissquote connaît, pas sur une preuve produite par le script de l'adresse. La preuve ne dit rien de l'identité de la personne qui tient la clé : elle est rattachée au client par la session bancaire.

## Limites assumées

- **Swissquote disparaît ET le client perd sa clé : les fonds sont perdus.** Aucun chemin ne fonctionne sans Swissquote si le client n'a plus sa clé. Extension possible : un chemin « backup du client + tiers » après un délai plus long.
- **Le tiers perd sa clé : la recovery devient impossible.** Le client doit le remplacer tant qu'il a sa clé : nouvelle politique et déplacement des coins. Ce changement de tiers n'est pas implémenté.
- **Zone grise de custody.** Swissquote + tiers peuvent dépenser, **vers n'importe quelle destination**, tout coin resté immobile D blocs. Observé dans `npm run test:attacks` (attaque 2, ligne « zone grise »). Atténuations : tiers choisi par le client et sans lien avec Swissquote, avertissement dans l'appli avant l'échéance, rafraîchissement par le client. Bitcoin ne permet pas de contraindre la destination.
- **Rafraîchissement obligatoire.** Pour bloquer toute recovery, le client doit déplacer chaque coin avant D : c'est un coût en frais, et l'activité devient visible sur la chaîne.
- **Peu de wallets externes signent ce type de script** (Miniscript avec délai) : Bitcoin Core (vérifié), Liana et certains wallets matériels (annoncés, non vérifiés). Sparrow ne le gère très probablement pas (issues GitHub #1700 ouverte et #1757 refusée ; non vérifié en lançant Sparrow).
- **Confidentialité.** En P2WSH, chaque dépense révèle la politique, donc l'existence du délai.
- **Pas d'Ethereum, pas de Taproot, pas de gasless, pas de dApp conforme** : voir « Perspectives ».
- **Code PIN du Wallet du client** : il protège l'usage du wallet (5 essais, puis blocage), mais **pas un vol du fichier** suivi d'une attaque hors ligne. scrypt ralentit chaque essai, mais un PIN de 6 chiffres reste à portée d'une recherche exhaustive. En production, il faut un élément sécurisé (wallet matériel, enclave du téléphone).
- **Alertes** : simple information. Elles dépendent de Swissquote (Swissquote arrêtée = plus d'alertes), et l'email est simulé. La protection reste le délai imposé par le consensus et le rafraîchissement par le client.
- Re-KYC et session bancaire mockés ; `node:sqlite` est expérimental dans Node 24.

## Perspectives (non implémentées)

- **Ethereum.** Un Safe dont le propriétaire est le compte EVM du client, avec le module de recovery de Candide (Swissquote + tiers, seuil 2, un délai). L'exploration sur fork Sepolia est conservée sur la branche `archive/exploration-etape-0`. Elle a montré le fonctionnement, et deux pièges de la version 0.0.1 déployée : après une recovery, il faut appeler `cancelRecovery` **et** `invalidateNonce` ; retirer un guardian n'annule pas une recovery en cours. La sémantique diffère de Bitcoin : le propriétaire **annule** une recovery en cours, au lieu de rafraîchir ses coins.
- **Taproot.** `tr(CLIENT, {and(SWISSQUOTE, TIERS, older(D))})` : la dépense du client passe par le chemin de clé et ressemble à un paiement ordinaire à signature unique. Elle coûte moins cher et ne révèle jamais l'existence du délai. La preuve de propriété pourrait alors porter sur l'adresse du compte elle-même. C'est à vérifier : la clé Taproot dépend de l'arbre de scripts, et `bip322-js` n'annonce que la dépense par clé simple.

## Structure

```
packages/bitcoin/   politique, descripteurs, PSBT, simulation, finalisation (index.ts : aucune clé ; sign.ts/keys.ts : outils seulement)
client/             appli de la banque (Vite + React) : e-banking simulé, Wallet crypto, recovery, Démo · Attaques
client-wallet/      Wallet du client (implémentation de référence ; processus et stockage propres)
bank-mock/          guardian Swissquote mocké (processus séparé, stockage propre)
guardian-console/   console du tiers de confiance
tools/              client-signer (signataire des scripts de test), keygen
scripts/            validations, attaques, aides de démo
docker/             bitcoind regtest
docs/               validation/, threat-model, architecture, ia
```
