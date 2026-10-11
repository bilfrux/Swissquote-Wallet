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


---

# Partie 2 — Les technologies en détail

Convention : **[projet]** = ce qui est dans le code et prouvé dans `docs/validation/`. **[général]** = connaissance générale de la technologie, *non exécutée ici* : à présenter comme telle, pas comme un résultat du projet. **[option]** = piste de conception non implémentée.

## A. Miniscript (la brique Bitcoin)

### Ce que c'est
Un sous-ensemble structuré du Script Bitcoin, avec une syntaxe composable. Contrairement au Script brut, on peut **analyser** un script Miniscript par machine : savoir exactement quelles clés et quelles conditions le satisfont, calculer la taille du témoin, vérifier qu'il n'est pas malléable, garantir qu'il respecte les limites de standardité. Il vient avec une couche **Policy** (langage de haut niveau, ex. `and(pk(A), older(100))`) que le compilateur de référence (celui de Pieter Wuille / sipa) traduit en Miniscript optimisé. **[général]**

### Les briques disponibles **[général]**
| Fragment | Ce qu'il exprime |
| --- | --- |
| `pk(K)` | Une signature de la clé K |
| `multi(k, K1…Kn)` | k signatures parmi n (sous `wsh`) |
| `older(n)` | Verrou **relatif** (BIP68/112, `OP_CHECKSEQUENCEVERIFY`) : la pièce doit avoir au moins n blocs (ou n×512 s) |
| `after(n)` | Verrou **absolu** (BIP65, `OP_CHECKLOCKTIMEVERIFY`) : pas avant le bloc ou la date n |
| `sha256(h)`, `hash160(h)`… | Il faut révéler une pré-image (verrou par hachage) |
| `and`, `or`, `andor(X,Y,Z)`, `thresh(k, …)` | Combinaisons logiques ; `andor(X,Y,Z)` = (X et Y) ou Z |

### Dans notre projet **[projet]**
Politique : `or(pk(CLIENT), and(pk(SWISSQUOTE), and(pk(CONTACT), older(D))))`, compilée en `wsh(andor(pk(S), and_v(v:pk(T), older(D)), pk(C)))`. Lecture de la forme compilée : « (Swissquote **et** contact **et** pièce vieille de D blocs) **ou** client ». Deux chemins de dépense, et le nœud Bitcoin refuse tout le reste.

Pourquoi ce choix : le délai D n'est pas une promesse de notre logiciel, c'est une règle de **consensus**. Preuve : sur signet réel, la recovery avant D est rejetée par `non-BIP68-final`.

### Ce que Miniscript permet de combiner (pour répondre aux « et si… ») **[général]** / **[option]**
| Variante | Politique | Effet | Compromis |
| --- | --- | --- | --- |
| **Héritage** | `or(pk(OWNER), and(pk(HEIR), older(n)))` | L'héritier peut dépenser après n blocs d'inactivité | L'héritier **seul** a un pouvoir : c'est de la garde partagée, pas du logiciel |
| **Multisig dégradant** | `thresh` + `older` (ex. 3-sur-3, puis 2-sur-3 après un délai, puis 1-sur-3) | Le seuil baisse avec le temps | Plus complexe à expliquer et à tester |
| **Coffre (vault)** | Chemin « froid » immédiat et chemin « chaud » avec délai | Le délai laisse le temps de réagir | Sans *covenants*, Bitcoin ne peut pas imposer la destination |
| **Verrou à date fixe** | `after(date)` | Fonds inaccessibles avant une date | Pas de reset par l'activité (le verrou est absolu) |
| **Échange atomique / HTLC** | `sha256` + `older`/`after` | Paiements conditionnels, base des canaux Lightning | Hors sujet ici |
| **Notre extension possible** | Ajouter `and(pk(CONTACT), older(D2))` avec D2 ≫ D | Récupération si Swissquote disparaît **et** le client perd sa clé | Le contact **seul** gagne un pouvoir : on renforce la zone grise de custody **[option]** |

