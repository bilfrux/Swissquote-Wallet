// Recovery RÉELLE sur signet : Swissquote (bank-mock en cours d'exécution, port 4000, sa propre clé) + tiers,
// sur le coin du compte de l'étape 1, vers un nouveau compte du client.
//   npm run validate:3:signet -- prepare     enregistre les comptes, re-KYC, signatures, tentative de diffusion
//   npm run validate:3:signet -- broadcast   nouvelle tentative de diffusion du PSBT préparé
// Graines de TEST : .local/signet/ et bank-mock/data/ (ignorés par git).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { EsploraBackend, buildSpend, combinePsbts, createWalletConfig, finalizePsbt, outputAt, scan, simulate } from "@sq/bitcoin";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";

const BANK = process.env.VITE_BANK_MOCK_URL ?? "http://localhost:4000";
const EXPLORER = process.env.VITE_EXPLORER_URL ?? "https://blockstream.info/signet";
const chain = new EsploraBackend(process.env.VITE_ESPLORA_URL ?? "https://blockstream.info/signet/api");
const D = 6;
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
async function api(path: string, body?: unknown) {
  const r = await fetch(BANK + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j: any = await r.json();
  if (!r.ok) throw new Error(`${path} : ${j.error}`);
  return j;
}

const sqKey = (await api("/guardian/key?network=signet")).accountKey as string;
const sqFile = read("bank-mock/data/swissquote-seed.json").accountKey;
if (sqFile && sqFile !== sqKey) throw new Error("la clé Swissquote de bank-mock ne correspond pas à celle du compte de l'étape 1");
if (!existsSync(".local/signet/client-new.json")) throw new Error("créer d'abord la nouvelle clé : npm run keygen -- --network signet --out .local/signet/client-new.json");
const tiers = read(".local/signet/tiers.json");
const mk = (client: string) => createWalletConfig({ network: "signet", delay: D, client, swissquote: sqKey, tiers: tiers.accountKey });
const A = await mk(read(".local/signet/client.json").accountKey); // compte dont la clé est « perdue »
const B = await mk(read(".local/signet/client-new.json").accountKey); // nouveau compte
const FILE = ".local/signet/recovery.psbt";

async function tryBroadcast(psbt: string) {
  const sum = simulate(A, psbt);
  const coins = await scan(A, chain);
  console.log(`coins de l'ancien compte : ${coins.map((u) => `${u.value} sats, ${u.confirmations} conf (recovery dans ${u.recoveryOpensIn} blocs)`).join(" ; ") || "aucun"}`);
  console.log(`PSBT : chemin=${sum.path}, signatures=${sum.inputs.map((i) => i.signatures).join(",")}, sortie=${sum.outputs.map((o) => `${o.value} -> ${o.address}`).join(", ")}, frais=${sum.fee}`);
  const { hex } = finalizePsbt(A, psbt);
  try {
    const txid = await chain.broadcast(hex);
    console.log(`DIFFUSÉE : ${txid}\n${EXPLORER}/tx/${txid}`);
  } catch (e: any) {
    console.log(`REFUSÉE par le réseau signet : ${e.message}`);
  }
}

const cmd = process.argv[2] ?? "prepare";
if (cmd === "prepare") {
  for (const cfg of [A, B]) console.log("enregistrement :", JSON.stringify(await api("/accounts/register", { customerId: "CH-0001", network: "signet", delay: D, client: cfg.client.raw, tiers: cfg.tiers.raw })));
  const { token } = await api("/identity/verify", { customerId: "CH-0001", lastName: "Muster", birthDate: "1990-01-01", otp: "123456" });
  const utxos = await scan(A, chain);
  if (!utxos.length) throw new Error("aucun coin sur l'ancien compte");
  const { psbt } = await buildSpend({ cfg: A, backend: chain, utxos, path: "recovery", feeRate: 1, to: outputAt(B, 0, 0).getAddress() });
  const sq = await api("/guardian/sign", { token, network: "signet", psbt });
  console.log(`Swissquote (bank-mock) : ${sq.added} signature ; revue ${JSON.stringify({ source: sq.review.source, destination: sq.review.destination })}`);
  const t = signPsbtWithMnemonic(psbt, tiers.mnemonic, "signet");
  console.log(`tiers : ${t.added} signature`);
  const combined = combinePsbts([sq.psbt, t.psbt]);
  writeFileSync(FILE, combined);
  await tryBroadcast(combined);
} else if (cmd === "broadcast") {
  await tryBroadcast(readFileSync(FILE, "utf8").trim());
}
