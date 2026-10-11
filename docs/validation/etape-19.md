# Step 19: one wallet, one network at a time (MetaMask-style layout)

Request from the user: instead of one section per blockchain stacked on the Crypto page, a network selector at the top (as in MetaMask) and a single network shown at a time. No change to the custody logic.

## Delivered

| Item | Location |
| --- | --- |
| Wallet home: "My wallet" + network pill (icon, network, short address) + menu listing both accounts with balance, address and copy; note "same secret phrase, kept in your Client Wallet; Swissquote never holds their keys". Choice remembered per client. Both views stay mounted (hidden) so a prepared operation or a recovery countdown survives a network switch | `client/src/wallet/WalletHome.tsx`, `CryptoTab.tsx`, `index.css` |
| Ethereum page rebuilt on the Bitcoin page's layout: header (USDC balance, CHF at a simulated rate, protection chip, actions Receive / Send / Recover / Transfer "soon"), side panel (receive with QR, send, recovery), tabs Activity / Assets / Security | `client/src/wallet/Ethereum.tsx`, `lib/config.ts` (`USDC_CHF`) |
| Ethereum **activity read on-chain**: USDC transfers in/out and the recovery module's events (started, completed, cancelled, signatures invalidated) | `packages/evm/src/index.ts` (`activity`) |
| Bitcoin page: "History" renamed "Activity" (same word on both networks) | `client/src/wallet/Account.tsx` |
| **Fix of an existing defect**: the app shell rendered two different trees for phone and desktop, so crossing the 820 px width rebuilt the whole app and lost its state (seen on a desktop full-page capture showing "Loading…"; a user resizing or rotating would lose a prepared operation or a recovery in progress). One tree now; the content keeps its position | `client/src/ui/Shell.tsx` |
| Tests 17 and 18 follow the new navigation (network selector, "Send" and "Recover" actions) | `scripts/validate/etape-17-evm-ui.ts`, `etape-18-evm-recovery-ui.ts` |

## Verified before coding the activity reader (not assumed)

- Recovery module events: the keccak of each candidate signature matches the topic0 observed in the logs of our own step 18 transactions: `RecoveryExecuted(address,address[],uint256,uint256,uint64,uint256)` `0x1fa7…bf01`, `RecoveryFinalized(address,address[],uint256,uint256)` `0x8f02…ad5a`, `RecoveryCanceled(address,uint256)` `0x81da…0519`, `NonceInvalidated(address,uint256)` `0x1800…6241`. Topic1 is the Safe.
- The public Sepolia node has **pruned** old history: `eth_getLogs` beyond a few thousand blocks returns `pruned history unavailable`. The reader goes backwards by 2,000-block chunks and stops at the first pruned chunk; the page says "Read on-chain since block N (the public node keeps a limited history)". Observed: about 10,000 blocks (≈ 33 h), 23 events for the demo Safe.

## Commands

```bash
npm run demo:signet:ports
npm run validate:19          # layout, menu, remembered choice, on-chain activity, resize across the breakpoint, captures
npm run validate:17 && npm run validate:18   # Ethereum journeys on the new layout (real Sepolia, no ETH)
```

## Results (`etape-19-sortie.txt`, captures `etape-19-*.png`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 19-ordinateur / 19-telephone | One network shown at a time; menu lists Bitcoin (0.00008898 BTC) and Ethereum (17 USDC) with addresses; choice remembered after reload; Ethereum activity read on-chain (rows shown) | works |
| 19-resize | Resizing across the phone/desktop threshold keeps the chosen network and the page (no rebuild) | works (after the `Shell` fix) |
| 19-x | No error in the browser consoles | works |
| 17-1 … 17-4 | Ethereum account, activation (already done), refusal of an undecodable call, **1 USDC sent** from the new layout | works ([tx 0x5ef2…97ea](https://sepolia.etherscan.io/tx/0x5ef29a63a26a4e576774649b4ca658f6fb501cf412351915a668734506c897ea), solde 18000000 -> 17000000 in 10^-6 USDC) |
| 18-1 … 18-5 | Full Ethereum recovery from the new layout ("Recover" action, side panel) | works |

## Runs that failed along the way (all recorded)

| Run | Cause | Fix |
| --- | --- | --- |
| validate:17 | `getByText(/USDC sent/)` matched both the confirmation banner and the new activity row (the send itself had succeeded) | test targets the banner (`USDC sent: 0x…`) |
| validate:18 | same with "Recovery completed" (the recovery itself had completed) | test targets the banner |
| validate:19, run 1 | full-page capture showed "Loading…" on desktop | `Shell` defect above |
| validate:19, run 2 | Ethereum activity stayed on "Loading…": a chunk request failed in the browser and the error was swallowed. The same reader worked 3/3 from Node | each chunk is retried (load-balanced public node); an error is now **shown** with a Retry button instead of an endless "Loading…" |

## Non-regression (`etape-19-regressions-sortie.txt`)

Typing of the 8 projects; full journey `validate:6:ui` 19/19 desktop and 20/20 phone, run again after the `Shell` change; invariant 5.

## Not done (to say plainly)

- The Bitcoin and Ethereum recoveries are still two flows (Bitcoin full screen, Ethereum side panel), not a single shared stepper.
- Swissquote ↔ wallet transfers exist for Bitcoin only ("Transfer (soon)" on Ethereum).
- The footer and the home page total still count BTC only (USDC not added).
- The visual design is the current one; the user is preparing a Figma design to apply on top of this structure.