### Limites réelles (à connaître par cœur)
- **Aucune restriction de destination ni de montant** : un script Bitcoin classique ne voit pas les sorties. C'est pourquoi la zone grise existe : Swissquote + contact peuvent envoyer les pièces *n'importe où* après D. Réponse honnête : « Bitcoin ne peut pas, aujourd'hui, restreindre la destination sans *covenants* (non activés) ».
- **`older(D)` est relatif à la confirmation de chaque pièce** : le délai est *par pièce*. D'où le bouton **Refresh** : déplacer une pièce remet son compteur à zéro. C'est aussi ce qui fait que l'activité du client protège ses fonds.
- **Plafond de BIP68 : 65 535 blocs** (valeur sur 16 bits, ≈ 455 jours) **[général]**. Notre cible de 26 000 blocs (≈ 6 mois) rentre dedans, mais un délai de 2 ans ne rentrerait pas.
- **P2WSH (SegWit v0)** : la politique est révélée à chaque dépense (vie privée). **Taproot** la cacherait mais n'est pas implémenté **[projet]**. Et les bibliothèques de signature de messages (`bip322-js`) ne gèrent pas P2WSH.
- **Peu de wallets externes** savent signer un Miniscript avec délai : Bitcoin Core vérifié ; Liana et certains matériels annoncés, non vérifiés.

### Question piège type
*« Pourquoi pas un simple multisig 2-sur-3 ? »* → Un 2-sur-3 laisse Swissquote + partenaire dépenser **immédiatement** ; le délai ne serait qu'une règle logicielle. Avec `older(D)`, c'est la chaîne qui l'impose, et le client garde un chemin à lui seul.

## B. Safe + module de recovery de Candide (la brique Ethereum)

### Ce que c'est
Un **Safe** est un smart-contract wallet : un compte Ethereum qui est un contrat, avec une liste de propriétaires et un seuil de signatures. Il est extensible par des **modules** (code autorisé à agir au nom du Safe) et des **guards** (vérifications avant/après chaque transaction). **[général]**

Le **module de recovery de Candide** ajoute des *guardians* : un ensemble d'adresses qui, à un seuil donné, peuvent lancer une recovery. Le contrat applique ensuite un **délai** avant que le nouveau propriétaire prenne la place. Le propriétaire actuel peut **annuler** pendant ce délai. **[projet]**

