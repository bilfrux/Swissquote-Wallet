# Spec - Wallet self-custody Swissquote

Oct 10, 2026 · @Master

## Objectif et périmètre

Le projet livre un wallet self-custody EVM intégré à une appli bancaire simulée : le client signe seul, et la recovery exige trois guardians dont Swissquote, qui ne peut jamais agir seule. La démo suit l'histoire exigée par le document de la track : créer un wallet, se connecter et signer, tout perdre, récupérer l'accès.

| Élément | Statut | Détail |
| --- | --- | --- |
| Smart account, passkey, signature, transfert USDC testnet | Réel | Safe + passkey, une seule chaîne EVM testnet |
| Recovery 2-sur-3, délai, révocation | Réel | Module de recovery existant (Candide) ; à défaut, petit module Safe écrit par-dessus OpenZeppelin, jamais de cryptographie maison |
| Backend Swissquote (guardian, re-KYC) | Mocké, processus séparé | Propre stockage, la clé du guardian n'est jamais dans l'app cliente |
| Appli bancaire, solde CHF, KYC | Mocké | Documenté dans le README |
| Simulation lisible avant signature | Réel | Côté client, indépendante de Swissquote |
| Gasless | Réel si le temps le permet | Paymaster branché dès l'étape 2, bonus de 10 points |
| Parcours vault DeFi | Réel si le temps le permet | Sorti du périmètre en solo, perspective du pitch |
| Test de vie du tiers | Simulé | Message périodique côté backend |
| Succession | Même chemin que la perte totale | Délai long, pas de mécanisme séparé |

Hors périmètre : Bitcoin et Solana (limite EVM assumée), liste blanche qui bloque, achat et vente simulés, reconnaissance faciale comme clé, circuit zk.

## Modèle de custody et de recovery

Le client signe seul avec sa passkey, et la recovery remplace la clé du propriétaire grâce à deux guardians sur trois, sans jamais reconstituer de seed phrase. Cette règle a été validée avec les juges, pour la recovery uniquement et pas pour la signature.

**Les trois guardians**

| Guardian | Ce qu'il détient | Rôle |
| --- | --- | --- |
| Client | Clé de backup distincte de la passkey quotidienne (second appareil ou YubiKey) | Prouve que le client possède encore un facteur |
| Swissquote | Clé du guardian dans un processus séparé | Revérifie l'identité (re-KYC mocké), ne signe jamais de transaction |
| Tiers de confiance | Clé de guardian, testée régulièrement, remplaçable par le client seul | Facteur choisi par le client, successeur en cas de décès |

**Les chemins de recovery**

| Situation | Qui agit | Délai |
| --- | --- | --- |
| Le client a encore sa clé de backup | Client + Swissquote, ou client + tiers | 48 h, révocable |
| Le client n'a plus rien (perte totale ou décès) | Swissquote + tiers | 30 jours, remis à zéro par tout signe de vie du client |
| Swissquote a disparu | Client + tiers | 48 h, révocable |

Le délai dépend de ce que le client possède encore, pas de ce que les parties déclarent. Des guardians qui s'associent contre lui, sans la clé de backup, tombent donc sur le chemin de 30 jours. Un client vivant qui se reconnecte annule toute procédure lancée contre lui.

**Invariants à démontrer par des tests**

1. Swissquote seule ne peut ni signer, ni lancer une recovery, ni geler les fonds.
2. Swissquote + tiers sans la clé de backup ne finalisent jamais avant 30 jours.
3. Un signe de vie du client pendant le délai annule la recovery.
4. Si le processus Swissquote est arrêté, client + tiers récupèrent quand même.
5. Aucune clé de guardian n'est stockée dans l'app cliente.

**Risque résiduel assumé :** si le client a tout perdu et que Swissquote s'associe au tiers désigné, une recovery frauduleuse reste possible. Atténuations : tiers choisi par le client et jamais affilié à Swissquote, alertes sur plusieurs canaux, délai de 30 jours visible. Le document de la track qualifie ce cas de zone grise : il faut l'argumenter, pas le nier.

**Deux conséquences de ce modèle.** Un guardian ne peut pas être remplacé par Swissquote : seul le client change son tiers. Et le choix du module doit permettre deux délais différents, sinon l'invariant 2 ne peut pas être garanti on-chain et il faut le retirer des promesses : un chemin long géré par le backend serait contournable par une Swissquote complice du tiers.

## Architecture et squelette du projet

Trois blocs communiquent : l'appli cliente, un backend Swissquote mocké dans un processus séparé, et la chaîne EVM testnet. L'appli cliente ne contient aucune clé de Swissquote, et le backend Swissquote n'a accès à aucune clé du client.

&#91;embedded content: architecture · 3 blocs, 3 acteurs externes\]

L'appli relaie ses opérations par le bundler, les guardians signent leurs demandes de recovery, et la chaîne applique seule les règles de seuil et de délai.

