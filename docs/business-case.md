# Business case

**In one paragraph.** Today, a Swissquote client who wants to hold their own keys withdraws their crypto to an external wallet and leaves the Swissquote ecosystem: Swissquote loses the next trades, the conversions back to CHF and often the relationship. This wallet keeps them one click away. The coins sit in the client's own wallet, but buying, selling, moving back to the Swissquote account and recovering a lost wallet all happen inside the Swissquote app. Swissquote earns on the flows it keeps (trading and conversion fees, an optional paid recovery service) without holding the keys. It never holds the keys, so under the track's legal primer these assets are not in its custody (hypothesis, to confirm with a lawyer). It also gets a product to attract self-custody-minded clients who would not open a custodial crypto account.

## Levers

| Lever | Mechanism in the product | Status in the prototype |
| --- | --- | --- |
| Retention of outgoing flows | The withdrawal goes to a wallet that stays visible in the Swissquote app; selling goes back through the Swissquote account | Account ↔ wallet transfers with automatic ownership proof (tested, step 11) |
| Recovery service | Swissquote acts as a guardian: a lost wallet is recovered without a seed phrase (with the trusted contact, after D) | Tested (steps 3 and 14) |
| New clients | A Swiss bank offer for clients who refuse custodial crypto | Pitch argument, no data |
| Lower support cost | "I lost my phrase" no longer means "funds lost" | Recovery tested; cost saving not measured |
| No custody burden on these assets | Swissquote cannot move the funds alone | Invariant 1 tested; legal reading is a hypothesis |

## Calculation with explicit assumptions

None of the figures below is a Swissquote figure. They are **parameters** to replace with internal data. The formula is what matters.

```
Annual gain = N × p × (V × f × t + s) − C
```

| Parameter | Meaning | Illustrative value (assumption) |
| --- | --- | --- |
| N | Clients per year who withdraw crypto to an external wallet today | 5,000 |
| p | Share of them who use the Swissquote wallet instead | 30 % |
| V | Average annual volume they trade or convert through Swissquote once retained | CHF 10,000 |
| f | Average fee rate on that volume | 0.5 % |
| t | Share of V that would otherwise have been lost (traded elsewhere) | 50 % |
| s | Optional recovery-service subscription per client per year | CHF 30 |
| C | Annual running cost (guardian service, support, chain fees for its own operations) | CHF 150,000 |

With these values: 5,000 × 0.3 = 1,500 clients; per client 10,000 × 0.005 × 0.5 + 30 = CHF 55; total 1,500 × 55 = CHF 82,500, minus C = **−CHF 67,500**. At these illustrative values, **the product does not pay for itself on fees alone**.

The break-even is the real question. With the other parameters fixed, the product breaks even when N × p × (V × f × t + s) = C, i.e. at about **2,730 retained clients**. Equivalently, with 1,500 retained clients, it needs about CHF 100 of gain per client per year. The pitch should therefore rest on:
- the **volume and fee** figures Swissquote actually has (V, f, N), which we do not;
- the **strategic** value, which this formula does not count: keeping the relationship and the client's other assets, and attracting new clients.

## What we would ask Swissquote

- How many clients withdraw crypto to external addresses each year, and what volume they traded before leaving (N, V).
- How external addresses are verified today for the Travel Rule (manual allowlist, test deposit?), and at what cost per verification. Our ownership proof makes it automatic, which is a measurable saving.
- Whether a paid recovery service (s) fits the brand, or should be free and count as retention.
