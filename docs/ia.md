# Outils d'IA utilisés

## Outils

| Outil | Modèle | Usage |
| --- | --- | --- |
| Claude Code (CLI d'Anthropic) | Claude Opus 5.5 | Revue critique de la spec, scripts de faisabilité (Ethereum puis Bitcoin), implémentation de tout le code du dépôt, scripts de validation et d'attaque, exécution des tests, rédaction des rapports `docs/validation/` et de ces livrables |
| *(à compléter par l'équipe)* | — | Outils éventuellement utilisés hors du dépôt (rédaction de la spec et des prompts, pitch, slides) : ce document ne peut pas les déduire de l'historique |

Tous les commits après le commit initial portent la mention `Co-Authored-By: Claude Opus 5.5` (`git log`).

## Méthode de travail

- **L'humain décide, l'IA exécute et rapporte.** Le modèle de custody a changé trois fois sur décision de l'équipe. L'IA s'arrêtait et signalait chaque hypothèse fausse avant de la contourner (règle de `CLAUDE.md`).
- **Une étape à la fois, une preuve par étape** : un commit et un `docs/validation/etape-N.md` par étape, avec commandes et sorties brutes.
- **Rien n'est déclaré réussi sans exécution** : chaque ligne « fonctionne » renvoie à une sortie de test ; les points non exécutés sont marqués « non testé ».
- **Pas de cryptographie générée par l'IA** : signatures, dérivations et PSBT viennent de bibliothèques établies (`@scure/*`, `@noble/curves`, `@bitcoinerlab/*`, compilateur Miniscript de référence).

## Erreurs détectées par l'exécution (et non par relecture)

L'exécution systématique a fait apparaître des erreurs, de la spec comme du code produit par l'IA :

| Type | Constat | Comment il a été détecté |
| --- | --- | --- |
| Hypothèse de spec fausse | La première politique Bitcoin réutilisait les mêmes clés dans plusieurs chemins : Miniscript l'interdit | `[compile error]` du compilateur de référence |
| Hypothèse de spec fausse | `and(a, b, c)` n'existe pas dans le langage de politique (deux arguments seulement) | Erreur de compilation ; forme imbriquée retenue |
| Hypothèse de spec à nuancer | Les modules Candide déployés sont en version 0.0.1, sans 14 correctifs d'audit de 2026 | `cast call … VERSION()` sur Sepolia, lecture du code (branche archive) |
| Hypothèse non retenue | Sparrow ne gère très probablement pas les politiques Miniscript à délai | Issues GitHub #1700 et #1757 (non vérifié en lançant Sparrow) |
| Bug de code IA | Chemins relatifs des outils résolus depuis le mauvais dossier (`npm run -w`) | Échec de `client-signer` dans le test de l'étape 1 |
| Bug de code IA | Deux `scantxoutset` simultanés : bitcoind en refuse un (HTTP 500) | Erreur console dans le test Chrome de l'étape 1 |
| Bug de test IA | Message d'erreur attendu inexact (`bad-txns-inputs-missingorspent` au lieu de `missing-inputs`, renvoyé par Bitcoin Core 29) | Test rouge alors que le comportement était correct |
| Bug de test IA | Temporisation erronée : le test de rafraîchissement aurait laissé le nouveau coin atteindre D | Relecture du test avant exécution |
| Bug de test IA | Lectures trop tôt dans l'interface (ligne d'un ancien coin, élément sans le montant, mots de la phrase non encore affichés) | Tests Chrome rouges, corrigés côté test |
| Bug de code IA | Course entre deux scans : à la bascule vers le nouveau wallet après recovery, un scan obsolète de l'ancien compte écrasait le solde par 0 | Test de bout en bout de l'étape 6 (fonds bien sur la chaîne, solde affiché à 0) |
| Bug de code IA | « Simuler la perte de l'appareil » ne supprimait rien : le contrôle anti-requêtes « simples » du wallet refusait aussi le DELETE (415), et l'erreur n'était pas affichée | Test 6-9 (« ancien wallet effacé : false ») |
| Bug de code IA | Deux instances du Wallet du client se disputaient le port de rechargement à chaud de Vite | Erreurs websocket dans la console, test 6-11 |

## Limites de cet usage

- Le code a été écrit très vite et principalement par l'IA. Il est couvert par des tests d'intégration contre un vrai nœud, mais **n'a pas été audité**.
- Les affirmations juridiques et business (custody, Travel Rule, business case) ne figurent pas dans ces livrables techniques. Elles sont à formuler comme des hypothèses de conception et à faire relire par l'équipe.
