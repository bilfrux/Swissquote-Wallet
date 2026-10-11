# Step 23: countdown before a Bitcoin recovery becomes possible

Request from the user: the warning "N coin(s) soon spendable by Swissquote + Marie Dupont…" is a good idea, but it needs a timer of the time left before the end of the delay.

## Delivered (`client/src/wallet/Account.tsx`, `index.css`)

- **Countdown** in the warning, live (every second), for the coin closest to the deadline: "in N block(s), about 1 h 32 min 10 s (around 14:32, estimated at ~10 min per block)".
- **Delay already elapsed**: separate red warning "N coin(s) can already be moved by Swissquote + Marie Dupont: the 6-block delay has elapsed… use Refresh now".
- Header chip and **Coins** tab: estimated time per coin next to the blocks left.
- **Honest estimate**: Bitcoin counts the delay in blocks, not in time. The estimate is blocks left × 10 minutes (target rate of Bitcoin and signet), recomputed at each scan. On regtest (blocks mined on demand), only the number of blocks is shown.

## Observed

- On the real signet account CH-0003 (coin `c5ca6873…:0`, 20 confirmations, D = 6): red warning "1 coin(s) can already be moved by Swissquote + Marie Dupont: the 6-block delay has elapsed…", Coins tab "open"; no console error.
- **Refresh done from the interface on signet** (at the user's request): self-transfer signed in the Client Wallet, [tx 23f284c1…e857](https://blockstream.info/signet/tx/23f284c1b1e98a21a327ef5f1a34f26a9a386bcac2c5f19a7da8bb7fc974e857), 8,898 → 8,616 sats (fee 282). The old coin is spent, so the "already movable" warning disappeared.
- **Countdown observed ticking**: header chip "Recovery possible in 7 block(s) (≈ 1 h 10 min 00 s)" then "(≈ 1 h 09 min 56 s)" 5 s later; Coins tab "in 7 block(s) (after confirmation) ≈ 1 h 09 min 56 s"; no console error (`npx tsx scripts/validate/etape-23-refresh-signet.ts`, `etape-23-sortie.txt`, captures `etape-23-*.png`).
- Unconfirmed coin: the D-block delay only starts at confirmation, so one block is added to the estimate and "(after confirmation)" is shown.
- The yellow warning itself only appears when the coin is ≤ ⌈D/3⌉ blocks from the deadline (2 blocks here, about 20 minutes before); until then the countdown is in the header chip and the Coins tab.
- Run 1 broadcast the refresh but failed to read the chip: test selector `.asset-balance .chip` also matched the hidden Ethereum chip. Fixed in the test (Bitcoin chip only).

## Non-regression (`etape-23-regressions-sortie.txt`)

`validate:6:ui` 19/19 desktop and 20/20 phone (regtest: block count without time).
