// Compte crypto Swissquote (CUSTODIAL, comme aujourd'hui) et transferts avec le wallet self-custody du client,
// sous la Travel Rule : Swissquote n'envoie vers un wallet auto-hébergé, et ne crédite un dépôt qui en vient,
// qu'après avoir vérifié qu'il appartient au client.
// - registre MOCKÉ des avoirs (table custody_ledger) ;
// - portefeuille omnibus RÉEL de Swissquote dans bitcoind (regtest) : fonds en garde de la banque, sans rapport avec
//   la clé de guardian ;
// - enregistrements Travel Rule (table travel_rule_records).
import { BitcoindBackend, type NetworkName, type WalletConfig, addresses } from "@sq/bitcoin";
import { CUSTOMERS } from "./bank.ts";
import { db } from "./db.ts";

const rpc = new BitcoindBackend(process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443");
const OMNIBUS = process.env.BANK_MOCK_OMNIBUS ?? "sq-omnibus";
// Avoirs crypto de démo au compte Swissquote (BTC), par client.
const INITIAL_BTC: Record<string, number> = { "CH-0001": 1.5, "CH-0002": 0.4, "CH-0003": 0.8 };

db.exec(`
  create table if not exists custody_ledger (
    id integer primary key, customer_id text not null, network text not null, sats integer not null, reason text not null,
    ref text unique, created_at text not null default (datetime('now'))
  );
  create table if not exists deposit_addresses (address text primary key, customer_id text not null, network text not null);
  create table if not exists travel_rule_records (
    id integer primary key, customer_id text not null, network text not null, direction text not null, status text not null,
    amount_sats integer not null, address text not null, txid text, originator text not null, beneficiary text not null,
    verification text not null, created_at text not null default (datetime('now'))
  );
`);

export class CustodyError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

const name = (c: string) => `${CUSTOMERS[c].firstName} ${CUSTOMERS[c].lastName} (client ${c})`;
function ensureOpening(customerId: string, network: NetworkName) {
  db.prepare("insert or ignore into custody_ledger (customer_id, network, sats, reason, ref) values (?, ?, ?, ?, ?)")
    .run(customerId, network, Math.round((INITIAL_BTC[customerId] ?? 0) * 1e8), "solde d'ouverture (démo)", `open:${customerId}:${network}`);
}
export function balance(customerId: string, network: NetworkName): number {
  ensureOpening(customerId, network);
  return (db.prepare("select coalesce(sum(sats), 0) as s from custody_ledger where customer_id = ? and network = ?").get(customerId, network) as any).s;
}
const requireRegtest = (n: NetworkName) => {
  if (n !== "regtest") throw new CustodyError(501, "compte crypto Swissquote : démo disponible en regtest seulement (le portefeuille omnibus signet n'est pas approvisionné)");
};

// Portefeuille omnibus (regtest) : créé et approvisionné au besoin (minage de démo).
async function omnibus(): Promise<string> {
  const loaded: string[] = await rpc.call("listwallets");
  if (!loaded.includes(OMNIBUS)) {
    const onDisk: string[] = (await rpc.call("listwalletdir")).wallets.map((w: any) => w.name);
    if (onDisk.includes(OMNIBUS)) await rpc.call("loadwallet", [OMNIBUS]);
    else await rpc.call("createwallet", [OMNIBUS]);
  }
  if ((await rpc.call("getbalance", [], OMNIBUS)) < 5) {
    const a = await rpc.call("getnewaddress", ["approvisionnement"], OMNIBUS);
    await rpc.call("generatetoaddress", [101, a]); // regtest : fonds de démo de la banque
  }
  return OMNIBUS;
}

// Adresses (lookahead) de tous les comptes enregistrés du client sur ce réseau.
type Ctx = { accounts: { id: number; cfg: WalletConfig }[] };
const ownAddressMap = (ctx: Ctx) => {
  const m = new Map<string, number>();
  for (const a of ctx.accounts) for (const x of addresses(a.cfg, 50)) m.set(x.address, a.id);
  return m;
};

// RETRAIT : compte Swissquote -> wallet self-custody du client.
export async function withdraw(customerId: string, network: NetworkName, address: string, amountSats: number, ctx: Ctx) {
  requireRegtest(network);
  if (!Number.isInteger(amountSats) || amountSats < 10_000) throw new CustodyError(400, "montant invalide (minimum 10 000 sats)");
  if (amountSats > balance(customerId, network)) throw new CustodyError(400, "avoirs insuffisants sur le compte Swissquote");
  const accountId = ownAddressMap(ctx).get(address);
  if (accountId === undefined) throw new CustodyError(403, "adresse refusée : seuls les wallets enregistrés à votre nom sont autorisés");
  // Travel Rule : propriété du wallet auto-hébergé vérifiée (preuve signée par la clé du client) AVANT l'envoi.
  const proof = db.prepare("select id, verified_at from ownership_challenges where customer_id = ? and address = ? and verified_at is not null order by verified_at desc limit 1").get(customerId, address) as any;
  if (!proof) throw new CustodyError(412, "Travel Rule : preuve de propriété requise pour cette adresse avant tout envoi", { needProof: true, address });
  const wallet = await omnibus();
  const txid: string = await rpc.call("sendtoaddress", [address, amountSats / 1e8], wallet);
  db.prepare("insert into custody_ledger (customer_id, network, sats, reason, ref) values (?, ?, ?, ?, ?)").run(customerId, network, -amountSats, `retrait vers le wallet (compte n°${accountId})`, `wd:${txid}`);
  const id = db.prepare(`insert into travel_rule_records (customer_id, network, direction, status, amount_sats, address, txid, originator, beneficiary, verification)
    values (?, ?, 'sortant', 'envoyé', ?, ?, ?, ?, ?, ?)`).run(customerId, network, amountSats, address, txid,
    `${name(customerId)} · compte Swissquote`, `${name(customerId)} · wallet auto-hébergé (compte n°${accountId})`,
    `preuve de propriété n°${proof.id.slice(0, 8)} vérifiée le ${new Date(proof.verified_at).toISOString()}`).lastInsertRowid;
  return { txid, recordId: Number(id), balanceSats: balance(customerId, network) };
}

// DÉPÔT : adresse de dépôt du client (portefeuille omnibus).
export async function depositAddress(customerId: string, network: NetworkName) {
  requireRegtest(network);
  const existing = db.prepare("select address from deposit_addresses where customer_id = ? and network = ?").get(customerId, network) as any;
  if (existing) return existing.address as string;
  const a: string = await rpc.call("getnewaddress", [`dépôt ${customerId}`], await omnibus());
  db.prepare("insert into deposit_addresses (address, customer_id, network) values (?, ?, ?)").run(a, customerId, network);
  return a;
}

// Crédit des dépôts confirmés : seulement si la provenance est vérifiée (entrées venant d'un compte enregistré du client).
export async function syncDeposits(customerId: string, network: NetworkName, ctx: Ctx) {
  requireRegtest(network);
  const mine = db.prepare("select address from deposit_addresses where customer_id = ? and network = ?").all(customerId, network) as any[];
  if (!mine.length) return { credited: 0, held: 0 };
  const own = ownAddressMap(ctx);
  const listed: any[] = await rpc.call("listtransactions", ["*", 1000, 0, true], await omnibus());
  let credited = 0, held = 0;
  for (const l of listed.filter((x) => x.category === "receive" && x.confirmations >= 1 && mine.some((m) => m.address === x.address))) {
    if (db.prepare("select 1 from travel_rule_records where txid = ? and direction = 'entrant'").get(l.txid)) continue;
    const tx = await rpc.call("getrawtransaction", [l.txid, 2]);
    const from = tx.vin.map((i: any) => i.prevout?.scriptPubKey?.address).filter(Boolean) as string[];
    const verified = from.length > 0 && from.every((a) => own.has(a));
    const sats = Math.round(l.amount * 1e8);
    if (verified) {
      db.prepare("insert or ignore into custody_ledger (customer_id, network, sats, reason, ref) values (?, ?, ?, ?, ?)").run(customerId, network, sats, "dépôt depuis le wallet", `dep:${l.txid}:${l.vout}`);
      credited++;
    } else held++;
    db.prepare(`insert into travel_rule_records (customer_id, network, direction, status, amount_sats, address, txid, originator, beneficiary, verification)
      values (?, ?, 'entrant', ?, ?, ?, ?, ?, ?, ?)`).run(customerId, network, verified ? "crédité" : "en attente de vérification", sats, l.address, l.txid,
      verified ? `${name(customerId)} · wallet auto-hébergé (compte n°${own.get(from[0])})` : `inconnu (${from[0] ?? "?"})`,
      `${name(customerId)} · compte Swissquote`,
      verified ? "provenance vérifiée : toutes les entrées viennent d'un wallet enregistré du client" : "provenance NON vérifiée : fonds non crédités");
  }
  return { credited, held };
}

export const records = (customerId: string, network: NetworkName) =>
  db.prepare("select * from travel_rule_records where customer_id = ? and network = ? order by id desc").all(customerId, network);
