// Étape 23 : « Refresh » réel sur signet depuis l'interface (envoi à soi-même, signé dans le Wallet du client),
// puis compte à rebours du délai de recovery observé à deux instants. Démo : scripts/demo/signet-ports.sh.
import { chromium, type BrowserContext } from "playwright-core";
import { makeReport } from "./lib.ts";

const APP = process.env.APP_URL ?? "http://localhost:5183", PIN = process.env.WALLET_PIN ?? "482916";
const SHOTS = "docs/validation/captures";
const { report, summary } = makeReport();
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errs: string[] = [], failed: string[] = [];
const popupOf = async (ctx: BrowserContext, click: () => Promise<void>) => { const [p] = await Promise.all([ctx.waitForEvent("page", { timeout: 60000 }), click()]); await p.waitForLoadState(); return p; };
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  ctx.on("page", (p) => { p.on("console", (m) => m.type() === "error" && errs.push(m.text())); p.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).host}`); }); });
  const p = await ctx.newPage();
  await p.goto(APP); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload();
  await p.getByRole("button", { name: "Login", exact: true }).click();
  await p.getByLabel("Username").fill("CH-0003"); await p.getByLabel("Password", { exact: true }).fill("demo0003");
  await p.getByRole("button", { name: "Log in", exact: true }).click();
  await p.getByRole("button", { name: "Crypto", exact: true }).first().click();
  await p.getByTestId("btc-balance").getByText(/\d\.\d+ BTC/).waitFor({ timeout: 60000 });
  const before = (await p.getByTestId("btc-balance").textContent())!.trim();
  // Refresh seulement si un coin a dépassé le délai (sinon il a déjà été fait : on passe à l'observation).
  const needed = await p.getByTestId("recovery-countdown").filter({ hasText: "can already be moved" }).count();
  if (needed) {
  await p.getByRole("button", { name: "Refresh", exact: true }).click();
  await p.getByRole("button", { name: "Prepare the refresh" }).click();
  const w = await popupOf(ctx, () => p.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 30000 }));
  await w.getByRole("heading", { name: "Confirm the transfer" }).waitFor({ timeout: 20000 });
  const screen = (await w.locator("section").first().textContent())?.replace(/\s+/g, " ") ?? "";
  const pin = w.getByLabel("Wallet PIN"); if (await pin.count()) await pin.fill(PIN);
  await w.getByRole("button", { name: "Confirm and sign" }).click();
  await p.getByRole("button", { name: "Broadcast on the Bitcoin network" }).click();
  const sent = (await p.locator(".success", { hasText: "Transaction broadcast" }).textContent({ timeout: 30000 })) ?? "";
  const txid = sent.match(/[0-9a-f]{64}/)?.[0];
  report("23-1", "Refresh depuis l'interface sur signet : envoi à soi-même signé dans le Wallet du client, diffusé", !!txid && /Transfer to yourself/.test(screen), `solde avant ${before} ; https://blockstream.info/signet/tx/${txid} ; écran : ${screen.slice(0, 160)}`);
  } else console.log(`[--] 23-1 : Refresh déjà diffusé lors d'un essai précédent (solde ${before}, aucun coin au-delà du délai)`);

  // Compte à rebours : badge d'en-tête (le bandeau n'apparaît qu'à ≤ D/3 blocs) et onglet Coins, relevés à 5 s d'écart.
  await p.getByRole("button", { name: "Reload" }).click();
  const chip = p.getByTestId("btc-balance").locator("xpath=..").locator(".chip"); // badge de la fiche Bitcoin (pas celui d'Ethereum, masqué)
  await chip.getByText(/Recovery possible in \d+ block\(s\) \(≈/).waitFor({ timeout: 60000 });
  const t1 = (await chip.textContent())!.trim();
  await p.waitForTimeout(5000);
  const t2 = (await chip.textContent())!.trim();
  await p.screenshot({ path: `${SHOTS}/etape-23-1-compte-a-rebours.png` });
  await p.getByRole("button", { name: "Coins", exact: true }).click();
  const coins = (await p.locator("#coins").textContent())?.replace(/\s+/g, " ") ?? "";
  await p.screenshot({ path: `${SHOTS}/etape-23-2-coins.png` });
  const secs = (s: string) => { const m = s.match(/(?:(\d+) h )?(\d+) min (\d+) s/); return m ? (+(m[1] ?? 0)) * 3600 + +m[2] * 60 + +m[3] : NaN; };
  report("23-2", "Compte à rebours affiché et qui défile (deux relevés à 5 s d'écart) ; coin non confirmé : délai compté à partir de sa confirmation",
    secs(t1) - secs(t2) >= 4 && secs(t1) - secs(t2) <= 6 && /after confirmation|block\(s\) ≈/.test(coins), `${t1} → ${t2} ; coins : ${coins.slice(0, 220)}`);
} finally {
  await b.close();
}
report("23-x", "Aucune erreur dans les consoles", errs.length === 0, `${errs.join(" | ") || "aucune"} ; réponses en erreur : ${[...new Set(failed)].join(", ") || "aucune"}`);
process.exit(summary() ? 0 : 1);
