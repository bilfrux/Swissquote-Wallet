# Step 5: deliverables

Delivered: `README.md`, `docs/threat-model.md`, `docs/architecture.md`, `docs/ia.md`, and for the demo `npm run demo` and `npm run regtest -- fund|mine`.

## Checks run

| Criterion | Command | Verdict |
| --- | --- | --- |
| The demo starts with three commands (`npm install`, `npm run regtest:up`, `npm run demo`): app, bank-mock, console, attacks | `npm run demo`; `curl localhost:4000/health`; attack server on 4200 | works (console on 5175, because 5174 was taken by another process on the machine; Vite reports it) |
| The demo stack supports the full recovery journey | `CONSOLE_URL=http://localhost:5175 npm run validate:3:ui` against `npm run demo` | works, 7/7 |
| The "Attacks" panel of the demo stack | `npm run validate:4:ui` against `npm run demo` | works, 4/4 |
| Regtest demo helpers | `npm run regtest -- fund <address> 0.01`; `npm run regtest -- mine 2` | works |
| The two Mermaid diagrams render | Rendered in Chrome with mermaid 12.1.0 (installed outside the repository) | works (SVG produced, no error) |
| The cited proof files exist | `test -f docs/validation/…` | works |
| Typing of the 6 projects | `npm run typecheck` | works |

## Security claims of the deliverables: demonstrated or declared?

| Claim | Status | Evidence |
| --- | --- | --- |
| Swissquote alone cannot spend through any path | **Demonstrated** (consensus rejection, two paths, after D) | `etape-4-attaques-sortie.txt`, invariant-1 |
| Swissquote + contact cannot spend before D | **Demonstrated** (regtest and signet) | attack 2; `etape-3-sortie.txt`; `etape-3-signet-sortie.txt` |
| Swissquote + contact can spend after D without refresh (grey zone) | **Demonstrated** (accepted by the node, not broadcast) | attack 2, information line |
| Refresh blocks the recovery and resets the delay | **Demonstrated** | `etape-3-sortie.txt`, test 2 |
| The client spends alone, Swissquote stopped | **Demonstrated** | attack 3; `etape-2-sortie.txt`, test 7 |
| No client private key in the app, no guardian key in `client/` or its bundle | **Demonstrated** for the seeds present on the machine and the generic patterns, with positive control | `etape-4-invariant-5-sortie.txt` |
| The contact's phrase is not kept by the console | **Demonstrated** (storage, DOM, fields) | `etape-2-ui-sortie.txt`, UI-4 |
| An attacker without the guardians' keys is refused | **Demonstrated** (attacker signatures rejected; re-KYC refused) | attack 1 |
| "Nobody can block the client" / "any node is enough" | **Partially demonstrated**: bank-mock stopped, and broadcast through a public Esplora. Censorship by a network third party is **declared** | attack 3; step 1 signet |
| The external wallet displays what it signs | **Demonstrated for `tools/client-signer`**; **declared** for real wallets | `etape-1-signet-sortie.txt` |
| Bitcoin Core signs the policy | **Demonstrated** (regtest) | `etape-1-regtest-sortie.txt`, test 4 |
| Liana and hardware wallets compatible | **Declared** (announced, not verified) | — |
| Sparrow incompatible | **Declared** (GitHub issues, not verified) | — |
| Bitcoin cannot restrict the destination of a recovery | **Declared** (protocol property, no covenant) | — |
| Swissquote closed + key lost = funds lost; contact without key = recovery impossible | **Declared** (consequences of the policy), not tested | — |
| Re-KYC | **Mocked**: secondary layer, not representative of a real KYC | `etape-2-sortie.txt` |
