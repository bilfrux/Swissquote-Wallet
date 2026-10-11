// Étape 19 : captures de l'accueil du wallet (sélecteur de réseau), ordinateur et téléphone. Démo signet en cours.
import { chromium } from "playwright-core";
import { makeReport } from "./lib.ts";
const APP = process.env.APP_URL ?? "http://localhost:5183";
const { report, summary } = makeReport();
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errs: string[] = [], failed: string[] = [];
for (const [name, vp] of [["ordinateur", { width: 1280, height: 1000 }], ["telephone", { width: 390, height: 844 }]] as const) {
  const ctx = await b.newContext({ viewport: vp });
  const p = await ctx.newPage(); p.on("console", (m) => m.type() === "error" && errs.push(m.text())); p.on("pageerror", (e) => errs.push(e.message)); p.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).host}`); });
  await p.goto(APP); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload();
  await p.getByRole("button", { name: "Login", exact: true }).click(); // site public (étape 22)
  await p.getByLabel("Username").fill("CH-0003"); await p.getByLabel("Password", { exact: true }).fill("demo0003");
  await p.getByRole("button", { name: "Log in", exact: true }).click();
  await p.getByRole("button", { name: "Crypto", exact: true }).first().click();
  await p.getByTestId("btc-balance").waitFor({ timeout: 30000 }); await p.waitForTimeout(4000);
  const btcShown = await p.getByTestId("btc-balance").isVisible(), evmHidden = !(await p.getByTestId("evm-usdc").isVisible());
  await p.screenshot({ path: `docs/validation/captures/etape-19-${name}-1-bitcoin.png`, fullPage: true });
  await p.getByTestId("network-switcher").click(); await p.waitForTimeout(800);
  const menu = (await p.locator(".net-menu").textContent()) ?? "";
  await p.screenshot({ path: `docs/validation/captures/etape-19-${name}-2-menu.png` });
  await p.getByTestId("network-evm").click();
  await p.getByTestId("evm-guardians").waitFor({ timeout: 30000 }); await p.getByTestId("evm-activity").locator(".tx-row").first().waitFor({ timeout: 30000 });
  const evmShown = await p.getByTestId("evm-usdc").isVisible(), btcHidden = !(await p.getByTestId("btc-balance").isVisible());
  const rows = await p.getByTestId("evm-activity").locator(".tx-row").count();
  await p.screenshot({ path: `docs/validation/captures/etape-19-${name}-3-ethereum.png`, fullPage: true });
  // Passage du seuil ordinateur/téléphone (redimensionnement) : l'appli ne doit pas être reconstruite (état conservé).
  if (name === "ordinateur") {
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
    await p.setViewportSize({ width: 1280, height: 1000 }); await p.waitForTimeout(800);
    const kept = await p.getByTestId("evm-usdc").isVisible() && await p.getByTestId("network-switcher").isVisible() && !(await p.getByText("Loading…").first().isVisible().catch(() => false));
    report("19-resize", "Redimensionnement à travers le seuil téléphone/ordinateur : réseau choisi et page conservés (pas de rechargement)", kept, `page Ethereum toujours affichée : ${kept}`);
  }
  await p.reload(); await p.getByRole("button", { name: "Crypto", exact: true }).first().click();
  await p.getByTestId("evm-guardians").waitFor({ timeout: 30000 });
  const remembered = await p.getByTestId("evm-usdc").isVisible();
  report(`19-${name}`, `Accueil du wallet (${name}) : un seul réseau affiché, menu avec les deux comptes et leurs soldes, choix mémorisé, historique Ethereum lu on-chain`,
    btcShown && evmHidden && /Bitcoin/.test(menu) && /Ethereum/.test(menu) && /USDC/.test(menu) && evmShown && btcHidden && rows > 0 && remembered,
    `menu : ${menu.replace(/\s+/g, " ").slice(0, 200)} ; lignes d'activité Ethereum affichées : ${rows} ; réseau mémorisé après rechargement : ${remembered}`);
}
await b.close();
report("19-x", "Aucune erreur dans les consoles des navigateurs", errs.length === 0, `${errs.join(" | ") || "aucune"} ; réponses en erreur : ${[...new Set(failed)].join(", ") || "aucune"}`);
process.exit(summary() ? 0 : 1);