**Arborescence du dépôt**

```text
swissquote-wallet/
  README.md          réel vs mocké, schéma, threat model, outils d'IA
  package.json       workspaces : client, bank-mock, contracts
  .env.example       RPC, bundler, paymaster, clés de test (jamais de vraie clé)
  client/            appli web (Vite + React)
    src/bank/        banque simulée : solde CHF, écran d'accueil (mocké)
    src/wallet/      création, passkey, signature, envoi d'USDC
    src/recovery/    lancement, compte à rebours, révocation, test de vie
    src/simulation/  décodage en clair des transactions et des demandes
    src/lib/         clients viem et AbstractionKit
  bank-mock/         processus séparé, port propre
    src/server.ts    endpoints : identité mockée, signature du guardian
    src/guardian.ts  clé du guardian Swissquote
    src/liveness.ts  test de vie du tiers (simulé)
    data/            stockage propre (SQLite), jamais lu par le client
  contracts/         module de recovery minimal (plan B), tests Foundry et script de déploiement
  scripts/           déploiement de test, réinitialisation de la démo
  tests/             invariants de custody et attaques, en une commande
  docs/              schéma, threat model, captures de validation
```

**Pile technique**

| Brique | Rôle | À vérifier |
| --- | --- | --- |
| AbstractionKit (Candide) | Safe, module de recovery, UserOps | Seuil 2 sur 3, annulation, délais, testnet |
| viem | Lecture de la chaîne, simulation, encodage | Support WebAuthn |
| Module passkey (Rhinestone, viem ou permissionless.js) | Signature par passkey | Compatibilité avec Safe et le module de recovery |
| @simplewebauthn/browser | Création et usage de la passkey dans le navigateur | Compatibilité avec le flux de signature du Safe |
| Bundler et paymaster (Candide ou Pimlico) | Envoi des UserOps et gasless | Support du testnet, clé d'API |
| Vite + React, Node + SQLite | Client et backend mocké | Aucune clé de Swissquote dans le bundle client |
| OpenZeppelin + Foundry ou Hardhat | Module de recovery minimal (plan B), tests d'invariants | Écrit seulement si l'étape 0 échoue |

## Étapes de construction

On construit dans cet ordre, et on ne passe à l'étape suivante que si la validation de la précédente est observée. Deux portes arrêtent tout bonus : la porte A (étape 2) et surtout la porte B (étape 5), car le document n'accorde aucun point bonus tant que créer, signer et récupérer ne marche pas de bout en bout.

| N° | Étape | Livrable | Validation (à observer, pas à supposer) |
| --- | --- | --- | --- |
| 0 | Test de faisabilité, 1 à 2 h maximum | Safe sur testnet avec le module de recovery de Candide, plusieurs instances du module à délais différents, une recovery lancée puis annulée, puis une recovery vers une nouvelle passkey | Seuil 2-sur-3 configurable, annulation par le propriétaire possible, délai raccourci disponible pour la démo, module déployé sur le testnet choisi (Sepolia en priorité), plusieurs instances du module à délais différents activables sur un même Safe, recovery menée jusqu'au bout vers une nouvelle passkey et pas seulement vers une EOA, et 30 minutes passées à lire le code du module |
| 1 | Squelette du projet | Dépôt, trois paquets (client, backend Swissquote, contrats de démo), variables d'environnement, wallet de déploiement de test | `npm install` et lancement des deux processus sans erreur, aucune clé réelle dans le dépôt |
| 2 | Passkey + smart account + transfert | Création du compte avec une passkey, adresse affichée, transfert d'USDC de test signé par passkey, avec le paymaster branché dès cette étape pour ne pas avoir à alimenter le Safe en ETH | **Porte A.** Transaction visible sur l'explorateur, signée par la passkey, et reconnexion possible après rechargement de la page |
| 3 | Backend Swissquote mocké | Processus séparé avec son propre stockage, endpoints d'identité mockée et de signature du guardian, plus une page « console guardian » séparée de l'app cliente pour le tiers | Arrêter le processus coupe le guardian sans casser la signature du client, et la recherche de la clé du guardian dans le code client ne renvoie rien |
| 4 | Recovery courte (client a son backup) | Configuration des trois guardians, écran de lancement, compte à rebours, révocation | Recovery client + Swissquote terminée avec un délai court, l'ancienne passkey ne signe plus, la nouvelle signe un transfert ; une révocation pendant le délai annule bien |
| 5 | Recovery sans Swissquote + chemin long | Client + tiers avec Swissquote arrêtée ; chemin Swissquote + tiers avec délai long | **Porte B.** Swissquote arrêtée, client + tiers récupèrent ; Swissquote + tiers sans backup ne finalisent pas avant le délai long ; un signe de vie du client l'annule |
| 6 | Simulation avant signature | Décodage en langage clair, côté client, d'un transfert, d'une approbation et d'une demande de recovery | Une approbation illimitée est signalée, une demande de recovery affiche qui la demande, la date d'application et le solde concerné |
| 7 | Panneau d'attaques et tests d'invariants | Trois boutons de démo et une suite de tests des cinq invariants | Chaque attaque se solde par un refus observable, les tests passent en une commande |
| 8 | Gestion des guardians (hors périmètre en solo) | Remplacement du tiers par le client seul, test de vie périodique simulé | Remplacement possible seulement avec la clé du client, un tiers qui ne répond pas déclenche l'alerte |
| 9 | Gasless | Déjà branché à l'étape 2 : le paymaster sponsorise le transfert d'USDC | Transfert réussi depuis un compte sans ETH, et un abus évident (montant ou fréquence) est refusé |
| 10 | Parcours DeFi (hors périmètre en solo) | Vault ERC-4626 de test, dépôt et retrait, simulation DeFi, tableau des approbations | Dépôt simulé en clair avant signature, parts reçues visibles, approbation révocable en un tap |
| 11 | Livrables | README réel vs mocké, schéma d'architecture, threat model, business case, liste des outils d'IA, vidéo de secours | Un lecteur extérieur comprend en deux minutes ce qui est réel et ce qui est mocké |

