# Swissquote · wallet Bitcoin self-custody avec recovery à deux guardians

> « La banque construit l'outil, mais ne tient jamais les clés. »

Le client garde sa seed phrase dans **son** wallet externe (Bitcoin Core vérifié ; Liana ou wallet matériel annoncés compatibles) et dépense seul, à tout moment. Si le client perd sa clé, **Swissquote et un tiers de confiance choisi par le client** peuvent ensemble déplacer ses coins vers un nouveau compte, mais **seulement pour des coins restés immobiles D blocs**. Ces règles ne sont pas appliquées par Swissquote : elles sont écrites dans le script Bitcoin et imposées par le consensus.

```
or( pk(CLIENT), and( pk(SWISSQUOTE), and( pk(TIERS), older(D) ) ) )      P2WSH, Miniscript
```

Démo : D = 6 blocs. Valeur visée en production (hypothèse, paramètre) : environ 6 mois (≈ 26 000 blocs).

## Réel ou mocké

| Élément | Statut | Détail |
| --- | --- | --- |
| Politique Miniscript, adresses, PSBT, délai `older(D)` | **Réel** | Compilateur de référence (sipa), `@bitcoinerlab/descriptors`, `@scure/btc-signer`. Aucune cryptographie maison |
| Nœud Bitcoin | **Réel** | bitcoind 29 en regtest (Docker) ; signet via l'API Esplora de blockstream.info |
| Transactions signet | **Réel** | Dépense du client [9203045e…](https://blockstream.info/signet/tx/9203045ed6d150a225821dff8c4287601f94d0c065ec975a795e92f637e6d248) ; recovery refusée par le réseau signet avant D (`non-BIP68-final`) |
| Appli web cliente | **Réel** | `client/` : aucune clé privée, uniquement des clés publiques |
| Signataire externe réel | **Réel** | Bitcoin Core 29 (`walletprocesspsbt`), validé en regtest |
| Signataire du client utilisé pour la démo | **Substitut de démo** | `tools/client-signer` représente le wallet externe du client (il lit la phrase à l'exécution et ne stocke rien) |
| Backend Swissquote (guardian) | **Mocké**, processus séparé | `bank-mock/` : clé propre dans son stockage, re-KYC mocké (dossiers de test), signature limitée aux recoveries vers un compte du même client |
| Re-KYC, session bancaire, solde CHF | **Mocké** | Deux dossiers de test codés en dur ; client identifié par `VITE_CUSTOMER_ID` |
| Console du tiers de confiance | **Réel** (logique), démo | `guardian-console/` : décode et signe ; la phrase n'est jamais conservée |
| Panneau « Attaques » | **Réel**, démo regtest | Scénarios exécutés contre bitcoind avec des graines jetables (`scripts/attacks/`) |
| Ethereum, gasless, dApp, DeFi | **Hors périmètre** | Non développés |

## Lancer la démo (trois commandes)

Prérequis : Node 24, Docker.

```bash
npm install
npm run regtest:up      # bitcoind 29 regtest dans Docker
npm run demo            # appli :5173 · bank-mock :4000 · console du tiers :5174 · attaques :4200
```

Si un port est déjà pris, Vite choisit le suivant et l'affiche dans la console.

### Parcours de démo

1. **Créer les wallets de démo** (ils représentent le wallet externe du client et celui du tiers) :
   `npm run keygen -- --network regtest`, une fois pour le client et une fois pour le tiers. La phrase s'affiche une seule fois ; la clé publique est à coller dans l'appli.
2. **Appli** (http://localhost:5173) : coller la clé du client, cliquer sur « Obtenir la clé de Swissquote », coller la clé du tiers, puis « Créer le compte ».
3. **Recevoir** : `npm run regtest -- fund <adresse affichée> 0.5`.
4. **Envoyer** : préparer la transaction (simulation en clair), la signer dans le wallet externe
   (`npm run client-signer -- --psbt <fichier> --network regtest`), recoller le PSBT signé, puis diffuser.
5. **Perte de la clé** : dans un autre profil de navigateur, « J'ai perdu la clé de mon wallet ». Re-KYC mocké : nom `Muster`, date de naissance `1990-01-01`, code `123456`. Puis nouvelle clé, signature Swissquote, signature du tiers dans la console (http://localhost:5174), et diffusion : **le réseau refuse** (`non-BIP68-final`). Ensuite `npm run regtest -- mine 6`, puis diffuser à nouveau : accepté.
6. **Attaques** : les trois boutons du panneau en bas de l'appli.

## Preuves

Toutes les affirmations de ce dépôt renvoient à une exécution consignée dans `docs/validation/` (commandes, sorties brutes, captures).

| Commande | Ce qu'elle prouve |
| --- | --- |
| `npm run validate:1` / `validate:1:ui` / `validate:1:signet` | Politique, adresses, dépense du client par signataire externe (client-signer, Bitcoin Core), parcours dans Chrome, signet |
| `npm run validate:2` / `validate:2:ui` | bank-mock, re-KYC, refus de Swissquote, bank-mock arrêté → le client dépense seul, console du tiers |
| `npm run validate:3` / `validate:3:ui` / `validate:3:signet` | Recovery refusée avant D et acceptée à D, rafraîchissement, recovery de bout en bout dans Chrome, refus réel sur signet |
| `npm run test:attacks` / `validate:4:ui` | Les trois attaques et l'invariant 1 contre le consensus |
| `npm run validate:inv5` | Aucune clé privée ni graine dans `client/` et son bundle (avec témoin positif) |

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
client/             appli web (Vite + React) : compte, réception, envoi, recovery, panneau « Attaques »
bank-mock/          guardian Swissquote mocké (processus séparé, stockage propre)
guardian-console/   console du tiers de confiance
tools/              client-signer (wallet externe de démo), keygen
scripts/            validations, attaques, aides de démo
docker/             bitcoind regtest
docs/               validation/, threat-model, architecture, ia
```
