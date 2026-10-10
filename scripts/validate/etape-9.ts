// Étape 9 : historique des transactions et estimation des frais.
// regtest : scénario complet (réceptions, envoi, rafraîchissement, recovery) ; signet : historique réel et frais réels.
// Prérequis : npm run regtest:up ; pour la partie signet, le wallet signet de CH-0003 (étape 8) dans client-wallet/data.
import { existsSync, readFileSync } from "node:fs";
import { EsploraBackend, MIN_RELAY_FEE, buildSpend, combinePsbts, createWalletConfig, finalizePsbt, history, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { makeReport, miner, rpc } from "./lib.ts";

const { report, summary } = makeReport();
const D = 6;
const seeds = { client: newMnemonic(), sq: newMnemonic(), tiers: newMnemonic(), client2: newMnemonic() };
const key = (m: string) => accountKey(masterFromMnemonic(m, "regtest"));
const A = await createWalletConfig({ network: "regtest", delay: D, client: key(seeds.client), swissquote: key(seeds.sq), tiers: key(seeds.tiers) });
const B = await createWalletConfig({ network: "regtest", delay: D, client: key(seeds.client2), swissquote: key(seeds.sq), tiers: key(seeds.tiers) });
const m = await miner();
const sign = async (psbt: string, ...who: string[]) => {
  const signed = combinePsbts(who.map((w) => signPsbtWithMnemonic(psbt, w, "regtest").psbt));
  return rpc.broadcast(finalizePsbt(A, signed).hex);
};

// Réceptions
const r1 = await m.pay(outputAt(A, 0, 0).getAddress(), 0.3);
const r2 = await m.pay(outputAt(A, 0, 1).getAddress(), 0.2);
await m.mine(1);
// Envoi externe (0.1 BTC, 3.5 sat/vB : taux fractionnaire)
const send = await buildSpend({ cfg: A, backend: rpc, utxos: await scan(A, rpc), path: "client", feeRate: 3.5, to: m.addr, amount: 10_000_000n, changeIndex: 0 });
const sTx = await sign(send.psbt, seeds.client);
await m.mine(1);
// Rafraîchissement (tout vers une adresse de change neuve)
const refresh = await buildSpend({ cfg: A, backend: rpc, utxos: await scan(A, rpc), path: "client", feeRate: 2, to: outputAt(A, 1, 1).getAddress() });
const fTx = await sign(refresh.psbt, seeds.client);
await m.mine(D);
// Recovery Swissquote + tiers vers le compte B
const rec = await buildSpend({ cfg: A, backend: rpc, utxos: await scan(A, rpc), path: "recovery", feeRate: 2, to: outputAt(B, 0, 0).getAddress() });
const rTx = await sign(rec.psbt, seeds.sq, seeds.tiers);
// (non minée : doit apparaître « en attente »)

const h = await history(A, rpc);
const by = (txid: string) => h.find((e) => e.txid === txid);
const fmt = (e: any) => e ? `${e.kind} ${e.amount} sats, frais ${e.fee ?? "—"}, ${e.height === null ? "en attente" : `bloc ${e.height}`}` : "absente";
report("9-1", "Historique regtest : réceptions, envoi, rafraîchissement et recovery sortante, chacune classée avec son montant",
  by(r1)?.kind === "reçu" && by(r1)?.amount === 30_000_000n && by(r2)?.amount === 20_000_000n &&
  by(sTx)?.kind === "envoyé" && by(sTx)?.amount === -10_000_000n && by(sTx)?.fee === send.summary.fee &&
  by(fTx)?.kind === "rafraîchissement" && by(fTx)?.amount === 0n &&
  by(rTx)?.kind === "recovery sortante" && by(rTx)?.height === null && h[0].txid === rTx,
  [r1, r2, sTx, fTx, rTx].map((t) => fmt(by(t))).join(" | "));
const hB = await history(B, rpc);
report("9-2", "Du côté du nouveau compte, la même transaction apparaît « reçu par recovery »", hB[0]?.kind === "reçu par recovery" && hB[0].txid === rTx, fmt(hB[0]));
report("9-3", "Frais à taux fractionnaire (3,5 sat/vB) : montant entier et cohérent", send.summary.fee > 0n && Number(send.summary.fee) === Math.ceil(Number(send.summary.fee)), `frais de l'envoi : ${send.summary.fee} sats`);

const fr = await rpc.feeRates();
report("9-4", "Frais regtest : estimation du nœud, ou valeurs par défaut s'il n'en a pas ; toutes ≥ 1 sat/vB", fr.fast >= fr.normal && fr.normal >= fr.slow && fr.slow >= MIN_RELAY_FEE, JSON.stringify(fr));

// Signet (vrai réseau)
const esplora = new EsploraBackend("https://blockstream.info/signet/api");
const fs = await esplora.feeRates();
report("9-5", "Frais signet : estimation réelle de l'API Esplora, planchérisée au minimum de relais (1 sat/vB)", fs.source === "réseau" && fs.slow >= MIN_RELAY_FEE && fs.fast >= fs.slow, JSON.stringify(fs));
// Wallet signet de CH-0003 qui a reçu le coin du faucet. Après la recovery de l'étape 8, il a été effacé du Wallet du
// client : sa clé publique reste dans l'état du test (.local/signet-ui), avec la politique du wallet signet actuel.
const wf = "client-wallet/data/wallets.json";
const w = existsSync(wf) ? (JSON.parse(readFileSync(wf, "utf8")) as any[]).filter((x) => x.policy?.network === "signet").at(-1) : null;
const sf = ".local/signet-ui/state.json";
const lost = existsSync(sf) ? JSON.parse(readFileSync(sf, "utf8")).lostAccountKey : null;
if (w) {
  const cfg = await createWalletConfig({ ...w.policy, client: lost ?? w.accountKey });
  const hs = await history(cfg, esplora);
  report("9-6", `Historique signet réel du wallet CH-0003${lost ? " d'origine (avant recovery)" : ""} : réception du faucet visible`, hs.some((e) => e.kind === "reçu" && e.amount >= 10_000n), hs.map((e) => `${e.txid.slice(0, 10)}… ${fmt(e)}`).join(" | "));
} else report("9-6", "Historique signet réel", false, "aucun wallet signet dans client-wallet/data");

process.exit(summary() ? 0 : 1);