### Dans notre projet **[projet]**
- Propriétaire : l'EOA du client, dérivée de la même phrase que Bitcoin (`m/44'/60'/0'/0/0`).
- Guardians : Swissquote et le contact. **Seuil 2**.
- Les signatures des guardians sont en **EIP-712** (message typé, avec domaine = chaîne + adresse du module, donc non rejouables ailleurs), relayées par bank-mock.
- Démo : délai de 3 minutes ; cible : 7 ou 14 jours. Module **v0.0.1**, sur **Sepolia**.
- Après chaque recovery, notre flux appelle `cancelRecovery` et `invalidateNonce` pour éteindre toute signature résiduelle.

### Ce que Safe permet de combiner **[général]**
| Combinaison | Effet | Ici ? |
| --- | --- | --- |
| Plusieurs propriétaires + seuil | Multisig classique sur Ethereum | Non (un seul propriétaire) |
| **Module de recovery** | Récupération par guardians avec délai et annulation | **Oui** |
| **Module de plafond de dépense** (allowance) | Limite de montant par période, appliquée **on-chain** | Non : c'est la contre-mesure possible au manque de limite par montant sur Ethereum **[option]** |
| **Guard** | Liste blanche de contrats/adresses, sanctions, simulation avant exécution | Non : serait la base d'une « interaction dApp conforme » **[option]** |
| **Clés de session** | Droits limités et temporaires pour une application | Non |
| **Passkey comme signataire** | Le propriétaire est une passkey (P-256) vérifiée par un contrat ; la vérification est bon marché là où la précompilée secp256r1 existe (RIP-7212) | Non : ici le propriétaire est une clé ECDSA dérivée de la seed |

### Différence de fond avec Bitcoin (à savoir expliquer)
| | Bitcoin | Ethereum |
| --- | --- | --- |
| Déclenchement | **Automatique** : le chemin s'ouvre tout seul pour les pièces inactives | **Actif** : Swissquote et le contact doivent démarrer la recovery |
| Ce que fait le client | Rester actif / Refresh | Surveiller et annuler |
| Portée | Par pièce (UTXO) | Tout le compte d'un coup |
| Qui impose la règle | Le consensus Bitcoin | Le contrat du module |

### Limites **[projet]**
- Module **v0.0.1** : retirer un guardian n'annule pas sa recovery en cours ; le nouveau propriétaire n'est pas validé avant finalisation (audit M-01). Les correctifs existent en 0.2.0, mais ne sont **pas déployés** aux adresses du SDK.
- Un client **inattentif** est exposé : il doit voir la recovery hostile dans le délai ; les alertes dépendent de Swissquote.
- Pas de limite par montant sur Ethereum (Bitcoin a la confirmation renforcée au-dessus de 0,2 BTC).
- Annulation depuis l'interface : **non testée** par un parcours automatisé.

## C. ERC-4337, bundler, paymaster, Candide (transactions sans ETH)

- **Principe** : au lieu d'une transaction classique, le client signe une *UserOperation* ; un **bundler** les regroupe et les envoie à un contrat unique (*EntryPoint*) ; un **paymaster** peut payer le gaz à la place de l'utilisateur. **[général]**
- **Chez nous** : le paymaster public de Candide sponsorise les opérations ; le client n'a pas d'ETH. Bibliothèques : `abstractionkit` (SDK Candide) et `viem`. **[projet]**
- **Combinaison** : Safe (compte) + module 4337 (accepte les UserOperations) + paymaster (gaz) + module de recovery (récupération).
- **Limites** : le paymaster et le bundler sont des **tiers**. Swissquote ne paie pas et n'a aucune politique d'abus. Sans paymaster, il faut payer le gaz en ETH ou passer par un autre bundler : **non testé**. Les nœuds Sepolia publics ont renvoyé des états obsolètes : corrigé en lisant au bloc d'inclusion.
- **Question piège** : *« Si Candide disparaît ? »* → le propriétaire garde sa clé et le Safe reste un contrat ; on peut utiliser un autre bundler ou une transaction normale payée en ETH (raisonnement, pas testé).

## D. Seed et dérivation : BIP39, BIP32, BIP44/48

- **BIP39** : la phrase de 12/24 mots encode l'entropie ; `@scure/bip39` la génère. **[projet]**
- **BIP32** : à partir de la seed, on dérive un arbre de clés. Les dérivations **durcies** (apostrophe) ne permettent pas de remonter ; les non durcies permettent de calculer des clés publiques filles depuis une clé publique étendue (**xpub**). **[général]**
- **BIP44** (comptes simples, utilisé pour Ethereum `m/44'/60'/0'/0/0`) et **BIP48** (comptes multi-clés/script ; `48'/1'/0'/2'` = testnet, script P2WSH) **[projet pour les chemins observés dans l'interface]**.
- **Pourquoi on envoie un xpub à Swissquote** : elle peut calculer toutes les adresses et toutes les clés publiques du compte (donc vérifier la preuve de propriété et surveiller les pièces) **sans pouvoir dépenser**. Le niveau du compte est durci, donc l'xpub ne révèle rien au-dessus.
- **Piège** : *« Une seule phrase pour deux chaînes, c'est risqué ? »* → oui, c'est un point de défaillance unique pour le chemin client : la phrase volée ouvre BTC et ETH. Atténuation : chiffrement biométrique de la phrase sur l'appareil. Les recoveries sont, elles, indépendantes entre chaînes.

## E. PSBT (BIP174), descripteurs, sighash

- **PSBT** : format standard d'une transaction **partiellement signée**. Rôles : créateur, mise à jour, signataire, combineur, finaliseur, extracteur. **[général]**
- **Chez nous** : l'appli (sans clé) crée et met à jour ; le Client Wallet, Swissquote et la console du contact **signent chacun séparément** ; l'appli **combine, finalise et diffuse**. C'est ce qui permet qu'**aucune partie ne voit la clé d'une autre**. **[projet]**
- **Descripteurs** (`@bitcoinerlab/descriptors-scure`) : décrivent scripts + clés + chemins, donc permettent de retrouver les adresses et de savoir quel chemin de dépense signer. **[projet]**
- **Sighash BIP143** (SegWit v0) : la signature couvre les montants des entrées et le script du compte, donc elle ne se rejoue pas sur un autre compte. **[projet, via la lib]**
- **Combinaison** : Miniscript décrit *ce qui est exigé* ; le PSBT transporte *les signatures qui l'atteignent* ; le descripteur permet à chacun de vérifier ce qu'il signe.
- **Limite** : un signataire qui ne décode pas la transaction signe à l'aveugle. C'est pourquoi le Client Wallet décode lui-même le PSBT et affiche chemin, sorties et frais.

