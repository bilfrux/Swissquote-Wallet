# Threat model

Politique Bitcoin (P2WSH, Miniscript) : `or(pk(CLIENT), and(pk(SWISSQUOTE), and(pk(TIERS), older(D))))`. Démo : D = 6 blocs.

La colonne « Résultat observé » ne reprend que ce qui a été exécuté et consigné dans `docs/validation/`. Sans preuve, la case indique **non testé**.

## Les trois questions du document de la track

| Question | Réponse | Preuve |
| --- | --- | --- |
| Qui pourrait voler les fonds ? | Le client seul, à tout moment. Swissquote + tiers **ensemble**, uniquement sur des coins immobiles depuis D blocs (zone grise ci-dessous). Personne d'autre. | Invariant 1, attaques 1 et 2 (`etape-4-attaques-sortie.txt`) |
| Qui pourrait bloquer le client ? | Personne : la dépense du client n'a besoin ni de Swissquote, ni du tiers, ni de l'appli Swissquote (n'importe quel nœud ou explorateur Bitcoin suffit). | Attaque 3, étape 2 test 7 |
| Swissquote, seule ou avec un partenaire, peut-elle déplacer les fonds sans le client ? | Seule : non, rejet par le consensus sur les deux chemins. Avec le tiers : oui, après D, si le client n'a pas rafraîchi ses coins. | Invariant 1 ; attaque 2 (ligne « zone grise ») |

## Menaces

| Menace | Défense | Test | Résultat observé |
| --- | --- | --- | --- |
| Vol du téléphone : l'appli de la banque tombe aux mains d'un attaquant | L'appli ne contient aucune clé privée (clés publiques et PSBT non signés uniquement) | `npm run validate:inv5` ; étape 1 UI-5 (localStorage) ; étape 6 test 6-4 | Aucune des 14 graines de la machine dans `client/` ni dans son bundle, avec témoin positif 14/14 ; localStorage = configuration publique seule (`etape-4-invariant-5-sortie.txt`, `etape-1-ui-sortie.txt`) |
| Vol du téléphone + de l'email | Re-KYC Swissquote (mocké) ; surtout, les deux guardians et le délai D sont imposés on-chain | Attaque 1 (`npm run test:attacks`, bouton du panneau) | Re-KYC refusé (403) ; après D, signatures de l'attaquant rejetées : `mempool-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)` |
| Swissquote seule veut déplacer les fonds | Aucun chemin du script ne se satisfait avec la seule clé Swissquote | Invariant 1 | Rejet par le consensus, même après D : chemin recovery `Script failed an OP_CHECKSIGVERIFY operation` ; chemin client `Signature must be zero for failed CHECK(MULTI)SIG operation` ; la bibliothèque refuse de finaliser |
| bank-mock compromis : signe n'importe quoi | La signature Swissquote ne suffit jamais : il faut aussi le tiers ET D blocs | Attaque 2 (bank-mock contourné) ; invariant 1 | Collusion refusée avant D : `non-BIP68-final` |
| Swissquote + tiers complices, avant D | `older(D)` imposé par le consensus (BIP68/112) | Attaque 2 ; étape 3 test 1 ; signet | Regtest : `non-BIP68-final` à 1 et à 5 confirmations. Signet : `sendrawtransaction RPC error -26: non-BIP68-final` (`etape-3-signet-sortie.txt`) |
| **Swissquote + tiers complices, après D, coins non rafraîchis** | Aucune défense technique (zone grise assumée) : tiers choisi par le client, avertissement dans l'appli, rafraîchissement | Attaque 2, ligne d'information | **Acceptée par le nœud à D** (non diffusée) : risque résiduel |
| Le client ne voit pas qu'une recovery approche | Avertissement « bientôt dépensable par Swissquote + tiers » quand il reste ≤ ⌈D/3⌉ blocs ; bouton de rafraîchissement | Étape 3 UI-1 ; étape 3 test 2 | Avertissement affiché ; notification hors appli (email, push) **non testée** |
| Une recovery déjà signée reste valable après rafraîchissement | Le rafraîchissement dépense les coins : la transaction signée référence des entrées qui n'existent plus | Étape 3 test 2 | Refus `missing-inputs` ; nouvelle recovery sur le coin rafraîchi refusée (`non-BIP68-final`) : le délai repart de zéro |
| Swissquote disparaît (processus arrêté) | Le chemin client ne dépend pas de Swissquote | Attaque 3 ; étape 2 test 7 | bank-mock injoignable (`ECONNREFUSED`) ; dépense du client diffusée et confirmée |
| Swissquote disparaît **et** le client perd sa clé | Aucune | — | **Non testé, par construction : fonds perdus.** Extension : chemin backup + tiers avec délai plus long |
| Le tiers perd sa clé | Le client remplace le tiers tant qu'il a sa clé (nouvelle politique, déplacement des coins) | — | **Non testé** : remplacement non implémenté ; sans tiers, recovery impossible |
| Swissquote signe une recovery vers une adresse étrangère ou les coins d'un autre client | Contrôles de bank-mock (couche secondaire) : recovery uniquement, entrées d'un compte du client, sorties vers un autre compte du même client | Étape 2 test 5 | Trois refus 403 avec motif |
| Re-KYC frauduleux (l'attaquant passe la vérification d'identité) | Il faut encore la signature du tiers et D blocs ; avertissement au client | Partiellement : attaque 2 (collusion) | Refus avant D observé ; un re-KYC réellement contourné est **non testé** (KYC mocké) |
| Le PSBT présenté au client est malveillant (appli Swissquote compromise) | Le Wallet du client décode lui-même le PSBT et affiche chemin, sorties (les siennes reconnues grâce à la politique enregistrée), montants et frais avant de signer ; le client peut refuser | Étape 6, tests 6-6 (écran de confirmation, refus remonté à l'appli) | Affichage et refus observés ; vérification réelle de l'adresse par l'utilisateur **non testée** |
| L'appli de la banque tente d'obtenir une signature sans confirmation, ou de lire une clé | API du Wallet du client sans CORS, et refus de toute requête d'une autre origine avant exécution ; interaction possible seulement par la fenêtre du wallet | Étape 6, test 6-7 | Lecture bloquée dans le navigateur ; POST avec l'origine de la banque refusé (403) |
| La graine du client fuit vers la banque | Graine générée et stockée dans le Wallet du client ; seule la clé publique transite | Étape 6, test 6-4 ; `npm run validate:inv5` | Phrase absente du stockage et de la page de l'appli et de la base de Swissquote ; graines du Wallet du client absentes de `client/` et du bundle |
| Le wallet signe une recovery à l'insu du client | Le Wallet du client refuse de signer le chemin de recovery (ce chemin ne concerne pas sa clé) | Étape 6, test 6-12 | Refus 400 « chemin de recovery » |
| Vol de l'appareil qui porte le Wallet du client | En production : wallet matériel ou appli téléphone avec code et élément sécurisé | — | **Non testé** : l'implémentation de référence stocke la graine en clair (fichier en mode 600), sans code ni chiffrement |
| Fuite de la phrase du tiers par la console guardian | Phrase lue au clic, utilisée, effacée ; jamais dans l'état, le stockage ni les journaux | Étape 2 UI-4 | Absente de localStorage, sessionStorage, du DOM et des champs après signature ; navigateur du tiers compromis : **non testé** |
| Le client déclare une adresse externe qui n'est pas la sienne (Travel Rule) | Défi Swissquote à usage unique, signé par la clé client à l'index de l'adresse ; vérification stricte (BIP-322) avec la clé recalculée par Swissquote depuis le xpub enregistré | `npm run validate:7` ; étape 6, test 6-13 | Preuve valide acceptée ; rejeu (409), message altéré, autre clé, format BIP-137 et compte d'un autre client refusés. **Portée** : prouve la détention de la clé client, qui suffit seule à dépenser l'adresse d'après la politique enregistrée ; ce n'est pas une signature de l'adresse P2WSH elle-même |
| Rejeu d'une signature de guardian sur un autre compte | Les signatures portent sur la transaction (sighash BIP143) et le script du compte | Étape 2 test 5 (autre client) | Refus en amont par bank-mock ; rejeu on-chain **non testé séparément** |
| Swissquote refuse de servir l'API ou de relayer | La diffusion passe par n'importe quel nœud ou explorateur | Étape 1 (diffusion via Esplora public) ; attaque 3 | Observé |
| Attaque physique (« wrench attack ») en visant l'échéance | Aucune ; en P2WSH, chaque dépense révèle la politique et le délai | — | **Non testé** : risque résiduel ; Taproot en perspective |
| Griefing : demandes de recovery répétées | Une demande non diffusable avant D n'a aucun effet on-chain ; le client rafraîchit | — | **Non testé** |

## Risques résiduels (à argumenter, pas à nier)

1. **Zone grise de custody** : après D sans rafraîchissement, Swissquote + tiers peuvent dépenser vers n'importe quelle destination. Bitcoin ne permet pas de contraindre la destination (pas de covenant).
2. **Swissquote fermée + clé du client perdue = fonds perdus.**
3. **Tiers qui perd sa clé = recovery impossible**, tant que le client ne l'a pas remplacé.
4. **Coût du rafraîchissement** : déplacer chaque coin avant D, en frais et en traces sur la chaîne.
5. **Peu de wallets externes compatibles** : Bitcoin Core vérifié ; Liana et wallets matériels annoncés, non vérifiés ; Sparrow très probablement non.
6. **Confidentialité** : la politique est révélée à chaque dépense en P2WSH.
7. **Wallet du client de référence** : graine stockée en clair (mode 600), sans code ni chiffrement. Un vrai wallet matériel ou une appli téléphone avec élément sécurisé est requis en production.
8. **Composants mockés** : re-KYC, session bancaire. Le re-KYC n'est qu'une couche en plus : la défense réelle est on-chain.
9. **Hors périmètre** : Ethereum, gasless, dApp, DeFi.
