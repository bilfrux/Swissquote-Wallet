import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// En regtest, le navigateur parle à bitcoind via ce proxy de développement : les identifiants RPC (de test,
// conteneur local) restent côté serveur de dev et ne sont jamais dans le bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const rpc = new URL(env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443");
  const auth = "Basic " + Buffer.from(`${rpc.username}:${rpc.password}`).toString("base64");
  rpc.username = rpc.password = "";
  return {
    envDir: "..",
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/regtest-rpc": { target: rpc.origin, changeOrigin: true, rewrite: (p) => p.replace(/^\/regtest-rpc/, ""), headers: { authorization: auth } },
      },
    },
  };
});
