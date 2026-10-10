# AI tools used

## Tools

| Tool | Model | Use |
| --- | --- | --- |
| Claude Code (Anthropic CLI) | Claude Opus 5.5, then Claude Sonnet 5.5 | Critical review of the spec, feasibility scripts (Ethereum then Bitcoin), implementation of all the code in the repository, validation and attack scripts, running the tests, writing the `docs/validation/` reports and these deliverables, translation of the interface and documentation into English |
| *(to be completed by the team)* | — | Tools possibly used outside the repository (writing the spec and prompts, pitch, slides): this document cannot infer them from the history |

All commits after the initial commit carry a `Co-Authored-By: Claude …` line (`git log`).

## Working method

- **The human decides, the AI executes and reports.** The custody model changed three times on the team's decision. The AI stopped and flagged each false assumption before working around it (`CLAUDE.md` rule).
- **One step at a time, one proof per step**: one commit and one `docs/validation/etape-N.md` per step, with commands and raw outputs.
- **Nothing is declared successful without execution**: each "works" line points to a test output; points not executed are marked "not tested".
- **No AI-generated cryptography**: signatures, derivations and PSBTs come from established libraries (`@scure/*`, `@noble/curves`, `@bitcoinerlab/*`, reference Miniscript compiler).

## Errors caught by execution (not by review)

Systematic execution brought out errors, in the spec as well as in the AI-produced code:

| Type | Finding | How it was detected |
| --- | --- | --- |
| False spec assumption | The first Bitcoin policy reused the same keys in several paths: Miniscript forbids it | `[compile error]` from the reference compiler |
| False spec assumption | `and(a, b, c)` does not exist in the policy language (two arguments only) | Compilation error; nested form chosen |
| Spec assumption to qualify | The deployed Candide modules are version 0.0.1, without 14 audit fixes from 2026 | `cast call … VERSION()` on Sepolia, code reading (archive branch) |
| Assumption not retained | Sparrow most likely does not handle Miniscript policies with a delay | GitHub issues #1700 and #1757 (not verified by running Sparrow) |
| AI code bug | Relative paths of the tools resolved from the wrong folder (`npm run -w`) | `client-signer` failure in the step 1 test |
| AI code bug | Two simultaneous `scantxoutset`: bitcoind rejects one (HTTP 500) | Console error in the step 1 Chrome test |
| AI test bug | Wrong expected error message (`bad-txns-inputs-missingorspent` instead of `missing-inputs`, returned by Bitcoin Core 29) | Red test while the behaviour was correct |
| AI test bug | Wrong timing: the refresh test would have let the new coin reach D | Re-reading the test before running it |
| AI test bug | Reads too early in the interface (row of an old coin, element without the amount, phrase words not yet displayed) | Red Chrome tests, fixed on the test side |
| AI code bug | Race between two scans: when switching to the new wallet after recovery, a stale scan of the old account overwrote the balance with 0 | Step 6 end-to-end test (funds on the chain, balance displayed as 0) |
| AI code bug | "Simulate losing the device" deleted nothing: the wallet's "simple request" guard also refused DELETE (415), and the error was not displayed | Test 6-9 ("old wallet erased: false") |
| AI code bug | Two instances of the Client Wallet fought over Vite's hot-reload port | Websocket errors in the console, test 6-11 |
| AI test bug | Console error 412 expected by design (first withdrawal attempt without ownership proof) flagged as a failure; fixed by checking the proof status first | Test 6-11 |
| Unexplained | One 500 error seen once in the desktop Chrome test, not reproduced in 5 further runs; cause not established | Test 6-11 (now logs the method, URL and response of any 5xx) |
| Translation | The ownership-proof tamper test no longer altered anything after the message was translated | `validate:7`, test 7-4 |

## Limits of this use

- The code was written very quickly and mainly by the AI. It is covered by integration tests against a real node, but **has not been audited**.
- The legal and business statements (custody, Travel Rule, business case) do not appear in these technical deliverables. They are to be phrased as design hypotheses and reviewed by the team.