## F. WebAuthn, passkeys et extension PRF

- **WebAuthn / FIDO2** : l'authentificateur (Touch ID, Face ID, Windows Hello, clé de sécurité) crée une paire de clés liée à un domaine (*rpId*) ; la clé privée ne sort pas. La preuve de présence/vérification de l'utilisateur est locale. **[général]**
- **Usage 1 — authentification serveur** : bank-mock envoie un *challenge*, le navigateur le fait signer, `@simplewebauthn/server` vérifie. Sert à déverrouiller la partie crypto et aux montants élevés. **[projet]**
- **Usage 2 — secret de chiffrement local (PRF)** : l'extension PRF rend un secret de 32 octets, toujours le même pour une passkey et un sel donnés. On le passe dans HKDF puis AES-256-GCM pour chiffrer la phrase. **Aucune signature n'est vérifiée** : sans le bon secret, le déchiffrement échoue. **[projet]**
- **Combinaison** : la même technologie (passkey) sert à deux rôles indépendants. Compromettre l'un (session bancaire) ne donne pas l'autre (déchiffrement local).
- **Limites** :
  - Le support de PRF dépend du navigateur et de l'authentificateur ; le wallet refuse de créer un wallet si PRF n'est pas disponible.
  - Une passkey **synchronisée** (trousseau cloud) peut exister sur plusieurs appareils : le secret PRF peut être reproduit ailleurs, mais les données chiffrées restent sur l'appareil. **[général, non testé]**
  - La biométrie PRF n'a **pas** été validée par un test automatisé avec un vrai authentificateur (l'étape 37 simule le secret). Seul un essai manuel le montre.
  - Protection d'un appareil volé et déverrouillé : voir §9 de la partie 1.

## G. Chiffrement du coffre : HKDF, AES-256-GCM, scrypt (`node:crypto`)

- **HKDF-SHA256** dérive une clé AES à partir du secret PRF et du sel. **AES-256-GCM** chiffre la phrase *et* l'authentifie (une altération du fichier fait échouer le déchiffrement). **[général]**
- **scrypt** (ancien format PIN) est volontairement coûteux, mais un PIN à 6 chiffres n'a que 10⁶ possibilités : résistant en ligne (60 s de blocage après 5 erreurs), **faible hors ligne** si le fichier est volé. C'est pourquoi le PIN a été abandonné pour les nouveaux wallets.
- Aucune de ces primitives n'est écrite dans le projet : appel à `node:crypto`.

## H. BIP-322, preuve de propriété et Travel Rule

- **BIP-322** : signature de message générique, y compris pour des adresses SegWit, contrairement à l'ancien format BIP-137. Variante utilisée : « simple ». **[projet]**
- **Chez nous** : Swissquote émet un challenge à usage unique (10 min). Le Client Wallet le signe avec la clé client de l'index i. Swissquote **recalcule** cette clé à partir de l'xpub enregistré et vérifie en mode strict.
- **Ce que ça prouve** : le client détient la clé client à l'index i. **Ce que ça ne prouve pas** : une signature de l'adresse P2WSH elle-même (non supporté par la lib), ni l'identité de la personne (liée seulement à la session bancaire).
- **Travel Rule** (traçabilité des transferts de crypto entre prestataires et vers des portefeuilles privés) : ici, retrait uniquement vers une adresse prouvée, dépôt crédité seulement si toutes les entrées viennent d'un wallet enregistré. Ledger mocké ; transferts on-chain réels sur regtest ; pas d'analyse de chaîne. Détail : `docs/travel-rule.md`.

## I. Réseaux et accès à la chaîne : bitcoind, regtest, signet, Esplora, Sepolia

| Élément | Ce que c'est | Pourquoi on l'utilise |
| --- | --- | --- |
| **bitcoind 29** en **regtest** | Nœud Bitcoin Core avec une chaîne privée où l'on mine à la demande | Démo reproductible : `mine 6` fait passer D en une seconde |
| **Signet** | Réseau de test public dont les blocs sont signés par un signataire fixe, avec des pièces gratuites par faucet | Preuve sur un vrai réseau (les rejets `non-BIP68-final` sont réels) |
| **Esplora** (blockstream.info) | API REST qui lit la chaîne | Lire pièces, historique, frais et diffuser sans nœud local en signet |
| **Sepolia** | Testnet public d'Ethereum | Preuve sur un vrai réseau pour Safe + Candide |
| **Limite** | Pas de mainnet ; les délais de démo (6 blocs, 3 min) ne sont pas ceux de production | À dire clairement |

