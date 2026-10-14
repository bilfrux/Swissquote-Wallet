// Builds docs/slides/swissquote-wallet-2min.pptx : 6 slides, about 2 minutes, then the live demo.
// Visual identity taken from the app (client/src/index.css, client/public): Swissquote orange #FE5E3A,
// anthracite wordmark, light blue-grey cards, rounded corners, geometric sans-serif, 3D isometric visual.
// Run: node docs/slides/build-2min.cjs   (needs pptxgenjs resolvable from this folder)
const pptxgen = require("pptxgenjs");
const path = require("path");

const RED = "FE5E3A", REDTEXT = "D6401F", REDSOFT = "FFF0EC", BG = "EEF1F7", LINE = "E2E7F0";
const TEXT = "1F2633", MUTED = "6B7487", DARK = "22272F", GREEN = "12805C", PAPER = "FFFFFF";
const FONT = "Helvetica Neue";
const img = (n) => path.join(__dirname, "img", n);
const LOGO_RATIO = 224 / 1212;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.title = "Swissquote self-custody wallet (2-minute version)";
pres.author = "Swissquote Wallet team";

const card = (s, x, y, w, h, fill) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill || BG }, line: { color: fill || BG, width: 1 }, rectRadius: 0.16 });
const pill = (s, text, x, y, w, fill, color) => {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.38, fill: { color: fill || REDSOFT }, line: { color: fill || REDSOFT }, rectRadius: 0.19 });
  s.addText(text, { x, y, w, h: 0.38, fontFace: FONT, fontSize: 12, bold: true, color: color || REDTEXT, align: "center", valign: "middle", margin: 0, isTextBox: true });
};
function body(s, text, x, y, w, h, size, color) {
  const parts = String(text).split("\n");
  const runs = parts.map((t, i) => ({ text: t, options: { breakLine: i < parts.length - 1, paraSpaceAfter: parts.length > 1 ? 10 : 0 } }));
  s.addText(runs, { x, y, w, h, fontFace: FONT, fontSize: size || 18, color: color || TEXT, margin: 0, valign: "top", isTextBox: true });
}
const heading = (s, text, x, y, w, size) => s.addText(text, { x, y, w, h: 0.5, fontFace: FONT, fontSize: size || 20, bold: true, color: DARK, margin: 0, isTextBox: true });
// Standard slide: logo top-left, eyebrow pill, dark title, notes.
function base(eyebrow, title, notes) {
  const s = pres.addSlide();
  s.background = { color: PAPER };
  s.addImage({ path: img("swissquote-logo.png"), x: 0.6, y: 0.4, w: 2.1, h: 2.1 * LOGO_RATIO, altText: "Swissquote" });
  pill(s, eyebrow, 0.6, 1.2, 0.35 + eyebrow.length * 0.105, REDSOFT, REDTEXT);
  s.addText(title, { x: 0.6, y: 1.7, w: 12.1, h: 0.8, fontFace: FONT, fontSize: 34, bold: true, color: DARK, margin: 0, valign: "top", isTextBox: true });
  s.addNotes(notes);
  return s;
}

// 1. Title - 10 s
{
  const s = pres.addSlide();
  s.background = { color: PAPER };
  s.addImage({ path: img("swissquote-logo.png"), x: 0.7, y: 0.6, w: 3.0, h: 3.0 * LOGO_RATIO, altText: "Swissquote" });
  s.addImage({ path: img("login-visual.png"), x: 7.3, y: 0.9, w: 5.7, h: 5.7, altText: "Swissquote isometric illustration" });
  s.addText([{ text: "Your keys.", options: { breakLine: true, color: DARK } }, { text: "Your control.", options: { color: RED } }],
    { x: 0.7, y: 2.1, w: 6.8, h: 2.4, fontFace: FONT, fontSize: 64, bold: true, margin: 0, valign: "top", isTextBox: true });
  s.addText("A self-custody wallet one step from your Swissquote account.", { x: 0.7, y: 4.5, w: 6.3, h: 0.9, fontFace: FONT, fontSize: 22, color: MUTED, margin: 0, valign: "top", isTextBox: true });
  pill(s, "The bank builds the tool, but never holds the keys.", 0.7, 5.7, 5.3, REDSOFT, REDTEXT);
  s.addText("EPFL Hackathon · Swissquote track", { x: 0.7, y: 6.8, w: 6, h: 0.35, fontFace: FONT, fontSize: 13, color: MUTED, margin: 0, isTextBox: true });
  s.addNotes("[10 s] Self-custody means leaving the bank. We built the wallet where clients keep their keys and stay with Swissquote.");
}

