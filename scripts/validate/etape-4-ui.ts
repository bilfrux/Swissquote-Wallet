// Panneau « Attaques » dans Chrome headless : chaque bouton exécute le vrai scénario et affiche le verdict
// et le message réel de la chaîne. Prérequis : regtest:up ; npm run attacks:server ; appli en regtest (APP_URL).
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { makeReport } from "./lib.ts";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync("docs/validation/captures", { recursive: true });
const { report, summary } = makeReport();

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
try {
  await page.goto(APP);
  const cases = [
    { label: "Steal the phone and email", expect: "⛔ Rejected", chain: "Signature must be zero for failed CHECK(MULTI)SIG operation" },
    { label: "Swissquote + trusted contact collude before the delay", expect: "⛔ Rejected", chain: "non-BIP68-final" },
    { label: "Swissquote disappears", expect: "✅ Succeeded", chain: "broadcast" },
  ];
  for (const [i, c] of cases.entries()) {
    const block = page.locator(".attack").nth(i);
    await block.getByRole("button", { name: c.label }).click();
    const out = block.locator(".success, .error");
    await out.first().waitFor({ timeout: 120000 });
    const text = (await out.first().textContent()) ?? "";
    report(`UI-${i + 1}`, `Bouton « ${c.label} » : ${c.expect}, conforme, message réel de la chaîne affiché`,
      text.includes(c.expect) && text.includes("(as expected)") && text.includes(c.chain), text.replace(/\s+/g, " ").slice(0, 260));
  }
  await page.locator(".attack").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "docs/validation/captures/etape-4-panneau-attaques.png", fullPage: true });
} finally {
  await browser.close();
}
report("UI-4", "Aucune erreur dans la console du navigateur", errors.length === 0, errors.join(" | ") || "aucune");
process.exit(summary() ? 0 : 1);
