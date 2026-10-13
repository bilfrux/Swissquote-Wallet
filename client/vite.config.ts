import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// En regtest, le navigateur parle à bitcoind via ce relais de développement : les identifiants RPC (de test,
// conteneur local) restent côté serveur de dev et ne sont jamais dans le bundle.
// Le relais ne transmet QUE ce dont l'appli a besoin (lecture de la chaîne, diffusion, portefeuilles « sq-watch-* » en
// lecture seule) : sans ce filtre, l'appli, ou un autre site par une requête « simple » (CSRF), aurait tout le RPC du nœud,
// y compris `sendtoaddress` sur le portefeuille de garde de Swissquote (sq-omnibus) ou `stop`.
const WATCH = /^sq-watch-[0-9a-z]+$/;
const NODE_METHODS = new Set(["getblockcount", "validateaddress", "scantxoutset", "getrawtransaction", "testmempoolaccept", "sendrawtransaction", "getdescriptorinfo", "listwallets", "listwalletdir", "estimatesmartfee"]);
const WALLET_METHODS = new Set(["importdescriptors", "listsinceblock"]);

export function rpcAllowed(path: string, body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "single JSON-RPC request required";
  const { method, params = [] } = body as { method?: unknown; params?: unknown };
  if (typeof method !== "string" || !Array.isArray(params)) return "invalid JSON-RPC request";
  const wallet = path.match(/^\/wallet\/([^/?]+)\/?$/)?.[1];
  if (wallet !== undefined) return WATCH.test(decodeURIComponent(wallet)) && WALLET_METHODS.has(method) ? null : `${method} refused on wallet ${wallet}`;
  if (path !== "/" && path !== "") return `path refused: ${path}`;
  if (NODE_METHODS.has(method)) return null;
  // Portefeuille lecture seule du compte : nom « sq-watch-… », sans clé privée (disable_private_keys) et vide (blank).
  if (method === "loadwallet") return WATCH.test(String(params[0])) ? null : "loadwallet refused";
  if (method === "createwallet") return WATCH.test(String(params[0])) && params[1] === true && params[2] === true ? null : "createwallet refused: watch-only sq-watch-* wallets only";
  return `${method} refused`;
}

function regtestRelay(target: string, auth: string): Plugin {
  return {
    name: "regtest-rpc-relay",
    configureServer(server) {
      server.middlewares.use("/regtest-rpc", async (req, res) => {
        const refuse = (status: number, error: string) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ result: null, error: { code: -1, message: error } }));
        // Même origine seulement : un autre site ne peut pas se servir du relais (CSRF).
        if (req.method !== "POST") return refuse(405, "POST required");
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return refuse(403, `origin rejected: ${req.headers.origin}`);
        let raw = "";
        for await (const c of req) { raw += c; if (raw.length > 1_000_000) return refuse(413, "request too large"); }
        let body: unknown;
        try { body = JSON.parse(raw); } catch { return refuse(400, "invalid JSON"); }
        const path = (req.url ?? "/").split("?")[0];
        const why = rpcAllowed(path, body);
        if (why) return refuse(403, `regtest relay: ${why}`);
        try {
          const r = await fetch(target + path, { method: "POST", headers: { "content-type": "text/plain", authorization: auth }, body: raw });
          res.writeHead(r.status, { "content-type": "application/json" }).end(await r.text());
        } catch (e: any) { refuse(502, `bitcoind unreachable: ${e.message}`); }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const rpc = new URL(env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443");
  const auth = "Basic " + Buffer.from(`${decodeURIComponent(rpc.username)}:${decodeURIComponent(rpc.password)}`).toString("base64");
  return {
    envDir: "..",
    plugins: [react(), regtestRelay(rpc.origin, auth)],
    server: { port: 5173 },
  };
});
