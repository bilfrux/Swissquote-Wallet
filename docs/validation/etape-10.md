# Step 10 (A1): passkey authentication and high-value amounts

Track topic 4: "How the client proves who they are before signing […] Show how a high-value transaction differs from a small one".

## Delivered

| Item | Location |
| --- | --- |
| WebAuthn passkeys (`@simplewebauthn/server` 14.0.3 and `/browser` 14.0.0, no home-made crypto): registration, login, step-up; user verification required, single-use challenges (5 min), anti-cloning counter | `bank-mock/src/passkeys.ts`, routes `/auth/passkey/*`, `/auth/stepup/*` |
| "Log in with a passkey" login; activation in "My account" | `client/src/bank/Login.tsx`, `client/src/ui/AccountSecurity.tsx`, `Shell.tsx` |
| High-value amount (≥ 0.2 BTC sent out of the account) on the app side: warning, passkey re-authentication (activation on the spot if needed), record and alert at Swissquote; non-blocking if Swissquote is unreachable | `client/src/lib/bank.ts` (`stepUp`), `wallet/Send.tsx` |
| High-value amount on the Client Wallet side: banner, PIN + last 6 characters of the address, **verified by the wallet's server** | `client-wallet/src/server.ts`, `ui/App.tsx` |

## Results

| # | Criterion | Verdict |
| --- | --- | --- |
| 10-1 | Wallet: 0.25 BTC marked "high-value"; signature refused without the 6 characters or with wrong characters, accepted with the right ones | works (`etape-10-sortie.txt`) |
| 10-2 | Wallet: 0.05 BTC signed with the PIN alone | works |
| 10-3 | Swissquote: step-up impossible without a passkey, without a session, or with an invented assertion | works |
| 6-17 | Chrome (Chrome's virtual WebAuthn authenticator): passkey enabled, logout, passkey login | works (desktop and phone) |
| 6-18 | Chrome: send of 0.25 BTC, warning, passkey step-up ("High-value amount confirmed by passkey"), 6 characters + PIN in the wallet, broadcast | works (desktop and phone) |
| Full journey | `validate:6:ui`: 17/17 on desktop, 18/18 on phone | works |
| Non-regression | `validate:1` to `validate:8:alerts`, `test:attacks`, `validate:inv5`; typing | works |
| — | High-value amount with Swissquote unreachable: the app continues, the wallet applies its checks alone | **not tested** in the interface (logic written; the wallet's signature does not depend on Swissquote, see 10-1) |

## Limits (written in the README)

- On Bitcoin, **no on-chain difference** by amount: the client path `pk(CLIENT)` does not know amounts. The checks are application-level (Swissquote) and in the signer (Client Wallet).
- A new passkey can be added by an open session. A real bank would require extra verification for a new device.
- In the test, biometrics are simulated by Chrome's virtual authenticator.
