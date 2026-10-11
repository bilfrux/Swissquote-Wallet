// Builds docs/slides/swissquote-wallet-pitch.pptx
// Run: NODE_PATH=<dir with pptxgenjs> node docs/slides/build.cjs
const pptxgen = require("pptxgenjs");
const path = require("path");

const INK = "1B2433", RED = "E8502B", PAPER = "FFFFFF", MIST = "F3F5F9", MUTED = "5B6677";
const GREEN = "2E7D32", GREENBG = "E3F6E8", AMBER = "B8860B", AMBERBG = "FFF4D6", SLATEBG = "E3E8F2";
const HEAD = "Cambria", BODY = "Calibri";
const img = (n) => path.join(__dirname, "img", n);

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.title = "Swissquote self-custody wallet";
pres.author = "Swissquote Wallet team";

function base(title, notes) {
  const s = pres.addSlide();
  s.background = { color: PAPER };
  s.addText(title, { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontFace: HEAD, fontSize: 34, bold: true, color: INK, margin: 0, valign: "top", isTextBox: true });
  if (notes) s.addNotes(notes);
  return s;
}
function card(s, x, y, w, h, fill) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill || MIST }, line: { color: fill || MIST }, rectRadius: 0.12 });
}
function label(s, text, x, y, w, color, size) {
  s.addText(text, { x, y, w, h: 0.4, fontFace: BODY, fontSize: size || 14, bold: true, color: color || RED, margin: 0, isTextBox: true });
}
function body(s, text, x, y, w, h, size, color) {
  const parts = String(text).split("\n");
  const runs = parts.map((t, i) => ({ text: t, options: { breakLine: i < parts.length - 1, paraSpaceAfter: parts.length > 1 ? 10 : 0 } }));
  s.addText(runs, { x, y, w, h, fontFace: BODY, fontSize: size || 16, color: color || INK, margin: 0, valign: "top", isTextBox: true });
}

// 1. Title (dark)
{
  const s = pres.addSlide();
  s.background = { color: INK };
  s.addText("Your keys. Your control.", { x: 0.8, y: 1.9, w: 11.5, h: 1.1, fontFace: HEAD, fontSize: 54, bold: true, color: PAPER, margin: 0, isTextBox: true });
  s.addText("One step from your Swissquote account.", { x: 0.8, y: 3.0, w: 11.5, h: 0.9, fontFace: HEAD, fontSize: 36, color: RED, margin: 0, isTextBox: true });
  s.addText("A self-custody wallet Swissquote could launch: the bank builds the tool, but never holds the keys.", { x: 0.8, y: 4.4, w: 9.5, h: 0.9, fontFace: BODY, fontSize: 20, color: "CADCFC", margin: 0, valign: "top", isTextBox: true });
  s.addText("EPFL Hackathon · Swissquote track · working prototype on regtest, Bitcoin signet and Ethereum Sepolia", { x: 0.8, y: 6.5, w: 11.5, h: 0.4, fontFace: BODY, fontSize: 14, color: "9AA6BD", margin: 0, isTextBox: true });
  s.addNotes("Opening line: the bank builds the tool, but never holds the keys. 30 seconds.");
}

// 2. Problem
{
  const s = base("Self-custody today means leaving the bank",
    "The client who wants their own keys withdraws to an external wallet. Swissquote loses the next trades, the conversions back to CHF and often the relationship. A lost seed phrase means lost funds, and Swissquote cannot help.");
  const cols = [
    ["Today", "The client withdraws crypto to an external wallet and leaves the Swissquote ecosystem.", INK],
    ["The cost for the bank", "Lost trades, lost conversions back to CHF, often the whole relationship.", INK],
    ["The cost for the client", "A lost seed phrase means lost funds. Nobody can help, not even the bank.", INK],
  ];
  cols.forEach((c, i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 1.8, 3.9, 2.6);
    label(s, c[0], x + 0.3, 2.05, 3.3);
    body(s, c[1], x + 0.3, 2.55, 3.3, 1.7, 18);
  });
  card(s, 0.6, 4.8, 12.1, 1.6, INK);
  s.addText("Our answer: keys stay with the client, recovery is built in, and every flow stays one click from the Swissquote account.", { x: 0.9, y: 4.95, w: 11.5, h: 1.3, fontFace: HEAD, fontSize: 24, color: PAPER, margin: 0, valign: "middle", isTextBox: true });
}

