// Étape 44 : la biométrie du Wallet du client (extension WebAuthn « prf ») dans un vrai navigateur.
// Chrome headless + authentificateur virtuel CDP (`hasPrf: true`) ; le code exécuté est celui de l'interface
// (client-wallet/src/ui/bio.ts, chargé par Vite). Wallet isolé :5196 ; regtest pour la signature.
// Prérequis : npm run regtest:up. Limite : authentificateur virtuel, pas Touch ID (vérification manuelle à part).
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { buildSpend, createWalletConfig, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { openBio } from "../../client-wallet/src/vault.ts";
import { makeReport, miner, rpc } from "./lib.ts";

const WALLET = "http://localhost:5196";
const DATA = `${process.cwd()}/.local/e2e-44-prf`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "client-wallet"], { env: { ...process.env, CLIENT_WALLET_PORT: "5196", CLIENT_WALLET_DATA: DATA }, stdio: "ignore", detached: true });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${WALLET}/api/wallets`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const options = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true };
  const { authenticatorId } = (await cdp.send("WebAuthn.addVirtualAuthenticator", { options } as any)) as { authenticatorId: string };
  await page.goto(WALLET);
  await page.waitForLoadState("networkidle");

  // Le code de l'interface : création de la passkey du wallet + lecture du secret PRF, puis création du wallet.
  const created = await page.evaluate(async () => {
    const bio = await import("/src/ui/bio.ts");
    const available = await bio.bioAvailable();
    const key = await bio.bioEnroll("étape 44");
    const again = await bio.bioSecret(key);
    const r = await fetch("/api/wallets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network: "regtest", label: "étape 44", bio: key }) });
    return { available, key, again, status: r.status, body: await r.json() };
  });
  report("44-1", "Navigateur : authentificateur de plateforme disponible, passkey du wallet créée avec l'extension PRF, secret de 32 octets rendu",
    created.available === true && /^[A-Za-z0-9_-]{43}$/.test(created.key.prf) && created.status === 200,
    `disponible=${created.available} ; secret ${created.key.prf.length} caractères base64url ; création du wallet : ${created.status} ${created.body.error ?? ""}`);
  report("44-2", "Le même authentificateur rend le même secret pour le même sel (déverrouillage possible plus tard)", created.again === created.key.prf, `identique : ${created.again === created.key.prf}`);

  const stored = JSON.parse(readFileSync(`${DATA}/wallets.json`, "utf8"))[0];
  report("44-3", "La graine stockée est déchiffrée par le secret rendu par le navigateur, et seulement par lui",
    openBio(stored.bio, created.key.prf) === created.body.mnemonic && !readFileSync(`${DATA}/wallets.json`, "utf8").includes(created.key.prf),
    `champs stockés : ${Object.keys(stored).join(", ")}`);

  // Vraie signature d'un PSBT regtest, avec le secret redemandé à l'authentificateur depuis l'interface.
  const sq = accountKey(masterFromMnemonic(newMnemonic(), "regtest")), t = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: created.body.wallet.accountKey, swissquote: sq, tiers: t });
  const m = await miner();
  await m.pay(outputAt(cfg, 0, 0).getAddress(), 0.05);
  await m.mine(1);
  const { psbt } = await buildSpend({ cfg, backend: rpc, utxos: await scan(cfg, rpc), path: "client", feeRate: 2, to: m.addr, amount: 1_000_000n });
  const sign = (k: unknown) => page.evaluate(async ({ k, psbt }) => {
    const bio = await import("/src/ui/bio.ts");
    // Sans authentificateur, le navigateur attendrait jusqu'au délai de la demande : on arrête au bout de 8 s.
    const prf = await Promise.race([bio.bioSecret(k as any), new Promise<never>((_, no) => setTimeout(() => no(new Error("no biometric secret within 8 s")), 8000))]);
    const r = await fetch("/api/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ psbt, network: "regtest", prf }) });
    return { status: r.status, body: await r.json() };
  }, { k, psbt });
  const ok = await sign({ credentialId: created.key.credentialId, prfSalt: created.key.prfSalt });
  report("44-4", "Signature d'un PSBT regtest après la biométrie (secret redemandé à l'authentificateur)", ok.status === 200 && ok.body.added === 1, `${ok.status} ajoutées=${ok.body.added} ${ok.body.error ?? ""}`);

  // Autre sel : l'authentificateur rend un autre secret, qui ne déchiffre pas la graine.
  const other = await sign({ credentialId: created.key.credentialId, prfSalt: "A".repeat(43) });
  // Passkey supprimée (appareil perdu) : plus aucun secret.
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  const gone = await sign({ credentialId: created.key.credentialId, prfSalt: created.key.prfSalt }).catch((e: Error) => ({ status: 0, body: { error: (e.message.match(/Error: (.*)/)?.[1] ?? e.message).split("\n")[0] } }));
  report("44-5", "Autre sel : signature refusée ; authentificateur retiré : plus de secret, donc plus de signature",
    other.status === 403 && gone.status !== 200, `autre sel : ${other.status} ${other.body.error} ; sans authentificateur : ${gone.status} ${gone.body.error}`);
} finally {
  await browser.close();
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
