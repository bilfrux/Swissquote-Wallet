# Fiche technique pour répondre aux questions du jury

Sources : `README.md`, `docs/architecture.md`, `docs/threat-model.md`, `docs/custody-models.md` et `docs/validation/etape-*.md` de la pile live (worktree `docs-soumission`), plus lecture du code. Légende : **testé** = exécuté et enregistré dans `docs/validation/` ; **mocké** = simulé exprès ; **non testé** = à dire tel quel.

## 1. L'idée en 30 secondes

« La banque construit l'outil mais ne détient jamais les clés. » Le client garde une seed dans son propre Client Wallet. Si il la perd, **Swissquote + un contact de confiance choisi par le client** peuvent déplacer ses fonds vers une nouvelle clé, **mais seulement après un délai que la blockchain impose** (Bitcoin) ou que le contrat impose (Ethereum). Swissquote seule ne peut jamais rien déplacer.

## 2. Stack technique

| Couche | Techno | Rôle |
| --- | --- | --- |
| Appli banque `client/` (:5173) | Vite 8 + React 19, TypeScript | E-banking simulé + onglet Crypto. **Aucune clé privée**, seulement clés publiques et PSBT (test `validate:inv5` : 0 seed dans le code et le bundle) |
| Client Wallet `client-wallet/` (:5180/5190) | Node + Vite, processus séparé | Génère la seed, la chiffre, affiche l'écran de confirmation, signe. Joue le rôle d'un hardware wallet / app téléphone |
| Backend Swissquote `bank-mock/` (:4000/4100) | Node 24, `node:sqlite`, `@simplewebauthn/server` | Guardian Swissquote **mocké** : sa propre clé, re-KYC simulé, signe uniquement des recoveries, relais, alertes, ledger de custody |
| Console du contact `guardian-console/` (:5174) | Vite + React | Le contact crée son identité, décode et signe. Sa phrase n'est jamais stockée |
| Bitcoin | Miniscript (`@bitcoinerlab/miniscript-policies`, compilateur de sipa), `@bitcoinerlab/descriptors-scure`, `@scure/btc-signer`, `@scure/bip32`, `@scure/bip39`, `@noble/curves`, `bip322-js` | Politique, adresses P2WSH, PSBT, preuve de propriété |
| Réseaux Bitcoin | bitcoind 29 regtest (Docker) ; signet via Esplora (blockstream.info) | **Réel** (pas de simulation de la chaîne) |
| Ethereum | `viem` 2.57, `abstractionkit` 0.4.3, Safe + module de recovery de Candide v0.0.1, ERC-4337, paymaster public Candide | Réseau **Sepolia** (testnet) |
| Authentification | WebAuthn (passkeys) ; PRF pour le coffre du wallet | Voir §4 |
| Principe | **Aucune cryptographie maison** : uniquement des bibliothèques établies | |

## 3. Création du wallet (pas à pas)