**Règles de coupe.** Les étapes 8 et 10 sortent du périmètre en solo, et le gasless passe à l'étape 2 (voir la section de révision en fin de document). Les étapes 0 à 7 et 11 ne se coupent pas, mais 6 et 7 restent minimales. Si l'étape 5 bute sur le délai long, on retire l'invariant 2 et l'attaque 2 des promesses plutôt que de les simuler dans le backend, ce qui les rendrait contournables.

**Après chaque étape :** un commit, et une capture ou un enregistrement court de la validation, qui servira de preuve dans le threat model et de secours pour la démo.

## Scénario de démo et panneau d'attaques

La démo raconte une seule histoire avec un client, puis montre trois attaques qui échouent, ce qui est le point de différenciation du projet. Les délais sont des paramètres courts pour la démo, et une vidéo de secours enregistre le parcours complet.

**L'histoire (4 à 5 minutes)**

1. Le client ouvre l'appli bancaire simulée, voit son solde, crée son wallet avec Face ID, désigne son tiers de confiance et enregistre sa clé de backup.
2. Il envoie des USDC de test. La simulation affiche en clair ce que la transaction fait avant la signature.
3. Il perd son téléphone. Sur un nouvel appareil, il lance une recovery avec sa clé de backup et la vérification d'identité de Swissquote.
4. Le compte à rebours s'affiche avec la simulation de la demande. Le délai passe, la nouvelle passkey signe un transfert, l'ancienne est refusée.
5. Si le temps le permet : dépôt dans un vault, avec simulation DeFi et tableau des approbations.

**Panneau « Attaques » : trois boutons, trois refus**

| Attaque | Ce qu'on montre | Refus attendu |
| --- | --- | --- |
| Attaquant avec téléphone et email | Il lance une recovery depuis un nouvel appareil | Il lui manque le second guardian, c'est la défense on-chain ; la vérification d'identité de Swissquote, mockée, n'est qu'une couche en plus |
| Swissquote + tiers sans le client | Ils lancent une recovery ensemble, sans la clé de backup | Ils tombent sur le chemin long, et une connexion du client l'annule |
| Swissquote disparue | On arrête le processus Swissquote en direct | Le client récupère quand même avec sa clé de backup et le tiers |

Le document de la track accorde un crédit bonus à la démo où la recovery refuse un attaquant qui a volé téléphone et email, donc la première attaque est prioritaire. La deuxième est la preuve de la zone grise sur la custody, et la troisième est exigée par le sujet (« si Swissquote disparaît ») mais rarement montrée.

**À préparer avant de monter sur scène :** un compte de démo pré-créé, un second compte pour la recovery en direct, des délais réglés à quelques minutes, la vidéo de secours, et une phrase d'accroche : « la banque construit l'outil, mais ne tient jamais les clés ».

## Threat model testé

Chaque ligne de ce tableau devient un test ou une attaque exécutée en démo, et la colonne « Résultat observé » est remplie avec une preuve (log ou capture) pendant la construction. Le document de la track demande : qui pourrait voler les fonds, qui pourrait bloquer le client, et si Swissquote, seule ou avec un partenaire, pourrait déplacer les fonds sans lui.

