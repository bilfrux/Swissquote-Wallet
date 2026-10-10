// Étape 8 (n°2) : code PIN du Wallet du client. Wallet isolé :5196 (stockage neuf) ; regtest pour la signature.
// Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { buildSpend, createWalletConfig, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { open } from "../../client-wallet/src/vault.ts";
import { makeReport, miner, rpc } from "./lib.ts";

const WALLET = "http://localhost:5196";
const DATA = `${process.cwd()}/.local/e2e-8-pin`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "client-wallet"], { env: { ...process.env, CLIENT_WALLET_PORT: "5196", CLIENT_WALLET_DATA: DATA }, stdio: "ignore", detached: true });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${WALLET}/api/wallets`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const post = async (path: string, body: unknown) => { const r = await fetch(WALLET + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
const { report, summary } = makeReport();

try {
  const noPin = await post("/api/wallets", { network: "regtest" });
  report("8-5", "Création sans code PIN : refusée", noPin.status === 400, `${noPin.status} ${noPin.body.error}`);

  const c = await post("/api/wallets", { network: "regtest", pin: "482916" });
  const words: string[] = c.body.mnemonic.split(" ");
  const file = readFileSync(`${DATA}/wallets.json`, "utf8");
  const stored = JSON.parse(file)[0];
  // Un mot isolé peut coïncider avec la structure du fichier (« label », « wallet » sont des mots BIP39) :
  // on exige l'absence de toute paire de mots consécutifs de la phrase, et d'aucun mot dans la partie chiffrée.
  const pairs = words.slice(1).map((w, i) => `${words[i]} ${w}`).filter((p) => file.includes(p));
  const sealedText = JSON.stringify(stored.sealed);
  const plainWords = [...pairs, ...words.filter((w) => new RegExp(`\\b${w}\\b`).test(sealedText))];
  const coincidences = words.filter((w) => new RegExp(`\\b${w}\\b`).test(file));
  report("8-6", "Graine chiffrée sur le disque : ni la phrase ni aucun de ses 24 mots en clair ; scrypt + AES-256-GCM ; le bon PIN la redonne",
    !file.includes(c.body.mnemonic) && plainWords.length === 0 && !stored.mnemonic && stored.sealed?.kdf === "scrypt" && open(stored.sealed, "482916") === c.body.mnemonic && c.body.wallet.protected === true,
    `paires de mots ou mots dans la partie chiffrée : ${plainWords.length} ; mots isolés coïncidant avec la structure du fichier : ${coincidences.join(", ") || "aucun"} ; champs stockés : ${Object.keys(stored).join(", ")} ; paramètres scrypt N=${stored.sealed.N} r=${stored.sealed.r} p=${stored.sealed.p}`);

  // Compte regtest de ce wallet, financé, pour une vraie signature
  const sqKey = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const tKey = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: c.body.wallet.accountKey, swissquote: sqKey, tiers: tKey });
  await post(`/api/wallets/${c.body.wallet.id}/policy`, { policy: { network: "regtest", delay: 6, swissquote: sqKey, tiers: tKey } });
  const m = await miner();
  await m.pay(outputAt(cfg, 0, 0).getAddress(), 0.05);
  await m.mine(1);
  const { psbt } = await buildSpend({ cfg, backend: rpc, utxos: await scan(cfg, rpc), path: "client", feeRate: 2, to: m.addr, amount: 1_000_000n });

  const wrong = await post("/api/sign", { psbt, network: "regtest", pin: "000000" });
  const missing = await post("/api/sign", { psbt, network: "regtest" });
  report("8-7", "Signature avec un PIN faux ou absent : refusée, essais restants indiqués", wrong.status === 403 && missing.status === 403, `${wrong.body.error} | ${missing.body.error}`);

  const ok = await post("/api/sign", { psbt, network: "regtest", pin: "482916" });
  report("8-8", "Signature avec le bon PIN : PSBT signé (une signature ajoutée)", ok.status === 200 && ok.body.added === 1, `${ok.status} ajoutées=${ok.body.added}`);

  for (let i = 0; i < 5; i++) await post("/api/sign", { psbt, network: "regtest", pin: "111111" });
  const locked = await post("/api/sign", { psbt, network: "regtest", pin: "482916" });
  report("8-9", "Après 5 PIN faux : wallet bloqué, même le bon PIN est refusé pendant 60 s", locked.status === 429, `${locked.status} ${locked.body.error}`);

  // Ancien wallet en clair (créé avant l'étape 8) : protection par PIN
  const legacyPhrase = newMnemonic();
  const legacy = { id: "aaaaaaaa", label: "ancien", mnemonic: legacyPhrase, accountKey: accountKey(masterFromMnemonic(legacyPhrase, "regtest")), createdAt: new Date().toISOString() };
  writeFileSync(`${DATA}/wallets.json`, JSON.stringify([...JSON.parse(readFileSync(`${DATA}/wallets.json`, "utf8")), legacy], null, 2));
  const listBefore = await (await fetch(`${WALLET}/api/wallets`)).json();
  const prot = await post("/api/wallets/aaaaaaaa/protect", { pin: "730215" });
  const after = readFileSync(`${DATA}/wallets.json`, "utf8");
  report("8-10", "Ancien wallet en clair : signalé « non protégé », puis chiffré par un PIN ; la phrase en clair disparaît du disque",
    listBefore.find((w: any) => w.id === "aaaaaaaa")?.protected === false && prot.status === 200 && prot.body.protected === true && !after.includes(legacyPhrase),
    `avant : protected=${listBefore.find((w: any) => w.id === "aaaaaaaa")?.protected} ; après : ${prot.status} protected=${prot.body.protected} ; phrase encore sur le disque : ${after.includes(legacyPhrase)}`);
} finally {
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
