# Étape 2 : bank-mock (guardian Swissquote) et console guardian (tiers)

## Livré

| Élément | Emplacement | Rôle |
| --- | --- | --- |
| bank-mock | `bank-mock/src/` (port 4000, stockage `bank-mock/data/` : SQLite + graine en mode 600, ignoré par git) | Guardian Swissquote **mocké**, processus séparé |
| Console guardian | `guardian-console/` (port 5174, appli séparée) | Le tiers lit la demande en clair, saisit sa phrase, signe ; rien n'est conservé |
| Appli cliente | `client/src/lib/bank.ts`, `AccountSetup.tsx`, `App.tsx` | Récupère la clé publique Swissquote et enregistre le compte. Facultatif : l'appli fonctionne sans bank-mock |

### Endpoints de bank-mock

| Route | Effet |
| --- | --- |
| `GET /guardian/key?network=` | Clé **publique** de compte Swissquote (la graine ne sort jamais) |
| `POST /accounts/register` | Enregistre un compte (clé client, clé tiers, délai) pour un client de la banque simulée |
| `POST /identity/verify` | Re-KYC **mocké** : un dossier de test par client ; renvoie un jeton valable 10 min |
| `POST /guardian/sign` | Signe un PSBT **seulement si** : jeton KYC valide ; toutes les entrées dépensent un script d'un compte enregistré de ce client (le scriptPubKey est recalculé) ; chemin recovery (nSequence = D) ; toutes les sorties vont vers un **autre** compte enregistré du **même** client. Chaque décision est journalisée (`sign_log`) |

Ces contrôles sont une couche en plus. La garantie réelle, deux signatures et le délai D, est imposée par le consensus Bitcoin (voir le test 6).

## Commandes

```bash
npm run regtest:up
npm run validate:2        # lance son propre bank-mock (port 4100, stockage .local/bm-test), puis l'arrête au test 7
npm run dev               # client (5173), bank-mock (4000), console (5174)
npm run validate:2:ui     # Chrome headless ; CONSOLE_URL / APP_URL si les ports par défaut sont pris
```

## Résultats (`etape-2-sortie.txt`, `etape-2-ui-sortie.txt`)

| # | Critère | Verdict |
| --- | --- | --- |
| 1 | Clé Swissquote générée au premier lancement, dans le stockage de bank-mock (mode 600) ; seule la clé publique est exposée | fonctionne |
| 2 | Enregistrement des comptes ; client inconnu refusé (403) | fonctionne |
| 3 | **Identité non vérifiée refusée** par `/guardian/sign` (sans jeton, jeton inventé) ; mauvais code OTP refusé | fonctionne |
| 4 | Après re-KYC : Swissquote signe la recovery A → B du même client, avec sa propre clé (vérifiée sur la signature) | fonctionne |
| 5 | Refus : dépense courante (chemin client), recovery vers une adresse étrangère, coins d'un autre client | fonctionne |
| 6 | Le tiers signe (code de la console) ; le PSBT combiné est refusé par le nœud avant D (`non-BIP68-final`) et accepté à D | fonctionne (aperçu de l'étape 3) |
| 7 | **bank-mock arrêté** : `/guardian/sign` injoignable (`ECONNREFUSED`), et **le client dépense seul** (signature externe, diffusion) | fonctionne |
| 8 | **Aucune clé dans `client/`** : 0 clé privée étendue, graine Swissquote absente, aucun import de signature ou de graine, pas de liste BIP39 dans le bundle | fonctionne |
| UI-1 | Console : la clé publique affichée correspond à la phrase ; le champ phrase est vidé | fonctionne |
| UI-2 | Console : une dépense courante est signalée (« PAS une recovery ») et le bouton de signature est désactivé | fonctionne |
| UI-3 | Console : la recovery est décodée (délai, destination) puis signée avec la clé du tiers | fonctionne |
| UI-4 | Console : phrase absente de localStorage, de sessionStorage, du DOM et des champs après signature | fonctionne |
| UI-5 | Appli : clé Swissquote obtenue de bank-mock, compte créé puis enregistré | fonctionne |
| UI-6 | Aucune erreur dans la console des navigateurs | fonctionne |

Commande de recherche de clés du test 8 :

```bash
grep -rlE '[tx]prv[1-9A-HJ-NP-Za-km-z]{100,}' client/src client/dist
grep -rlF "<graine Swissquote>" client/src client/dist
grep -rlE '@sq/bitcoin/(sign|keys)|mnemonicToSeed|swissquote-seed|bank-mock/data' client/src
grep -rl '"abandon","ability"' client/dist
```

Captures : `captures/etape-2-console-guardian.png`, `captures/etape-2-appli-enregistree.png`.

## Limites assumées

- Re-KYC **mocké** : deux dossiers de test codés en dur (`bank-mock/src/kyc.ts`). Le jeton est réutilisable pendant 10 min.
- La session bancaire est mockée : le client est identifié par `VITE_CUSTOMER_ID`, sans authentification.
- `node:sqlite` est marqué expérimental dans Node 24 (avertissement masqué au lancement).
- La console guardian tourne dans un navigateur : la phrase y transite en mémoire le temps de la signature. Un vrai tiers utiliserait son propre wallet.
- La preuve de propriété d'adresse (optionnelle) n'est pas faite.
