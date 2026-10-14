// Étape 53 : la console du contact de confiance ne plante plus sur un texte collé qui commence par « { » sans être une
// demande valide. Console isolée :5216 (Vite). Pas besoin de regtest.
import { type ChildProcess, spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { makeReport } from "./lib.ts";

const CONSOLE = "http://localhost:5216";
const proc: ChildProcess = spawn("npx", ["vite", "--port", "5216", "--strictPort"], { cwd: "guardian-console", env: { ...process.env, VITE_BTC_NETWORK: "regtest" }, stdio: "ignore", detached: true });
for (let i = 0; i < 150; i++) { try { if ((await fetch(CONSOLE)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const p = await browser.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(CONSOLE);
  const box = p.getByPlaceholder(/PSBT received from the client/);
  const results: string[] = [];
  for (const text of ["{abc", '{"kind":"autre"}', "pas un psbt"]) {
    await box.fill(text);
    results.push(((await p.locator(".error").first().textContent({ timeout: 5000 }).catch(() => "")) ?? "").trim());
  }
  const alive = await p.getByRole("heading", { name: "Sign a recovery request" }).isVisible();
  report("53-1", "Console du contact : JSON invalide, demande inconnue et texte quelconque → message d'erreur, page toujours utilisable, aucune exception",
    alive && errors.length === 0 && /invalid JSON/.test(results[0]) && /unreadable Ethereum request/.test(results[1]) && /unreadable PSBT/.test(results[2]),
    `messages : ${results.map((r) => `« ${r.slice(0, 60)} »`).join(" ; ")} ; page utilisable : ${alive} ; exceptions : ${errors.join(" | ") || "aucune"}`);
} finally {
  await browser.close();
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
