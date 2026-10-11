# Step 22: public site (markets page and login) and languages (EN, FR, DE, IT)

Request from the user, with two captures of swissquote.com: copy the start page ("Markets", daily overview) and the login page. Charts and figures may be mocked; the login button and page must work. Several languages: at least French and English, or the same languages as Swissquote.

## Languages: checked, not assumed

swissquote.com offers, for Switzerland, `hreflang` de-CH, en-CH, fr-CH and it-CH (other regions also ar, es, ru, zh). Implemented: **English, French, German, Italian**, choice remembered in the browser, English by default.

**Translated**: public site (markets, login), app frame (top menu, rail, footer, account menu), Home and Accounts pages, login error. **Not translated yet**: the crypto screens (Bitcoin, Ethereum, recovery) and the Client Wallet and guardian console, which stay in English. Account names and transaction labels come from the simulated backend and stay as they are.

## Delivered

| Item | Location |
| --- | --- |
| Public header: logo, help, language, "Discover our services", Login, Sign up (sign-up explained as out of scope of the demo) | `client/src/public/PublicSite.tsx` |
| "Markets" page: rail (Tools, Markets, Inspiration, ESG, Crypto hub), search field, regions and products menu, daily overview with 10 cards (flag, symbol, name, price, change, sparkline, "All components"). **Simulated data, labelled as such** | same |
| Login page: title, username and password fields with icons, show/hide password, "forgot" links, black login button, passkey login kept, help, "New to Swissquote? Become a client", demo clients reminder; illustration: the Swissquote visual provided by the user (`client/public/login-visual.png`, transparent PNG on the coral gradient), replacing a first drawing made for the project | same |
| Language support and selector (public pages and app) | `client/src/i18n.tsx`, `ui/Shell.tsx`, `bank/Overview.tsx`, `bank/Accounts.tsx`, `main.tsx` |
| Flow: not logged in → Markets → Login → app; logout → Markets | `client/src/App.tsx` |
| Old login page removed | `client/src/bank/Login.tsx` |
| Tests: go through "Login" on the public page; "Username" label; exact "Password" label (the eye button is named "Show the password") | `scripts/validate/etape-6-ui.ts`, `8`, `17`, `18`, `19`, `20` |

## Command

```bash
npm run demo:signet:ports
npm run validate:22
```

## Results (`etape-22-sortie.txt`, captures `etape-22-*.png`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 22-1 | Public "Markets" page: 10 simulated cards with sparkline; header help, language, Login, Sign up | works |
| 22-2 | Language FR applied and remembered after reload | works |
| 22-3 | Login in French: wrong password refused with a translated message, password can be shown, then login succeeds | works |
| 22-4 | App in German (menu, overview, footer); logout goes back to "Märkte" | works |
| 22-5 | Phone: Markets page then login page usable | works |
| 22-x | No console error (apart from the intentional wrong password) | works |

## Non-regression (`etape-22-regressions-sortie.txt`)

Typing of the 8 projects; `validate:6:ui` 19/19 desktop and 20/20 phone, through the new public site; invariant 5.

Not rerun after this step: `validate:8:signet`, `17`, `18`, `19`, `20` (adapted to the new login, but they use the real signet and Sepolia: the Bitcoin API quota had just reset and was kept for the user).
