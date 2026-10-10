// Aide de démo regtest : financer une adresse, miner des blocs (pour faire passer le délai D).
//   npm run regtest -- fund <adresse> [btc]
//   npm run regtest -- mine <n>
import { miner, rpc } from "../validate/lib.ts";

const [cmd, a, b] = process.argv.slice(2);
const m = await miner();
if (cmd === "fund" && a) {
  const txid = await m.pay(a, Number(b ?? 0.5));
  await m.mine(1);
  console.log(`${b ?? 0.5} BTC envoyés à ${a} (txid ${txid}), 1 bloc miné. Hauteur : ${await rpc.tipHeight()}`);
} else if (cmd === "mine") {
  await m.mine(Number(a ?? 1));
  console.log(`${a ?? 1} bloc(s) miné(s). Hauteur : ${await rpc.tipHeight()}`);
} else {
  console.log("usage : npm run regtest -- fund <adresse> [btc] | mine <n>");
  process.exit(1);
}
