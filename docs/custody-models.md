# Custody models: comparison and decision

The track document lists five common custody models and says combinations are allowed and often stronger. This page compares them on the questions the track asks, then explains our choice: **a seed phrase held by the client, combined with a Bitcoin script whose recovery path needs two guardians and a delay enforced by consensus**.

Legend for the "evidence" column: **tested** = executed in this repository (report in `docs/validation/`); **verified in docs** = read in the library's documentation, not executed; **general** = standard property of the model, not tested here.

## The five models on the track's questions

Assumed setup for the threshold models: three parties, any two of them suffice (client, Swissquote, an independent partner or trusted contact).

| Question | Custodial | Seed phrase alone | MPC 2-of-3 | Smart account (ERC-4337 / Safe) | Split backup (Shamir / SLIP-39 2-of-3) | **Ours** (seed + Bitcoin script) |
| --- | --- | --- | --- | --- | --- | --- |
| Can Swissquote **alone** move the funds? | Yes | No | No | No, if it is not an owner | No | **No**: rejected by consensus (tested, invariant 1) |
| Can Swissquote **+ partner** move them without the client? | — | No | **Yes, immediately**, unless the share holders' software refuses (off-chain rule) | Depends on the recovery module: possible after an on-chain delay, cancellable by the owner | **Yes**: they reconstruct the seed | **Only after D** on coins not moved for D blocks; before D, rejected by consensus (tested on regtest and signet) |
| Who enforces the delay, if any? | Swissquote | — | The share holders' software | The contract | Nobody (a procedure) | **Bitcoin consensus** (`older(D)`, BIP68/112) |
| Client spends alone, Swissquote stopped? | No | Yes | **No**: a second share is needed | Yes | Yes | **Yes** (tested, attack 3) |
| Client loses everything: can they recover? | Yes (it is the bank's) | **No** | Yes, with Swissquote + partner | Yes, through guardians | Yes, Swissquote + partner | **Yes**, Swissquote + contact after D (tested) |
| Client loses everything **and** Swissquote is gone | Funds depend on the bankruptcy | Lost | Lost (one share left) | Depends on the remaining guardians | Lost (one share left) | **Lost** (accepted limit, same as the threshold models) |
| A thief gets the client's secret | Not applicable | **Funds stolen** | Useless alone | Depends on the signer (passkey in an enclave) | One share: useless | **Funds stolen** through the client path: same weakness as a seed phrase; mitigation: PIN-encrypted seed (tested), hardware wallet in production |
| Chains | All | All | All ECDSA/EdDSA chains, including Bitcoin (general) | EVM only | All | **Bitcoin** today; EVM planned with Safe + Candide recovery module |
| What the chain sees | Bank wallet | Single signature | Single signature (general) | Contract | Single signature | The script (P2WSH reveals it at spend time; Taproot would hide it, perspective) |
| Where the secret is put back together | — | — | Never (general) | Never | **In one place**, at recovery time | Never: each guardian signs separately |

## Each model, in one paragraph

**Custodial account.** Simplest for the client and already what Swissquote offers. It is custody under the track's legal primer (Swissquote moves the funds alone), so it does not answer the challenge: the client gains nothing over today's account.

**Seed phrase alone.** The client is sovereign, but a lost phrase means lost funds and Swissquote cannot help. The track's question ("will a typical Swissquote client keep the phrase safe?") is the weakness: probably not reliably.

**MPC / threshold signatures.** The strongest model against theft of a single device: no party ever holds the whole key, and it works on every chain with one mechanism. Its limit for this challenge is the track's own question: with a 2-of-3 between client, Swissquote and a partner, Swissquote and the partner can sign together **at once**. A delay can only be a rule in the share holders' software, so a Swissquote that colludes or is compromised can skip it. Practical points checked in the `coinbase/cb-mpc` README (verified in docs, not executed): it does not support browsers, WebAssembly or mobile, and it provides no transport, storage, policy or recovery workflow. These have to be built around it. Its HD derivation is "not BIP32-compliant". We did not test any other MPC library.

**Smart-contract account (ERC-4337 / Safe).** Rules live on-chain: guardians, thresholds and delays are enforced by the contract, and the owner can cancel a recovery. This is the EVM counterpart of our design and our plan for Ethereum (Safe + Candide recovery module). It is EVM-only, and gas must be paid or sponsored (paymaster).

**Split backup (Shamir / SLIP-39).** Good for storing a backup, weak for custody: Swissquote and the partner can reconstruct the seed without the client and with no delay, and the full seed exists in one place at recovery time. After any reconstruction, the seed must be considered exposed.

## Our decision and why

We combine two models: the **seed phrase** (the client's key, in their own wallet) and an **on-chain rule** (Bitcoin script):

```
or( pk(CLIENT),  and( pk(SWISSQUOTE), and( pk(TRUSTED_CONTACT), older(D) ) ) )
```

1. **The client is always sovereign.** They spend alone, at any time, with Swissquote stopped (tested).
2. **Swissquote can never act alone** (tested, consensus refusal).
3. **Swissquote + the contact cannot act before D.** This is a consensus rule, not a promise of our software. The refusal was observed on the public signet network (`non-BIP68-final`, `etape-3.md`). This is the point where we differ from a 2-of-3 MPC.
4. **The client keeps control after D if they stay active.** Moving their coins restarts the delay (tested). After D, the first confirmed transaction wins (tested, `etape-14.md`).
5. **A lost phrase is no longer fatal.** The guardians recover after D to a new key of the client, and that new key spends (tested, `etape-14.md`).

**What we give up, written plainly:**
- A **stolen** seed lets the thief spend at once. MPC is better here. Our mitigation is the PIN-encrypted Client Wallet (tested) and, in production, a hardware wallet or phone secure element.
- **Bitcoin only** for now. Ethereum gets the same guarantees through a Safe with an on-chain recovery module, not through the same mechanism.
- Few external wallets sign this script (Bitcoin Core verified; Liana and some hardware wallets announced, not verified).
- The **grey zone**: after D, Swissquote + contact can move unmoved coins to any destination.

## Custody reading (hypothesis, to confirm with a lawyer)

Under the track's legal primer, custody depends on who can move the funds. In our design, Swissquote alone can never move them. The only joint power is Swissquote + a contact **chosen by the client**, independent of Swissquote, and only after a long delay (production target about 6 months) that the client resets by any spend. Our argument is that this is closer to software than to custody. It is the grey zone the track names, so we argue it rather than deny it. A 2-of-3 MPC or a Shamir split with a partner chosen by Swissquote is in the same grey zone, without a delay enforced on-chain.
