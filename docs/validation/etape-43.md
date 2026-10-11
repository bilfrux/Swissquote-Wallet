# Étape 43 — Changer son contact de confiance (Bitcoin)

## Pourquoi c'est plus qu'un champ à modifier

Sur Bitcoin, le contact de confiance fait partie du **script** du compte :
`or(pk(CLIENT), and(pk(SWISSQUOTE), and(pk(CONTACT), older(D))))`. Changer de contact, c'est changer la règle, donc les
adresses. Les coins déjà reçus restent sous l'ancienne règle (ancien contact) tant qu'ils ne sont pas déplacés.

## Ce qui est fait

Onglet Crypto → fiche Bitcoin → **Security** → « Change my trusted contact » :

1. Le client saisit le nom et la clé publique du nouveau contact (vérifiés : clé valide, différente de l'actuelle, de la sienne
   et de celle de Swissquote).
2. Le site relit les coins **sur la chaîne** (pas la liste en mémoire) et prépare une transaction « clé du client seule »
   qui envoie **tous** les coins à une adresse de la nouvelle règle (même clé client, même clé Swissquote, même délai,
   nouveau contact). Le délai de recovery repart donc de zéro.
3. Le Client Wallet affiche **« Confirm the change of trusted contact »** : ancien et nouveau contact, clé du nouveau
   contact, sortie étiquetée « new account (new trusted contact) » (et non un paiement à un tiers). Le client signe avec sa
   biométrie.
4. Après la diffusion : bank-mock met à jour son registre (`POST /accounts/tiers`, verrou biométrique complet exigé, journal
   `tiers_changes`, notification au client), puis le Client Wallet enregistre la nouvelle politique. L'état est conservé
   après la diffusion (point de non-retour) pour reprendre si Swissquote ou le wallet ne répondent pas.
5. Sans coin à déplacer, seules les deux mises à jour ont lieu.

Code : `client/src/wallet/ChangeContact.tsx`, `bank-mock/src/server.ts` (`/accounts/tiers`), `client-wallet/src/server.ts`
(`describe` avec `nextPolicy`) et `client-wallet/src/ui/App.tsx` (écran de confirmation).

Le Client Wallet ne retient jamais la politique proposée par le site : il s'en sert seulement pour reconnaître les sorties
(même clé du client, mêmes clés Swissquote et délai : sinon refus) et afficher le nouveau contact.

## Validation exécutée

```bash
npm run typecheck
npm run validate:43      # sortie : docs/validation/etape-43-sortie.txt
```

Pile isolée (deux bank-mock, dont un avec verrou, Client Wallet, site) et bitcoind regtest. Résultat observé : typecheck
sans erreur ; `validate:43` : 6 critères sur 6 réussis (code de sortie 0).

| # | Critère | Observé |
| --- | --- | --- |
| 43-1 | Client Wallet : sans la nouvelle politique, le déplacement est un paiement externe de montant élevé ; avec elle, sortie « new account (new trusted contact) », pas de montant élevé, contact Marie Dupont → Bob ; autre clé Swissquote ou autre délai : refusé | conforme ; 400 ; 400 |
| 43-2 | Signature et diffusion : les coins passent de l'ancienne à la nouvelle règle | ancienne règle : 0 coin ; nouvelle : 1 coin de 39 999 542 sats |
| 43-3 | Registre Swissquote : verrou, même contact, contact = soi, clé invalide, nom vide, compte d'un autre client ; puis succès | 403 ; 409 ; 400 ; 400 ; 400 ; 403 ; 200 (Bob) |
| 43-4 | Recovery de la nouvelle règle : refusée avant la mise à jour du registre, signée après | 403 puis 200, 1 signature ajoutée |
| 43-5 | Après mise à jour de la politique : le client dépense seul sous la nouvelle règle | chemin `client`, rendu reconnu, diffusé |
| 43-6 | Interface Chrome : Sécurité → formulaire → préparation → Client Wallet « Confirm the change of trusted contact » avec Bob et sa clé | conforme, 0 erreur JS |

Captures : `captures/etape-43-1-site-preparation.png`, `etape-43-2-wallet-confirmation.png`.

Défaut trouvé et corrigé pendant l'étape : la première version de l'assistant se fiait à la liste de coins déjà en
mémoire ; si elle n'était pas encore chargée, il aurait annoncé « aucun coin à déplacer » et changé le contact en laissant
les fonds sous l'ancienne règle. Les coins sont maintenant relus sur la chaîne au moment de préparer.

## Constat sur l'environnement de test (regtest)

`BitcoindBackend.history` crée un portefeuille de surveillance `sq-watch-*` par compte observé et ne le décharge jamais.
Après les validations précédentes, 145 étaient chargés : bitcoind devait tous les mettre à jour à chaque bloc, et miner un
bloc prenait plusieurs minutes (les validations expiraient). Déchargés (les fichiers restent sur disque), le nœud a repris
immédiatement. La boucle d'alertes regtest de bank-mock (toutes les 30 s, y compris quand la démo tourne sur signet) en
créait aussi : la démo a été relancée avec `ALERT_INTERVAL_MS=0`. `validate:43` décharge ces portefeuilles avant et après.
Non corrigé : le backend lui-même (à décharger ou à réutiliser).

## Limites

- **Bitcoin seulement.** Le contact de l'Ethereum (module de recovery du Safe, deux gardiens) est une autre mécanique
  (transaction du Safe) : étape suivante, non faite ici.
- **La biométrie est simulée** dans le test (secret PRF aléatoire, comme aux étapes 37 et 41). L'interface est vérifiée
  jusqu'à l'écran de confirmation du Client Wallet, sans valider Touch ID. Le parcours complet dans le navigateur
  (signature réelle, diffusion, mises à jour) n'a pas été exécuté.
- **Fenêtre entre la diffusion et la mise à jour de Swissquote** : tant que le registre n'est pas à jour, Swissquote refuse
  de relire une recovery de la nouvelle règle (observé : 403 avant, signé après). Un bouton « Retry » est proposé.
- **Coins reçus plus tard à une ancienne adresse** (l'ancienne règle) : le site ne regarde plus que le compte actif, ils
  seraient invisibles dans l'onglet et resteraient sous l'ancien contact. L'ancienne adresse n'est plus proposée à la
  réception ; il faut éviter de la réutiliser. Non géré.
- **Frais** : le déplacement coûte des frais réseau.
- **Registre bank-mock** : un seul compte par clé client (contrainte d'unicité) ; la mise à jour est donc faite sur place.
  L'ancien contact n'est conservé que dans le journal `tiers_changes`.
