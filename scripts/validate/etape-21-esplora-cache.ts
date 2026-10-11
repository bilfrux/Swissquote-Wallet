// Étape 21 : résilience de l'appli à la limite de l'API Esplora publique (blockstream : 700 requêtes/heure/IP, 429).
// Faux serveur Esplora local (répond normalement, puis 429 sur commande) et faux stockage du navigateur :
// test déterministe, sans consommer le quota réel.
import { createServer } from "node:http";
import { EsploraBackend } from "@sq/bitcoin";
import { makeReport } from "./lib.ts";

const { report, summary } = makeReport();
// Faux localStorage (l'appli tourne dans le navigateur ; ici Node).
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};

let limited = false, hits = 0;
const srv = createServer((req, res) => {
  hits++;
  if (limited) return res.writeHead(429).end('{"error":"Too Many Requests"}');
  if (req.url === "/blocks/tip/height") return res.writeHead(200).end("325900");
  if (req.method === "POST" && req.url === "/tx") return res.writeHead(200).end("ab".repeat(32));
  res.writeHead(404).end("not found");
}).listen(0);
await new Promise((r) => srv.once("listening", r));
const base = `http://127.0.0.1:${(srv.address() as any).port}`;

try {
  // 21-1 Première lecture : réseau, puis mise en cache persistante (une nouvelle instance = page rechargée la relit sans requête).
  const a = new EsploraBackend(base);
  const h1 = await a.tipHeight();
  const before = hits;
  const b = new EsploraBackend(base); // « page rechargée »
  const h2 = await b.tipHeight();
  report("21-1", "Lecture mise en cache dans le stockage du navigateur : après rechargement, aucune nouvelle requête pendant la durée de validité", h1 === 325900 && h2 === 325900 && hits === before, `requêtes au faux serveur : ${hits}`);

  // 21-2 Cache expiré + API limitée (429) : dernière valeur connue servie, date signalée.
  const key = [...mem.keys()].find((k) => k.endsWith("/blocks/tip/height"))!;
  const saved = JSON.parse(mem.get(key)!);
  mem.set(key, JSON.stringify({ ...saved, t: Date.now() - 3_600_000 })); // une heure plus tôt
  limited = true;
  const c = new EsploraBackend(base);
  const h3 = await c.tipHeight();
  report("21-2", "API limitée (429) et cache expiré : la dernière valeur connue est servie et datée (staleSince)", h3 === 325900 && c.staleSince !== null && Date.now() - c.staleSince! >= 3_590_000, `valeur ${h3} ; données du ${new Date(c.staleSince!).toISOString()}`);

  // 21-3 Sans aucune donnée connue : message clair (pas le JSON brut de l'API).
  const d = new EsploraBackend(base + "/");
  mem.clear();
  const err = await d.tipHeight().then(() => "aucune erreur", (e) => e.message);
  report("21-3", "API limitée sans donnée en cache : message lisible", /rate-limited/.test(err) && !/Blockstream Explorer API NOTICE|{/.test(err), err);

  // 21-4 Après une diffusion, le cache est vidé (mémoire et stockage) : le solde suivant sera relu.
  limited = false;
  const e = new EsploraBackend(base);
  await e.tipHeight();
  const stored = [...mem.keys()].filter((k) => k.startsWith(`sq-esplora:${base}:`)).length;
  await e.broadcast("00");
  const after = [...mem.keys()].filter((k) => k.startsWith(`sq-esplora:${base}:`)).length;
  report("21-4", "Après une diffusion, le cache persistant est vidé (relecture réelle du solde)", stored === 1 && after === 0, `entrées avant ${stored}, après ${after}`);

  // 21-5 « Reload » (invalidate) force une vraie relecture.
  await e.tipHeight();
  const n0 = hits;
  e.invalidate();
  await e.tipHeight();
  report("21-5", "« Reload » : invalidate() force une vraie relecture", hits === n0 + 1, `requêtes ${n0} -> ${hits}`);
} finally {
  srv.close();
}
process.exit(summary() ? 0 : 1);
