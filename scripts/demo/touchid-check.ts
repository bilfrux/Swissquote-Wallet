// Vérification MANUELLE de la biométrie réelle (Touch ID) du Client Wallet : les tests automatiques utilisent un
// authentificateur virtuel de Chrome (étape 44) ; celle-ci utilise l'authentificateur de la machine.
// Lancer : npm run check:touchid   (prérequis : npm run regtest:up). Une fenêtre Chrome s'ouvre ; poser le doigt à chaque
// demande (trois fois : création de la passkey, lecture du secret, signature). Wallet isolé :5250, stockage neuf.
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { buildSpend, createWalletConfig, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { openBio } from "../../client-wallet/src/vault.ts";
import { miner, rpc } from "../validate/lib.ts";

const WALLET = "http://localhost:5250";
const DATA = `${process.cwd()}/.local/touchid-check`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "client-wallet"], { env: { ...process.env, CLIENT_WALLET_PORT: "5250", CLIENT_WALLET_DATA: DATA }, stdio: "ignore", detached: true });
for (let i = 0; i < 150; i++) { try { if ((await fetch(`${WALLET}/api/wallets`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const say = (ok: boolean, label: string, detail: string) => console.log(`[${ok ? "OK " : "KO "}] ${label}\n       ${detail}`);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: false });
let all = true;
try {
  const page = await browser.newPage();
  await page.goto(WALLET);
  await page.waitForLoadState("networkidle");
  console.log("Touch ID : posez le doigt quand Chrome le demande (création de la passkey du wallet, puis lecture du secret).");
  const created = await page.evaluate(async () => {
    try {
      const bio = await import("/src/ui/bio.ts");
      const available = await bio.bioAvailable();
      const key = await bio.bioEnroll("vérification Touch ID");
      const r = await fetch("/api/wallets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network: "regtest", label: "Touch ID", bio: key }) });
      return { ok: true, available, key, status: r.status, body: await r.json() };
    } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  if (!created.ok) throw new Error(`biométrie refusée ou indisponible : ${created.error}`);
  const stored = JSON.parse(readFileSync(`${DATA}/wallets.json`, "utf8"))[0];
  const ok1 = created.status === 200 && openBio(stored.bio, created.key.prf) === created.body.mnemonic;
  all &&= ok1;
  say(ok1, "Passkey du wallet créée avec Touch ID, secret PRF rendu, graine chiffrée et déchiffrable", `authentificateur de plateforme : ${created.available} ; création ${created.status}`);

  const sq = accountKey(masterFromMnemonic(newMnemonic(), "regtest")), t = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: created.body.wallet.accountKey, swissquote: sq, tiers: t });
  const m = await miner();
  await m.pay(outputAt(cfg, 0, 0).getAddress(), 0.01);
  await m.mine(1);
  const { psbt } = await buildSpend({ cfg, backend: rpc, utxos: await scan(cfg, rpc), path: "client", feeRate: 2, to: m.addr, amount: 100_000n });
  console.log("Touch ID : posez le doigt pour signer la transaction de test.");
  const signed = await page.evaluate(async ({ k, psbt }) => {
    try {
      const bio = await import("/src/ui/bio.ts");
      const prf = await bio.bioSecret(k);
      const r = await fetch("/api/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ psbt, network: "regtest", prf }) });
      return { status: r.status, body: await r.json() };
    } catch (e: any) { return { status: 0, body: { error: String(e?.message ?? e) } }; }
  }, { k: { credentialId: created.key.credentialId, prfSalt: created.key.prfSalt }, psbt });
  const ok2 = signed.status === 200 && signed.body.added === 1;
  all &&= ok2;
  say(ok2, "Signature d'un PSBT regtest après Touch ID (secret redemandé à l'authentificateur)", `${signed.status} ${signed.body.error ?? `signatures ajoutées : ${signed.body.added}`}`);
} catch (e: any) {
  all = false;
  say(false, "Vérification Touch ID", e.message);
} finally {
  await browser.close();
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
console.log(all ? "\nTouch ID : fonctionne avec le Client Wallet." : "\nTouch ID : ÉCHEC (voir ci-dessus).");
process.exit(all ? 0 : 1);
