# Projet : wallet self-custody Swissquote (hackathon, solo, 24 h)

Lis SPEC.md en entier. La section « Révisions après revue critique » prime sur le reste.

Règles :
- Ne jamais écrire de cryptographie maison (signatures, EIP-712, WebAuthn, génération de clés) : utiliser des bibliothèques établies.
- Aucune clé de Swissquote ni de guardian dans client/. Le backend est un processus séparé (bank-mock/).
- Ne rien supposer sur Candide, Safe ou les passkeys : vérifier dans la doc ou en exécutant, et dire ce qui est confirmé ou non.
- Une étape à la fois. Ne pas passer à la suivante tant que la validation de la spec n'est pas observée.
- Un commit par étape, et un fichier docs/validation/etape-N.md avec la commande lancée et ce qui a été observé.
- Aucun secret dans le dépôt : .env.example uniquement.
- Si une hypothèse de la spec est fausse, t'arrêter et me le dire avant de la contourner.
- Ne déclare jamais une validation réussie sans l'avoir exécutée.
