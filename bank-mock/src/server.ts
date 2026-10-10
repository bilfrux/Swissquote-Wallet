// bank-mock : backend Swissquote MOCKÉ, processus séparé, port et stockage propres.
// Rôle : guardian Swissquote. Il ne signe QUE des PSBT de recovery (chemin Swissquote + tiers), après re-KYC mocké,
// pour un compte enregistré du client, et vers un autre compte enregistré du MÊME client.
// Ces contrôles sont une couche en plus : seul le consensus Bitcoin impose les deux signatures et le délai D.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { Verifier } from "bip322-js";
import { type NetworkName, type WalletConfig, addresses, clientKeyAddress, combinePsbts, createWalletConfig, inputsBelongTo, outputAt, simulate } from "@sq/bitcoin";
import { db } from "./db.ts";
import { signAsSwissquote, signEvmRecovery, swissquoteAccountKey, swissquoteEvmAddress } from "./guardian.ts";
import { getAddress, isAddress } from "viem";
import { safeAddressOf } from "@sq/evm";
import { TEST_CUSTOMERS, customerFromToken, verifyIdentity } from "./kyc.ts";
import { CUSTOMERS, createSession, customerFromSession, login } from "./bank.ts";
import { authenticationOptions, passkeyCount, recordStepup, registrationOptions, verifyAuthentication, verifyRegistration } from "./passkeys.ts";
import { notify, runAlerts } from "./alerts.ts";
import { CustodyError, balance, depositAddress, records, syncDeposits, withdraw } from "./custody.ts";

const PORT = Number(process.env.BANK_MOCK_PORT ?? 4000);
const ORIGINS = (process.env.BANK_MOCK_ORIGINS ?? "http://localhost:5173,http://localhost:5174,http://localhost:5175").split(",");
const NETWORKS: NetworkName[] = ["regtest", "signet"];

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const network = (n: unknown): NetworkName => {
  if (!NETWORKS.includes(n as NetworkName)) throw new HttpError(400, "unknown network (regtest or signet)");
  return n as NetworkName;
};

type AccountRow = { id: number; customer_id: string; network: NetworkName; delay: number; client_key: string; tiers_key: string; tiers_name: string | null; created_at: string };
const publicAccount = (r: AccountRow) => ({ id: r.id, delay: r.delay, client: r.client_key, tiers: r.tiers_key, tiersName: r.tiers_name, swissquote: swissquoteAccountKey(r.network), createdAt: r.created_at });
const configOf = (a: AccountRow): Promise<WalletConfig> =>
  createWalletConfig({ network: a.network, delay: a.delay, client: a.client_key, swissquote: swissquoteAccountKey(a.network), tiers: a.tiers_key });

