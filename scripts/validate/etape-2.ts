// Validation de l'étape 2 (regtest) : bank-mock (guardian Swissquote, processus séparé) et signature du tiers.
// Lance son propre bank-mock (port 4100, stockage .local/bm-test), le tue en cours de route.
// Prérequis : npm run regtest:up
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { BitcoindBackend, addresses, buildSpend, combinePsbts, createWalletConfig, finalizePsbt, outputAt, pubkeyAt, scan, simulate } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { btc } from "@bitcoinerlab/descriptors-scure";
import { base64, hex } from "@scure/base";

const PORT = Number(process.env.VALIDATE_2_PORT ?? 4100);
// Un serveur déjà présent sur ce port répondrait à la place du bank-mock de test (observé : un autre bank-mock sur 4100).
if (await fetch(`http://localhost:${PORT}/health`).then(() => true, () => false)) { console.error(`port ${PORT} déjà occupé : relancer avec VALIDATE_2_PORT=<port libre>`); process.exit(2); }
const BANK = `http://localhost:${PORT}`;
const DATA = ".local/bm-test";
const rpc = new BitcoindBackend(process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443");
const DELAY = 6;
const results: [string, string, boolean][] = [];
const report = (id: string, label: string, ok: boolean, detail: string) => {
  results.push([id, label, ok]);
  console.log(`[${ok ? "OK " : "KO "}] ${id} ${label}\n       ${detail}`);
};
async function api(path: string, body?: unknown) {
  const r = await fetch(BANK + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  return { status: r.status, json: (await r.json()) as any };
}

// --- bank-mock dans son propre processus, stockage vierge ---
rmSync(DATA, { recursive: true, force: true });
mkdirSync(".local", { recursive: true });
let bank: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "bank-mock"], { env: { ...process.env, BANK_MOCK_CRYPTO_LOCK: "off", BANK_MOCK_PORT: String(PORT), BANK_MOCK_DATA: `${process.cwd()}/${DATA}` }, stdio: "ignore", detached: true });
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BANK}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

