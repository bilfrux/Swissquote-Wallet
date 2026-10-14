// Étape 47 : la politique du compte n'est plus enregistrée en silence par le Client Wallet. Une appli compromise qui
// glisse sa propre clé de contact est visible (empreinte affichée, à comparer avec la console du contact) ; rien n'est
// enregistré sans la biométrie du client, vérifiée par le serveur du wallet.
// Pile isolée : Client Wallet :5211 ; « appli » de test :5212 (page minimale qui ouvre le wallet, origine autorisée).
// Chrome headless, authentificateur virtuel avec PRF (étape 44). Pas besoin de regtest.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport } from "./lib.ts";

const WALLET = "http://localhost:5211", APP = "http://localhost:5212";
const DATA = `${process.cwd()}/.local/e2e-47`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "client-wallet"], { env: { ...process.env, CLIENT_WALLET_PORT: "5211", CLIENT_WALLET_DATA: DATA, VITE_WALLET_ALLOWED_ORIGINS: APP }, stdio: "ignore", detached: true });
// Appli de test : ouvre le wallet, lui transmet des demandes, garde ses réponses.
const app = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><script>
  window.responses = [];
  window.openWallet = () => { window.win = window.open(${JSON.stringify(WALLET)}, "w", "popup"); };
  window.send = (r) => window.win.postMessage({ type: "wallet-request", network: "regtest", ...r }, ${JSON.stringify(WALLET)});
  addEventListener("message", (e) => { if (e.origin === ${JSON.stringify(WALLET)} && e.data.type === "wallet-response") window.responses.push(e.data); });
