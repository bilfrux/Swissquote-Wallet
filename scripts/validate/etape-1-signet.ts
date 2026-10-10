// Validation de l'étape 1 sur signet (vrai réseau) avec les graines de TEST de .local/ et bank-mock/data/ (ignorés par git).
//   npm run validate:1:signet -- address   adresse à financer
//   npm run validate:1:signet -- status    coins et confirmations
//   npm run validate:1:signet -- spend     vraie dépense du client : PSBT -> tools/client-signer -> finalisation -> diffusion
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { EsploraBackend, buildSpend, createWalletConfig, finalizePsbt, nextIndex, outputAt, scan, simulate } from "@sq/bitcoin";

const ESPLORA = process.env.VITE_ESPLORA_URL ?? "https://blockstream.info/signet/api";
const EXPLORER = process.env.VITE_EXPLORER_URL ?? "https://blockstream.info/signet";
const chain = new EsploraBackend(ESPLORA);
const key = (f: string) => JSON.parse(readFileSync(f, "utf8")).accountKey as string;
const cfg = await createWalletConfig({
  network: "signet",
  delay: 6,
  client: key(".local/signet/client.json"),
  swissquote: key("bank-mock/data/swissquote-seed.json"),
  tiers: key(".local/signet/tiers.json"),
});

const cmd = process.argv[2] ?? "address";
if (cmd === "address") {
  console.log(`clé client     ${cfg.client.raw}\nclé Swissquote ${cfg.swissquote.raw}\nclé tiers      ${cfg.tiers.raw}`);
  console.log(`adresse de réception (index 0) : ${outputAt(cfg, 0, 0).getAddress()}`);
} else if (cmd === "status") {
  console.log(`hauteur signet : ${await chain.tipHeight()}`);
  for (const u of await scan(cfg, chain))
    console.log(`${u.txid}:${u.vout} ${u.value} sats, ${u.confirmations} conf, recovery ouverte dans ${u.recoveryOpensIn} blocs (${u.change ? "change" : "réception"} ${u.index})`);
} else if (cmd === "spend") {
  const utxos = (await scan(cfg, chain)).filter((u) => u.confirmations > 0);
  if (!utxos.length) throw new Error("aucun coin confirmé : financer l'adresse et attendre une confirmation");
  const to = outputAt(cfg, 0, 1).getAddress(); // adresse 1 du compte : transfert réel, les fonds de test restent sur le compte
  // Le faucet n'envoie que de petits montants : tout le solde part vers l'adresse 1 du compte (1 sat/vB).
  const { psbt, summary } = await buildSpend({ cfg, backend: chain, utxos, path: "client", feeRate: 1, to });
  console.log(`PSBT préparé : chemin=${summary.path}, sorties=${summary.outputs.map((o) => `${o.value}->${o.address}`).join(", ")}, frais=${summary.fee}`);
  writeFileSync(".local/signet/unsigned.psbt", psbt);
  execFileSync("npm", ["run", "-s", "client-signer", "--", "--psbt", ".local/signet/unsigned.psbt", "--mnemonic-file", ".local/signet/client.json", "--network", "signet", "--yes", "--out", ".local/signet/signed.psbt"], { stdio: ["ignore", "inherit", "inherit"] });
  const signed = readFileSync(".local/signet/signed.psbt", "utf8").trim();
  console.log(`signatures après signataire externe : ${simulate(cfg, signed).inputs.map((i) => i.signatures).join(",")}`);
  const { hex } = finalizePsbt(cfg, signed);
  const txid = await chain.broadcast(hex);
  console.log(`diffusée : ${txid}\n${EXPLORER}/tx/${txid}`);
}
