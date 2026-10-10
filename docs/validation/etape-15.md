# Step 15: EVM feasibility on the real Sepolia, gasless (11 October 2026)

Decisions taken by the user before this step: ERC-4337 + paymaster for gas; local fork then real Sepolia; local demo dApp (no WalletConnect).

## Question

Can a Safe owned by the client's EOA be deployed **with no ETH**, with Candide's recovery module enabled and the two guardians (Swissquote, trusted contact) at threshold 2, through Candide's **public** bundler and paymaster (no API key)?

## What was checked in the documentation (not assumed)

- Candide documents public bundler and paymaster endpoints, "no API required", rate-limited per IP: `https://api.candide.dev/public/v3/11155111` for Sepolia.
- `eth_supportedEntryPoints` on that endpoint returned EntryPoints v0.9, v0.8, v0.7 and v0.6; `eth_chainId` = `0xaa36a7` (Sepolia).
- Whether a public gas policy would sponsor our operations was **not stated** for our case: only execution could tell.

## Command

```bash
cd scripts/feasibility
npm run gasless        # fresh throwaway keys in memory (viem), nothing written
```

One UserOperation (EntryPoint v0.7, `SafeAccountV0_3_0` of abstractionkit 0.4.3) deploys the Safe and, in the same batch, enables the 3-minute instance of the recovery module (`0x949d…8c66`, v0.0.1) and adds both guardians with threshold 2.

## Results (`etape-15-sortie.txt`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 15-1 | The public paymaster sponsors the UserOperation (paymaster `0x8b1f…75ba`) | works (2 runs out of 2) |
| 15-2 | UserOperation included on Sepolia: Safe deployed, ETH balance 0 before and after | works: [tx 0xd6ae…8bf0](https://sepolia.etherscan.io/tx/0xd6ae8454ff1527b04c622affdfeec721efac3c9578f3465579107c2da67d8bf0) (2nd run), [tx 0x65be…7682](https://sepolia.etherscan.io/tx/0x65be64b008fd5df87482f79be28e6eef31370882878134da0ad09ced99287682) (1st run) |
| 15-3 | On-chain state: module enabled, 2 guardians, threshold 2, owner = the client EOA | works (read on Sepolia with `cast` after run 1, with viem in run 2) |

**Observed along the way.** In run 1, AbstractionKit's `getGuardians` helper, called right after inclusion, returned an **empty list**, although the contract held both guardians (`cast call` a moment later). The script now reads the contract directly with viem, with a few retries. Cause not established: possibly the public RPC node lagging right after inclusion.

## Not tested yet

- A transfer (test USDC) and a full recovery through the bundler; the delay and cancellation were verified on a fork at step 0, not on the real Sepolia.
- Abuse prevention of the sponsorship: the public policy belongs to Candide, its limits are not known to us. A private policy (Candide dashboard, account needed) would let Swissquote set rules.
- The client EOA key coming from the Client Wallet (here, a throwaway key).