// 3. Custody decision
{
  const s = base("Custody: client seed + a rule enforced by Bitcoin",
    "We combine two models: the client's own seed, and an on-chain rule. The delay is a consensus rule, not a promise of our software. That is where we differ from a 2-of-3 MPC. Compared with five models in docs/custody-models.md.");
  card(s, 0.6, 1.6, 12.1, 1.2, INK);
  s.addText("or( pk(CLIENT), and( pk(SWISSQUOTE), and( pk(TRUSTED CONTACT), older(D) ) ) )", { x: 0.8, y: 1.65, w: 11.7, h: 1.1, fontFace: "Courier New", fontSize: 18, color: PAPER, margin: 0, valign: "middle", align: "center", isTextBox: true });
  const items = [
    ["Client alone", "Spends at any time, even with Swissquote stopped.", "tested"],
    ["Swissquote alone", "Never. Rejected by consensus.", "tested"],
    ["Swissquote + contact", "Only on coins unmoved for D blocks. Before D: non-BIP68-final.", "tested on signet"],
    ["Client stays active", "Any spend or Refresh restarts the delay.", "tested"],
  ];
  items.forEach((it, i) => {
    const x = 0.6 + i * 3.05;
    card(s, x, 3.15, 2.9, 2.4);
    label(s, it[0], x + 0.2, 3.3, 2.5, INK, 16);
    body(s, it[1], x + 0.2, 3.8, 2.5, 1.3, 14);
    label(s, it[2], x + 0.2, 5.1, 2.5, GREEN, 12);
  });
  body(s, "Demo D = 6 blocks. Production target (parameter): about 6 months. What we give up: a stolen seed is spent at once (mitigated by biometric unlock; hardware wallet in production). MPC does better there.", 0.6, 5.85, 12.1, 1.2, 14, MUTED);
}

// 4. Architecture
{
  const s = base("Architecture: what is real, what is mocked",
    "Green is real, yellow is mocked, blue-grey is a reference implementation. The bank mock is a separate process with its own storage. The client app holds no private key: checked by validate:inv5 with a positive control.");
  const box = (x, y, w, h, t, sub, fill, line) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: line, width: 1.25 }, rectRadius: 0.1 });
    s.addText([{ text: t, options: { bold: true, fontSize: 15, breakLine: true } }, { text: sub, options: { fontSize: 12 } }], { x: x + 0.1, y, w: w - 0.2, h, fontFace: BODY, color: INK, margin: 0, valign: "middle", align: "center", isTextBox: true });
  };
  box(0.6, 1.7, 3.3, 1.3, "Bank app (client/)", "e-banking + crypto tab. Public keys and PSBTs only", GREENBG, GREEN);
  box(0.6, 4.2, 3.3, 1.3, "Client Wallet", "separate app, own storage. Seed, biometrics, confirmation screen", SLATEBG, "44546F");
  box(5.1, 1.7, 3.3, 1.3, "bank-mock (Swissquote guardian)", "separate process, own key. Mocked re-KYC", AMBERBG, AMBER);
  box(5.1, 4.2, 3.3, 1.3, "Trusted-contact console", "decodes and signs. Phrase never stored", GREENBG, GREEN);
  box(9.6, 1.7, 3.1, 1.3, "Bitcoin", "regtest (bitcoind) + signet (Esplora)", GREENBG, GREEN);
  box(9.6, 4.2, 3.1, 1.3, "Ethereum Sepolia", "Safe + Candide recovery module, public paymaster", GREENBG, GREEN);
  const line = (x1, y1, x2, y2) => s.addShape(pres.shapes.LINE, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: { color: MUTED, width: 1.5, endArrowType: "triangle" } });
  line(2.25, 3.0, 2.25, 4.2);
  line(3.9, 2.35, 5.1, 2.35);
  line(3.9, 4.85, 5.1, 4.85);
  line(8.4, 2.35, 9.6, 2.35);
  line(8.4, 4.85, 9.6, 4.85);
  body(s, "Legend:  green = real   ·   yellow = mocked   ·   blue-grey = reference implementation. Not shown: attack panel (regtest demo).", 0.6, 6.1, 12.1, 0.8, 14, MUTED);
}