try {
  // 1. Clé Swissquote : générée au premier lancement, stockée seulement dans le dossier de bank-mock
  const sqKey = (await api("/guardian/key?network=regtest")).json.accountKey as string;
  const seedStat = statSync(`${DATA}/swissquote-seed.json`);
  report("1", "Clé Swissquote générée au premier lancement, dans le stockage de bank-mock (mode 600) ; seule la clé publique est exposée",
    /^\[[0-9a-f]{8}\/48'\/1'\/0'\/2'\]tpub/.test(sqKey) && (seedStat.mode & 0o777) === 0o600,
    `GET /guardian/key -> ${sqKey.slice(0, 40)}… ; ${DATA}/swissquote-seed.json mode=${(seedStat.mode & 0o777).toString(8)}`);

  // Client (ancienne et nouvelle clé) et tiers : graines de test hors appli
  const seeds = { oldClient: newMnemonic(), newClient: newMnemonic(), tiers: newMnemonic(), other: newMnemonic() };
  const key = (m: string) => accountKey(masterFromMnemonic(m, "regtest"));
  const cfgA = await createWalletConfig({ network: "regtest", delay: DELAY, client: key(seeds.oldClient), swissquote: sqKey, tiers: key(seeds.tiers) });
  const cfgB = await createWalletConfig({ network: "regtest", delay: DELAY, client: key(seeds.newClient), swissquote: sqKey, tiers: key(seeds.tiers) });
  const cfgOther = await createWalletConfig({ network: "regtest", delay: DELAY, client: key(seeds.other), swissquote: sqKey, tiers: key(seeds.tiers) });
  const regA = await api("/accounts/register", { customerId: "CH-0001", network: "regtest", delay: DELAY, client: cfgA.client.raw, tiers: cfgA.tiers.raw });
  const regB = await api("/accounts/register", { customerId: "CH-0001", network: "regtest", delay: DELAY, client: cfgB.client.raw, tiers: cfgB.tiers.raw });
  const regO = await api("/accounts/register", { customerId: "CH-0002", network: "regtest", delay: DELAY, client: cfgOther.client.raw, tiers: cfgOther.tiers.raw });
  const regX = await api("/accounts/register", { customerId: "CH-9999", network: "regtest", delay: DELAY, client: key(newMnemonic()), tiers: cfgA.tiers.raw });
  report("2", "Enregistrement des comptes : A (ancienne clé) et B (nouvelle clé) pour CH-0001, un compte pour CH-0002 ; client inconnu refusé",
    regA.status === 200 && regB.status === 200 && regO.status === 200 && regX.status === 403,
    `A=${JSON.stringify(regA.json)} B=${JSON.stringify(regB.json)} CH-0002=${JSON.stringify(regO.json)} inconnu=${regX.status} ${regX.json.error}`);

  // Financement du compte A
  const wallets: string[] = await rpc.call("listwallets");
  if (!wallets.includes("miner")) await rpc.call("loadwallet", ["miner"]).catch(() => rpc.call("createwallet", ["miner"]));
  const miner: string = await rpc.call("getnewaddress", [], "miner");
  const mine = (n: number) => rpc.call("generatetoaddress", [n, miner]);
  await rpc.call("sendtoaddress", [outputAt(cfgA, 0, 0).getAddress(), 0.25], "miner");
  await rpc.call("sendtoaddress", [outputAt(cfgOther, 0, 0).getAddress(), 0.1], "miner");
  await mine(1);
  const utxosA = await scan(cfgA, rpc);
  const recoveryPsbt = (await buildSpend({ cfg: cfgA, backend: rpc, utxos: utxosA, path: "recovery", feeRate: 2, to: outputAt(cfgB, 0, 0).getAddress() })).psbt;

  // 3. Identité non vérifiée : refus
  const noKyc = await api("/guardian/sign", { network: "regtest", psbt: recoveryPsbt });
  const badToken = await api("/guardian/sign", { network: "regtest", psbt: recoveryPsbt, token: "00".repeat(32) });
  const badKyc = await api("/identity/verify", { customerId: "CH-0001", lastName: "Muster", birthDate: "1990-01-01", otp: "000000" });
  report("3", "Identité non vérifiée : /guardian/sign refuse (sans jeton, jeton inventé) ; re-KYC avec un mauvais code refusé",
    noKyc.status === 403 && badToken.status === 403 && badKyc.status === 403,
    `sans jeton : ${noKyc.status} ${noKyc.json.error} ; jeton inventé : ${badToken.status} ; mauvais OTP : ${badKyc.status} ${badKyc.json.error}`);

  // 4. Re-KYC mocké correct -> signature d'une recovery A -> B
  const kyc = await api("/identity/verify", { customerId: "CH-0001", lastName: "Muster", birthDate: "1990-01-01", otp: "123456" });
  const token = kyc.json.token;
  const signedSq = await api("/guardian/sign", { network: "regtest", psbt: recoveryPsbt, token });
  const sqPub = hex.encode(pubkeyAt(cfgA.swissquote, "regtest", 0, 0));
  const sigKeys = signedSq.status === 200 ? (btc.Transaction.fromPSBT(base64.decode(signedSq.json.psbt)).getInput(0).partialSig ?? []).map(([k]: any) => hex.encode(k)) : [];
  report("4", "Après re-KYC mocké : Swissquote signe la recovery du compte A vers le compte B du même client, avec SA clé",
    kyc.status === 200 && signedSq.status === 200 && sigKeys.length === 1 && sigKeys[0] === sqPub,
    `KYC : ${kyc.status}, expire ${kyc.json.expiresAt} ; signature : ${signedSq.status} ${signedSq.json.error ?? `${signedSq.json.added} ajoutée, revue=${JSON.stringify({ source: signedSq.json.review?.source, destination: signedSq.json.review?.destination })}`} ; clé signataire = clé Swissquote : ${sigKeys[0] === sqPub}`);

  // 5. Refus : dépense courante (chemin client), destination hors compte du client, coins d'un autre client
  const clientPsbt = (await buildSpend({ cfg: cfgA, backend: rpc, utxos: utxosA, path: "client", feeRate: 2, to: outputAt(cfgB, 0, 0).getAddress() })).psbt;
  const toMiner = (await buildSpend({ cfg: cfgA, backend: rpc, utxos: utxosA, path: "recovery", feeRate: 2, to: miner })).psbt;
  const otherPsbt = (await buildSpend({ cfg: cfgOther, backend: rpc, utxos: await scan(cfgOther, rpc), path: "recovery", feeRate: 2, to: outputAt(cfgB, 0, 0).getAddress() })).psbt;
  const r1 = await api("/guardian/sign", { network: "regtest", psbt: clientPsbt, token });
  const r2 = await api("/guardian/sign", { network: "regtest", psbt: toMiner, token });
  const r3 = await api("/guardian/sign", { network: "regtest", psbt: otherPsbt, token });
  report("5", "Swissquote refuse : dépense courante du client, recovery vers une adresse étrangère, coins d'un autre client",
    r1.status === 403 && r2.status === 403 && r3.status === 403,
    `chemin client : ${r1.json.error} | vers le mineur : ${r2.json.error} | autre client : ${r3.json.error}`);

  // 6. Signature du tiers (même code que la console guardian), puis aperçu : la recovery n'est valide qu'après D
  const signedT = signPsbtWithMnemonic(recoveryPsbt, seeds.tiers, "regtest");
  const both = combinePsbts([signedSq.json.psbt, signedT.psbt]);
  const sigs = simulate(cfgA, both).inputs.map((i) => i.signatures);
  const { hex: rawTx } = finalizePsbt(cfgA, both);
  const early = await rpc.call("testmempoolaccept", [[rawTx]]);
  await mine(DELAY - 1);
  const late = await rpc.call("testmempoolaccept", [[rawTx]]);
  report("6", "Tiers signe (code de la console guardian) ; PSBT combiné finalisable ; refusé par le nœud avant D, accepté à D (aperçu étape 3)",
    signedT.added === 1 && sigs.every((n) => n === 2) && early[0]["reject-reason"] === "non-BIP68-final" && late[0].allowed === true,
    `signatures par entrée=${sigs.join(",")} ; à 1 conf : ${early[0]["reject-reason"]} ; à ${DELAY} conf : allowed=${late[0].allowed}`);

  // 7. bank-mock arrêté : le client dépense seul ; /guardian/sign injoignable
  process.kill(-bank.pid!, "SIGTERM");
  await new Promise((r) => setTimeout(r, 800));
  let unreachable = "";
  try { await fetch(`${BANK}/guardian/sign`, { method: "POST", body: "{}" }); unreachable = "joignable (!)"; } catch (e: any) { unreachable = `injoignable (${e.cause?.code ?? e.message})`; }
  writeFileSync(".local/bm-test/client.json", JSON.stringify({ mnemonic: seeds.oldClient }), { mode: 0o600 });
  const spend = (await buildSpend({ cfg: cfgA, backend: rpc, utxos: await scan(cfgA, rpc), path: "client", feeRate: 2, to: miner, amount: 1_000_000n })).psbt;
  writeFileSync(".local/bm-test/unsigned.psbt", spend);
  execFileSync("npm", ["run", "-s", "client-signer", "--", "--psbt", ".local/bm-test/unsigned.psbt", "--mnemonic-file", ".local/bm-test/client.json", "--network", "regtest", "--yes", "--out", ".local/bm-test/signed.psbt"], { stdio: "ignore" });
  const { hex: clientTx } = finalizePsbt(cfgA, readFileSync(".local/bm-test/signed.psbt", "utf8").trim());
  let txid = "";
  try { txid = await rpc.broadcast(clientTx); } catch (e: any) { txid = `refusée : ${e.message}`; }
  report("7", "bank-mock arrêté : /guardian/sign injoignable, mais le client dépense seul (signature externe, diffusion)",
    unreachable.startsWith("injoignable") && /^[0-9a-f]{64}$/.test(txid), `/guardian/sign : ${unreachable} ; dépense client : ${txid}`);
} finally {
  try { process.kill(-bank.pid!, "SIGTERM"); } catch {}
}