| Menace | Défense | Test | Résultat observé |
| --- | --- | --- | --- |
| Vol du téléphone | Passkey protégée par biométrie dans l'enclave de l'appareil | Signature impossible sans biométrie | À remplir |
| Vol du téléphone + de l'email | Re-KYC de Swissquote + second guardian + délai révocable | Attaque 1 du panneau | À remplir |
| Appli Swissquote compromise (mise à jour malveillante) | Aucune clé dans l'appli, règles on-chain, simulation décodée côté client | Recherche de clés dans le code client, simulation indépendante | À remplir |
| Swissquote seule veut déplacer les fonds | Pas de rôle de signature, un guardian ne suffit pas | Invariant 1 | À remplir |
| Swissquote + tiers sans le client | Chemin long de 30 jours, annulé par un signe de vie | Attaque 2 du panneau | À remplir |
| Swissquote disparaît | Chemin client + tiers | Attaque 3 du panneau | À remplir |
| Faux décès | Un signe de vie du client remet le compteur à zéro | Invariant 3 | À remplir |
| Tiers de confiance injoignable | Test de vie périodique, remplacement par le client seul | Étape 8 | À remplir |
| Dapp ou approbation malveillante | Simulation en clair, alerte sur approbation illimitée, tableau de révocation | Étape 6 et 10 | À remplir |
| Swissquote refuse de sponsoriser le gas | Le client peut payer son propre gas, ou passer par un bundler public | Transfert sans paymaster | À remplir |

**Risques résiduels à écrire noir sur blanc :** collusion Swissquote + tiers quand le client a tout perdu, griefing (Swissquote et le tiers peuvent relancer des recoveries en boucle, que le client paie pour annuler), dépendance envers Apple ou Google si la passkey est synchronisée, limite EVM (le MPC serait nécessaire pour Bitcoin), et module de recovery dont l'audit et la maturité restent à confirmer.

## Contenu de la soumission

Le document de la track demande six éléments, et chacun a ici son point d'appui. Les affirmations juridiques sont des hypothèses de conception à formuler comme telles, ou à sourcer (FINMA, loi sur le blanchiment) avant de les affirmer.

| Élément demandé | Ce qu'on écrit |
| --- | --- |
| Modèle de custody et threat model | Signature par le client seul, recovery à seuil 2-sur-3 avec délais, tableau de menaces testé, risques résiduels assumés |
| Architecture avec les parties mockées marquées | Le schéma de la section Architecture, avec le réel et le mocké en couleurs différentes |
| Custody et Travel Rule | Custody : Swissquote ne peut jamais déplacer les fonds seule, ni avec un partenaire de son choix. Argumentaire sur la zone grise (Swissquote + tiers choisi par le client, délai long et annulable). Travel Rule : adresse créée dans l'appli et liée au client mocké, propriété prouvée par la signature d'un défi par la passkey ; quand le client paie un tiers, Swissquote ne peut ni initier ni déplacer la transaction, lecture à confirmer avec un juriste |
| Business case | Un petit calcul avec hypothèses explicites : clients qui retirent aujourd'hui vers un wallet externe, rétention, frais d'entrée, coût de support évité. Aucun chiffre réel sur Swissquote sans source |
| Bonus traités | Gasless et accès DeFi accompagné, si l'étape correspondante passe |
| Outils d'IA utilisés et usage de chacun | À tenir à jour pendant le weekend |

**Points à clarifier avec les mentors avant de figer le pitch :** comment Swissquote vérifie aujourd'hui les adresses externes (liste blanche, dépôt de test), et si une liste de protocoles examinés, affichée comme information sans bloquer, change son rôle juridique.

## Extensions avec plus de temps

Avec plus de temps, on renforce d'abord ce qui rend la recovery plus crédible, puis on élargit la portée. Chaque extension est indépendante du cœur et ne doit jamais le fragiliser.

| Priorité | Extension | Intérêt | Coût estimé |
| --- | --- | --- | --- |
| 1 | Preuve de propriété de l'adresse (signature d'un défi vérifiée par la banque) | Rend la Travel Rule concrète | Faible à moyen |
| 1 | Délai de recovery modulé par la force de la preuve (clé USB ou présence en personne = délai plus court, jamais nul) | Justifie chaque facteur par une conséquence | Faible |
| 2 | Confirmation renforcée au-delà d'un seuil (passkey fraîche, délai, notification) | Répond à la question du document sur les gros montants | Faible |
| 2 | Plusieurs successeurs désignés, avec compromis disponibilité contre collusion | Réduit le risque d'un tiers perdu | Moyen |
| 3 | Tiers de confiance doté de sa propre recovery | Supprime le cas limite du tiers perdu | Élevé |
| 3 | Alertes de recovery réelles (email, notification) | Rend le délai révocable utile en vrai | Moyen |
| 3 | Signal « protocole examiné par Swissquote » sans blocage | Information sans pouvoir | Faible |
| 4 | Deuxième chaîne EVM avec recovery rejouée sur chacune | Montre la limite multi-chaîne | Moyen, et complique les tests |
| 4 | Succession avec compteur d'inactivité réel | Angle patrimoine, argument business | Moyen |
| 5 | Variante MPC pour couvrir Bitcoin | Répond à la limite EVM | Très élevé |
| 5 | Preuve zk de propriété d'adresse ou de facteur | Confidentialité, perspective de recherche | Très élevé, à garder en perspective |

