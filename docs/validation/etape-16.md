# Step 16: full EVM journey on the real Sepolia, with no ETH (11 October 2026)

Script only, no interface yet. Throwaway keys generated in memory by viem, never written. Everything goes through Candide's **public** bundler and paymaster (no API key, no ETH on any account).

## Setup

- Client's Safe (`SafeAccountV0_3_0`, EntryPoint v0.7), owner = the client's EOA.
- Candide recovery module v0.0.1, **3-minute instance** (`0x949d…8c66`), guardians Swissquote and trusted contact, threshold 2.
- The guardians sign the recovery request in EIP-712 (typed data from abstractionkit, signature by viem). Anyone can relay the signatures: here a "relay" Safe of the client's new key, also sponsored. No guardian needs ETH either.
- "Transaction signed by the client": mint of a test NFT (contract used in Candide's documentation). The USDC transfer is not done yet (test USDC needed).

## Command

```bash
cd scripts/feasibility
npm run e2e          # about 5 minutes, including 3 minutes waiting for the delay
```

## Results (run 4, `etape-16-sortie.txt`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 16-1 | Creation with no ETH: Safe + module + 2 guardians (threshold 2) + a transaction signed by the client, in one sponsored UserOperation | works: [tx 0x23d4…622e](https://sepolia.etherscan.io/tx/0x23d422f34514017ecb01ccd7831291f7cd5baf7b18151be5c55e86353874622e), Safe ETH balance 0 |
| 16-2 | Swissquote alone cannot start a recovery | works: `SM: confirmed signatures less than threshold` |
| 16-3 | Swissquote + contact start the recovery to the client's new key; finalizing before the delay is refused | works: [tx 0xfd61…ee80](https://sepolia.etherscan.io/tx/0xfd61f9ac67f5524518fff587e2ae787a0566e8848d5f956e50d25efb65faee80); early finalize: `SM: recovery period still pending` |
| 16-4 | After the delay: owner replaced; the new key signs (and calls `invalidateNonce`, project rule); the old key is refused | works: finalize [0xa799…4ec5](https://sepolia.etherscan.io/tx/0xa7999fefef9f0ff489bf32c8aed4d9adca71d7b3b7988876e66f05767c884ec5), new key [0x55ae…b526](https://sepolia.etherscan.io/tx/0x55aee3234f476464f91fdecd9dc1de35938aa359820855b0f8a0c6912c74b526); old key: `INVALID_SIGNATURE: Invalid account signature` |
| 16-5 | A recovery to an attacker started by Swissquote + contact is cancelled by the owner during the delay (`cancelRecovery` + `invalidateNonce`) | works: cancel [0x41ad…5610](https://sepolia.etherscan.io/tx/0x41ad66d288233fb54ee6961dbce5136cba1be20ca3f17bdbba64ca0091295610); finalize afterwards: `SM: no ongoing recovery` |

Each refusal is checked **with its reason**: a bundler failure for another cause (rate limit, network) would not pass.

## The four runs (all kept in `etape-16-sortie.txt`)

| Run | Result | Cause |
| --- | --- | --- |
| 1 | 16-1 and 16-5 KO; refusals without a reason | State read right after inclusion on the public RPC node (load-balanced) came back **stale**: NFT balance read too early, pending recovery read as 0, although the cancellation succeeded (it reverts when nothing is pending). The bundler error only said "rpc call failed". |
| 2 | 5/5, but the refusals showed only `BUNDLER_ERROR` | Wait added after each inclusion. Refusal reasons still hidden. |
| 3 | 16-1 to 16-4 OK with reasons; 16-5 crashed: `SM: Invalid guardian signature` | Reasons now read from the error's `cause`. The guardians signed with a recovery **nonce read on a stale node**, before the `invalidateNonce` of 16-4. |
| 4 | 5/5 with reasons | Every read is pinned to the block of the last included operation (retry until the node has it); the nonce is passed explicitly to the EIP-712 data. |

**Lesson for the app:** after any operation, read the chain state at the block of its receipt, never "latest" on a public load-balanced node. Otherwise a guardian may sign with a stale nonce.

## Not tested yet

- Client EOA key derived from the Client Wallet seed, Swissquote's key in bank-mock, the contact's key in the guardian console (here throwaway keys in one process).
- USDC transfer; abuse limits of the public sponsorship policy (Candide's, unknown to us).
- Interface.
