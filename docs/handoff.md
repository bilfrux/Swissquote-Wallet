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
| Step 8 (end) | Signet, from the interface: send `f7ce359c…` and Swissquote + contact recovery `c5ca6873…` (A3 relay) |
| Step 14 | Regtest: the recovered key spends, the old one cannot; race after D (client first / guardians first / mempool replacement) |
| A4 | `docs/custody-models.md`, `docs/travel-rule.md`, `docs/business-case.md` (illustrative assumptions kept for now) |
| Steps 15-16 | EVM on the real Sepolia with no ETH (Candide public bundler + paymaster): Safe + recovery module (3 min) + 2 guardians; Swissquote alone refused; early finalize refused; recovery to a new key; old key refused; owner cancels a hostile recovery. Script only (`scripts/feasibility/e2e-sepolia.ts`) |
| Steps 17-18 | Ethereum in the product: one phrase, two accounts; Safe activation, USDC balance and send (sponsored), refusal to sign what the wallet cannot decode; recovery from the interface (re-KYC, EIP-712 signatures of Swissquote and the contact via the relay, countdown, completion). `packages/evm`, `validate:17`, `validate:18` |
| Steps 19-26 | One network at a time (MetaMask-style selector), Ethereum activity read on-chain, market prices and charts, Esplora rate-limit resilience, public site (markets, login) in EN/FR/DE/IT, crypto screens in French, Bitcoin refresh and recovery countdown on signet, threat model covers Ethereum |
| Steps 27-35 | Passkey login removed (passkey kept for step-up and the smart account), passkey wording and rules, Client Wallet and contact console visuals aligned, testnet assets valued, direct USDC unlock |
| Steps 36-37 | Client Wallet unlocked by biometrics (WebAuthn PRF, HKDF + AES-256-GCM); the PIN format is kept only to migrate old wallets. Step 37 repaired commit 36 (missing `vault.ts`/`store.ts`) and added `validate:37` |
| Submission docs | README rewritten for Bitcoin and Ethereum (it still said Ethereum was out of scope); `docs/ia.md` unchanged |

Last verified: `npm run typecheck`; `validate:6:ui` desktop 19/19 and phone 20/20; `validate:1,2,3,7,8:pin,8:alerts,9,10,11,12,inv5`, `test:attacks` all pass. Reports in `docs/validation/etape-N.md` (raw outputs in `*-sortie.txt`, kept as recorded, French).

## Remaining

### Bitcoin
1. Done: signet UI spend and recovery (step 8). Run the signet demo on free ports: `APP_URL`/`CONSOLE_URL`, and `VITE_GUARDIAN_CONSOLE_URL` for the relay link.
2. **A3 rest**: trusted contact inbox and notification (today the link is passed by hand).
3. Not tested: high-value amount with Swissquote unreachable in the UI; deposit button flow in Chrome; one unexplained 500 seen once in the desktop test (cause unknown; the test now logs any 5xx).
4. Not rerun after A3/step 13: signet scripts; old `etape-1/2/3-ui` scripts target the pre-redesign UI.

### Ethereum
Decisions taken (11 Oct): ERC-4337 + paymaster; local fork then real Sepolia; local demo dApp (no WalletConnect). Done: steps 15-18 (script, then interface: account, USDC send, recovery). Gasless is delivered by Candide's public paymaster (no Swissquote policy). **Not done: compliant dApp interaction** (no code: approved list, sanctions screening, dApp connection). Pitfall observed: read chain state at the receipt's block (public RPC node returns stale state).

### A4 written deliverables (cheap, worth many points)
Done: comparison of the 5 custody models, custody and grey-zone argument, Travel Rule, business case. Remaining: backup video; complete `docs/ia.md` (the pitch slides exist on branch `worktree-slides-pitch`, not merged here) ("to be completed by the team" row). Open question: clean the demo data of CH-0001/CH-0002?

### Housekeeping
Code comments and `CLAUDE.md` are still in French (CLAUDE.md quotes the old French heading "Révisions après revue critique", now "Revisions after critical review" in `SPEC.md`). Background `npm run demo:signet` may still be running (user's own processes on 5173/5174/5175 must not be killed). Existing `bank-mock/data` keeps old French alerts/records.

## Rules to keep
Never write home-made cryptography; no Swissquote/guardian key in `client/`; verify Candide/Safe/passkey behaviour by running, say what is confirmed or not; one step at a time, one commit and one `docs/validation/etape-N.md` per step; no secret in the repo; stop and tell the user if a spec assumption is false; never declare a validation successful without running it. Commit trailers: `Co-Authored-By: Claude <model> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_015sawmA3ZuHPFdJ27QPWB6K`.