## J. Isolation entre applications : origines, `postMessage`, processus séparés

- Le site banque et le Client Wallet sont **deux origines et deux processus** (ports différents, stockage séparé). Le navigateur applique la politique de **même origine** : le site banque ne peut pas lire le stockage du wallet. **[général]**
- Le site ouvre la fenêtre du wallet et lui envoie une demande par `postMessage`, en n'écoutant que l'origine du wallet. L'API du wallet n'a pas de CORS et refuse toute requête d'une autre origine avant exécution. **[projet, étape 6 test 6-7]**
- **Combinaison** avec PSBT : ce que le site banque envoie au wallet, ce sont des demandes ; ce qu'il reçoit, ce sont des clés publiques et des signatures. Jamais une clé privée.
- **Limite** : un navigateur compromis sur l'appareil qui héberge les deux contourne tout cela. D'où la recommandation d'un secure element en production.

## K. Outils de développement et de test

- **React 19 / Vite 8 / TypeScript** : interface. **Node 24** avec `node:sqlite` (module expérimental, à signaler) : stockage de bank-mock. **`playwright-core`** : parcours navigateur de test. **Docker** : bitcoind regtest.
- Chaque affirmation du README renvoie à une exécution enregistrée dans `docs/validation/` (commande + sortie). Quand un test n'a pas été exécuté, la doc l'écrit : c'est un argument de crédibilité.

## L. Les combinaisons qui font l'originalité du projet

1. **Miniscript + PSBT + trois signataires indépendants** : chacun signe séparément un même PSBT, aucune partie ne reconstitue de secret (contraire de Shamir).
2. **Miniscript `older(D)` + bouton Refresh** : le client contrôle le délai par son activité ; la banque n'a aucun levier.
3. **Safe + module de recovery + EIP-712 + relais bank-mock** : mêmes acteurs que Bitcoin, sémantique inverse (démarrage actif, annulation par le propriétaire).
4. **Une seed, deux comptes, deux mécanismes de recovery** : un seul secret à garder, mais des règles propres à chaque chaîne.
5. **Passkey bancaire + passkey du wallet (PRF)** : deux usages distincts de WebAuthn, pour verrouiller l'accès crypto côté serveur *et* le déchiffrement côté appareil.
6. **Défense en profondeur** : bank-mock vérifie le re-KYC et la destination (couche secondaire), le wallet décode ce qu'il signe, mais la défense réelle est dans le script et dans le contrat.

## M. Réponses courtes aux questions « technologie par technologie »

| Question | Réponse en une phrase |
| --- | --- |
| Pourquoi Miniscript et pas du Script à la main ? | On peut prouver par analyse que chaque chemin se satisfait, qu'il n'est pas malléable, et le compilateur est celui de référence. |
| Pourquoi pas Taproot ? | Non fait dans le temps imparti : c'est la perspective naturelle (vie privée, frais). Point resté à vérifier dans le README : la clé Taproot dépend de l'arbre de scripts, et `bip322-js` n'annonce que la dépense par la clé. Je n'ai pas testé. |
| Pourquoi un Safe plutôt qu'un script ? | Ethereum n'a pas de verrou relatif natif au niveau de l'UTXO ; la règle doit vivre dans un contrat (module). |
| Pourquoi le même seed pour BTC et ETH ? | Un seul secret à protéger ; en contrepartie, un point de défaillance unique pour le chemin client. |
| Pourquoi des passkeys ? | Standard établi, vérification utilisateur matérielle, secret jamais exporté ; PRF fournit une clé de chiffrement sans mot de passe. |
| Qu'est-ce qui est réel ? | Chaîne, scripts, signatures, WebAuthn, contrats : réels. Banque, re-KYC, email, ledger de custody : mockés. |
| Qu'est-ce qui manque pour la production ? | Secure element, mainnet, Taproot, délai long, politique de paymaster, vrai KYC, audit, module Safe corrigé. |
