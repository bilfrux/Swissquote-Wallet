// Validation de l'étape 3 (regtest) : recovery Swissquote + tiers, refus réel avant D, rafraîchissement, avertissement.
// Prérequis : npm run regtest:up
import { buildSpend, combinePsbts, createWalletConfig, finalizePsbt, outputAt, scan, simulate } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { clientSign, makeReport, miner, nodeVerdict, rpc, startBankMock } from "./lib.ts";

const D = 6;
const { report, summary } = makeReport();
const bank = await startBankMock(4101, ".local/bm-test-3");
const { addr: minerAddr, mine, pay } = await miner();

try {
  const sqKey = (await bank.api("/guardian/key?network=regtest")).json.accountKey;
  const tiers = newMnemonic();
  const key = (m: string) => accountKey(masterFromMnemonic(m, "regtest"));
  const account = async (clientSeed: string) => {
    const cfg = await createWalletConfig({ network: "regtest", delay: D, client: key(clientSeed), swissquote: sqKey, tiers: key(tiers) });
    await bank.api("/accounts/register", { customerId: "CH-0001", network: "regtest", delay: D, client: cfg.client.raw, tiers: cfg.tiers.raw });
    return cfg;
  };
  const token = (await bank.api("/identity/verify", { customerId: "CH-0001", lastName: "Muster", birthDate: "1990-01-01", otp: "123456" })).json.token;
  // Recovery complète d'un compte vers un autre : signature Swissquote (bank-mock) + tiers, combinaison, finalisation.
  const recoveryTx = async (from: Awaited<ReturnType<typeof account>>, to: Awaited<ReturnType<typeof account>>) => {
    const { psbt } = await buildSpend({ cfg: from, backend: rpc, utxos: await scan(from, rpc), path: "recovery", feeRate: 2, to: outputAt(to, 0, 0).getAddress() });
    const sq = await bank.api("/guardian/sign", { network: "regtest", psbt, token });
    if (sq.status !== 200) throw new Error(`Swissquote : ${sq.json.error}`);
    const both = combinePsbts([sq.json.psbt, signPsbtWithMnemonic(psbt, tiers, "regtest").psbt]);
    return { ...finalizePsbt(from, both), sigs: simulate(from, both).inputs.map((i) => i.signatures) };
  };

  // 1. Recovery complète, deux coins reçus à 2 blocs d'écart : la transaction n'est valide qu'au D-ième bloc du PLUS RÉCENT.
  {
    const lost = newMnemonic();
    const A = await account(lost);
    const B = await account(newMnemonic());
    await pay(outputAt(A, 0, 0).getAddress(), 0.3);
    await mine(1);
    await mine(2);
    await pay(outputAt(A, 0, 1).getAddress(), 0.2);
    await mine(1);
    const tx = await recoveryTx(A, B);
    const coins = await scan(A, rpc);
    const v0 = await nodeVerdict(tx.hex);
    await mine(D - 3); // le plus ancien a D confirmations, le plus récent D-2
    const old = (await scan(A, rpc)).map((u) => u.confirmations).sort();
    const vMid = await nodeVerdict(tx.hex);
    await mine(1); // plus récent : D-1
    const vLast = await nodeVerdict(tx.hex);
    await mine(1); // plus récent : D
    const vOk = await nodeVerdict(tx.hex);
    const txid = vOk === "accepté" ? await rpc.broadcast(tx.hex) : "";
    await mine(1);
    const [left, got] = [await scan(A, rpc), await scan(B, rpc)];
    report("1", "Recovery Swissquote + tiers : refusée par le consensus avant D, acceptée à D pour le coin le plus récent ; fonds sur le nouveau compte",
      tx.sigs.every((n) => n === 2) && v0 === "non-BIP68-final" && vMid === "non-BIP68-final" && vLast === "non-BIP68-final" && vOk === "accepté" && left.length === 0 && got.length === 1,
      `confirmations des coins au départ=${coins.map((u) => u.confirmations).join(",")} ; à 1 conf : ${v0} ; à ${old.join("/")} conf : ${vMid} ; ` +
      `plus récent à ${D - 1} : ${vLast} ; à ${D} : ${vOk} ; txid=${txid} ; ancien compte : ${left.length} coin, nouveau : ${got.map((u) => u.value).join(",")} sats`);
  }

  // 2. Rafraîchissement : le client déplace ses coins avant D ; la recovery préparée devient invalide, et le délai repart de zéro.
  {
    const seed = newMnemonic();
    const A = await account(seed);
    const B = await account(newMnemonic());
    await pay(outputAt(A, 0, 0).getAddress(), 0.15);
    await mine(1);
    await mine(D - 3); // D-2 confirmations
    const before = await scan(A, rpc);
    const warned = before.filter((u) => u.recoveryOpensIn <= Math.ceil(D / 3)); // même règle que l'avertissement de l'appli
    const pending = await recoveryTx(A, B); // Swissquote + tiers ont signé, en attente du délai
    const refresh = await buildSpend({ cfg: A, backend: rpc, utxos: before, path: "client", feeRate: 2, to: outputAt(A, 1, 0).getAddress() });
    const r = clientSign(A, refresh.psbt, seed);
    const refreshTxid = await rpc.broadcast(r.hex);
    await mine(4); // nouveau coin : 4 confirmations (< D) ; l'ancien en aurait eu D+2
    const vPending = await nodeVerdict(pending.hex);
    const fresh = await recoveryTx(A, B); // nouvelle demande sur le coin rafraîchi
    const after = await scan(A, rpc);
    const vFresh = await nodeVerdict(fresh.hex);
    report("2", "Rafraîchissement avant D : la recovery déjà signée devient invalide ; sur le nouveau coin le délai repart de zéro",
      warned.length === 1 && vPending === "missing-inputs" && vFresh === "non-BIP68-final" && after[0].confirmations < D,
      `avertissement à ${before[0].confirmations} conf (recovery dans ${before[0].recoveryOpensIn} blocs) : ${warned.length === 1 ? "affiché" : "absent"} ; ` +
      `rafraîchissement ${refreshTxid.slice(0, 16)}… ; recovery signée avant : ${vPending} ; nouvelle recovery à ${after[0].confirmations} conf du nouveau coin : ${vFresh}`);
  }

  // 3. Pendant tout ce temps, le client dépense seul, sans délai ni Swissquote.
  {
    const seed = newMnemonic();
    const A = await account(seed);
    await pay(outputAt(A, 0, 0).getAddress(), 0.05);
    await mine(1);
    bank.stop();
    const spend = await buildSpend({ cfg: A, backend: rpc, utxos: await scan(A, rpc), path: "client", feeRate: 2, to: minerAddr });
    const v = await nodeVerdict(clientSign(A, spend.psbt, seed).hex);
    report("3", "Client seul, 1 confirmation, Swissquote arrêtée : dépense acceptée", v === "accepté", `verdict du nœud : ${v}`);
  }
} finally {
  bank.stop();
}
process.exit(summary() ? 0 : 1);