// Analyse d'une demande de recovery : d'où viennent les coins, où vont-ils, par quel chemin.
async function reviewRecovery(customerId: string, net: NetworkName, psbt: string) {
  const rows = db.prepare("select * from accounts where customer_id = ? and network = ?").all(customerId, net) as AccountRow[];
  const accounts = await Promise.all(rows.map(async (r) => ({ row: r, cfg: await configOf(r) })));
  const source = accounts.find((a) => inputsBelongTo(a.cfg, psbt));
  if (!source) throw new HttpError(403, "the spent coins do not belong to any registered account of this client");
  const summary = simulate(source.cfg, psbt);
  if (summary.path !== "recovery") throw new HttpError(403, "Swissquote only signs the recovery path (nSequence = D), never an ordinary spend");
  const dest = accounts.find((a) => a.row.id !== source.row.id && (() => {
    const own = new Set(addresses(a.cfg, 50).map((x) => x.address));
    return summary.outputs.every((o) => own.has(o.address));
  })());
  if (!dest) throw new HttpError(403, "all outputs must go to ANOTHER registered account of the same client (new client key)");
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
      // Client identifié par sa session bancaire (appli) ou, pour les scripts de validation, par son identifiant.
      const customerId = customerFromSession(req.headers.authorization) ?? body.customerId;
      if (!TEST_CUSTOMERS[customerId]) throw new HttpError(403, "client unknown to the simulated bank");
      body.customerId = customerId;
      const net = network(body.network);
      const cfg = await createWalletConfig({ network: net, delay: Number(body.delay), client: body.client, swissquote: swissquoteAccountKey(net), tiers: body.tiers }).catch((e) => {
        throw new HttpError(400, e.message);
      });
      db.prepare("insert or ignore into accounts (customer_id, network, delay, client_key, tiers_key, tiers_name) values (?, ?, ?, ?, ?, ?)")
        .run(body.customerId, net, cfg.delay, cfg.client.raw, cfg.tiers.raw, typeof body.tiersName === "string" ? body.tiersName.slice(0, 80) : null);
      const row = db.prepare("select id, customer_id from accounts where network = ? and client_key = ?").get(net, cfg.client.raw) as any;
      if (row.customer_id !== body.customerId) throw new HttpError(409, "this client key is already registered by another client");
      return { accountId: row.id };
    }

    // ---- Ethereum (étape 17) : Safe du client, Swissquote est l'un des deux gardiens du module de recovery ----
    case "GET /guardian/evm-address":
      return { address: swissquoteEvmAddress };

    case "POST /evm/accounts/register": {
      const customerId = customerFromSession(req.headers.authorization);
      if (!customerId) throw new HttpError(401, "session expired: please log in again");
      if (!isAddress(String(body.owner)) || !isAddress(String(body.tiers))) throw new HttpError(400, "invalid Ethereum address");
      const owner = getAddress(body.owner), tiers = getAddress(body.tiers);
      if (tiers === owner || tiers === swissquoteEvmAddress) throw new HttpError(400, "the trusted contact must be a third party (not you, not Swissquote)");
      const safe = safeAddressOf(owner); // recalculé ici : Swissquote ne fait pas confiance à l'appli
      db.prepare("insert or ignore into evm_accounts (customer_id, owner, safe, tiers, tiers_name) values (?, ?, ?, ?, ?)")
        .run(customerId, owner, safe, tiers, typeof body.tiersName === "string" ? body.tiersName.slice(0, 80) : null);
      const row = db.prepare("select * from evm_accounts where owner = ?").get(owner) as any;
      if (row.customer_id !== customerId) throw new HttpError(409, "this Ethereum key is already registered by another client");
      return { id: row.id, owner, safe, tiers: row.tiers, tiersName: row.tiers_name, swissquote: swissquoteEvmAddress };
    }

    case "GET /evm/accounts": {
      const customerId = customerFromSession(req.headers.authorization);
      if (!customerId) throw new HttpError(401, "session expired: please log in again");
      const rows = db.prepare("select * from evm_accounts where customer_id = ? order by id").all(customerId) as any[];
      return { swissquote: swissquoteEvmAddress, accounts: rows.map((r) => ({ id: r.id, owner: r.owner, safe: r.safe, tiers: r.tiers, tiersName: r.tiers_name, createdAt: r.created_at })) };
    }

    case "POST /auth/login": {
      const s = login(body.customerId, body.password);
      if (!s) throw new HttpError(403, "incorrect client ID or password");
      return s;
    }

    // ---- Passkeys (WebAuthn) ----
    case "GET /auth/passkey": {
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      return { count: passkeyCount(id) };
    }
    case "POST /auth/passkey/register/options": {
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      return registrationOptions(id);
    }
    case "POST /auth/passkey/register/verify": {
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      return verifyRegistration(id, body.response).catch((e) => { throw new HttpError(403, e.message); });
    }
    case "POST /auth/passkey/login/options": {
      if (!CUSTOMERS[body.customerId]) throw new HttpError(403, "unknown client");
      return authenticationOptions(body.customerId, "login").catch((e) => { throw new HttpError(404, e.message); });
    }
    case "POST /auth/passkey/login/verify": {
      if (!CUSTOMERS[body.customerId]) throw new HttpError(403, "unknown client");
      await verifyAuthentication(body.customerId, "login", body.response).catch((e) => { throw new HttpError(403, e.message); });
      return createSession(body.customerId);
    }
    // Ré-authentification avant un envoi de montant élevé : enregistrée et signalée au client (alerte).
    case "POST /auth/stepup/options": {
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      return authenticationOptions(id, "stepup").catch((e) => { throw new HttpError(404, e.message); });
    }
    case "POST /auth/stepup/verify": {
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      await verifyAuthentication(id, "stepup", body.response).catch((e) => { throw new HttpError(403, e.message); });
      const amount = Number(body.amountSats ?? 0), dest = String(body.destination ?? "");
      recordStepup(id, String(body.network ?? ""), amount, dest);
      notify(id, null, "envoi-eleve", "High-value transfer confirmed by passkey",
        `You confirmed by passkey the transfer of ${(amount / 1e8).toFixed(8)} BTC to ${dest}. If this was not you, do not sign in your wallet.`,
        `stepup:${id}:${Date.now()}`);
      return { approved: true };
    }

    // ---- Compte crypto Swissquote (custodial) et transferts sous la Travel Rule ----
    case "GET /custody":
    case "POST /custody/withdraw":
    case "GET /custody/deposit-address":
    case "POST /custody/sync":
    case "GET /custody/travel-rule": {
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      const net = network(url.searchParams.get("network") ?? body.network);
      const rows = db.prepare("select * from accounts where customer_id = ? and network = ?").all(id, net) as AccountRow[];
      const ctx = { accounts: await Promise.all(rows.map(async (r) => ({ id: r.id, cfg: await configOf(r) }))) };
      if (key === "GET /custody") return { network: net, balanceSats: balance(id, net) };
      if (key === "GET /custody/travel-rule") return { records: records(id, net) };
      if (key === "GET /custody/deposit-address") return { address: await depositAddress(id, net) };
      if (key === "POST /custody/sync") return syncDeposits(id, net, ctx);
      const r = await withdraw(id, net, String(body.address ?? ""), Number(body.amountSats), ctx);
      notify(id, null, "retrait", "Withdrawal to your wallet sent",
        `${(Number(body.amountSats) / 1e8).toFixed(8)} BTC sent from your Swissquote account to your wallet (${body.address}). Wallet ownership verified (Travel Rule).`, `wd:${r.txid}`);
      return r;
    }

    case "GET /me": {
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      const { password: _p, ...c } = CUSTOMERS[id];
      return { id, ...c };
    }

    case "GET /wallet/accounts": {
      // Comptes Bitcoin (clés PUBLIQUES) du client connecté : un nouvel appareil retrouve son wallet.
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      const rows = db.prepare("select * from accounts where customer_id = ? and network = ? order by id").all(id, network(url.searchParams.get("network"))) as AccountRow[];
      return { accounts: rows.map(publicAccount) };
    }

    case "POST /ownership/challenge": {
      // Défi de preuve de propriété pour une adresse d'un compte du client connecté (usage unique, 10 min).
      const customerId = customerFromSession(req.headers.authorization);
      if (!customerId) throw new HttpError(401, "session expired: please log in again");
      const net = network(body.network);
      const row = db.prepare("select * from accounts where customer_id = ? and network = ? and client_key = ?").get(customerId, net, String(body.client ?? "")) as AccountRow | undefined;
      if (!row) throw new HttpError(403, "this account does not belong to the logged-in client");
      const change = Number(body.change ?? 0), index = Number(body.index);
      if (![0, 1].includes(change) || !Number.isInteger(index) || index < 0 || index > 1_000_000) throw new HttpError(400, "invalid address index");
      const address = outputAt(await configOf(row), change as 0 | 1, index).getAddress();
      const id = randomBytes(16).toString("hex");
      const message = `Swissquote · proof of ownership\nClient: ${customerId}\nAddress: ${address}\nChallenge: ${id}\nIssued on: ${new Date().toISOString()}`;
      db.prepare("insert into ownership_challenges (id, customer_id, account_id, network, change, idx, address, message, expires_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, customerId, row.id, net, change, index, address, message, Date.now() + 10 * 60 * 1000);
      return { challengeId: id, message, address, change, index };
    }

    case "GET /ownership/status": {
      // Cette adresse a-t-elle déjà une preuve de propriété vérifiée (Travel Rule) ?
      const customerId = customerFromSession(req.headers.authorization);
      if (!customerId) throw new HttpError(401, "session expired: please log in again");
      const row = db.prepare("select id, verified_at from ownership_challenges where customer_id = ? and address = ? and verified_at is not null order by verified_at desc limit 1")
        .get(customerId, String(url.searchParams.get("address") ?? "")) as any;
      return { verified: !!row, proofId: row?.id ?? null, verifiedAt: row ? new Date(row.verified_at).toISOString() : null };
    }

    case "POST /ownership/verify": {
      const customerId = customerFromSession(req.headers.authorization);
      if (!customerId) throw new HttpError(401, "session expired: please log in again");
      const c = db.prepare("select * from ownership_challenges where id = ? and customer_id = ?").get(String(body.challengeId ?? ""), customerId) as any;
      if (!c) throw new HttpError(404, "unknown challenge");
      if (c.used_at) throw new HttpError(409, "challenge already used");
      if (c.expires_at < Date.now()) throw new HttpError(410, "challenge expired");
      db.prepare("update ownership_challenges set used_at = ? where id = ?").run(Date.now(), c.id); // usage unique, même en cas d'échec
      const row = db.prepare("select * from accounts where id = ?").get(c.account_id) as AccountRow;
      const cfg = await configOf(row);
      // Swissquote recalcule elle-même la clé du client depuis son xpub enregistré : elle ne fait pas confiance à l'appli.
      const keyAddress = clientKeyAddress(cfg, c.change, c.idx);
      let verified = false;
      try { verified = Verifier.verifySignature(keyAddress, c.message, String(body.signature ?? ""), true); } catch { verified = false; }
      const sameAddress = outputAt(cfg, c.change, c.idx).getAddress() === c.address;
      if (verified && sameAddress) db.prepare("update ownership_challenges set verified_at = ? where id = ?").run(Date.now(), c.id);
      return {
        verified: verified && sameAddress,
        address: c.address,
        keyAddress,
        proves: verified && sameAddress
          ? `The client holds the private key of their client key at index ${c.idx} (BIP-322 signature verified for ${keyAddress}). According to the registered policy, this key alone is enough to spend address ${c.address} (client path).`
          : "No ownership demonstrated: invalid signature for the expected client key.",
      };
    }

    // Relais vers le tiers de confiance (A3) : le client dépose le PSBT déjà signé par Swissquote, le tiers l'ouvre par
    // un lien (identifiant aléatoire de 128 bits) et y renvoie sa signature. Swissquote ne fait que transporter :
    // la signature du tiers ne se fait que dans sa console.
    case "POST /relay": {
      const customerId = customerFromSession(req.headers.authorization);
      if (!customerId) throw new HttpError(401, "session expired: please log in again");
      const id = randomBytes(16).toString("hex");
      db.prepare("insert into relay (id, customer_id, psbt) values (?, ?, ?)").run(id, customerId, String(body.psbt ?? ""));
      return { id };
    }
    case "GET /relay": {
      const row = db.prepare("select psbt, signed from relay where id = ?").get(String(url.searchParams.get("id") ?? "")) as any;
      if (!row) throw new HttpError(404, "unknown request");
      return { psbt: row.psbt, signed: row.signed };
    }
    case "POST /relay/signed": {
      const row = db.prepare("select psbt from relay where id = ?").get(String(body.id ?? "")) as any;
      if (!row) throw new HttpError(404, "unknown request");
      // Doit être la MÊME transaction (sinon combinePsbts échoue) : le tiers ne peut pas substituer une autre dépense.
      try { combinePsbts([row.psbt, String(body.psbt ?? "")]); } catch { throw new HttpError(400, "signed PSBT unrelated to the request"); }
      db.prepare("update relay set signed = ? where id = ?").run(String(body.psbt), String(body.id));
      return { ok: true };
    }

    case "GET /notifications": {
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      const items = db.prepare("select id, account_id as accountId, kind, title, body, created_at as createdAt, read_at as readAt from notifications where customer_id = ? order by id desc limit 50").all(id) as any[];
      return { unread: items.filter((n) => !n.readAt).length, items };
    }

    case "POST /notifications/read": {
      const id = customerFromSession(req.headers.authorization);
      if (!id) throw new HttpError(401, "session expired: please log in again");
      db.prepare("update notifications set read_at = datetime('now') where customer_id = ? and read_at is null").run(id);
      return { ok: true };
    }

    case "POST /alerts/run":
      // Passe de surveillance à la demande (démo et tests) ; elle tourne aussi périodiquement.
      return runAlerts(configOf, body.network ? [network(body.network)] : undefined);

    case "POST /identity/verify": {
      const session = verifyIdentity(body);
      if (!session) throw new HttpError(403, "identity verification rejected (unknown test file or incorrect answers)");
      return session;
    }

    case "POST /accounts/list": {
      // Après re-KYC : clés PUBLIQUES des comptes du client, pour qu'un nouvel appareil retrouve son ancien compte.
      const customerId = customerFromToken(body.token);
      if (!customerId) throw new HttpError(403, "identity not verified: re-KYC required");
      const rows = db.prepare("select * from accounts where customer_id = ? and network = ? order by id").all(customerId, network(body.network)) as AccountRow[];
      return { accounts: rows.map(publicAccount) };
    }

    case "POST /guardian/sign": {
      const customerId = customerFromToken(body.token);
      const net = network(body.network);
      const log = (decision: string, reason: string) =>
        db.prepare("insert into sign_log (customer_id, network, decision, reason, psbt) values (?, ?, ?, ?, ?)").run(customerId, net, decision, reason, String(body.psbt ?? ""));
      try {
        if (!customerId) throw new HttpError(403, "identity not verified: re-KYC required before any signature");
        if (typeof body.psbt !== "string") throw new HttpError(400, "psbt missing");
        const review = await reviewRecovery(customerId, net, body.psbt);
        const { psbt, added } = signAsSwissquote(body.psbt, net);
        if (added === 0) throw new HttpError(500, "no input signable by the Swissquote key");
        log("signé", `account ${review.source} -> account ${review.destination}`);
        notify(customerId, review.source, "recovery-signee", "Swissquote signed a recovery request",
          `Swissquote signed a recovery request from your account #${review.source} to your account #${review.destination}, after identity verification. If this was not you, immediately refresh your coins from your wallet.`,
          `sign:${customerId}:${review.source}:${Date.now()}`);
        return { psbt, added, review: { ...review, summary: JSON.parse(JSON.stringify(review.summary, (_, v) => (typeof v === "bigint" ? v.toString() : v))) } };
      } catch (e: any) {
        log("refusé", e.message);
        throw e;
      }
    }
  }
  throw new HttpError(404, `unknown route: ${key}`);
}

createServer(async (req, res: ServerResponse) => {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "content-type, authorization");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    const out = await route(req, raw ? JSON.parse(raw) : {}, new URL(req.url ?? "/", "http://localhost"));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  } catch (e: any) {
    const status = e instanceof HttpError || e instanceof CustodyError ? e.status : 500;
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message, ...(e instanceof CustodyError ? e.extra : {}) }));
  }
}).listen(PORT, () => console.log(`[bank-mock] guardian Swissquote sur http://localhost:${PORT}`));

// Surveillance périodique des comptes (alertes au client) : regtest toutes les 30 s ; signet toutes les 15 min
// (API Esplora publique limitée à 700 requêtes/heure/IP chez blockstream). 0 désactive.
const REGTEST_MS = Number(process.env.ALERT_INTERVAL_MS ?? 30_000);
const SIGNET_MS = Number(process.env.ALERT_SIGNET_INTERVAL_MS ?? 900_000);
if (REGTEST_MS > 0) setInterval(() => { runAlerts(configOf, ["regtest"]).catch(() => undefined); }, REGTEST_MS);
if (SIGNET_MS > 0) setInterval(() => { runAlerts(configOf, ["signet"]).catch(() => undefined); }, SIGNET_MS);