À éviter même avec du temps : recoder de la cryptographie (signatures, EIP-712, WebAuthn), utiliser le visage comme clé, ou donner à Swissquote un pouvoir de blocage.

## Risques techniques et plans B

Le risque principal est l'assemblage passkey + Safe + module de recovery + paymaster, que l'étape 0 teste en premier. Les points ci-dessous n'ont pas été confirmés dans la documentation et doivent être vérifiés par l'exécution.

| Risque | Signe d'alerte | Plan B |
| --- | --- | --- |
| Module de recovery absent du testnet choisi | Déploiement introuvable | Passer sur Ethereum Sepolia, utilisé dans les exemples de Candide |
| Passkey non branchée comme signataire du Safe | Signature refusée à l'étape 2 | Tester les autres modules WebAuthn (Rhinestone, support de viem ou de permissionless.js), sinon compte à clé classique pour la signature et passkey pour l'accès à l'appli, en le documentant |
| Seuil 2-sur-3 ou révocation absents | Fonctions non exposées à l'étape 0 | Autre module de recovery existant ; sinon petit module Safe écrit par-dessus OpenZeppelin (voir la section de révision), sans recoder signatures, EIP-712 ni WebAuthn |
| Un seul délai disponible | Impossible de distinguer 48 h et 30 jours | Plusieurs instances du module sur le même Safe ; sinon retirer l'invariant 2 et l'attaque 2 des promesses, car un chemin long géré par le backend serait contournable par une Swissquote complice du tiers |
| Délai minimal trop long pour la démo | Plus petit délai de plusieurs jours | Démonstration sur un réseau local forké avec avance du temps, ou vidéo enregistrée |
| Paymaster indisponible sur le testnet | Clé d'API refusée ou réseau non supporté | Autre fournisseur, sinon gasless présenté comme perspective |
| Démo qui échoue en direct | Délai, réseau ou passkey capricieux | Vidéo de secours enregistrée à chaque porte, comptes pré-créés |
| Temps insuffisant | Porte B non franchie à mi-parcours | Couper les extensions et se concentrer sur le flux de base et la démo d'attaque principale |

**Règle de décision :** si l'étape 0 échoue sur deux critères, on change de module avant d'écrire la moindre ligne de l'application.

## Révisions après revue critique

La revue juge le concept solide mais le plan calibré pour trois personnes : en solo sur 24 h, on garde les étapes 0 à 7 et 11 en version minimale, on sort les étapes 8 et 10, et on valide d'abord que les deux délais s'expriment vraiment on-chain.

**Les deux délais : hypothèse à tester à l'étape 0**

Le module de recovery de Candide a, sauf erreur, un seul délai et un seul seuil par configuration, donc la règle « backup obligatoire pour le chemin court » ne s'exprime pas avec un seuil 2-sur-3 unique. Un chemin long géré par le backend est à écarter : si c'est Swissquote qui refuse de signer avant le délai, une Swissquote complice du tiers peut signer tout de suite, et l'invariant 2 ne prouve plus rien. Hypothèse de travail rapportée par la revue, que je n'ai pas pu confirmer dans la documentation : Candide déploierait un singleton du module par délai (3 minutes, 3 jours, 7 jours, 14 jours), chacun stockant sa configuration par compte, ce qui permettrait à un même Safe d'activer plusieurs instances.

| Instance du module | Guardians | Seuil | Chemin |
| --- | --- | --- | --- |
| 3 minutes | Backup + Swissquote | 2 | Court : téléphone perdu, backup disponible |
| 3 jours | Backup + tiers | 2 | Swissquote a disparu |
| 14 jours | Swissquote + tiers | 2 | Long : le client n'a plus rien, ou décès |

Dans les sections précédentes, « 48 h » et « 30 jours » désignent le délai court et le délai long : les valeurs réelles sont celles des instances disponibles. Le chemin long n'a pas besoin d'aboutir en démo : il suffit de le montrer en attente, puis annulé par le client. Le chemin à 3 jours se montre sur un fork local avec avance du temps, ou en vidéo. Si la combinaison fonctionne, l'invariant 2 devient réellement on-chain, ce qui est le meilleur argument face aux juges.

**Si les instances ne suffisent pas : un petit module Safe écrit par nous**

Le document de la track interdit de réinventer la cryptographie, pas d'écrire un contrat : un petit module de logique par-dessus des bibliothèques établies est défendable, à confirmer avec les mentors.

