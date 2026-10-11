# Step 24: crypto screens in French

Request from the user: "traduis aussi les écrans crypto en français".

## Delivered

- `client/src/i18n-crypto-fr.ts`: French dictionary of the crypto screens (319 entries, keyed by the English text).
- `client/src/i18n.tsx`: `tr(english, vars)` returns the French text when the language is FR, otherwise the English text (DE and IT keep English on the crypto screens), with `{name}` placeholders.
- Screens translated: wallet home (KPIs, positions, network menu), Bitcoin account (actions, countdown, Coins / Activity / Security tabs), send, PSBT summary, Swissquote account ↔ wallet transfer, wallet creation, recovery, Ethereum account, price chart, notifications, "My account" security, Demo · Attacks tab. Dates and numbers follow `fr-CH` in French.
- `scripts/validate/etape-22-public-ui.ts`: new check 22-6 (crypto screen in French).

## Observed

| # | Command | Result |
| --- | --- | --- |
| 22-6 | `npm run -s validate:22` (signet demo, CH-0003 logged in in French) | works: "Valeur crypto totale", "Variation du jour", "Mon wallet", "Recevoir", "Envoyer" found; none of the English labels checked remain (capture `etape-22-6-crypto-fr.png`) |
| 22-1 to 22-5, 22-x | same | works, no console error |
| Full regtest journey | `npm run -s validate:6:ui` | 19/19 desktop |
| Same, phone | `MOBILE=1 npm run -s validate:6:ui` | 20/20 phone |
| Typing | `npm run -s typecheck` | no error |

Outputs: `etape-24-regressions-sortie.txt`.

## Change abandoned during the step

To silence the "Scan already in progress" 500 logged in the console (the client already retries), I had replaced the regtest proxy of `client/vite.config.ts` with a relay that retries on the server side. Both regtest journeys failed with it; it was reverted to the original proxy before the runs above. The client-side retry is kept and 6-11 (no console error) passes.

## Not tested

- The German and Italian crypto screens stay in English (only French was requested).
- Not every string was checked one by one in the test: 22-6 checks a sample of labels; the other screens were read in the captures.
