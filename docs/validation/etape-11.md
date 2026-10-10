# Étape 11 (A2) : transferts compte Swissquote ↔ wallet, avec preuve de propriété automatique (Travel Rule)

Idée de la track : passer du crypto en garde chez Swissquote (offre actuelle) au self-custody, sans copier-coller d'adresse et sous la Travel Rule (wallet auto-hébergé : Swissquote doit établir que le wallet appartient à son client).

## Livré

| Élément | Emplacement |
| --- | --- |
| Compte crypto Swissquote **custodial** : registre des avoirs MOCKÉ (soldes de démo : CH-0001 1,5 BTC, CH-0002 0,4 BTC, CH-0003 0,8 BTC) | `bank-mock/src/custody.ts` (`custody_ledger`) |
| Portefeuille omnibus **réel** de Swissquote dans bitcoind (regtest), créé et approvisionné par minage de démo ; sans rapport avec la clé de guardian | `custody.ts` (`omnibus`) |
| Retrait vers le wallet : seulement vers une adresse d'un compte enregistré du client (403 sinon), **et seulement après une preuve de propriété vérifiée** pour cette adresse (412 sinon) ; enregistrement Travel Rule (donneur d'ordre, bénéficiaire, référence de la preuve) | `custody.ts` (`withdraw`), routes `POST /custody/withdraw`, `GET /ownership/status`, `GET /custody/travel-rule` |
| Dépôt vers Swissquote : adresse de dépôt du client ; crédité seulement si **toutes** les entrées viennent d'un wallet enregistré du client, sinon « en attente de vérification », non crédité | `custody.ts` (`depositAddress`, `syncDeposits`) |
| Interface : bouton « Transférer » du compte ; la preuve de propriété est demandée **automatiquement** au Wallet du client (PIN) quand l'adresse n'en a pas encore ; « Préparer un dépôt » préremplit l'envoi vers l'adresse de dépôt ; liste Travel Rule ; compte crypto Swissquote dans l'accueil | `client/src/wallet/Transfer.tsx`, `lib/ownership.ts`, `lib/bank.ts`, `wallet/Account.tsx`, `bank/Overview.tsx` |

## Commandes et résultats

```
npm run regtest:up
npm run validate:11
CONSOLE_URL=http://localhost:5175 npm run validate:6:ui
MOBILE=1 CONSOLE_URL=http://localhost:5175 npm run validate:6:ui
```

| # | Critère | Verdict |
| --- | --- | --- |
| 11-1 | Retrait sans preuve : 412 « Travel Rule : preuve de propriété requise » ; vers une adresse étrangère : 403 | fonctionne (`etape-11-sortie.txt`) |
| 11-2 | Après preuve vérifiée (BIP-322, `bip322-js`) : 0,3 BTC envoyés on-chain par l'omnibus, reçus dans le wallet, solde Swissquote débité | fonctionne |
| 11-3 | Enregistrement Travel Rule : donneur d'ordre et bénéficiaire (même personne, wallet auto-hébergé), référence de la preuve | fonctionne |
| 11-4 | Retrait supérieur aux avoirs : 400 | fonctionne |
| 11-5 | Dépôt venant du wallet : crédité ; dépôt d'une source inconnue : en attente, non crédité | fonctionne |
| 11-6 | Signet : refus explicite (501), l'omnibus signet n'est pas approvisionné | fonctionne |
| 6-19 | Chrome : « Transférer » 0,1 BTC → preuve signée dans le Wallet du client avec le PIN → envoi → ligne Travel Rule affichée | fonctionne (ordinateur et téléphone : `etape-11-ui-ordinateur-sortie.txt`, `etape-11-ui-telephone-sortie.txt`) |
| Parcours complet | `validate:6:ui` : 18/18 sur ordinateur, 19/19 sur téléphone | fonctionne |
| Non-régression | `validate:1`, `2`, `3`, `7`, `8:pin`, `8:alerts`, `10`, `11`, `test:attacks`, `validate:inv5` ; typage des 7 projets | fonctionne (`etape-11-regressions-sortie.txt`) |
| — | Dépôt depuis l'interface (bouton « Préparer un dépôt » puis « Vérifier mes dépôts ») | **non testé dans Chrome** (logique testée en 11-5) |

## Ce qui a été observé en chemin

- Première version : l'appli tentait le retrait, recevait 412, puis faisait la preuve. Le parcours fonctionnait, mais la console du navigateur affichait l'erreur 412. Désormais l'appli demande d'abord `GET /ownership/status` et ne fait la preuve que si nécessaire. Le 412 reste le garde-fou côté serveur (11-1).
- Une exécution sur ordinateur a montré une fois une **erreur 500** non identifiée (la console ne donnait pas l'URL). Je ne l'ai pas reproduite sur 5 exécutions suivantes (3 sur ordinateur, 2 sur téléphone). Le test note maintenant la méthode, l'URL et la réponse de toute erreur 5xx pour la diagnostiquer si elle revient. **Cause non établie.**

## Limites

- Regtest uniquement : sur signet, l'omnibus n'est pas approvisionné (refus explicite 501).
- Registre des avoirs mocké ; l'omnibus est approvisionné par minage de démo.
- La preuve porte sur la détention de la clé client à l'index de l'adresse (voir étape 7), pas sur une signature de l'adresse P2WSH elle-même.
- Le contrôle de provenance des dépôts est simple : toutes les entrées doivent venir d'une adresse (lookahead 50) d'un compte enregistré du client. Pas d'analyse de chaîne ni de screening de sanctions (mock prévu pour la partie EVM).
- L'enregistrement Travel Rule est local. Aucune transmission à un autre prestataire (inutile ici : le bénéficiaire est un wallet auto-hébergé du même client).
