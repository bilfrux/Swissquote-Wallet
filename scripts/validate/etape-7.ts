// Étape 7 : preuve de propriété (défi bank-mock -> signature du Wallet du client -> vérification bank-mock)
// et client de démo vierge CH-0003. Pile isolée : bank-mock :4120, Wallet du client :5195 (stockages neufs).
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { Signer } from "bip322-js";
import { btc } from "@bitcoinerlab/descriptors-scure";
import { btcNetwork, clientKeyAddress, createWalletConfig, outputAt } from "@sq/bitcoin";
import { masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { open } from "../../client-wallet/src/vault.ts";
import { makeReport } from "./lib.ts";

const PIN = "482916";

const BANK = "http://localhost:4120", WALLET = "http://localhost:5195";
const DATA = `${process.cwd()}/.local/e2e-7`;
rmSync(DATA, { recursive: true, force: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>) => procs.push(spawn(cmd[0], cmd.slice(1), { env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4120", BANK_MOCK_DATA: `${DATA}/bank` });
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5195", CLIENT_WALLET_DATA: `${DATA}/wallet` });
for (const u of [`${BANK}/health`, `${WALLET}/api/wallets`]) for (let i = 0; i < 100; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });

const { report, summary } = makeReport();
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });
const bank = async (path: string, token?: string, body?: unknown) =>
  json(await fetch(BANK + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }));
// Appel local (outil, sans en-tête Origin) : équivalent de ce que fait l'interface du wallet après confirmation.
const wallet = async (path: string, body: unknown) => json(await fetch(WALLET + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

try {
  // CH-0003 : connexion, aucun compte Bitcoin au départ
  const login = await bank("/auth/login", undefined, { customerId: "CH-0003", password: "demo0003" });
  const token = login.body.token;
  const before = await bank("/wallet/accounts?network=regtest", token);
  const me = await bank("/me", token);
  report("7-1", "Client de démo vierge CH-0003 : connexion, comptes CHF, aucun compte Bitcoin", login.status === 200 && before.body.accounts.length === 0 && me.body.accounts.length === 2,
    `${me.body.firstName} ${me.body.lastName} ; comptes CHF : ${me.body.accounts.length} ; comptes Bitcoin : ${before.body.accounts.length}`);

  // Création du wallet (Wallet du client) et du compte
  const created = await wallet("/api/wallets", { network: "regtest", pin: PIN });
  const tiers = masterFromMnemonic(newMnemonic(), "regtest");
  const { accountKey } = await import("@sq/bitcoin/keys");
  const sq = (await bank("/guardian/key?network=regtest")).body.accountKey;
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: created.body.wallet.accountKey, swissquote: sq, tiers: accountKey(tiers) });
  const reg = await bank("/accounts/register", token, { network: "regtest", delay: 6, client: cfg.client.raw, tiers: cfg.tiers.raw, tiersName: "Marie Dupont" });

  // Preuve valide
  const ch = await bank("/ownership/challenge", token, { network: "regtest", client: cfg.client.raw, change: 0, index: 3 });
  const sig = await wallet("/api/prove", { accountKey: cfg.client.raw, change: 0, index: 3, message: ch.body.message, network: "regtest", pin: PIN });
  const ok = await bank("/ownership/verify", token, { challengeId: ch.body.challengeId, signature: sig.body.signature });
  report("7-2", "Preuve valide : défi Swissquote pour l'adresse n°3, signé par le Wallet du client, vérifié par Swissquote (mode strict)",
    reg.status === 200 && ch.body.address === outputAt(cfg, 0, 3).getAddress() && sig.body.keyAddress === clientKeyAddress(cfg, 0, 3) && ok.body.verified === true,
    `adresse du compte ${ch.body.address} ; clé signée ${sig.body.keyAddress} ; ${ok.body.proves}`);

  // Rejeu du même défi
  const replay = await bank("/ownership/verify", token, { challengeId: ch.body.challengeId, signature: sig.body.signature });
  report("7-3", "Rejeu d'un défi déjà utilisé : refusé", replay.status === 409, `${replay.status} ${replay.body.error}`);

  // Message altéré : le wallet signe un autre texte que le défi
  const ch2 = await bank("/ownership/challenge", token, { network: "regtest", client: cfg.client.raw, change: 0, index: 0 });
  const forged = await wallet("/api/prove", { accountKey: cfg.client.raw, change: 0, index: 0, message: ch2.body.message.replace("Challenge", "Challenge2"), network: "regtest", pin: PIN });
  const v2 = await bank("/ownership/verify", token, { challengeId: ch2.body.challengeId, signature: forged.body.signature });
  report("7-4", "Signature d'un message différent du défi : refusée", v2.body.verified === false, v2.body.proves);

  // Mauvaise clé : un autre wallet signe le bon défi (sa propre clé, même index)
  const other = await wallet("/api/wallets", { network: "regtest", pin: PIN });
  const ch3 = await bank("/ownership/challenge", token, { network: "regtest", client: cfg.client.raw, change: 0, index: 0 });
  const wrongKey = await wallet("/api/prove", { accountKey: other.body.wallet.accountKey, change: 0, index: 0, message: ch3.body.message, network: "regtest", pin: PIN });
  const v3 = await bank("/ownership/verify", token, { challengeId: ch3.body.challengeId, signature: wrongKey.body.signature });
  report("7-5", "Signature du bon défi par une autre clé que celle du client : refusée", v3.body.verified === false, `clé signée ${wrongKey.body.keyAddress} ≠ clé attendue ${clientKeyAddress(cfg, 0, 0)}`);

  // Format BIP-137 (« message signé » ancien) avec la BONNE clé du client : refusé en vérification stricte.
  // (La graine est lue dans le stockage du wallet de test pour fabriquer cette signature au mauvais format.)
  const ch4 = await bank("/ownership/challenge", token, { network: "regtest", client: cfg.client.raw, change: 0, index: 1 });
  const seed = (JSON.parse(readFileSync(`${DATA}/wallet/wallets.json`, "utf8")) as any[]).find((w) => w.accountKey === cfg.client.raw);
  const seedPhrase = open(seed.sealed, PIN);
  const k = masterFromMnemonic(seedPhrase, "regtest").derive("m/48'/1'/0'/2'/0/1");
  const wif = btc.WIF(btcNetwork("regtest")).encode(k.privateKey!);
  const legacy = Signer.sign(wif, btc.p2pkh(k.publicKey!, btcNetwork("regtest")).address!, ch4.body.message); // BIP-137, bonne clé
  const v4 = await bank("/ownership/verify", token, { challengeId: ch4.body.challengeId, signature: legacy });
  report("7-6", "Bonne clé mais format BIP-137 (ancien) : refusé, seule une signature BIP-322 pour l'adresse de la clé est acceptée", v4.body.verified === false, v4.body.proves);

  // Compte d'un autre client
  const login2 = await bank("/auth/login", undefined, { customerId: "CH-0002", password: "demo5678" });
  const foreign = await bank("/ownership/challenge", login2.body.token, { network: "regtest", client: cfg.client.raw, change: 0, index: 0 });
  report("7-7", "Défi demandé par un autre client pour ce compte : refusé", foreign.status === 403, `${foreign.status} ${foreign.body.error}`);

  // Le wallet refuse un compte qui n'est pas le sien
  const notMine = await wallet("/api/prove", { accountKey: cfg.tiers.raw, change: 0, index: 0, message: "x", network: "regtest", pin: PIN });
  report("7-8", "Le Wallet du client refuse de prouver pour un compte qui n'est pas sur l'appareil", notMine.status === 404, `${notMine.status} ${notMine.body.error}`);
} finally {
  stopAll();
}
process.exit(summary() ? 0 : 1);
