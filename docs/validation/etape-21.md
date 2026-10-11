# Step 21: resilience to the public Bitcoin API rate limit

## Problem reported by the user

On the Bitcoin page: `cannot read the chain: {"error":"Too Many Requests","message":"Blockstream Explorer API NOTICE: … 700 requests/hour per IP …"}`, no balance shown, and "Activity" stuck on "Loading…".

## Cause (observed, not assumed)

- `blockstream.info/signet/api` answers **429** (checked with curl). `mempool.space/signet/api` is **unreachable** from this network (curl: no response), as already noted in `.env.example`: blockstream is the only signet source here.
- One display of the Bitcoin page costs about 12 to 15 requests (gap-limit address discovery, UTXOs, history). The cache was **in memory only**, so every page reload paid again. The many test runs of the day (steps 17 to 20, each loading the page several times), plus bank-mock's signet watch every 15 minutes, used up the 700 requests per hour of the machine's IP.
- The app showed the raw API message, and "Activity" ignored the error (endless "Loading…").

## Delivered

| Item | Location |
| --- | --- |
| Esplora cache kept in the **browser storage** (survives reloads), longer validity (addresses 60 s, tip 30 s, fees 5 min) | `packages/bitcoin/src/backend.ts` (`EsploraBackend.cached`) |
| On 429 or network error: the **last known data** is served and dated (`staleSince`); the page shows "The public Bitcoin API is rate-limited (700 requests/hour): balance and activity as of HH:MM. Your coins are not affected." | `backend.ts`, `client/src/wallet/Account.tsx` |
| Readable error when nothing is cached ("the public Bitcoin API is rate-limited … retry in a few minutes"), and in "Activity" instead of "Loading…" | `backend.ts`, `Account.tsx` |
| Cache emptied after a broadcast (the balance reflects the transaction); "Reload" forces a real read | `backend.ts` (`invalidate`, `clearAll`), `Account.tsx` |
| bank-mock's signet watch once per hour in the signet demo (shares the same IP quota) | `scripts/demo/signet-ports.sh` |

## Command

```bash
npm run validate:21     # local fake Esplora server (200, then 429 on demand) and fake browser storage: no real quota used
```

## Results (`etape-21-sortie.txt`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 21-1 | Data cached in browser storage: after a reload, no new request during its validity | works |
| 21-2 | API rate-limited (429) and cache expired: last known value served and dated | works |
| 21-3 | API rate-limited and nothing cached: readable message (not the raw API JSON) | works |
| 21-4 | After a broadcast, the persistent cache is emptied | works |
| 21-5 | "Reload" forces a real read | works |

## Non-regression (`etape-21-regressions-sortie.txt`)

Typing of the 8 projects; `validate:6:ui` 19/19 desktop and 20/20 phone (regtest, not affected by the limit). `validate:9` reads the real signet: it **stops on the rate limit** (new readable message), as expected while the limit lasts. To rerun afterwards, with `validate:18`, `19`, `20` (console criterion).

## Limits

- While nothing is cached in the browser (first visit during a rate-limited hour), the balance cannot be shown: the message says so and why.
- A Blockstream API key would raise the limit (their notice points to dashboard.blockstream.info). Not tried: their authentication method is not verified here.
