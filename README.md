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
| **Wallet du client** | **Implémentation de référence** | `client-wallet/` : appli séparée (processus et stockage propres) qui représente le wallet matériel ou l'appli téléphone du client. Graine générée par `@scure/bip39` et affichée une fois ; signature seulement après un écran de confirmation (sorties, montants, frais, chemin) ; API fermée aux autres origines |
| Signataire externe réel | **Réel** | Bitcoin Core 29 (`walletprocesspsbt`), validé en regtest |
| Signataire en ligne de commande | **Outil de test** | `tools/client-signer` : signataire utilisé par les scripts de validation (il lit la phrase à l'exécution et ne stocke rien) |
| Backend Swissquote (guardian) | **Mocké**, processus séparé | `bank-mock/` : clé propre dans son stockage, re-KYC mocké (dossiers de test), signature limitée aux recoveries vers un compte du même client |
| Connexion e-banking, comptes et opérations CHF, re-KYC, cours BTC/CHF | **Mocké** | Clients de test codés en dur (`bank-mock/src/bank.ts`, `kyc.ts`) |
| Console du tiers de confiance | **Réel** (logique), démo | `guardian-console/` : création de l'identité du tiers (phrase affichée une fois), décodage et signature ; la phrase n'est jamais conservée |
| Panneau « Attaques » | **Réel**, démo regtest | Scénarios exécutés contre bitcoind avec des graines jetables (`scripts/attacks/`) |
| Ethereum, gasless, dApp, DeFi | **Hors périmètre** | Non développés |

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
2. **Le client** se connecte à la banque (http://localhost:5173) : identifiant `CH-0002`, mot de passe `demo5678` (client sans wallet ; `CH-0001` / `demo1234` contient des comptes de test).
3. **Crypto → Créer mon wallet** : saisir le nom et la clé du tiers, puis « Créer mon wallet avec le Wallet du client ». La fenêtre du Wallet du client génère et affiche la phrase une fois ; le client confirme l'avoir notée ; seule la clé publique revient à la banque.
4. **Recevoir** : `npm run regtest -- fund <adresse affichée> 0.5`, puis « Actualiser ».
5. **Envoyer** : préparer l'envoi (simulation en clair), « Signer avec mon Wallet du client », vérifier l'écran de confirmation du wallet, signer, puis diffuser. `npm run regtest -- mine 1` confirme la transaction.
6. **Perte du wallet** : dans le Wallet du client (http://localhost:5180), « Simuler la perte de cet appareil ». Puis, dans un autre profil de navigateur, se reconnecter et cliquer sur « J'ai perdu mon wallet ». Re-KYC mocké de CH-0002 : `Exemple`, `1985-06-15`, `654321`. Ensuite : nouveau wallet, signature Swissquote, signature du tiers dans sa console, diffusion. **Le réseau refuse** (`non-BIP68-final`) ; après `npm run regtest -- mine 6`, diffuser à nouveau : accepté.
7. **Démo** : les trois boutons d'attaque.

L'interface s'adapte à la largeur : version téléphone sous 820 px (barre d'onglets en bas), version ordinateur au-delà (menu, rail latéral, barre d'état).

## Preuves

Toutes les affirmations de ce dépôt renvoient à une exécution consignée dans `docs/validation/` (commandes, sorties brutes, captures).

| Commande | Ce qu'elle prouve |
| --- | --- |
| `npm run validate:1` / `validate:1:signet` | Politique, adresses, dépense du client par signataire externe (client-signer, Bitcoin Core), signet |
| `npm run validate:2` | bank-mock, re-KYC, refus de Swissquote, bank-mock arrêté → le client dépense seul |
| `npm run validate:3` / `validate:3:signet` | Recovery refusée avant D et acceptée à D, rafraîchissement, recovery réelle sur signet |
| `npm run test:attacks` | Les trois attaques et l'invariant 1 contre le consensus |
| `npm run validate:6:ui` (et `MOBILE=1 npm run validate:6:ui`) | Parcours complet dans Chrome sur une pile isolée, en version ordinateur et téléphone : connexion, création du wallet via le Wallet du client, envoi confirmé dans le wallet, API du wallet fermée à la banque, perte du wallet et recovery |
| `npm run validate:inv5` | Aucune clé privée ni graine dans `client/` et son bundle (avec témoin positif) |

Les tests Chrome des étapes 1 à 4 visaient l'interface précédente (commit `779a5bd`) ; ils sont remplacés par `validate:6:ui`.

Voir aussi : [docs/threat-model.md](docs/threat-model.md), [docs/architecture.md](docs/architecture.md), [docs/ia.md](docs/ia.md).

## Limites assumées

- **Swissquote disparaît ET le client perd sa clé : les fonds sont perdus.** Aucun chemin ne fonctionne sans Swissquote si le client n'a plus sa clé. Extension possible : un chemin « backup du client + tiers » après un délai plus long.
- **Le tiers perd sa clé : la recovery devient impossible.** Le client doit le remplacer tant qu'il a sa clé : nouvelle politique et déplacement des coins. Ce changement de tiers n'est pas implémenté.
- **Zone grise de custody.** Swissquote + tiers peuvent dépenser, **vers n'importe quelle destination**, tout coin resté immobile D blocs. Observé dans `npm run test:attacks` (attaque 2, ligne « zone grise »). Atténuations : tiers choisi par le client et sans lien avec Swissquote, avertissement dans l'appli avant l'échéance, rafraîchissement par le client. Bitcoin ne permet pas de contraindre la destination.
- **Rafraîchissement obligatoire.** Pour bloquer toute recovery, le client doit déplacer chaque coin avant D : c'est un coût en frais, et l'activité devient visible sur la chaîne.
- **Peu de wallets externes signent ce type de script** (Miniscript avec délai) : Bitcoin Core (vérifié), Liana et certains wallets matériels (annoncés, non vérifiés). Sparrow ne le gère très probablement pas (issues GitHub #1700 ouverte et #1757 refusée ; non vérifié en lançant Sparrow).
- **Confidentialité.** En P2WSH, chaque dépense révèle la politique, donc l'existence du délai. Taproot est une perspective, non implémentée.
- **Pas d'Ethereum, pas de gasless, pas de dApp conforme.** L'exploration Ethereum (Safe + module Candide) est conservée sur la branche `archive/exploration-etape-0`, non intégrée.
- Re-KYC et session bancaire mockés ; `node:sqlite` est expérimental dans Node 24 ; la preuve de propriété d'adresse n'est pas faite.

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
