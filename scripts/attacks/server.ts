// Serveur de démo du panneau « Attaques » (regtest uniquement). Processus séparé de l'appli :
// il exécute les mêmes scénarios que `npm run test:attacks`, avec des graines de démo jetables.
// Aucune clé ne transite vers le navigateur : il ne renvoie que les verdicts et les messages de la chaîne.
import { createServer } from "node:http";
import { ATTACKS } from "./attacks.ts";

const PORT = Number(process.env.ATTACKS_PORT ?? 4200);
const HOST = process.env.ATTACKS_HOST ?? "localhost"; // boucle locale seulement
const ORIGINS = (process.env.ATTACKS_ORIGINS ?? "http://localhost:5173").split(",");
let running = false;

createServer(async (req, res) => {
  if (req.headers.origin && ORIGINS.includes(req.headers.origin)) {
    res.setHeader("access-control-allow-origin", req.headers.origin);
    res.setHeader("access-control-allow-headers", "content-type");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  const m = req.url?.match(/^\/attacks\/([\w-]+)$/);
  const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (req.method !== "POST" || !m || !ATTACKS[m[1]]) return send(404, { error: "attaque inconnue" });
  if (running) return send(409, { error: "une attaque est déjà en cours" });
  running = true;
  try { send(200, await ATTACKS[m[1]]()); } catch (e: any) { send(500, { error: e.message }); } finally { running = false; }
}).listen(PORT, HOST, () => console.log(`[attaques] démo regtest sur http://localhost:${PORT}`));
