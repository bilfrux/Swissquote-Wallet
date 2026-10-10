# Étape 5 : livrables

Livrés : `README.md`, `docs/threat-model.md`, `docs/architecture.md`, `docs/ia.md`, et pour la démo `npm run demo` et `npm run regtest -- fund|mine`.

## Vérifications exécutées

| Critère | Commande | Verdict |
| --- | --- | --- |
| La démo démarre en trois commandes (`npm install`, `npm run regtest:up`, `npm run demo`) : appli, bank-mock, console, attaques | `npm run demo` ; `curl localhost:4000/health` ; serveur d'attaques sur 4200 | fonctionne (console sur 5175, car le 5174 était occupé par un autre processus de la machine ; Vite l'indique) |
| La pile de démo supporte le parcours complet de recovery | `CONSOLE_URL=http://localhost:5175 npm run validate:3:ui` contre `npm run demo` | fonctionne, 7/7 |
| Le panneau « Attaques » de la pile de démo | `npm run validate:4:ui` contre `npm run demo` | fonctionne, 4/4 |
| Aides regtest de la démo | `npm run regtest -- fund <adresse> 0.01` ; `npm run regtest -- mine 2` | fonctionne |
| Les deux schémas Mermaid se rendent | Rendu dans Chrome avec mermaid 12.1.0 (installé hors du dépôt) | fonctionne (SVG produit, aucune erreur) |
| Les fichiers de preuve cités existent | `test -f docs/validation/…` | fonctionne |
| Typage des 6 projets | `npm run typecheck` | fonctionne |

## Affirmations de sécurité des livrables : démontrées ou déclarées ?

| Affirmation | Statut | Preuve |
| --- | --- | --- |
| Swissquote seule ne peut dépenser par aucun chemin | **Démontrée** (rejet du consensus, deux chemins, après D) | `etape-4-attaques-sortie.txt`, invariant-1 |
| Swissquote + tiers ne peuvent pas dépenser avant D | **Démontrée** (regtest et signet) | attaque 2 ; `etape-3-sortie.txt` ; `etape-3-signet-sortie.txt` |
| Swissquote + tiers peuvent dépenser après D sans rafraîchissement (zone grise) | **Démontrée** (acceptée par le nœud, non diffusée) | attaque 2, ligne d'information |
| Le rafraîchissement bloque la recovery et remet le délai à zéro | **Démontrée** | `etape-3-sortie.txt`, test 2 |
| Le client dépense seul, Swissquote arrêtée | **Démontrée** | attaque 3 ; `etape-2-sortie.txt`, test 7 |
| Aucune clé privée du client dans l'appli, aucune clé de guardian dans `client/` ni dans son bundle | **Démontrée** pour les graines présentes sur la machine et les motifs génériques, avec témoin positif | `etape-4-invariant-5-sortie.txt` |
| La phrase du tiers n'est pas conservée par la console | **Démontrée** (stockage, DOM, champs) | `etape-2-ui-sortie.txt`, UI-4 |
| Un attaquant sans les clés des guardians est refusé | **Démontrée** (signatures de l'attaquant rejetées ; re-KYC refusé) | attaque 1 |
| « Personne ne peut bloquer le client » / « n'importe quel nœud suffit » | **Partiellement démontrée** : bank-mock arrêté, et diffusion via un Esplora public. La censure par un tiers réseau est **déclarée** | attaque 3 ; étape 1 signet |
| Le wallet externe affiche ce qu'il signe | **Démontrée pour `tools/client-signer`** ; **déclarée** pour les vrais wallets | `etape-1-signet-sortie.txt` |
| Bitcoin Core signe la politique | **Démontrée** (regtest) | `etape-1-regtest-sortie.txt`, test 4 |
| Liana et wallets matériels compatibles | **Déclarée** (annoncée, non vérifiée) | — |
| Sparrow incompatible | **Déclarée** (issues GitHub, non vérifiée) | — |
| Bitcoin ne permet pas de contraindre la destination d'une recovery | **Déclarée** (propriété du protocole, sans covenant) | — |
| Swissquote fermée + clé perdue = fonds perdus ; tiers sans clé = recovery impossible | **Déclarées** (conséquences de la politique), non testées | — |
| Re-KYC | **Mocké** : couche secondaire, non représentative d'un vrai KYC | `etape-2-sortie.txt` |