// 5. Creation + authentication
{
  const s = base("Creation and authentication",
    "The wallet is created from inside the e-banking session, so Swissquote knows which public keys belong to which client. Passkey step-up above 0.2 BTC. Ethereum threshold is not configured: said openly. Wallet unlock by biometrics (WebAuthn PRF) was verified by typecheck, build and UI text only, not by an end-to-end run.");
  s.addImage({ path: img("product.png"), x: 0.6, y: 1.6, w: 6.4, h: 4.52, altText: "Crypto tab of the Swissquote app" });
  const rows = [
    ["Creation", "Seed generated in the client's own wallet; only the public key goes to the bank. Linked to the client's identity through the bank session."],
    ["Everyday signing", "Biometric unlock of the Client Wallet, then a confirmation screen that decodes the transaction itself."],
    ["High value", "Above 0.2 BTC: passkey re-authentication with Swissquote, then retyping the last 6 characters of the address in the wallet."],
  ];
  rows.forEach((r, i) => {
    const y = 1.6 + i * 1.6;
    label(s, r[0], 7.4, y, 5.3, RED, 16);
    body(s, r[1], 7.4, y + 0.4, 5.3, 1.1, 14);
  });
  body(s, "Screenshot: the app on real signet. Total value is a market-price reading of test coins.", 0.6, 6.3, 6.4, 0.5, 11, MUTED);
}

// 6. Recovery
{
  const s = base("Recovery: lose the wallet, keep the funds",
    "Walk through the six steps. The network itself rejected the early broadcast: non-BIP68-final. After D it is accepted. Real signet recovery: tx c5ca6873 from the interface.");
  const steps = ["Re-KYC", "New wallet", "Swissquote signs", "Contact signs", "Broadcast: refused", "After D: accepted"];
  steps.forEach((t, i) => {
    const x = 0.6 + i * 2.05;
    s.addShape(pres.shapes.OVAL, { x: x, y: 1.6, w: 0.5, h: 0.5, fill: { color: i === 4 ? RED : INK }, line: { color: i === 4 ? RED : INK } });
    s.addText(String(i + 1), { x: x, y: 1.6, w: 0.5, h: 0.5, fontFace: BODY, fontSize: 14, bold: true, color: PAPER, align: "center", valign: "middle", margin: 0, isTextBox: true });
    body(s, t, x, 2.2, 1.9, 0.6, 14);
  });
  s.addImage({ path: img("refus.png"), x: 0.6, y: 3.0, w: 6.8, h: 2.26, altText: "Recovery rejected by the Bitcoin network before the delay" });
  card(s, 7.8, 3.0, 4.9, 3.6);
  label(s, "What stops an attacker", 8.05, 3.15, 4.4, RED, 16);
  body(s, "Stolen phone and email: the app holds no key, and re-KYC refuses wrong answers (403).\nSwissquote + contact too early: rejected by consensus.\nA hostile recovery on Ethereum: the owner can cancel during the delay.", 8.05, 3.65, 4.4, 2.8, 15);
  body(s, "Observed on regtest, then on real signet from the interface.", 0.6, 5.5, 6.8, 0.5, 12, MUTED);
}

// 7. Threat model
{
  const s = base("Threat model: the track's three questions",
    "Answer plainly, including the grey zone. Evidence: attacks 1, 2, 3 on regtest, invariant 1; Ethereum steps 16 and 18 on real Sepolia.");
  const hdr = { bold: true, color: PAPER, fill: { color: INK }, fontFace: BODY, fontSize: 14 };
  const c = (t, o) => ({ text: t, options: Object.assign({ fontFace: BODY, fontSize: 15, color: INK, valign: "top" }, o || {}) });
  s.addTable([
    [{ text: "Question", options: hdr }, { text: "Bitcoin", options: hdr }, { text: "Ethereum (Safe + recovery module)", options: hdr }],
    [c("Who could steal the funds?", { bold: true }), c("The client. Swissquote + contact together, only on coins unmoved for D blocks."), c("The client. Swissquote + contact together, only if the client does not cancel their recovery in time.")],
    [c("Who could lock the client out?", { bold: true }), c("Nobody: spending needs no Swissquote and no app."), c("Nobody for the owner key. Without the paymaster (a third party), the client pays gas.")],
    [c("Can Swissquote move funds without the client?", { bold: true }), c("Alone: no. With the contact: yes after D (the grey zone), unless the client refreshed."), c("Alone: no, two guardians needed. With the contact: yes after the delay if not cancelled.")],
  ], { x: 0.6, y: 1.6, w: 12.1, colW: [3.1, 4.5, 4.5], rowH: [0.5, 1.1, 0.9, 1.1], border: { type: "solid", pt: 0.75, color: "D5DAE3" }, fill: { color: PAPER }, margin: 0.1 });
  body(s, "Accepted limits: Swissquote gone AND key lost = funds lost. Contact loses their key = recovery impossible. A stolen seed spends at once.", 0.6, 5.5, 12.1, 0.9, 15, MUTED);
}

