# Architecture

Trois principes :
1. **Aucune clé privée dans l'appli** : elle ne manipule que des clés publiques et des PSBT.
2. **La politique de dépense est appliquée par le consensus Bitcoin**, pas par Swissquote.
3. **Chaque guardian est un processus ou une personne séparée**, avec son propre stockage.

```mermaid
flowchart LR
  classDef reel fill:#e3f6e8,stroke:#2e7d32,color:#1b3d1f
  classDef mock fill:#fff4d6,stroke:#b8860b,color:#4d3800
  classDef demo fill:#e3e8f2,stroke:#44546f,color:#1d2433

  subgraph Client["Client"]
    APP["Appli web<br/>client/ (Vite + React)<br/>clés publiques + PSBT"]:::reel
    WALLET["Wallet externe du client<br/>Bitcoin Core (réel)<br/>tools/client-signer (substitut de démo)"]:::demo
  end

  subgraph SQ["Swissquote (processus séparé)"]
    BANK["bank-mock/<br/>guardian Swissquote<br/>re-KYC mocké · clé propre"]:::mock
    DB[("bank-mock/data<br/>SQLite + graine (600)")]:::mock
  end

  subgraph TIERS["Tiers de confiance"]
    CONSOLE["guardian-console/<br/>décode et signe<br/>phrase jamais conservée"]:::reel
  end

  subgraph CHAIN["Réseau Bitcoin"]
    NODE["bitcoind 29 regtest (Docker)<br/>signet via Esplora (blockstream.info)"]:::reel
  end

  ATT["scripts/attacks/server.ts<br/>panneau « Attaques » (démo regtest)"]:::demo

  APP -- "PSBT non signé" --> WALLET
  WALLET -- "PSBT signé (client)" --> APP
  APP -- "clé publique, enregistrement, re-KYC,<br/>demande de recovery (PSBT)" --> BANK
  BANK --- DB
  BANK -- "PSBT signé (Swissquote)" --> APP
  APP -- "PSBT à signer (copier-coller)" --> CONSOLE
  CONSOLE -- "PSBT signé (tiers)" --> APP
  APP -- "finalise et diffuse ;<br/>lit les coins" --> NODE
  APP -- "lance un scénario" --> ATT
  ATT -- "transactions de démo" --> NODE
```

Légende : vert = réel, jaune = mocké, gris-bleu = substitut ou outil de démo.

## Politique et chemins de dépense

```mermaid
flowchart TD
  U["Coin sur l'adresse du compte<br/>wsh(andor(pk(S), and_v(v:pk(T), older(D)), pk(C)))"]
  U -->|"signature du client<br/>à tout moment"| C["Chemin client"]
  U -->|"signatures Swissquote + tiers<br/>ET coin immobile depuis D blocs"| R["Chemin recovery"]
  R --> N["Nouveau compte du client<br/>(nouvelle clé client, mêmes guardians)"]
  C -->|"envoi à soi-même = rafraîchissement<br/>le délai D repart de zéro"| U
```

## Flux principaux

| Flux | Étapes | Qui signe | Dépend de Swissquote ? |
| --- | --- | --- | --- |
| Création du compte | L'appli reçoit 3 clés publiques (client, Swissquote, tiers), compile la politique, dérive les adresses, enregistre le compte chez bank-mock (facultatif) | — | Non (la clé Swissquote peut être collée) |
| Dépense du client | L'appli prépare le PSBT et le simule en clair → le wallet externe signe → l'appli finalise et diffuse | Client | **Non** (attaque 3) |
| Rafraîchissement | Envoi de tous les coins vers une adresse de change neuve du compte | Client | Non |
| Recovery | Re-KYC → ancien compte retrouvé → nouvelle clé → PSBT de recovery → bank-mock signe → le tiers signe dans sa console → l'appli combine, finalise, diffuse ; refus réel `non-BIP68-final` avant D | Swissquote + tiers | Oui (par conception) |

## Composants

| Dossier | Rôle | Réel / mocké |
| --- | --- | --- |
| `packages/bitcoin` | Politique Miniscript, descripteurs, scan, PSBT, simulation, finalisation, backends Esplora et bitcoind. `index.ts` n'expose ni clé ni signature ; `sign.ts` et `keys.ts` sont réservés aux outils, à bank-mock et à la console | Réel |
| `client/` | Appli du client (port 5173) | Réel (banque et session simulées) |
| `bank-mock/` | Guardian Swissquote (port 4000) : clé publique, comptes, re-KYC mocké, signature limitée aux recoveries, journal | Mocké |
| `guardian-console/` | Console du tiers (port 5174) | Réel (logique) |
| `tools/client-signer`, `tools/keygen` | Substituts de démo du wallet externe | Démo |
| `scripts/attacks/` | Scénarios d'attaque (tests et panneau, port 4200) | Réel contre regtest, graines jetables |
| `docker/regtest.yml` | bitcoind 29 regtest | Réel |

## Bibliothèques (aucune cryptographie maison)

`@bitcoinerlab/miniscript-policies` 1.1.0 (compilateur de référence de sipa), `@bitcoinerlab/miniscript` 2.0.0, `@bitcoinerlab/descriptors-scure` 3.2.0 (`@scure/btc-signer`, `@scure/bip32`, `@noble/curves`), `@scure/bip39` 2.4.0, `@scure/base` 2.4.0, React 19.3, Vite 8.3, `node:sqlite` (Node 24), `playwright-core` 1.64 (tests uniquement).
