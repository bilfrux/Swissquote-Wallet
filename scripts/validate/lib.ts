// Outils communs aux scripts de validation (regtest).
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { BitcoindBackend, type WalletConfig, finalizePsbt } from "@sq/bitcoin";

export const rpc = new BitcoindBackend(process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443");

export async function miner() {
  const wallets: string[] = await rpc.call("listwallets");
  if (!wallets.includes("miner")) await rpc.call("loadwallet", ["miner"]).catch(() => rpc.call("createwallet", ["miner"]));
  const addr: string = await rpc.call("getnewaddress", [], "miner");
  if ((await rpc.tipHeight()) < 101) await rpc.call("generatetoaddress", [101, addr]);
  return {
    addr,
    mine: (n: number) => rpc.call("generatetoaddress", [n, addr]),
    pay: (to: string, btc: number) => rpc.call("sendtoaddress", [to, btc], "miner") as Promise<string>,
  };
}

// Verdict du nœud sans diffuser : "accepted" ou la raison réelle du refus.
export async function nodeVerdict(hex: string): Promise<string> {
  const [r] = await rpc.call("testmempoolaccept", [[hex]]);
  return r.allowed ? "accepted" : r["reject-reason"];
}

export function makeReport() {
  const results: [string, string, boolean][] = [];
  const report = (id: string, label: string, ok: boolean, detail: string) => {
    results.push([id, label, ok]);
    console.log(`[${ok ? "OK " : "KO "}] ${id} ${label}\n       ${detail}`);
  };
  const summary = () => {
    console.log("\nRÉSUMÉ");
    for (const [id, label, ok] of results) console.log(`${id.padEnd(3)} ${(ok ? "fonctionne" : "ne fonctionne pas").padEnd(18)} ${label}`);
    return results.every(([, , ok]) => ok);
  };
  return { report, summary };
}

// bank-mock dans son propre processus, stockage vierge.
export async function startBankMock(port: number, dataDir: string) {
  rmSync(dataDir, { recursive: true, force: true });
  const child: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "bank-mock"], {
    env: { ...process.env, BANK_MOCK_PORT: String(port), BANK_MOCK_DATA: `${process.cwd()}/${dataDir}` },
    stdio: "ignore",
    detached: true,
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${url}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  const api = async (path: string, body?: unknown) => {
    const r = await fetch(url + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    return { status: r.status, json: (await r.json()) as any };
  };
  return { url, api, stop: () => { try { process.kill(-child.pid!, "SIGTERM"); } catch {} } };
}

// Signature par le signataire externe de démo (processus séparé), à partir d'une graine de test.
export function clientSign(cfg: WalletConfig, psbt: string, mnemonic: string, dir = ".local/validate") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/client.json`, JSON.stringify({ mnemonic }), { mode: 0o600 });
  writeFileSync(`${dir}/unsigned.psbt`, psbt);
  execFileSync("npm", ["run", "-s", "client-signer", "--", "--psbt", `${dir}/unsigned.psbt`, "--mnemonic-file", `${dir}/client.json`, "--network", cfg.network, "--yes", "--out", `${dir}/signed.psbt`], { stdio: "ignore" });
  rmSync(`${dir}/client.json`);
  return finalizePsbt(cfg, readFileSync(`${dir}/signed.psbt`, "utf8").trim());
}
