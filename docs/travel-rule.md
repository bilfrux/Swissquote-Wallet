# Travel Rule and wallet ownership

Starting point: the track's legal primer (simplified, not legal advice). A Swiss bank may only send crypto to, or receive it from, an external wallet **after verifying who owns it**. The legal statements below are design hypotheses to confirm with a lawyer. The FINMA text itself is still to be cited (to source: FINMA guidance on payments on the blockchain).

## What the wallet makes automatic (tested)

The wallet is created from inside the client's e-banking session. Swissquote therefore knows from the start which public keys belong to which client. Ownership is then **proved cryptographically**, not declared.

| Step | What happens | Evidence |
| --- | --- | --- |
| Link to the identity | The client creates the wallet while logged in to their Swissquote account. Swissquote registers the account's policy (client xpub, guardian keys, D) under the client ID. | Step 6 |
| Ownership proof | Swissquote issues a single-use challenge (10 min) naming the client and address #i. The Client Wallet signs it with the client key at index i (BIP-322). Swissquote recomputes that key from the registered xpub and verifies in strict mode. | `validate:7`: valid proof accepted; replay, altered message, other key and another client's account refused |
| Withdrawal Swissquote → wallet | Allowed only to an address of an account registered to the client (403 otherwise), and only after a verified proof (412 otherwise). The proof is requested automatically from the Client Wallet, with no copy-paste. | `validate:11`, 11-1 and 11-2; Chrome journey 6-19 |
| Travel Rule record | Originator and beneficiary (the same person, self-hosted wallet), amount, address, txid and proof reference. | 11-3 |
| Deposit wallet → Swissquote | Credited only if **all** inputs come from a wallet registered to the client; otherwise held as "awaiting verification". | 11-5 |

**Exact scope of the proof.** It proves possession of the client key at index i. According to the registered policy, that key alone is enough to spend address #i. It is not a signature of the P2WSH address itself (`bip322-js` does not handle P2WSH). It says nothing about the legal identity of the key holder: the link to the person comes from the authenticated bank session and Swissquote's existing KYC.

## When the client pays a third party: is Swissquote the sending institution?

Our hypothesis: **no**, for transfers from the self-custody wallet to a third party.

- Swissquote does not hold the client's key and cannot sign the client path. A transaction signed by Swissquote alone is rejected by consensus (tested, invariant 1).
- The client signs in their own wallet, after a screen that decodes the transaction independently of the bank app (tested, step 6).
- The client can spend without Swissquote at all: Swissquote stopped, transaction built and broadcast without the bank app (tested, attack 3; Bitcoin Core validated as an external signer).

Points a lawyer would challenge, and our answer:

| Objection | Answer |
| --- | --- |
| The bank app prepares the transaction | It is unsigned software output. The client's wallet decodes it and can refuse. The client can use another tool. |
| Swissquote is a guardian | It holds a key that is useless alone and only usable after D together with a contact chosen by the client. It never signs a payment to a third party (bank-mock refuses any recovery to an address that is not the client's: tested, step 2 test 5). |
| Swissquote + contact after D | The grey zone named by the track: see `docs/custody-models.md`. |

**Possible service without control (perspective, not implemented).** Swissquote could show, for information only, a screening of the destination address (sanctions lists) before the client signs. Showing a warning without blocking keeps Swissquote out of the decision. Whether even a non-blocking warning changes its legal role is a question for the mentors (already listed in `SPEC.md`).

## Limits

- Regtest only for withdrawals: the signet omnibus is not funded (explicit 501).
- The Travel Rule record is local. Nothing is transmitted to another provider, which is unnecessary here because the beneficiary is a self-hosted wallet of the same client.
- No chain analysis on deposits beyond "all inputs come from a registered wallet of the client".
