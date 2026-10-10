# Étape 12 (A3, première partie) : recovery sans copier-coller, relais Swissquote vers le tiers

## Livré

- bank-mock : `POST /relay` (session du client, dépose le PSBT déjà signé par Swissquote), `GET /relay?id=` (lecture par le tiers), `POST /relay/signed` (renvoi de la signature ; refusé si ce n'est pas la même transaction). Identifiant aléatoire de 128 bits. Table `relay`.
- Appli (recovery, étape 5) : « Envoyer la demande à <tiers> » donne un lien vers la console ; « Récupérer la signature du tiers ». L'échange manuel du PSBT reste disponible, replié, si Swissquote est indisponible.
- Console du tiers : ouverte avec `?req=…`, elle charge la demande, le tiers vérifie le décodage et signe avec sa phrase (toujours lue au clic, jamais transmise), puis « Renvoyer au client via Swissquote ».

## Commandes et résultats

```
npm run regtest:up
npm run validate:12
npm run validate:6:ui            # et MOBILE=1
```

| # | Critère | Verdict |
| --- | --- | --- |
| 12-1 | Dépôt de la demande refusé sans session (401) ; le tiers relit le PSBT identique par l'identifiant | fonctionne (`etape-12-sortie.txt`) |
| 12-2 | Signature du tiers renvoyée puis récupérée ; PSBT d'une autre transaction refusé (400) ; identifiant inconnu (404) | fonctionne |
| 6-20 | Chrome : envoi au tiers par lien, PSBT chargé dans sa console, signature renvoyée, récupérée, recovery diffusée | fonctionne (ordinateur 19/19, téléphone 20/20) |
| — | Parcours signet (`validate:8:signet`) : adapté pour ouvrir l'échange manuel replié | **non exécuté** (attente du coin signet) |
| — | Autres non-régressions (`validate:1`…`11`, attaques) | **non relancées** pour cette petite étape ; seul le typage et `validate:6:ui` l'ont été |

## Limites

- Le lien est transmis au tiers hors de l'appli (pas encore de notification ni de boîte de réception du tiers).
- Le lien suffit pour lire la demande (pas d'authentification du tiers) : il révèle le PSBT, qui n'est pas un secret de dépense, mais révèle des montants et adresses.
- Swissquote transporte : elle pourrait bloquer le relais, d'où l'échange manuel conservé.
- La console du test 6 est désormais une instance propre au test (port 5192), et non `CONSOLE_URL`.