1. **Étape 0 :** tester plusieurs instances du module de Candide. La décision est prise à la fin de l'étape 0.
2. **Si ça échoue :** module Safe minimal, écrit après la porte A et limité à 3 h. Il garde pour chaque chemin ses guardians, son seuil et son délai, enregistre une recovery en attente, laisse le propriétaire l'annuler et, le délai écoulé, demande au Safe de changer le propriétaire. Estimation : 150 à 250 lignes, à confirmer.
3. **À ne pas recoder :** la vérification de signatures, le hachage EIP-712 et le support WebAuthn, pris dans OpenZeppelin et les bibliothèques de Safe.
4. **Preuve :** des tests d'invariants Foundry sur ce module démontrent directement que Swissquote seule ne déplace pas les fonds.
5. **À demander aux mentors pendant l'étape 0 :** un petit module Safe écrit par nous, basé sur OpenZeppelin, est-il acceptable ?
6. **Si les 3 h sont dépassées :** retirer l'invariant 2 et l'attaque 2 des promesses, et écrire dans le threat model que le module n'est pas audité.

**Autres risques à intégrer**

- **Clé de backup sur YubiKey :** une YubiKey en WebAuthn signe en P-256, pas en secp256k1. En faire un guardian demande un smart account guardian (EIP-1271), soit des heures de plus. En 24 h, le backup est une EOA stockée dans un autre navigateur ou un fichier, et la YubiKey reste une perspective.
- **Recovery vers une nouvelle passkey :** le propriétaire passkey d'un Safe est un contrat signataire WebAuthn, pas une adresse simple. Son adresse est à calculer, et il faut probablement le déployer. L'étape 0 teste une recovery vers une passkey.
- **Passkeys synchronisées :** sur Mac, Chrome et Safari synchronisent les passkeys via iCloud ou Google, donc le nouvel appareil la retrouverait. Mise en scène : autre profil de navigateur, passkey supprimée devant le public.
- **Le tiers dans la démo :** une page « console guardian » séparée de l'app cliente, ce qui respecte l'invariant 5.
- **Attaque 1 :** présenter d'abord la défense on-chain (le second guardian manque), puisque le re-KYC est mocké.
- **Griefing :** Swissquote et le tiers peuvent relancer des recoveries en boucle, que le client paie pour annuler. À écrire comme risque résiduel, pas à résoudre.

**Ce qui change dans le plan**

- Gasless branché à l'étape 2 si le paymaster sponsorise sur le testnet, sans détection d'abus.
- Étapes 8 et 10 sorties du périmètre. Le remplacement du tiers est un simple appel du propriétaire au module, une phrase dans le README. Le parcours DeFi passe en perspective dans le pitch.
- Étape 7 : les scripts d'attaque servent à la fois de tests et de boutons du panneau.
- Étape 6 minimale : `decodeFunctionData` de viem sur trois ABI, et une alerte quand l'approbation vaut `maxUint256`.
- Pendant l'étape 0, lire le code du module de recovery, qui est court : tout le pitch repose sur ses garanties et les juges y creuseront.

**Découpage sur 24 h en solo**

| Créneau | Contenu |
| --- | --- |
| H0 à H2 | Étape 0, avec plusieurs instances du module et recovery vers une passkey |
| H2 à H3 | Squelette |
| H3 à H7 | Passkey + Safe + USDC + paymaster : porte A |
| H7 à H8h30 | Backend mocké + console guardian |
| H8h30 à H11h30 | Recovery courte, compte à rebours, annulation |
| H11h30 à H14 | Chemin sans Swissquote + chemin long : porte B, puis vidéo de secours |
| H14 à H16 | Sommeil, non négociable en solo |
| H16 à H19 | Simulation + scripts d'attaque |
| H19 à H22 | README, threat model, business case, slides |
| H22 à H24 | Répétition et marge |

Si la porte B n'est pas franchie à H14, tout ce qui suit se réduit à la démo de base et à l'attaque 1.

## Décisions après revue

Ces décisions, prises le 10 octobre 2026 après la revue de la spec, priment sur tout le reste du document, y compris sur la section « Révisions après revue critique », lorsqu'elles diffèrent.

**Points bloquants**

1. **Signature du backup.** Le backup signe via la console guardian : une page séparée de l'app cliente, où la clé est importée à l'exécution (collage ou fichier) et jamais persistée (ni localStorage, ni logs, ni état). L'invariant 5 interdit tout stockage de clé de guardian dans `client/` et dans son bundle. Le tiers signe de la même façon.
2. **Signe de vie.** Un signe de vie est une transaction d'annulation signée par la passkey actuelle du propriétaire. Le backend ne tire aucune conséquence d'une connexion à l'appli. Cela couvre le faux décès, pas un client qui a tout perdu : à écrire dans le threat model.
3. **Invariant 1.** À l'étape 0, définir précisément qui peut proposer, confirmer, exécuter, finaliser et annuler, et si la finalisation est ouverte à tous. L'invariant testé devient : Swissquote seule ne peut faire changer le propriétaire du Safe par aucun enchaînement de ces actions.
4. **Instances concurrentes.** Après toute recovery réussie, le nouveau propriétaire annule toutes les recoveries encore en attente sur toutes les instances. L'écran de recovery le fait, et le test de l'étape 4 le vérifie.

