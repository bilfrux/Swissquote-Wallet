// Étape 43 : changement du contact de confiance (Bitcoin). Contact = partie du script : changer de contact, c'est déplacer les
// coins vers une nouvelle règle (même clé client, même clé Swissquote, nouveau contact), puis mettre à jour le registre
// Swissquote et la politique du Client Wallet.
// Pile isolée : bank-mock :4410 (verrou désactivé) et :4411 (verrou actif, pour le refus), Client Wallet :5200, appli :4412.
// Prérequis : npm run regtest:up
// Limite : la biométrie est simulée par un secret PRF aléatoire (comme aux étapes 37 et 41) ; l'interface est vérifiée
// jusqu'à l'écran de confirmation du Client Wallet, sans valider Touch ID.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { BitcoindBackend, buildSpend, createWalletConfig, finalizePsbt, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport, miner, rpc } from "./lib.ts";

const BANK = "http://localhost:4410", BANK_LOCKED = "http://localhost:4411", WALLET = "http://localhost:5200", APP = "http://localhost:4412";
const DATA = `${process.cwd()}/.local/e2e-43`;
const SHOTS = "docs/validation/captures";
rmSync(DATA, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
const bankEnv = { BANK_MOCK_ORIGINS: APP, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" };
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { ...bankEnv, BANK_MOCK_PORT: "4410", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_CRYPTO_LOCK: "off" });
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { ...bankEnv, BANK_MOCK_PORT: "4411", BANK_MOCK_DATA: `${DATA}/bank-locked` });
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5200", CLIENT_WALLET_DATA: `${DATA}/wallet`, VITE_WALLET_ALLOWED_ORIGINS: APP });
start(["npx", "vite", "--port", "4412", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK, VITE_CLIENT_WALLET_URL: WALLET }, "client");
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
for (const u of [`${BANK}/health`, `${BANK_LOCKED}/health`, `${WALLET}/api/wallets`, APP]) for (let i = 0; i < 150; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const req = async (base: string, method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const wallet = (path: string, body: unknown) => req(WALLET, "POST", path, body);
const login = async (base: string, id = "CH-0003", pw = "demo0003") => (await req(base, "POST", "/auth/login", { customerId: id, password: pw })).body.token as string;
const b64u = (n: number) => randomBytes(n).toString("base64url");
const key = () => accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
const { report, summary } = makeReport();
// bitcoind recharge un portefeuille « sq-watch-* » par compte observé (BitcoindBackend.history) et les garde chargés : après des
// dizaines de comptes de test, chaque bloc devient très lent à miner. On les décharge (les fichiers restent sur disque).
const unloadWatchWallets = async () => { for (const n of (await rpc.call("listwallets")) as string[]) if (n.startsWith("sq-watch-")) await rpc.call("unloadwallet", [n]).catch(() => undefined); };
await unloadWatchWallets();
const { addr: minerAddr, mine, pay } = await miner();
const node = new BitcoindBackend(process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });

// Wallet du client (secret PRF simulé), politique P1 avec le contact 1, compte enregistré chez Swissquote, coins financés.
async function setup(label: string, funds: number[]) {
  const bio = { credentialId: b64u(32), prfSalt: b64u(32), prf: b64u(32) };
  const w = (await wallet("/api/wallets", { network: "regtest", label, bio })).body.wallet;
  const sq = (await req(BANK, "GET", "/guardian/key?network=regtest")).body.accountKey as string;
  const t1 = key(), t2 = key();
  const p1 = { network: "regtest", delay: 6, swissquote: sq, tiers: t1, tiersName: "Marie Dupont" };
  await wallet(`/api/wallets/${w.id}/policy`, { policy: p1, prf: bio.prf });
  const reg = await req(BANK, "POST", "/accounts/register", { customerId: "CH-0003", network: "regtest", delay: 6, client: w.accountKey, tiers: t1, tiersName: "Marie Dupont" });
  const cfgOld = await createWalletConfig({ network: "regtest", delay: 6, client: w.accountKey, swissquote: sq, tiers: t1 });
  for (const [i, v] of funds.entries()) await pay(outputAt(cfgOld, 0, i).getAddress(), v);
  if (funds.length) await mine(1);
  return { w, bio, sq, t1, t2, p1, accountId: reg.body.accountId as number, cfgOld };
}

try {
  // ---- Partie A : toute la chaîne, sans navigateur ----
  const A = await setup("Contact change", [0.3, 0.1]);
  const p2 = { ...A.p1, tiers: A.t2, tiersName: "Bob" };
  const cfgNew = await createWalletConfig({ network: "regtest", delay: 6, client: A.w.accountKey, swissquote: A.sq, tiers: A.t2 });
  const dest = outputAt(cfgNew, 0, 0).getAddress();
  const utxos = await scan(A.cfgOld, node);
  const sweep = await buildSpend({ cfg: A.cfgOld, backend: node, utxos, path: "client", feeRate: 2, to: dest });

  // 43-1 Le Client Wallet décrit le déplacement comme un changement de contact, pas comme un paiement à un tiers.
  const plain = (await wallet("/api/describe", { psbt: sweep.psbt, network: "regtest" })).body;
  const withNext = (await wallet("/api/describe", { psbt: sweep.psbt, network: "regtest", nextPolicy: p2 })).body;
  const otherSq = await wallet("/api/describe", { psbt: sweep.psbt, network: "regtest", nextPolicy: { ...p2, swissquote: key() } });
  const otherDelay = await wallet("/api/describe", { psbt: sweep.psbt, network: "regtest", nextPolicy: { ...p2, delay: 1 } });
  report("43-1", "Client Wallet : sans la nouvelle politique, le transfert est un paiement externe de montant élevé ; avec elle, c'est « new account (new trusted contact) », pas de montant élevé, contact affiché ; Swissquote ou délai modifiés : refusé",
    plain.high === true && plain.outputs[0].mine === null && withNext.outputs[0].mine === "new account (new trusted contact)" && withNext.high === false && withNext.contactChange?.to === "Bob" && withNext.contactChange?.from === "Marie Dupont" && otherSq.status === 400 && otherDelay.status === 400,
    `sans : mine=${plain.outputs[0].mine} high=${plain.high} ; avec : mine=${withNext.outputs[0].mine} high=${withNext.high} contact ${withNext.contactChange?.from}→${withNext.contactChange?.to} ; autre clé Swissquote ${otherSq.status} ; autre délai ${otherDelay.status}`);

  // 43-2 Swissquote : avant la mise à jour, une recovery de la NOUVELLE règle est refusée (coins d'aucun compte enregistré).
  const sign1 = await wallet("/api/sign", { psbt: sweep.psbt, network: "regtest", nextPolicy: p2, prf: A.bio.prf });
  const { hex } = finalizePsbt(A.cfgOld, sign1.body.psbt);
  const txid = await node.broadcast(hex);
  await mine(1);
  const oldCoins = await scan(A.cfgOld, node), newCoins = await scan(cfgNew, node);
  report("43-2", "Signature (secret biométrique) et diffusion : les coins quittent l'ancienne règle et arrivent sous la nouvelle (≈ 0,4 BTC en 1 coin)",
    sign1.status === 200 && oldCoins.length === 0 && newCoins.length === 1 && newCoins[0].value > 39_900_000n, `signature ${sign1.status} ; txid ${txid.slice(0, 16)}… ; ancienne règle : ${oldCoins.length} coin ; nouvelle règle : ${newCoins.length} coin de ${newCoins[0]?.value} sats`);

  // Recovery PSBT de la nouvelle règle vers un autre compte enregistré du même client (revue de Swissquote).
  const other = await createWalletConfig({ network: "regtest", delay: 6, client: key(), swissquote: A.sq, tiers: A.t1 });
  await req(BANK, "POST", "/accounts/register", { customerId: "CH-0003", network: "regtest", delay: 6, client: other.client.raw, tiers: A.t1, tiersName: "Marie Dupont" });
  const recovery = await buildSpend({ cfg: cfgNew, backend: node, utxos: newCoins, path: "recovery", feeRate: 2, to: outputAt(other, 0, 0).getAddress() });
  const kyc = (await req(BANK, "POST", "/identity/verify", { customerId: "CH-0003", lastName: "Martin", birthDate: "1992-03-21", otp: "246810" })).body.token;
  const before = await req(BANK, "POST", "/guardian/sign", { token: kyc, network: "regtest", psbt: recovery.psbt });

  // 43-3 Mise à jour du registre Swissquote : verrou biométrique, refus propres, puis succès.
  const tok = await login(BANK);
  const tokLocked = await login(BANK_LOCKED);
  const locked = await req(BANK_LOCKED, "POST", "/accounts/tiers", { network: "regtest", client: A.w.accountKey, tiers: A.t2, tiersName: "Bob" }, tokLocked);
  const same = await req(BANK, "POST", "/accounts/tiers", { network: "regtest", client: A.w.accountKey, tiers: A.t1, tiersName: "Marie Dupont" }, tok);
  const self = await req(BANK, "POST", "/accounts/tiers", { network: "regtest", client: A.w.accountKey, tiers: A.w.accountKey, tiersName: "Moi" }, tok);
  const garbage = await req(BANK, "POST", "/accounts/tiers", { network: "regtest", client: A.w.accountKey, tiers: "n-importe-quoi", tiersName: "X" }, tok);
  const noName = await req(BANK, "POST", "/accounts/tiers", { network: "regtest", client: A.w.accountKey, tiers: A.t2, tiersName: "  " }, tok);
  const otherClient = await req(BANK, "POST", "/accounts/tiers", { network: "regtest", client: A.w.accountKey, tiers: A.t2, tiersName: "Bob" }, await login(BANK, "CH-0001", "demo1234"));
  const ok = await req(BANK, "POST", "/accounts/tiers", { network: "regtest", client: A.w.accountKey, tiers: A.t2, tiersName: "Bob" }, tok);
  report("43-3", "Registre Swissquote : refus verrou (403), même contact (409), contact = soi (400), clé invalide (400), nom vide (400), compte d'un autre client (403) ; puis mise à jour réussie (contact Bob)",
    locked.status === 403 && same.status === 409 && self.status === 400 && garbage.status === 400 && noName.status === 400 && otherClient.status === 403 && ok.status === 200 && ok.body.tiersName === "Bob" && ok.body.tiers === A.t2,
    `verrou ${locked.status} ; même ${same.status} ; soi ${self.status} ; invalide ${garbage.status} ; nom ${noName.status} ; autre client ${otherClient.status} ; ok ${ok.status} (${ok.body.tiersName})`);

  // 43-4 La revue de Swissquote suit la nouvelle règle : refusée avant la mise à jour, signée après.
  const after = await req(BANK, "POST", "/guardian/sign", { token: kyc, network: "regtest", psbt: recovery.psbt });
  report("43-4", "Recovery de la nouvelle règle : refusée par Swissquote avant la mise à jour du registre, signée après",
    before.status === 403 && after.status === 200 && after.body.added > 0, `avant ${before.status} (${String(before.body.error).slice(0, 70)}…) ; après ${after.status}, signatures ajoutées : ${after.body.added}`);

  // 43-5 Politique du wallet mise à jour : le client dépense seul sous la nouvelle règle, le rendu est reconnu.
  const pol = await wallet(`/api/wallets/${A.w.id}/policy`, { policy: p2, prf: A.bio.prf });
  const spend = await buildSpend({ cfg: cfgNew, backend: node, utxos: newCoins, path: "client", feeRate: 2, to: minerAddr, amount: 5_000_000n, changeIndex: 0 });
  const d2 = (await wallet("/api/describe", { psbt: spend.psbt, network: "regtest" })).body;
  const sign2 = await wallet("/api/sign", { psbt: spend.psbt, network: "regtest", prf: A.bio.prf });
  const tx2 = sign2.status === 200 ? await node.broadcast(finalizePsbt(cfgNew, sign2.body.psbt).hex) : null;
  await mine(1);
  report("43-5", "Après la mise à jour de la politique : le client dépense seul sous la nouvelle règle (rendu reconnu, signature, diffusion)",
    pol.status === 200 && d2.path === "client" && d2.outputs.some((o: any) => o.mine === "change (this account)") && !!tx2, `politique ${pol.status} ; chemin ${d2.path} ; rendu reconnu : ${d2.outputs.some((o: any) => o.mine === "change (this account)")} ; txid ${tx2?.slice(0, 16)}…`);

  // ---- Partie B : interface Chrome jusqu'à l'écran de confirmation du Client Wallet ----
  const B = await setup("UI contact change", [0.01]);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const errors: string[] = [];
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(APP);
  await p.evaluate(([k, v]) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem(k as string, JSON.stringify(v)); },
    ["sq-wallet:btc:regtest:CH-0003", { id: B.accountId, client: B.w.accountKey, swissquote: B.sq, tiers: B.t1, tiersName: "Marie Dupont", delay: 6, walletId: B.w.id }] as const);
  await p.reload();
  await p.getByRole("button", { name: "Login", exact: true }).click();
  await p.getByLabel("Username").fill("CH-0003");
  await p.getByLabel("Password", { exact: true }).fill("demo0003");
  await p.getByRole("button", { name: "Log in", exact: true }).click();
  await p.getByRole("button", { name: "Log out" }).first().waitFor({ timeout: 20000 });
  await p.locator(".d-topnav").getByRole("button", { name: "Crypto", exact: true }).click();
  await p.getByTestId("wallet-page").waitFor({ timeout: 30000 });
  await p.locator("#crypto-top button", { hasText: /^Security$/ }).click();
  await p.getByRole("button", { name: "Change my trusted contact" }).click();
  await p.getByLabel("New contact's name").fill("Bob");
  await p.getByLabel("New contact's public key").fill(B.t2);
  await p.getByRole("button", { name: "Prepare the change" }).click();
  await p.getByText("your new account (new trusted contact)").waitFor({ timeout: 30000 });
  // Capture de la fenêtre seulement : une capture pleine page redimensionne brièvement la fenêtre sous 820 px ; l'interface
  // bascule alors en mise en page téléphone, ce qui remonte le formulaire et efface sa saisie (observé, étape 47).
  await p.getByTestId("contact-change-form").scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${SHOTS}/etape-43-1-site-preparation.png` });
  const [popup] = await Promise.all([ctx.waitForEvent("page"), p.getByRole("button", { name: "Sign with my Client Wallet" }).click()]);
  await popup.getByTestId("contact-change").waitFor({ timeout: 30000 });
  const text = (await popup.locator("main").textContent()) ?? "";
  await popup.screenshot({ path: `${SHOTS}/etape-43-2-wallet-confirmation.png`, fullPage: true });
  await popup.close();
  report("43-6", "Interface : onglet Sécurité → formulaire → préparation (coins déplacés vers « votre nouveau compte ») → Client Wallet affiche « Confirm the change of trusted contact » avec le nouveau contact et sa clé",
    text.includes("Confirm the change of trusted contact") && text.includes("Bob") && text.includes(B.t2) && text.includes("new account (new trusted contact)") && !text.includes("High-value") && errors.length === 0,
    `titre : ${text.includes("Confirm the change of trusted contact")} ; Bob : ${text.includes("Bob")} ; clé : ${text.includes(B.t2)} ; étiquette sortie : ${text.includes("new account (new trusted contact)")} ; erreurs JS : ${errors.length}`);
  await ctx.close();
} catch (e: any) {
  // Diagnostic : texte de chaque page ouverte au moment de l'échec.
  for (const c of browser.contexts()) for (const pg of c.pages()) console.log(`PAGE ${pg.url()} :`, ((await pg.locator("body").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 1200));
  report("43-x", "Exécution", false, `${e.stack ?? e.message}${e.cause ? ` (cause : ${e.cause.code ?? e.cause.message})` : ""}`);
} finally {
  await browser.close();
  stopAll();
  await unloadWatchWallets();
}
process.exit(summary() ? 0 : 1);