</script>`)).listen(5212, "localhost");
for (let i = 0; i < 150; i++) { try { if ((await fetch(`${WALLET}/api/wallets`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const key = () => accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
const fp = (k: string) => k.slice(1, 9);
const stored = () => JSON.parse(readFileSync(`${DATA}/wallets.json`, "utf8"))[0];

try {
  // --- Serveur du wallet : biométrie exigée pour enregistrer une politique ---
  const post = async (path: string, body: unknown) => { const r = await fetch(WALLET + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
  const bio = { credentialId: randomBytes(32).toString("base64url"), prfSalt: randomBytes(32).toString("base64url"), prf: randomBytes(32).toString("base64url") };
  const sw = (await post("/api/wallets", { network: "regtest", label: "serveur", bio })).body.wallet;
  const sq = key(), t1 = key();
  const p1 = { network: "regtest", delay: 6, swissquote: sq, tiers: t1, tiersName: "Marie Dupont" };
  const none = await post(`/api/wallets/${sw.id}/policy`, { policy: p1 });
  const wrong = await post(`/api/wallets/${sw.id}/policy`, { policy: p1, prf: randomBytes(32).toString("base64url") });
  const bad = await post(`/api/wallets/${sw.id}/policy`, { policy: { ...p1, tiers: "pas une clé" }, prf: bio.prf });
  const okSrv = await post(`/api/wallets/${sw.id}/policy`, { policy: p1, prf: bio.prf });
  report("47-1", "Serveur du wallet : politique refusée sans biométrie ou avec un mauvais secret (403), invalide refusée (400), acceptée avec la biométrie",
    none.status === 403 && wrong.status === 403 && bad.status === 400 && okSrv.status === 200 && stored().policy?.tiers === t1,
    `sans : ${none.status} ; mauvais secret : ${wrong.status} ; invalide : ${bad.status} ; biométrie : ${okSrv.status}`);
  rmSync(`${DATA}/wallets.json`);

  // --- Interface : wallet créé dans la fenêtre du wallet (passkey de cet authentificateur) ---
  const ctx = await browser.newContext();
  const opener = await ctx.newPage();
  await opener.goto(APP);
  const [win] = await Promise.all([ctx.waitForEvent("page"), opener.evaluate(() => (window as any).openWallet())]);
  await win.waitForLoadState("networkidle");
  const cdp = await ctx.newCDPSession(win);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } } as any);
  const created = await win.evaluate(async () => {
    const bio = await import("/src/ui/bio.ts");
    const k = await bio.bioEnroll("étape 47");
    const r = await fetch("/api/wallets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network: "regtest", label: "étape 47", bio: k }) });
    return (await r.json()).wallet;
  });
  const ask = async (id: string, policy: object) => {
    await opener.evaluate(([id, walletId, policy]) => (window as any).send({ id, action: "policy", payload: { walletId, policy } }), [id, created.id, policy] as const);
    await win.getByRole("button", { name: "Confirm and save" }).waitFor({ timeout: 15000 });
    return (await win.locator("section").first().textContent()) ?? "";
  };
  const answer = (w: Page, id: string) => w.waitForFunction((id) => (window as any).responses.find((r: any) => r.id === id), id, { timeout: 15000 }).then((h) => h.jsonValue() as Promise<any>);

  // Première politique : contact et empreintes affichés ; rien n'est enregistré avant la confirmation biométrique.
  const first = { network: "regtest", delay: 6, swissquote: sq, tiers: t1, tiersName: "Marie Dupont" };
  const screen1 = await ask("p1", first);
  const before = stored().policy;
  await win.getByRole("button", { name: "Confirm and save" }).click();
  const r1 = await answer(opener, "p1");
  report("47-2", "Première politique : écran de confirmation (contact, empreinte du contact et de Swissquote, délai) ; rien d'enregistré avant la biométrie, enregistrée après",
    screen1.includes("Confirm your account policy") && screen1.includes("Marie Dupont") && screen1.includes(fp(t1)) && screen1.includes(fp(sq)) && screen1.includes("6 blocks") && !before && r1.ok === true && stored().policy?.tiers === t1,
    `affiché : contact ${screen1.includes(fp(t1)) ? fp(t1) : "absent"}, Swissquote ${screen1.includes(fp(sq)) ? fp(sq) : "absent"} ; avant confirmation : ${JSON.stringify(before ?? null)} ; réponse ${JSON.stringify(r1.ok)}`);

  // Appli compromise : remplace la clé du contact par la sienne (même nom affiché). Le changement d'empreinte est visible ;
  // le client refuse ; la politique reste celle du vrai contact.
  const evil = key();
  await win.reload(); // la fenêtre revient à l'écran d'accueil du wallet (le reload garde l'authentificateur de l'onglet)
  await win.waitForLoadState("networkidle");
  const screen2 = await ask("p2", { ...first, tiers: evil });
  await win.getByRole("button", { name: "Refuse" }).click();
  const r2 = await answer(opener, "p2");
  report("47-3", "Clé de contact substituée par l'appli : changement signalé (ancienne → nouvelle empreinte), refus remonté à l'appli, politique inchangée",
    screen2.includes("Update your account policy") && screen2.includes(`(${fp(t1)}) → `) && screen2.includes(fp(evil)) && r2.ok === false && /refused/.test(r2.error) && stored().policy?.tiers === t1,
    `${screen2.match(/Trusted contact change:[^.]*\)/)?.[0] ?? "pas de changement signalé"} ; réponse ${JSON.stringify({ ok: r2.ok, error: r2.error })} ; contact enregistré : ${fp(stored().policy?.tiers ?? "")}`);

  // Clé Swissquote différente : alerte explicite.
  await win.reload();
  await win.waitForLoadState("networkidle");
  const screen3 = await ask("p3", { ...first, swissquote: key() });
  await win.getByRole("button", { name: "Refuse" }).click();
  await answer(opener, "p3");
  report("47-4", "Clé Swissquote différente de la politique actuelle : alerte affichée", screen3.includes("The Swissquote key is different"), screen3.includes("The Swissquote key is different") ? "alerte affichée" : "pas d'alerte");
} finally {
  await browser.close();
  app.close();
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