// 2. A + B - 25 s
{
  const s = base("THE DEMONSTRATION", "A + B: why it holds",
    "[25 s] Our design is A plus B. A: the client's own key, always able to spend alone. B: a rule enforced by the chain: Swissquote and a trusted contact can recover, but only after a delay. So Swissquote alone can do nothing, before the delay the network refuses, and a lost key is recoverable. All tested on a real node.");
  card(s, 0.6, 2.7, 5.95, 1.5, BG);
  s.addText("A", { x: 0.85, y: 2.8, w: 0.8, h: 1.3, fontFace: FONT, fontSize: 54, bold: true, color: RED, margin: 0, valign: "middle", isTextBox: true });
  heading(s, "The client's key", 1.75, 2.9, 4.6, 20);
  body(s, "In their own wallet. Spends alone, at any time.", 1.75, 3.4, 4.6, 0.8, 16);
  card(s, 6.75, 2.7, 5.95, 1.5, BG);
  s.addText("B", { x: 7.0, y: 2.8, w: 0.8, h: 1.3, fontFace: FONT, fontSize: 54, bold: true, color: RED, margin: 0, valign: "middle", isTextBox: true });
  heading(s, "A rule enforced by the chain", 7.9, 2.9, 4.7, 20);
  body(s, "Swissquote + a trusted contact, only after a delay D.", 7.9, 3.4, 4.6, 0.8, 16);
  s.addText("A + B  ⇒", { x: 0.6, y: 4.5, w: 12.1, h: 0.5, fontFace: FONT, fontSize: 22, bold: true, color: REDTEXT, margin: 0, isTextBox: true });
  const out = [
    ["Swissquote alone", "can do nothing"],
    ["Swissquote + contact", "refused by the network before D"],
    ["Client stays active", "the delay restarts"],
    ["Key lost", "recovery after D"],
  ];
  out.forEach((o, i) => {
    const x = 0.6 + i * 3.05;
    card(s, x, 5.1, 2.9, 1.45, BG);
    heading(s, o[0], x + 0.25, 5.25, 2.5, 16);
    body(s, o[1], x + 0.25, 5.8, 2.5, 0.7, 15);
  });
  body(s, "Each one tested on a real node. D = 6 blocks in the demo, about 6 months in production.", 0.6, 6.75, 12.1, 0.4, 13, MUTED);
}

// 3. The required points - 30 s
{
  const s = base("THE REQUIRED POINTS", "One answer to each point of the brief",
    "[20 s] Every point of the brief has a one-line answer here. Two to notice: the server checks a biometric passkey to open the crypto area, so a stolen password gets nothing; and if Swissquote disappears, an Emergency exit signs with the client's key alone.");
  const hdr = { bold: true, color: PAPER, fill: { color: DARK }, fontFace: FONT, fontSize: 13 };
  const c = (t, o) => ({ text: t, options: Object.assign({ fontFace: FONT, fontSize: 14, color: TEXT, valign: "middle" }, o || {}) });
  const rows = [
    ["Custody model", "Client key + on-chain rule. Threat model written, grey zone argued, contact can be changed."],
    ["Architecture", "Separate processes, each part labelled real or mocked."],
    ["Wallet creation", "Seed made on the client's own device. The bank only gets public keys."],
    ["Authentication", "Biometric passkey, checked by the server, to open the crypto area and to sign. Above 0.2 BTC: extra check."],
    ["Recovery", "Bank + contact after D. A stolen password gets nothing. Swissquote gone: Emergency exit, key alone (Bitcoin)."],
    ["Business case", "Flows stay in the app. Break-even formula with explicit assumptions."],
    ["Bonus", "Gasless: real (public paymaster). Compliant dApp: partial."],
  ];
  s.addTable([
    [{ text: "Required point", options: hdr }, { text: "Our answer", options: hdr }],
    ...rows.map((r) => [c(r[0], { bold: true, color: DARK }), c(r[1])]),
  ], { x: 0.6, y: 2.65, w: 12.1, colW: [2.9, 9.2], rowH: [0.4, 0.55, 0.55, 0.55, 0.55, 0.65, 0.55, 0.55], border: { type: "solid", pt: 0.75, color: LINE }, fill: { color: PAPER }, margin: [0, 0.12, 0, 0.12] });
}