**Points secondaires**

5. **Annulation en boucle par l'ancienne passkey** (voleur, passkey synchronisée compromise) : risque résiduel à écrire.
6. **Paymaster.** Il est opéré par un tiers (Candide ou Pimlico), pas par Swissquote. Le test « sans paymaster » demande d'alimenter le Safe en ETH de test, séparément de la validation « 0 ETH » de l'étape 2.
7. **Chemin de 3 jours en démo.** Appels directs des guardians (EOA) sur un fork local Anvil avec avance du temps, ou vidéo. À tenter après la porte B, si le temps le permet.
8. **Délais.** Valeurs de démo : 3 min, 3 j, 14 j. Valeurs cibles (hypothèse) : 3 j, 7 j, 14 j. Si le module stocke une configuration par compte et par délai, deux instances ne peuvent pas partager un délai : à vérifier à l'étape 0. Le pitch présente ces valeurs comme des paramètres.
9. **Gasless.** Branché à l'étape 2, sans détection d'abus. La validation de l'étape 9 se lit donc : « transfert réussi depuis un compte sans ETH », sans exigence de refus des abus.
10. **« Signature impossible sans biométrie »** : à écrire « déclaré », pas « testé », dans le threat model.
11. **`liveness.ts`** : hors périmètre en solo.

**Nouvelles décisions**

- **Règles on-chain uniquement.** Toutes les règles (seuil, délais, annulation) vivent dans le contrat. Rien n'est jamais appliqué par le backend. Si un délai ne peut pas être appliqué on-chain, on retire l'invariant concerné des promesses, on ne le simule pas.
- **Solidity, de façon limitée.** À la fin de l'étape 0, on choisit entre (a) plusieurs instances du module de Candide, (b) un petit module Safe écrit par-dessus OpenZeppelin, après la porte A et limité à 3 h, (c) un autre module existant. Jamais de cryptographie maison : ni signatures, ni EIP-712, ni WebAuthn.
- **Un guardian = une adresse = une voix.** Vérifier à l'étape 0 qu'une même adresse ne peut pas être enregistrée deux fois, et qu'une même signature ne peut pas compter deux fois ni être rejouée.
- **Changement de guardian.** Seul le propriétaire peut le faire, par une transaction du Safe. Le tiers est présent dans deux instances : il faudrait changer les deux dans une transaction groupée, en ajoutant avant de retirer. Vérifier si le module impose un délai pour modifier les guardians ; sinon, risque résiduel (un voleur qui contourne la biométrie pourrait se faire guardian). Hors périmètre en solo : on vérifie seulement.
- **Recovery vers une nouvelle passkey.** Le propriétaire est un contrat signataire WebAuthn. L'étape 0 teste la recovery vers une passkey, pas seulement vers une EOA.
- **Kit de sortie.** Le contrat doit être appelable sans l'appli. Un outil open source minimal est une perspective, à faire après la porte B. WebAuthn exige un navigateur : l'outil sera une page locale sur localhost.
- **Chaîne paramétrable.** Ethereum Sepolia d'abord. Si le module n'y est pas déployé, changer de testnet avant d'écrire du code.
- **Démo.** Un seul propriétaire. Mise en scène de la recovery : autre profil de navigateur, passkey supprimée devant le public. Backup = EOA dans un autre navigateur ou un fichier.
- **Périmètre.** Étapes 8 et 10 hors périmètre. Étapes 6 et 7 minimales.

## Modèle 2 guardians (10 octobre 2026, prime sur tout le reste du document)

Cette section remplace les modèles précédents (passkey, backup, chemins D1/D2/D3, signataire WebAuthn). Leur code est conservé sur la branche `archive/exploration-etape-0`.

