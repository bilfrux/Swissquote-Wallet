# Step 12 (A3, first part): recovery without copy-paste, Swissquote relay to the trusted contact

## Delivered

- bank-mock: `POST /relay` (client session, deposits the PSBT already signed by Swissquote), `GET /relay?id=` (read by the contact), `POST /relay/signed` (return of the signature; refused if it is not the same transaction). Random 128-bit identifier. Table `relay`.
- App (recovery, step 5): "Send the request to <contact>" gives a link to the console; "Fetch the trusted contact's signature". The manual PSBT exchange remains available, folded, if Swissquote is unavailable.
- Contact console: opened with `?req=…`, it loads the request, the contact checks the decoding and signs with their phrase (still read on click, never transmitted), then "Send back to the client via Swissquote".

## Commands and results

```
npm run regtest:up
npm run validate:12
npm run validate:6:ui            # and MOBILE=1
```

| # | Criterion | Verdict |
| --- | --- | --- |
| 12-1 | Request deposit refused without a session (401); the contact re-reads the identical PSBT by identifier | works (`etape-12-sortie.txt`) |
| 12-2 | Contact's signature sent back then fetched; PSBT of another transaction refused (400); unknown identifier (404) | works |
| 6-20 | Chrome: send to the contact by link, PSBT loaded in their console, signature returned, fetched, recovery broadcast | works (desktop 19/19, phone 20/20) |
| — | Signet journey (`validate:8:signet`): adapted to open the folded manual exchange | **not run** (waiting for the signet coin) |
| — | Other non-regressions (`validate:1`…`11`, attacks) | **not rerun** for this small step; only typing and `validate:6:ui` were |

## Limits

- The link is passed to the contact outside the app (no notification or inbox yet).
- The link is enough to read the request (no authentication of the contact): it reveals the PSBT, which is not a spending secret, but reveals amounts and addresses.
- Swissquote transports: it could block the relay, hence the manual exchange is kept.
- The step 6 console is now an instance of its own for the test (port 5192), not `CONSOLE_URL`.