// 4. Why not MPC / smart wallet - 30 s
{
  const s = base("THE CHOICE", "Why not MPC or a smart wallet?",
    "[30 s] Why not MPC or a smart wallet? I looked at both first. MPC lets Swissquote and a partner sign immediately: the delay is only software. My first plan, a Safe with a passkey, had too many problems, and it is Ethereum only, so no Bitcoin. So the key is a plain seed and the delay is Bitcoin consensus. On Ethereum, we do use a Safe.");
  card(s, 0.6, 2.7, 5.95, 2.9, BG);
  heading(s, "MPC 2-of-3", 1.0, 2.9, 5.2, 22);
  body(s, "Swissquote + partner can sign at once. The delay would be a rule in their software, so a colluding bank skips it.\nThe library leaves recovery and storage to us: no browser or mobile support (cb-mpc, read in its docs, not run).", 1.0, 3.5, 5.2, 2.1, 16);
  card(s, 6.75, 2.7, 5.95, 2.9, BG);
  heading(s, "Smart wallet (Safe + passkey)", 7.15, 2.9, 5.2, 22);
  body(s, "Our first plan. The problems we found: one delay per recovery module, a passkey owner that is itself a contract, and Ethereum only: no Bitcoin.", 7.15, 3.5, 5.2, 2.1, 16);
  card(s, 0.6, 5.85, 12.1, 1.1, RED);
  s.addText("So: the key stays a plain seed (A), the delay lives in Bitcoin consensus (B). On Ethereum, where it fits, we do use a Safe.", { x: 1.0, y: 5.85, w: 11.3, h: 1.1, fontFace: FONT, fontSize: 19, bold: true, color: PAPER, margin: 0, valign: "middle", isTextBox: true });
}

// 5. Why Swissquote - 25 s
{
  const s = base("WHY SWISSQUOTE", "What Swissquote gains",
    "[25 s] Why Swissquote? Today self-custody means the client withdraws and takes the trades away. Here the flows stay in the app. Swissquote cannot move the funds alone, so, subject to a lawyer, no custody burden. Travel Rule proofs become automatic. Honestly, break-even is about 2,700 clients at our illustrative numbers.");
  const items = [
    ["Keeps the flows", "Trades and CHF conversions stay in the app instead of leaving with the withdrawal."],
    ["No custody burden", "Swissquote cannot move the funds alone (hypothesis, to confirm with a lawyer)."],
    ["Lower cost, new clients", "Ownership proof for the Travel Rule is automatic. A lost phrase is no longer a lost fund. A bank offer for self-custody-minded clients."],
  ];
  items.forEach((it, i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 2.7, 3.9, 2.9, BG);
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: 2.95, w: 0.16, h: 0.16, fill: { color: RED }, line: { color: RED } });
    heading(s, it[0], x + 0.3, 3.25, 3.4, 20);
    body(s, it[1], x + 0.3, 3.85, 3.4, 1.7, 16);
  });
  card(s, 0.6, 5.85, 12.1, 1.1, DARK);
  s.addText("Honest numbers: with illustrative inputs, break-even is about 2,730 retained clients. We need Swissquote's real volumes.", { x: 1.0, y: 5.85, w: 11.3, h: 1.1, fontFace: FONT, fontSize: 18, color: PAPER, margin: 0, valign: "middle", isTextBox: true });
}

// 6. Real and mocked, then demo - 10 s (orange, like the Swissquote card)
{
  const s = pres.addSlide();
  s.background = { color: RED };
  s.addNotes("[10 s] Real: keys, scripts, delays, transactions. Mocked: the bank and the KYC. Now, live.");
  card(s, 0.6, 0.4, 2.5, 0.75, PAPER);
  s.addImage({ path: img("swissquote-logo.png"), x: 0.8, y: 0.57, w: 2.1, h: 2.1 * LOGO_RATIO, altText: "Swissquote" });
  s.addText("Real and mocked, openly", { x: 0.6, y: 1.5, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 38, bold: true, color: PAPER, margin: 0, isTextBox: true });
  card(s, 0.6, 2.7, 5.95, 2.0, PAPER);
  s.addText("Real", { x: 1.0, y: 2.9, w: 5.2, h: 0.45, fontFace: FONT, fontSize: 22, bold: true, color: GREEN, margin: 0, isTextBox: true });
  body(s, "Keys, scripts, delays and transactions on regtest, signet and Sepolia.", 1.0, 3.5, 5.2, 1.1, 18);
  card(s, 6.75, 2.7, 5.95, 2.0, PAPER);
  s.addText("Mocked", { x: 7.15, y: 2.9, w: 5.2, h: 0.45, fontFace: FONT, fontSize: 22, bold: true, color: "B8860B", margin: 0, isTextBox: true });
  body(s, "The bank, the KYC and the CHF accounts.", 7.15, 3.5, 5.2, 1.1, 18);
  s.addText("Known limit: if Swissquote disappears and the client loses their key, the funds are lost.", { x: 0.6, y: 5.0, w: 12.1, h: 0.7, fontFace: FONT, fontSize: 18, color: PAPER, margin: 0, valign: "top", isTextBox: true });
  s.addText("Live demo", { x: 0.6, y: 5.8, w: 12.1, h: 1.1, fontFace: FONT, fontSize: 56, bold: true, color: PAPER, margin: 0, isTextBox: true });
}

pres.writeFile({ fileName: path.join(__dirname, "swissquote-wallet-2min.pptx") }).then((f) => console.log("wrote", f));