// 8. Aucune clé privée ni graine dans client/ (sources et bundle), ni la graine Swissquote
{
  execFileSync("npm", ["run", "-s", "build", "-w", "client"], { stdio: "ignore" });
  const sqWords = JSON.parse(readFileSync(`${DATA}/swissquote-seed.json`, "utf8")).mnemonic as string;
  const grep = (args: string[]) => { try { return execFileSync("grep", args, { encoding: "utf8" }).trim(); } catch { return ""; } };
  const xprv = grep(["-rlE", "[tx]prv[1-9A-HJ-NP-Za-km-z]{100,}", "client/src", "client/dist"]);
  const sqSeed = grep(["-rlF", sqWords, "client/src", "client/dist"]);
  const imports = grep(["-rlE", "@sq/bitcoin/(sign|keys)|mnemonicToSeed|swissquote-seed|bank-mock/data", "client/src"]);
  const wordlist = grep(["-rl", "\"abandon\",\"ability\"", "client/dist"]);
  report("8", "Aucune clé privée, graine ou import de signature dans client/src et client/dist ; graine Swissquote absente",
    !xprv && !sqSeed && !imports && !wordlist,
    `grep -rlE '[tx]prv…' -> ${xprv || "rien"} ; grep -rlF <graine Swissquote> -> ${sqSeed || "rien"} ; imports sign/keys -> ${imports || "rien"} ; liste BIP39 -> ${wordlist || "rien"}`);
}

console.log("\nRÉSUMÉ");
for (const [id, label, ok] of results) console.log(`${id.padEnd(3)} ${(ok ? "fonctionne" : "ne fonctionne pas").padEnd(18)} ${label}`);
process.exit(results.some(([, , ok]) => !ok) ? 1 : 0);
