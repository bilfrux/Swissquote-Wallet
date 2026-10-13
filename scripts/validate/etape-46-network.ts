// Étape 46 : exposition réseau. Le Client Wallet, bank-mock et le serveur d'attaques n'écoutent que sur la boucle locale ;
// le wallet refuse un en-tête Host étranger (DNS rebinding) et exige la biométrie pour effacer un wallet.
// Pile isolée : Client Wallet :5210, bank-mock :4420, attaques :4421. Pas besoin de regtest.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { networkInterfaces } from "node:os";
import { readFileSync, rmSync } from "node:fs";
import { makeReport } from "./lib.ts";

const DATA = `${process.cwd()}/.local/e2e-46`;
rmSync(DATA, { recursive: true, force: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>) => procs.push(spawn(cmd[0], cmd.slice(1), { env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5210", CLIENT_WALLET_DATA: `${DATA}/wallet` });
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4420", BANK_MOCK_DATA: `${DATA}/bank`, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" });
start(["npx", "tsx", "scripts/attacks/server.ts"], { ATTACKS_PORT: "4421" });
const WALLET = "http://localhost:5210";
for (const u of [`${WALLET}/api/wallets`, "http://localhost:4420/health"]) for (let i = 0; i < 150; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
for (let i = 0; i < 100; i++) { try { await fetch("http://localhost:4421/"); break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { report, summary } = makeReport();

// Requête HTTP brute (pour choisir l'adresse et l'en-tête Host librement) : statut, ou code d'erreur réseau.
const raw = (host: string, port: number, path: string, headers: Record<string, string> = {}, method = "GET", body?: string) =>
  new Promise<string>((resolve) => {
    const r = request({ host, port, path, method, headers, timeout: 3000 }, (res) => { res.resume(); resolve(String(res.statusCode)); });
    r.on("error", (e: any) => resolve(e.code ?? e.message));
    r.on("timeout", () => { r.destroy(); resolve("timeout"); });
    r.end(body);
  });

try {
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  const ports = [5210, 4420, 4421];
  const fromLan = lan ? await Promise.all(ports.map((p) => raw(lan, p, "/"))) : [];
  const fromLoop = await Promise.all([raw("localhost", 5210, "/api/wallets"), raw("localhost", 4420, "/health"), raw("localhost", 4421, "/attacks/x", {}, "POST")]);
  report("46-1", "Client Wallet, bank-mock et serveur d'attaques : injoignables depuis l'adresse du réseau local, joignables en boucle locale",
    !!lan && fromLan.every((s) => s === "ECONNREFUSED") && fromLoop[0] === "200" && fromLoop[1] === "200" && fromLoop[2] === "404",
    `adresse réseau local ${lan} : ${ports.map((p, i) => `${p} → ${fromLan[i]}`).join(", ")} ; localhost : ${fromLoop.join(", ")}`);

  const rebinding = await raw("localhost", 5210, "/api/wallets", { host: "attacker.example:5210" });
  const rebindingUi = await raw("localhost", 5210, "/", { host: "attacker.example:5210" });
  const own = await raw("localhost", 5210, "/api/wallets", { host: "127.0.0.1:5210" });
  report("46-2", "Client Wallet : en-tête Host d'un autre domaine refusé (DNS rebinding), API et interface ; Host de boucle locale accepté",
    rebinding === "403" && rebindingUi === "403" && own === "200", `Host attacker.example : API ${rebinding}, interface ${rebindingUi} ; Host 127.0.0.1 : ${own}`);

  const post = async (path: string, body: unknown, method = "POST") => { const r = await fetch(WALLET + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
  const bio = { credentialId: randomBytes(32).toString("base64url"), prfSalt: randomBytes(32).toString("base64url"), prf: randomBytes(32).toString("base64url") };
  const w = (await post("/api/wallets", { network: "regtest", label: "étape 46", bio })).body.wallet;
  const bare = await fetch(`${WALLET}/api/wallets/${w.id}`, { method: "DELETE" });
  const wrong = await post(`/api/wallets/${w.id}`, { prf: randomBytes(32).toString("base64url") }, "DELETE");
  const still = JSON.parse(readFileSync(`${DATA}/wallet/wallets.json`, "utf8")).some((x: any) => x.id === w.id);
  const ok = await post(`/api/wallets/${w.id}`, { prf: bio.prf }, "DELETE");
  const gone = !JSON.parse(readFileSync(`${DATA}/wallet/wallets.json`, "utf8")).some((x: any) => x.id === w.id);
  report("46-3", "Effacer un wallet : refusé sans biométrie ou avec un mauvais secret (wallet conservé), accepté avec le bon secret",
    bare.status === 403 && wrong.status === 403 && still && ok.status === 200 && gone,
    `sans rien : ${bare.status} ; mauvais secret : ${wrong.status} ${wrong.body.error} ; encore présent : ${still} ; bon secret : ${ok.status} ; effacé : ${gone}`);

  // Docker : la configuration publie le RPC de bitcoind sur la boucle locale seulement.
  const cfg = execFileSync("docker", ["compose", "-f", "docker/regtest.yml", "config", "--format", "json"], { encoding: "utf8" });
  const port = JSON.parse(cfg).services.bitcoind.ports[0];
  report("46-4", "docker/regtest.yml : RPC bitcoind publié sur 127.0.0.1 seulement", port.host_ip === "127.0.0.1" && String(port.published) === "18443", JSON.stringify(port));
} finally {
  procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
}
process.exit(summary() ? 0 : 1);