// 8. Evidence
{
  const s = base("Every claim points to a recorded run",
    "docs/validation holds one report per step with the command and the observed output. Do not claim more than was run.");
  const stats = [
    ["36", "steps, each with a commit and a report in docs/validation"],
    ["19 / 19", "end-to-end Chrome checks, desktop layout (phone: 20 / 20)"],
    ["3", "attacks refused or survived against a real node"],
    ["2", "real signet transactions: client spend and recovery broadcast at D"],
  ];
  stats.forEach((st, i) => {
    const x = 0.6 + i * 3.05;
    card(s, x, 1.8, 2.9, 2.7);
    s.addText(st[0], { x: x + 0.2, y: 2.0, w: 2.5, h: 1.0, fontFace: HEAD, fontSize: 44, bold: true, color: RED, margin: 0, isTextBox: true });
    body(s, st[1], x + 0.2, 3.1, 2.5, 1.3, 14);
  });
  body(s, "Reproduce: npm run regtest:up, then npm run demo (three commands). Checks: validate:6:ui, test:attacks, validate:inv5 (no private key in client/ or its bundle).", 0.6, 4.9, 12.1, 1.0, 16);
  body(s, "Last full run of the checks listed above was recorded before steps 17 to 36; later steps were verified by typecheck and build, plus browser checks where noted in their reports.", 0.6, 6.0, 12.1, 0.8, 12, MUTED);
}

// 9. Ethereum + gasless
{
  const s = base("Bonus: Ethereum with no ETH (gasless)",
    "Candide's public paymaster pays the gas; it is a third party, not Swissquote. Abuse prevention: the public paymaster is rate-limited per IP; we did not build our own abuse detection. Compliant dApp: only the plain-language decoding of the operation before signing exists, with an unlimited-approval flag. No sanctions screening, no approved dApp list.");
  card(s, 0.6, 1.7, 6.0, 4.6);
  label(s, "What ran on the real Sepolia, with 0 ETH", 0.9, 1.9, 5.4, RED, 16);
  body(s, "Safe + recovery module + two guardians created in one sponsored operation.\nSwissquote alone is refused by the contract.\nSwissquote + contact start a recovery; finalizing early is refused.\nRecovery to a new key: the new key owns the Safe, the old one is refused.\nThe owner cancels a hostile recovery.", 0.9, 2.4, 5.4, 3.7, 17);
  card(s, 6.9, 1.7, 5.8, 4.6);
  label(s, "Honest status", 7.2, 1.9, 5.2, RED, 16);
  body(s, "Gasless: real, via a public paymaster (third party). Abuse control is the paymaster's rate limit only.\nCompliant dApp: partial. Operations are decoded in plain language and unlimited approvals are flagged. No sanctions screening, no approved-dApp list.\nEthereum passkey threshold: not configured.\nSigning without a paymaster: not tested.", 7.2, 2.4, 5.2, 3.7, 17);
}

// 10. Legal
{
  const s = base("Legal reading: software, not custody (hypothesis)",
    "These are design hypotheses to confirm with a lawyer, as written in docs/travel-rule.md. The ownership proof is BIP-322 on the client key, not on the P2WSH address itself: bip322-js does not handle P2WSH.");
  card(s, 0.6, 1.7, 5.9, 4.6);
  label(s, "Custody", 0.9, 1.9, 5.3, RED, 18);
  body(s, "Swissquote alone can never move the funds: consensus refuses.\nThe only joint power is Swissquote + a contact chosen by the client, after a delay the client resets by any spend.\nThis is the grey zone the track names. We argue it rather than deny it.", 0.9, 2.4, 5.3, 3.7, 17);
  card(s, 6.8, 1.7, 5.9, 4.6);
  label(s, "Travel Rule", 7.1, 1.9, 5.3, RED, 18);
  body(s, "The wallet is created inside the bank session, so ownership is proved, not declared.\nSwissquote sends only after a signed single-use challenge (BIP-322); a deposit is credited only if all inputs come from a registered wallet.\nPaying a third party from the wallet: Swissquote does not sign, so we hypothesise it is not the sending institution.", 7.1, 2.4, 5.3, 3.7, 17);
  body(s, "Verified by validate:7 and validate:11 on regtest. Withdrawals are regtest only.", 0.6, 6.5, 12.1, 0.5, 12, MUTED);
}

