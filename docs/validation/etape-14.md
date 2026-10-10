# Step 14: recovery actually usable, and race after D (regtest)

Two gaps raised during the review of the model: (1) a recovery only counts if the **new** key really spends afterwards, (2) after D, both spending paths are valid: what happens when the client and the guardians race?

## Delivered

Four tests added to `scripts/validate/etape-3.ts` (no application code changed).

## Command

```bash
npm run regtest:up
npm run validate:3        # bitcoind 29.4.0 regtest (Docker), dedicated bank-mock on port 4101
```

## Results (`etape-14-sortie.txt`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 4 | After the recovery, the new client key alone spends the new account; the old key signs no input of it | works: spend `accepted`; old key: `No inputs were signed` |
| 5 | After D, the client spends first (confirmed): the recovery already signed by Swissquote + contact becomes invalid | works: recovery `accepted` just before, `missing-inputs` after |
| 6 | After D, Swissquote + contact spend first (confirmed): the client can no longer do anything on these coins | works as expected for the accepted limit: client spend `missing-inputs`, funds on the recovery account |
| 7 | Observation: recovery broadcast but not mined; the client broadcasts a competing spend at 20 sat/vB (recovery at 2 sat/vB) | Observed: client spend accepted by the node (`fullrbf: true`), after 1 block the recovery account has 0 coin and the client account 1 refreshed coin |
| 1, 2, 3 | Unchanged tests of step 3 | still work |

## Reading

- Tests 5 and 6 are consensus: the first confirmed transaction wins.
- Test 7 is **mempool policy** of this node (Bitcoin Core 29, full RBF by default), not consensus: a miner can include the recovery anyway, and the guardians can raise their own fee. It shows that an alerted client still has a chance after D, not a guarantee.
- Recorded in `docs/threat-model.md` (two new lines).
