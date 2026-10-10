# Handoff: state of the project and what remains

Branch `modele-2-guardians`. Read `CLAUDE.md` (rules), `SPEC.md` (the later sections take precedence), then this file.

## Project

Hackathon (EPFL, Swissquote track, solo, 24 h): self-custody wallet Swissquote could launch. Track story: create wallet → log in and sign → lose keys → recover. Scoring: technical 35, security 20, legal 15, business 15, UX/pitch 15, bonus up to +20 (gasless, compliant dApp), granted only if create → sign → recover works end to end.

Model: the client holds their own key in the **Client Wallet** (separate reference app). Two guardians: Swissquote (`bank-mock/`, separate process) and a trusted contact (`guardian-console/`, phrase never stored). Bitcoin policy `or(pk(C),and(pk(S),and(pk(T),older(D))))`, P2WSH, D = 6 blocks in the demo.

## Done (all committed)

| Area | State |
| --- | --- |
| Bitcoin core | Policy, descriptors, PSBT, scan, history, fees (Esplora + bitcoind), refresh, recovery refused before D and accepted at D (regtest and real signet) |
| Apps | Swissquote-style e-banking (desktop + phone), Crypto tab, Client Wallet (PIN scrypt+AES-GCM, confirmation screen), guardian console, attack panel (3 attacks + invariants 1 and 5) |
| Step 7 | BIP-322 address ownership proof; blank client `CH-0003` (`demo0003`, re-KYC `Martin` / `1992-03-21` / `246810`) |
| Step 8 | PIN, alerts (bell + simulated email), signet UI create phase |
| Step 9 | History and fee estimation, Esplora rate-limit handling |
| A1 (step 10) | Passkey login (WebAuthn), step-up above 0.2 BTC, wallet asks PIN + last 6 chars of the address |
| A2 (step 11) | Swissquote custodial crypto account ↔ wallet transfers, automatic ownership proof, Travel Rule records (regtest only) |
| A3 part 1 (step 12) | Recovery without copy-paste: link relayed through bank-mock (`/relay`), contact signs in console |
| Step 13 | Whole interface and documentation translated to English |

Last verified: `npm run typecheck`; `validate:6:ui` desktop 19/19 and phone 20/20; `validate:1,2,3,7,8:pin,8:alerts,9,10,11,12,inv5`, `test:attacks` all pass. Reports in `docs/validation/etape-N.md` (raw outputs in `*-sortie.txt`, kept as recorded, French).

## Remaining

### Bitcoin
1. **Signet UI spend and recovery** (8-3, 8-4): the faucet coin (tx `8a34bfcd…e34a2`, 10,000 sats, wallet CH-0003 address `tb1qsd8naqffu8q4460kjvwd3nmu4svzw5tmg3xdv06q0nh6zeyl2xuq9m06j6`) is now confirmed. The first run of `CONSOLE_URL=http://localhost:5175 npm run -s validate:8:signet -- spend` failed at `login` in `scripts/validate/etape-8-signet-ui.ts:42` ("Execution context was destroyed"): wait for navigation to finish before reading the page. Then run `recover`, update `etape-8.md`, commit. Watch the blockstream.info rate limit (700 req/h/IP).
2. **A3 rest**: trusted contact inbox and notification (today the link is passed by hand).
3. Not tested: high-value amount with Swissquote unreachable in the UI; deposit button flow in Chrome; one unexplained 500 seen once in the desktop test (cause unknown; the test now logs any 5xx).
4. Not rerun after A3/step 13: signet scripts; old `etape-1/2/3-ui` scripts target the pre-redesign UI.

### Ethereum (priority 2, nothing coded)
Safe owned by the client's EOA (key in Client Wallet) + Candide SocialRecoveryModule v0.0.1 (Swissquote + contact, threshold 2; Sepolia addresses in `docs/validation/etape-0.md`; pitfalls: `cancelRecovery` + `invalidateNonce`, guardian removal does not cancel). Then gasless (ERC-4337 + paymaster or EIP-7702), compliant dApp interaction (allowlist, mocked sanctions screening, plain-language simulation, threshold checks), then MetaMask-like features. Decisions to confirm with the user: dApp connection (extension vs WalletConnect), networks (Sepolia fork then real), gas option.

### A4 written deliverables (cheap, worth many points)
Comparison of the 5 custody models; custody and grey-zone argument; Travel Rule; quantified business case (explicit assumptions, no unsourced Swissquote figures); pitch/slides; backup video; complete `docs/ia.md` ("to be completed by the team" row). Open question: clean the demo data of CH-0001/CH-0002?

### Housekeeping
Code comments and `CLAUDE.md` are still in French (CLAUDE.md quotes the old French heading "Révisions après revue critique", now "Revisions after critical review" in `SPEC.md`). Background `npm run demo:signet` may still be running (user's own processes on 5173/5174/5175 must not be killed). Existing `bank-mock/data` keeps old French alerts/records.

## Rules to keep
Never write home-made cryptography; no Swissquote/guardian key in `client/`; verify Candide/Safe/passkey behaviour by running, say what is confirmed or not; one step at a time, one commit and one `docs/validation/etape-N.md` per step; no secret in the repo; stop and tell the user if a spec assumption is false; never declare a validation successful without running it. Commit trailers: `Co-Authored-By: Claude <model> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_015sawmA3ZuHPFdJ27QPWB6K`.