1. Le contact de confiance ouvre sa console, crée son identité (phrase affichée une fois) et **envoie sa clé publique** au client.
2. Le client se connecte à la banque, onglet Crypto. Un verrou exige d'abord sa biométrie (§4).
3. Il saisit nom + clé publique du contact, puis « Create my wallet with the Client Wallet ».
4. Le site vérifie la clé du contact **avant** d'ouvrir le wallet (pas de seed créée pour rien), récupère la clé publique de Swissquote.
5. Il ouvre la fenêtre du Client Wallet (`window.open` + `postMessage`, seule l'origine du wallet est écoutée). Le wallet **génère la seed BIP39** (`@scure/bip39`) sur l'appareil, l'affiche **une seule fois**, le client confirme l'avoir notée.
6. La seed est **chiffrée par la biométrie** (§4). Seule la **clé publique de compte** (xpub, chemin `48'/1'/0'/2'` en testnet) retourne au site.
7. Le site compile la politique Miniscript, calcule l'adresse, **enregistre le compte chez Swissquote** (clés publiques seulement), puis demande au wallet de sauver la politique.
8. Une phrase donne **deux comptes** : Bitcoin (chemin ci-dessus) et Ethereum (`m/44'/60'/0'/0/0`, via viem).

Dérogation à la création (ajoutée) : si le compte n'a pas encore de passkey bancaire, elle est enregistrée automatiquement juste après l'enregistrement du compte. Un refus ne bloque pas la création.

## 4. Biométrie : deux passkeys différentes (piège classique)

| | Passkey **bancaire** | Passkey **du wallet** |
| --- | --- | --- |
| Où | Vérifiée côté serveur par bank-mock (`@simplewebauthn/server`) | Locale à l'appareil, rien n'est vérifié par un serveur |
| À quoi ça sert | Déverrouiller l'onglet Crypto (étape 38), confirmer les montants > 0,2 BTC (step-up) | Déchiffrer la seed pour signer |
| Mécanisme | Assertion WebAuthn, `userVerification: required`, déverrouillage expirant après 10 min d'inactivité | Extension WebAuthn **PRF** : la passkey rend un secret de 32 octets → HKDF-SHA256 → clé AES-256-GCM qui chiffre la seed |
| Si elle manque | Crypto verrouillée | Impossible de signer, la seed chiffrée reste inutilisable |

Précisions à ne pas oublier :
- `credentialId` et `prfSalt` sont publics ; sans l'authentificateur, ils ne donnent aucun secret.
- Le wallet exige deux gestes biométriques à la création (créer la passkey, puis l'utiliser) et un à chaque signature.
- **Force limitée** : dépend de l'appareil et du navigateur. En production : secure element (hardware wallet / enclave téléphone). Implémentation de référence, pas un produit.
- L'ancien format PIN (scrypt, 6 chiffres) n'existe plus que pour migrer ; un PIN à 6 chiffres résiste mal à une recherche exhaustive hors-ligne.
- **Non exécuté en navigateur réel pendant l'étape 37** : le test serveur remplace la sortie PRF par 32 octets aléatoires. À dire honnêtement si on te demande ce qui a été testé avec un vrai Touch ID.

## 5. Le compte Bitcoin

Politique (écrite dans le script, appliquée par le consensus) :

```
or( pk(CLIENT), and( pk(SWISSQUOTE), and( pk(CONTACT), older(D) ) ) )     P2WSH
```
Forme compilée : `wsh(andor(pk(S), and_v(v:pk(T), older(D)), pk(C)))`.

- **Chemin client** : la clé du client seule, à tout moment, sans Swissquote, sans contact.
- **Chemin recovery** : signatures Swissquote **et** contact **et** pièce non déplacée depuis D blocs (`older(D)`, BIP68/112).
- D = 6 blocs en démo ; cible production ≈ 26 000 blocs (≈ 6 mois). C'est une hypothèse, un paramètre.
- Le délai est **par pièce (UTXO)**. Toute dépense remet à zéro les pièces déplacées ; le bouton **Refresh** déplace toutes les pièces d'un coup vers une adresse du même compte.

## 6. La recovery Bitcoin (le cœur de la démo)

Situation : le client a perdu l'appareil (« Simulate losing this device » dans le Client Wallet).

1. Sur un autre navigateur, il se reconnecte et clique « I lost my wallet ». **Re-KYC mocké** (nom, date de naissance, OTP d'un dossier de test). Cela ouvre côté serveur un niveau `recovery` : accès aux comptes et au relais, mais **ni retrait du compte crypto Swissquote, ni preuve de propriété** (étape 38).
2. Il crée un **nouveau wallet** (nouvelle seed, nouvelle clé client).
3. Le site construit un **PSBT de recovery** : toutes les pièces de l'ancien compte → un compte du **même client** avec la **nouvelle clé client** et les **mêmes guardians**.
4. **bank-mock signe** après contrôles (couche secondaire) : recovery uniquement, entrées d'un compte du client, sorties vers un autre compte du même client. Une alerte part immédiatement vers l'ancien appareil.
5. Le client envoie un **lien** (relais bank-mock, `?req=…`) au contact. Celui-ci voit le PSBT décodé dans sa console, signe, la signature revient. bank-mock n'accepte qu'une version signée de **la même transaction**. L'échange manuel du PSBT reste possible si Swissquote est arrêtée.
6. Le site combine, finalise, **diffuse**. Avant D : le nœud **rejette** (`non-BIP68-final`, observé sur regtest et sur signet réel). Après D : accepté (`mine 6` sur regtest).
7. La nouvelle clé dépense seule les fonds récupérés ; l'ancienne ne signe plus aucune entrée (**testé**, étape 14).

**Qui gagne si client et guardians dépensent en même temps après D ?** Le premier confirmé (consensus). Avec la politique du mempool de Bitcoin Core 29 (full RBF), une dépense du client avec des frais plus élevés remplace une recovery non minée. Limite : c'est la politique mempool, pas du consensus ; un mineur peut inclure la recovery, et les guardians peuvent surenchérir.

## 7. La recovery Ethereum (différente par nature)

- Compte : un **Safe** dont le propriétaire est la clé EOA du client, plus le **module de recovery de Candide** (guardians = Swissquote et contact, **seuil 2**).
- Contrairement à Bitcoin, rien ne s'ouvre automatiquement : Swissquote **et** le contact doivent **activement démarrer** une recovery en signant en **EIP-712** (relayées par bank-mock). Le contrat attend alors un délai (3 min en démo, cible 7 ou 14 jours), puis la finalisation remplace le propriétaire.
- **Le propriétaire peut annuler** pendant le délai (`cancelRecovery` + `invalidateNonce`). C'est ce que le client doit surveiller : alertes via Swissquote, donc dépendantes de Swissquote.
- Frais payés par le **paymaster public de Candide** (le client n'a pas d'ETH). Swissquote ne paie rien et n'a **aucun contrôle d'abus** : à dire, c'est une limite assumée.
- Testé sur la vraie Sepolia (étapes 16 à 19) : une seule signature refusée (`SM: confirmed signatures less than threshold`), finalisation trop tôt refusée (`SM: recovery period still pending`), ancienne clé refusée après recovery.

## 8. Ce que chacun peut faire

| Acteur | Seul | Avec un autre |
| --- | --- | --- |
| Client | Dépenser à tout moment (BTC et ETH), même Swissquote arrêtée (**testé**, attaque 3) | — |
| Swissquote | **Rien** (rejeté par le consensus, même après D) | + contact : BTC après D sur les pièces non déplacées ; ETH après démarrage non annulé + délai |
| Contact de confiance | Rien | idem |
| Voleur de la seed | **Tout dépenser** par le chemin client (même faiblesse qu'une seed classique) | — |

## 9. Questions pièges et réponses honnêtes

**« Alors Swissquote détient bien vos fonds ? »** Non : seule, jamais. Avec le contact qu'elle ne choisit pas, seulement après D sur des pièces inactives, et le client l'empêche en restant actif. C'est la **zone grise** que le sujet nomme ; on l'argumente (plus proche d'un logiciel que d'une garde), on ne la nie pas. À confirmer avec un juriste.

**« Pourquoi pas du MPC 2-sur-3 ? »** Avec un MPC, Swissquote et le partenaire signent **tout de suite** : le délai n'est qu'une règle logicielle qu'ils peuvent contourner. Ici le délai est appliqué par la chaîne. Contre le vol d'un seul appareil, MPC est meilleur que nous : on le dit.

**« Pourquoi pas Shamir / seed seule / compte custodial ? »** Shamir : Swissquote + partenaire reconstituent la seed sans délai. Seed seule : seed perdue = fonds perdus. Custodial : c'est l'offre actuelle, le client n'y gagne rien. Détail : `docs/custody-models.md`.

**« Et si le contact perd sa clé ? »** La recovery devient impossible tant que le client ne l'a pas remplacé. Le **changement de contact** est implémenté (étape 43) : le client déplace toutes ses pièces vers une nouvelle règle incluant le nouveau contact, et le délai repart de zéro. Les pièces non déplacées restent sous l'ancienne règle.

**« Et si Swissquote disparaît ET que le client perd sa clé ? »** Fonds perdus. Limite acceptée (identique aux modèles à seuil).

**« Que se passe-t-il si Swissquote est hors ligne ? »** Le client dépense seul. Il y a aussi un **kit de sortie** dans le Client Wallet (étape 41) : il lit la chaîne lui-même et envoie tous les coins par le chemin client, sans bank-mock.

**« Le re-KYC est-il réel ? »** Non, **mocké** (dossiers de test). C'est une couche en plus ; la défense réelle est on-chain. Un re-KYC vraiment contourné n'est **pas testé**.

**« Et si le site de la banque est piraté ? »** Il ne détient aucune clé. Il peut demander au wallet de signer une transaction malveillante, mais le wallet **décode lui-même** la transaction et affiche chemin, sorties, montants, frais ; pour Ethereum il **refuse** tout appel qu'il ne sait pas expliquer. Le wallet refuse aussi de signer le chemin recovery (cette voie n'utilise pas sa clé). Limite : l'utilisateur doit vraiment lire l'écran (non testé auprès de vrais utilisateurs).

**« Quelle protection pour les gros montants ? »** Au-delà de 0,2 BTC : réauthentification par passkey auprès de Swissquote (journal + alerte), puis dans le wallet biométrie **et** ressaisie des 6 derniers caractères de l'adresse (contrôle fait par le serveur du wallet). La réauth Swissquote **n'est pas bloquante** si Swissquote est injoignable, sinon le client ne pourrait plus dépenser seul. Sur Ethereum : **pas** de confirmation renforcée par montant. Sur Bitcoin, la chaîne ne connaît pas les montants dans le chemin client.

**« À quoi sert la preuve de propriété ? »** Travel Rule : Swissquote n'envoie du crypto du compte custody qu'à une adresse prouvée. Challenge à usage unique signé par la clé client (BIP-322 « simple », `bip322-js`, vérification stricte). **Limite** : ce n'est pas une signature de l'adresse P2WSH elle-même (la lib ne gère pas P2WSH) ; le lien clé → adresse repose sur le descripteur connu de Swissquote.

**« Pourquoi Miniscript et P2WSH, pas Taproot ? »** Miniscript est compilé par l'outil de référence, pas écrit à la main. P2WSH révèle la politique (donc l'existence du délai) à chaque dépense. Taproot (`tr(CLIENT, {and(SWISSQUOTE, TRUSTED, older(D))})`) le cacherait : en **perspective**, non implémenté.

**« Quels wallets externes signent ce script ? »** Bitcoin Core (**vérifié**, `walletprocesspsbt`). Liana et certains hardware wallets : annoncés, **non vérifiés**. Sparrow : probablement non (issues #1700, #1757), non vérifié en l'exécutant.

**« Est-ce vraiment sur Bitcoin ? »** Regtest en local (bitcoind 29, Docker) pour la démo ; signet réel avec transactions publiques (dépense client `9203045e…`, recovery acceptée à D `d26b94de…`, rejetée avant D). Pas de mainnet.

**« Le gasless Ethereum, qui paie ? »** Le paymaster public de Candide (tiers). Swissquote ne paie pas et n'a aucune politique d'abus. Dépendance à des tiers : bundler, paymaster, nœud Sepolia public (lectures obsolètes déjà rencontrées, corrigées).

**« Module Ethereum v0.0.1 : risques ? »** Oui : retirer un guardian n'annule pas sa recovery en cours ; les nouveaux propriétaires ne sont pas validés avant finalisation (audit M-01). Corrigé dans la 0.2.0, **non déployée** aux adresses du SDK. Notre flux appelle `cancelRecovery` + `invalidateNonce` après chaque recovery.

**« Que reste-t-il de mocké ? »** Login bancaire, comptes CHF, re-KYC, taux BTC/CHF, email d'alerte (simulé), ledger du compte custody (mais les transferts on-chain sont réels sur regtest). Le Client Wallet est une implémentation de référence, pas un produit.

## 10. À ne pas affirmer

- Que la biométrie PRF a été validée avec un vrai Touch ID dans les tests automatisés (non : étape 37).
- Que les parcours navigateur des étapes 25 à 36 ont été retestés (l'étape 37 dit que non).
- Que la protection d'un wallet volé est forte : une seed volée = fonds volés, atténué seulement par le chiffrement biométrique.
- Que des alertes push réelles existent : information simulée, dépendante de Swissquote.
- Que l'activation automatique de la passkey à la création a été testée en navigateur : seul `tsc` est passé (`docs/validation/etape-38-passkey-auto.md`).