**Modèle**
- Le client garde sa seed phrase dans un wallet externe. L'appli ne détient **aucune** clé privée du client : ni clé chiffrée dans le navigateur, ni passkey, ni PRF.
- Deux guardians : Swissquote (clé dans `bank-mock/`, processus séparé, stockage propre) et le tiers de confiance (clé importée à l'exécution dans la console guardian, jamais persistée).
- Une seule politique et un seul délai D par chaîne.

**Bitcoin (priorité 1)**
- Politique : `or(pk(CLIENT),and(pk(SWISSQUOTE),and(pk(TIERS),older(D))))`. La forme imbriquée est obligatoire, car `and()` n'accepte que deux arguments dans le langage de politique. Elle se compile en `andor(pk(S),and_v(v:pk(T),older(D)),pk(C))`.
- Script P2WSH. Descripteurs à plage pour les trois clés (`/0/*` en réception, `/1/*` en change), dérivation BIP48 `m/48'/1'/0'/2'` sur les testnets. Le xpub est fourni avec son origine : `[empreinte/48'/1'/0'/2']tpub…`.
- Dépense du client : l'appli prépare un PSBT, le client le signe dans son signataire externe, l'appli finalise et diffuse. `tools/client-signer` remplace Sparrow ou un wallet matériel pour la démo et est étiqueté comme tel. Signataire externe réel validé : Bitcoin Core (wallet de descripteurs, `walletprocesspsbt`). Sparrow ne gère pas les politiques Miniscript à délai (issues #1700 ouverte et #1757 refusée), donc il n'est pas retenu.
- Recovery : si les coins n'ont pas bougé depuis D blocs, Swissquote et le tiers signent chacun le PSBT vers une nouvelle adresse du client.
- Rafraîchissement : un envoi à soi-même remet le délai à zéro, par UTXO. L'appli avertit avant l'expiration.
- D : 6 blocs pour la démo (regtest et signet). Valeur cible présentée dans le pitch : environ 6 mois (≈ 26 000 blocs), comme paramètre.
- Preuve de propriété (**optionnelle**) : `bip322-js` ne gère pas P2WSH. Repli : le client signe le défi avec sa clé publique qui figure dans la politique ; bank-mock vérifie la signature et recompile l'adresse.
- Réseaux : regtest (bitcoind 29 dans Docker) pour franchir les délais ; signet (API Esplora de blockstream.info) pour les vraies transactions.

**Ethereum (priorité 2, seulement après la porte B Bitcoin)**
- Safe dont le propriétaire est le compte EVM du client, signé depuis un wallet externe. Une seule instance du module de recovery Candide, avec deux guardians (Swissquote et tiers), seuil 2.
- Après toute recovery, appeler `cancelRecovery` et `invalidateNonce`. Retirer un guardian n'annule pas une recovery en cours (version 0.0.1).
- L'appli présente un seul wallet avec deux comptes. Le Safe n'est déployé qu'à la première utilisation.

**Invariants**
1. Swissquote seule ne peut dépenser par aucun chemin.
2. Swissquote + tiers ne peuvent pas dépenser avant D depuis le dernier mouvement des coins (erreur réelle du consensus).
3. Le client qui rafraîchit avant D bloque toute recovery.
4. Le client dépense seul à tout moment, même si Swissquote est arrêtée.
5. Aucune clé privée du client dans l'appli, et aucune clé de guardian dans `client/` ni dans son bundle.

**Attaques** (tests et boutons) : attaquant sans les clés des guardians (refus) ; collusion Swissquote + tiers avant D (refus) ; Swissquote arrêtée, le client dépense seul (succès).

**Limites** : clé du client perdue et Swissquote disparue, alors les fonds sont perdus. Tiers qui perd sa clé, alors il faut le remplacer par une nouvelle politique. Zone grise : Swissquote + tiers peuvent dépenser après D, vers n'importe quelle destination. Sémantique différente sur Ethereum (annulation) et sur Bitcoin (rafraîchissement). Peu de wallets externes gèrent Miniscript (Liana, Bitcoin Core, Ledger, Coldcard, BitBox02). En P2WSH, une dépense révèle la politique ; Taproot est une perspective. Pas de gasless ni de dApp.

**Ordre** : 1. Bitcoin, porte A. 2. bank-mock + console guardian. 3. Recovery Bitcoin, porte B. 4. Attaques et invariants. 5. Livrables. 6. Ethereum.

## Interface bancaire et Wallet du client (étape 6, 10 octobre 2026)

Cette section complète le « Modèle 2 guardians », sans le modifier.
- **Appli de la banque (simulée)** : connexion e-banking mockée, onglets Aperçu / Comptes / Wallet crypto. L'onglet Démo · Attaques n'existe qu'en regtest. La recovery est un écran à part, ouvert depuis « J'ai perdu mon wallet ».
- **Wallet du client** (`client-wallet/`) : **implémentation de référence** d'un wallet externe (en production : wallet matériel ou appli téléphone). Appli séparée, avec son propre processus et son propre stockage.
  - Il génère la graine avec `@scure/bip39`, l'affiche **une fois**, et ne transmet à la banque que la clé publique étendue.
  - Il signe uniquement après un écran de confirmation qui décode le PSBT : sorties, montants, frais, chemin de dépense. Il refuse de signer un PSBT de recovery.
  - L'appli de la banque lui parle par fenêtre (`postMessage`, avec contrôle de l'origine). Son API refuse toute requête d'une autre origine.
- **Tiers** : il crée son identité dans la console guardian (phrase affichée une fois) et transmet sa clé publique au client, qui la saisit avec son nom à la création du wallet.
- L'appli de la banque **ne reçoit jamais** ni la graine ni une clé privée du client.
