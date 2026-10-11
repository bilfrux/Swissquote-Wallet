# Step 23: countdown before a Bitcoin recovery becomes possible

Request from the user: the warning "N coin(s) soon spendable by Swissquote + Marie Dupont…" is a good idea, but it needs a timer of the time left before the end of the delay.

## Delivered (`client/src/wallet/Account.tsx`, `index.css`)

- **Countdown** in the warning, live (every second), for the coin closest to the deadline: "in N block(s), about 1 h 32 min 10 s (around 14:32, estimated at ~10 min per block)".
- **Delay already elapsed**: separate red warning "N coin(s) can already be moved by Swissquote + Marie Dupont: the 6-block delay has elapsed… use Refresh now".
- Header chip and **Coins** tab: estimated time per coin next to the blocks left.
- **Honest estimate**: Bitcoin counts the delay in blocks, not in time. The estimate is blocks left × 10 minutes (target rate of Bitcoin and signet), recomputed at each scan. On regtest (blocks mined on demand), only the number of blocks is shown.

## Observed

- On the real signet account CH-0003 (coin `c5ca6873…:0`, 20 confirmations, D = 6): red warning "1 coin(s) can already be moved by Swissquote + Marie Dupont: the 6-block delay has elapsed…", Coins tab "open"; no console error.
- The ticking countdown itself needs a coin still inside the delay (for example right after a "Refresh"): **not observed yet on signet**.

## Non-regression (`etape-23-regressions-sortie.txt`)

`validate:6:ui` 19/19 desktop and 20/20 phone (regtest: block count without time).
