// Étape 20 : page Crypto en colonnes (style plateforme Swissquote), positions, prix du marché et courbes.
// Prérequis : scripts/demo/signet-ports.sh (appli APP_URL, bank-mock :4000), client CH-0003 avec ses deux comptes.
import { chromium, type Page } from "playwright-core";
import { makeReport } from "./lib.ts";

const APP = process.env.APP_URL ?? "http://localhost:5183", BANK = "http://localhost:4000";
const SHOTS = "docs/validation/captures";
const { report, summary } = makeReport();
const chf = (t: string | null) => Number((t ?? "").replace(/[’'\s]/g, "").replace(/[^0-9.\-]/g, ""));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errs: string[] = [], failed: string[] = [];
const login = async (p: Page) => {
  await p.goto(APP); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload();
  await p.getByRole("button", { name: "Login", exact: true }).click(); // site public (étape 22)
  await p.getByLabel("Username").fill("CH-0003"); await p.getByLabel("Password", { exact: true }).fill("demo0003");
  await p.getByRole("button", { name: "Log in", exact: true }).click();
};

try {
  // 20-1 Flux de prix de Swissquote : relais CoinGecko avec cache partagé.
  const m1 = await (await fetch(`${BANK}/market/prices`)).json();
  const m2 = await (await fetch(`${BANK}/market/prices`)).json();
  const btcPx = m1.data.bitcoin.chf, usdcPx = m1.data["usd-coin"].chf;
  report("20-1", "Flux de prix fourni par bank-mock (CoinGecko), deuxième appel servi par le cache (même horodatage)",
    btcPx > 1000 && usdcPx > 0.5 && m1.at === m2.at, `BTC ${btcPx} CHF, USDC ${usdcPx} CHF ; source à ${new Date(m1.at).toISOString()} ; périmé : ${m1.stale}`);

  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && errs.push(m.text())); p.on("pageerror", (e) => errs.push(e.message)); p.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).host}`); });
  await login(p);
  await p.getByRole("button", { name: "Crypto", exact: true }).first().click();
  const pos = p.getByTestId("positions");
  await p.getByTestId("price-chart-bitcoin").locator("svg").waitFor({ timeout: 30000 });
  await pos.locator("tr.pos-row").first().getByText(/\d BTC/).waitFor({ timeout: 60000 }); // solde Bitcoin lu (Esplora)
  await pos.locator("tr.pos-row").nth(1).getByText(/\d USDC/).waitFor({ timeout: 60000 }); // solde USDC lu (Sepolia)
  await p.waitForTimeout(1500);

  // 20-2 Positions : valeur = quantité × prix du marché ; groupes « vos clés » et « Swissquote (garde) ».
  const rows = await pos.locator("tr.pos-row").allTextContents();
  const btcQty = Number((rows[0].match(/([0-9.]+) BTC/) ?? [])[1]);
  const usdcQty = Number((rows[1].match(/([0-9.]+) USDC/) ?? [])[1]);
  const vals = await pos.locator("tr.pos-row td.num:nth-of-type(2)").allTextContents();
  const okBtc = Math.abs(chf(vals[0]) - btcQty * btcPx) < 0.02, okUsdc = Math.abs(chf(vals[1]) - usdcQty * usdcPx) < 0.02;
  const groups = await pos.locator("tr.group").allTextContents();
  report("20-2", "Positions : valeur CHF = quantité × prix du marché ; self-custody (vos clés) séparée du compte en garde chez Swissquote",
    okBtc && okUsdc && groups.some((g) => /your keys/.test(g)) && groups.some((g) => /custody/.test(g)),
    `BTC ${btcQty} × ${btcPx} → ${vals[0]} ; USDC ${usdcQty} × ${usdcPx} → ${vals[1]} ; groupes : ${groups.join(" | ")}`);

  // 20-3 Courbe : période, réticule au survol.
  const chart = p.getByTestId("price-chart-bitcoin");
  await chart.getByRole("button", { name: "1W", exact: true }).click();
  await chart.getByText(/· 1W/).waitFor({ timeout: 30000 });
  const box = (await chart.locator("svg").boundingBox())!;
  await p.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 6 });
  const tip = (await chart.locator(".pc-tip-price").textContent({ timeout: 5000 })) ?? "";
  const n = await chart.locator("svg path").count();
  await p.screenshot({ path: `${SHOTS}/etape-20-1-bitcoin.png`, fullPage: true });
  report("20-3", "Courbe Bitcoin : période 1W chargée, réticule au survol avec prix et date", /CHF \d/.test(tip) && n >= 2, `info-bulle : ${tip}`);

  // 20-4 Pastilles de la table : Send BTC ouvre l'envoi Bitcoin ; Receive USDC passe sur Ethereum et ouvre la réception.
  await p.getByRole("button", { name: "Send BTC" }).click();
  const sendBtc = await p.getByRole("heading", { name: "Send bitcoin" }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  await p.getByRole("button", { name: "Receive USDC" }).click();
  await p.getByRole("heading", { name: "Receive USDC" }).waitFor({ timeout: 10000 });
  await p.getByTestId("price-chart-usd-coin").locator("svg").waitFor({ timeout: 30000 });
  await p.screenshot({ path: `${SHOTS}/etape-20-2-usdc.png`, fullPage: true });
  report("20-4", "Pastilles des positions : « Send BTC » ouvre l'envoi Bitcoin ; « Receive USDC » affiche Ethereum et sa réception", sendBtc, `envoi Bitcoin ouvert : ${sendBtc}`);

  // 20-5 Total cohérent entre la page Crypto et le pied de page (BTC + USDC + compte en garde).
  const total = (await p.getByTestId("crypto-total").textContent()) ?? "";
  const footer = (await p.locator(".d-status").textContent()) ?? "";
  report("20-5", "Total crypto identique sur la page Crypto et dans le pied de page (BTC + USDC + compte en garde)", footer.includes(`Crypto ${total.trim()} CHF`), `page : ${total} ; pied : ${footer.replace(/\s+/g, " ").slice(0, 140)}`);

  // 20-6 Flux de prix coupé (simulé dans le navigateur) : cours simulé signalé, courbe remplacée par un message.
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx2.route("**/market/**", (r) => r.abort());
  const q = await ctx2.newPage();
  await login(q);
  await q.getByRole("button", { name: "Crypto", exact: true }).first().click();
  await q.getByTestId("price-chart-bitcoin").getByText(/Market data unavailable/).waitFor({ timeout: 30000 });
  const note = (await q.locator(".kpi-note").textContent()) ?? "";
  const head = (await q.getByTestId("btc-balance").locator("..").textContent()) ?? "";
  await q.screenshot({ path: `${SHOTS}/etape-20-3-sans-flux-de-prix.png`, fullPage: true });
  report("20-6", "Flux de prix indisponible : la page reste utilisable, cours simulé signalé, message à la place de la courbe", /Simulated/.test(note) && /simulated rate/.test(head), `${note} ; ${head.replace(/\s+/g, " ").slice(0, 120)}`);

  // Captures téléphone et accueil.
  const t = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await login(t);
  await t.getByRole("button", { name: "Crypto", exact: true }).first().click();
  await t.getByTestId("price-chart-bitcoin").locator("svg").waitFor({ timeout: 30000 }); await t.waitForTimeout(1500);
  await t.screenshot({ path: `${SHOTS}/etape-20-4-telephone.png`, fullPage: true });
  await p.getByRole("button", { name: "Home", exact: true }).click(); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${SHOTS}/etape-20-5-accueil.png`, fullPage: true });
} finally {
  await b.close();
}
report("20-x", "Aucune erreur dans les consoles (contexte normal)", errs.length === 0, `${errs.join(" | ") || "aucune"} ; réponses en erreur : ${[...new Set(failed)].join(", ") || "aucune"}`);
process.exit(summary() ? 0 : 1);
