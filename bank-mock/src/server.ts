// bank-mock : backend Swissquote MOCKÉ, processus séparé, port et stockage propres.
// Rôle : guardian Swissquote. Il ne signe QUE des PSBT de recovery (chemin Swissquote + tiers), après re-KYC mocké,
// pour un compte enregistré du client, et vers un autre compte enregistré du MÊME client.
// Ces contrôles sont une couche en plus : seul le consensus Bitcoin impose les deux signatures et le délai D.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type NetworkName, type WalletConfig, addresses, createWalletConfig, inputsBelongTo, simulate } from "@sq/bitcoin";
import { db } from "./db.ts";
import { signAsSwissquote, swissquoteAccountKey } from "./guardian.ts";
import { TEST_CUSTOMERS, customerFromToken, verifyIdentity } from "./kyc.ts";

const PORT = Number(process.env.BANK_MOCK_PORT ?? 4000);
const ORIGINS = (process.env.BANK_MOCK_ORIGINS ?? "http://localhost:5173,http://localhost:5174").split(",");
const NETWORKS: NetworkName[] = ["regtest", "signet"];

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const network = (n: unknown): NetworkName => {
  if (!NETWORKS.includes(n as NetworkName)) throw new HttpError(400, "réseau inconnu (regtest ou signet)");
  return n as NetworkName;
};

type AccountRow = { id: number; customer_id: string; network: NetworkName; delay: number; client_key: string; tiers_key: string };
const configOf = (a: AccountRow): Promise<WalletConfig> =>
  createWalletConfig({ network: a.network, delay: a.delay, client: a.client_key, swissquote: swissquoteAccountKey(a.network), tiers: a.tiers_key });

// Analyse d'une demande de recovery : d'où viennent les coins, où vont-ils, par quel chemin.
async function reviewRecovery(customerId: string, net: NetworkName, psbt: string) {
  const rows = db.prepare("select * from accounts where customer_id = ? and network = ?").all(customerId, net) as AccountRow[];
  const accounts = await Promise.all(rows.map(async (r) => ({ row: r, cfg: await configOf(r) })));
  const source = accounts.find((a) => inputsBelongTo(a.cfg, psbt));
  if (!source) throw new HttpError(403, "les coins dépensés n'appartiennent à aucun compte enregistré de ce client");
  const summary = simulate(source.cfg, psbt);
  if (summary.path !== "recovery") throw new HttpError(403, "Swissquote ne signe que le chemin de recovery (nSequence = D), jamais une dépense courante");
  const dest = accounts.find((a) => a.row.id !== source.row.id && (() => {
    const own = new Set(addresses(a.cfg, 50).map((x) => x.address));
    return summary.outputs.every((o) => own.has(o.address));
  })());
  if (!dest) throw new HttpError(403, "toutes les sorties doivent aller vers un AUTRE compte enregistré du même client (nouvelle clé client)");
  return { source: source.row.id, destination: dest.row.id, summary };
}

async function route(req: IncomingMessage, body: any, url: URL) {
  const key = `${req.method} ${url.pathname}`;
  switch (key) {
    case "GET /health":
      return { ok: true, service: "bank-mock" };

    case "GET /guardian/key":
      return { accountKey: swissquoteAccountKey(network(url.searchParams.get("network"))) };

    case "POST /accounts/register": {
      // Session bancaire MOCKÉE : le client est identifié par son identifiant de la banque simulée.
      if (!TEST_CUSTOMERS[body.customerId]) throw new HttpError(403, "client inconnu de la banque simulée");
      const net = network(body.network);
      const cfg = await createWalletConfig({ network: net, delay: Number(body.delay), client: body.client, swissquote: swissquoteAccountKey(net), tiers: body.tiers }).catch((e) => {
        throw new HttpError(400, e.message);
      });
      db.prepare("insert or ignore into accounts (customer_id, network, delay, client_key, tiers_key) values (?, ?, ?, ?, ?)")
        .run(body.customerId, net, cfg.delay, cfg.client.raw, cfg.tiers.raw);
      const row = db.prepare("select id, customer_id from accounts where network = ? and client_key = ?").get(net, cfg.client.raw) as any;
      if (row.customer_id !== body.customerId) throw new HttpError(409, "cette clé client est déjà enregistrée par un autre client");
      return { accountId: row.id };
    }

    case "POST /identity/verify": {
      const session = verifyIdentity(body);
      if (!session) throw new HttpError(403, "vérification d'identité refusée (dossier de test inconnu ou réponses incorrectes)");
      return session;
    }

    case "POST /accounts/list": {
      // Après re-KYC : clés PUBLIQUES des comptes du client, pour qu'un nouvel appareil retrouve son ancien compte.
      const customerId = customerFromToken(body.token);
      if (!customerId) throw new HttpError(403, "identité non vérifiée : re-KYC requis");
      const rows = db.prepare("select * from accounts where customer_id = ? and network = ? order by id").all(customerId, network(body.network)) as AccountRow[];
      return { accounts: rows.map((r) => ({ id: r.id, delay: r.delay, client: r.client_key, tiers: r.tiers_key, swissquote: swissquoteAccountKey(r.network), createdAt: (r as any).created_at })) };
    }

    case "POST /guardian/sign": {
      const customerId = customerFromToken(body.token);
      const net = network(body.network);
      const log = (decision: string, reason: string) =>
        db.prepare("insert into sign_log (customer_id, network, decision, reason, psbt) values (?, ?, ?, ?, ?)").run(customerId, net, decision, reason, String(body.psbt ?? ""));
      try {
        if (!customerId) throw new HttpError(403, "identité non vérifiée : re-KYC requis avant toute signature");
        if (typeof body.psbt !== "string") throw new HttpError(400, "psbt manquant");
        const review = await reviewRecovery(customerId, net, body.psbt);
        const { psbt, added } = signAsSwissquote(body.psbt, net);
        if (added === 0) throw new HttpError(500, "aucune entrée signable par la clé Swissquote");
        log("signé", `compte ${review.source} -> compte ${review.destination}`);
        return { psbt, added, review: { ...review, summary: JSON.parse(JSON.stringify(review.summary, (_, v) => (typeof v === "bigint" ? v.toString() : v))) } };
      } catch (e: any) {
        log("refusé", e.message);
        throw e;
      }
    }
  }
  throw new HttpError(404, `route inconnue : ${key}`);
}

createServer(async (req, res: ServerResponse) => {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    const out = await route(req, raw ? JSON.parse(raw) : {}, new URL(req.url ?? "/", "http://localhost"));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
  }
}).listen(PORT, () => console.log(`[bank-mock] guardian Swissquote sur http://localhost:${PORT}`));