// 11. Business case
{
  const s = base("Business case: an honest break-even",
    "None of these figures is a Swissquote figure. The product does not pay for itself on fees alone at illustrative values; the pitch rests on real N, V, f from Swissquote and on strategic value. Break-even: about 2,730 retained clients.");
  card(s, 0.6, 1.7, 12.1, 1.1, INK);
  s.addText("Annual gain = N × p × ( V × f × t + s ) − C", { x: 0.8, y: 1.7, w: 11.7, h: 1.1, fontFace: "Courier New", fontSize: 26, color: PAPER, align: "center", valign: "middle", margin: 0, isTextBox: true });
  const st = [
    ["−CHF 67,500", "at illustrative values: fees alone do not cover the cost"],
    ["≈ 2,730", "retained clients needed to break even, other values fixed"],
    ["CHF 55", "gain per retained client per year at those values"],
  ];
  st.forEach((x, i) => {
    const xx = 0.6 + i * 4.1;
    card(s, xx, 3.1, 3.9, 2.1);
    s.addText(x[0], { x: xx + 0.25, y: 3.25, w: 3.4, h: 0.9, fontFace: HEAD, fontSize: 34, bold: true, color: RED, margin: 0, isTextBox: true });
    body(s, x[1], xx + 0.25, 4.2, 3.4, 0.9, 14);
  });
  body(s, "Levers: retained trades and conversions, a paid recovery service, new self-custody-minded clients, lower \"I lost my phrase\" support. The inputs we need from Swissquote: N, V, f, and the current cost of verifying an external address.", 0.6, 5.5, 12.1, 1.2, 15);
}

// 12. Limits, AI, next
{
  const s = base("Limits, AI use and what comes next",
    "The code was written very quickly and mainly by the AI and has not been audited. Say so. Slides themselves were drafted with Claude Code.");
  card(s, 0.6, 1.7, 3.9, 4.7);
  label(s, "Limits", 0.85, 1.9, 3.4, RED, 16);
  body(s, "Stolen seed: spent at once.\nFew external wallets sign this script.\nBank, re-KYC and email are mocked.\nCode not audited.", 0.85, 2.4, 3.4, 3.8, 16);
  card(s, 4.7, 1.7, 3.9, 4.7);
  label(s, "AI tools", 4.95, 1.9, 3.4, RED, 16);
  body(s, "Claude Code (Opus 5.5, Sonnet 5.5): spec review, code, tests, validation reports, docs, these slides.\nThe human decided the custody model; every claim is tied to an executed test.\nNo AI-written cryptography: established libraries only.", 4.95, 2.4, 3.4, 3.8, 16);
  card(s, 8.8, 1.7, 3.9, 4.7);
  label(s, "Next", 9.05, 1.9, 3.4, RED, 16);
  body(s, "Taproot: the client spend looks like a normal payment.\nTrusted-contact inbox and notifications.\nChange of contact.\nSecure element or hardware wallet.\nSanctions screening of destinations.", 9.05, 2.4, 3.4, 3.8, 16);
}

// 13. Close (dark)
{
  const s = pres.addSlide();
  s.background = { color: INK };
  s.addText("Create. Sign. Lose it. Recover.", { x: 0.8, y: 2.3, w: 11.7, h: 1.1, fontFace: HEAD, fontSize: 48, bold: true, color: PAPER, margin: 0, isTextBox: true });
  s.addText("Self-custody, with a Swiss bank one step away.", { x: 0.8, y: 3.5, w: 11.7, h: 0.8, fontFace: HEAD, fontSize: 30, color: RED, margin: 0, isTextBox: true });
  s.addText("Live demo: npm run regtest:up, then npm run demo", { x: 0.8, y: 5.2, w: 11.7, h: 0.5, fontFace: "Courier New", fontSize: 18, color: "CADCFC", margin: 0, isTextBox: true });
  s.addNotes("Offer to run the live demo, with the recorded video as backup.");
}

pres.writeFile({ fileName: path.join(__dirname, "swissquote-wallet-pitch.pptx") }).then((f) => console.log("wrote", f));
