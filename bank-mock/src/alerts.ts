// Alertes au client (information, PAS une sécurité : sans Swissquote, plus d'alertes).
// - un coin approche de l'ouverture de la recovery (≤ ⌈D/3⌉ blocs) ou elle est ouverte ;
// - Swissquote vient de signer une demande de recovery sur un compte du client.
// Chaque alerte est enregistrée (table notifications) et « envoyée » par email SIMULÉ (bank-mock/data/outbox.log).
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { BitcoindBackend, type ChainBackend, EsploraBackend, type NetworkName, type WalletConfig, scan } from "@sq/bitcoin";
import { CUSTOMERS } from "./bank.ts";
import { DATA_DIR, db } from "./db.ts";

db.exec(`create table if not exists notifications (
  id integer primary key, customer_id text not null, account_id integer, kind text not null, title text not null,
  body text not null, ref text not null unique, created_at text not null default (datetime('now')), read_at text
)`);

const backends: Record<NetworkName, ChainBackend> = {
  regtest: new BitcoindBackend(process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443"),
  signet: new EsploraBackend(process.env.ESPLORA_URL ?? process.env.VITE_ESPLORA_URL ?? "https://blockstream.info/signet/api"),
};

export function notify(customerId: string, accountId: number | null, kind: string, title: string, body: string, ref: string) {
  const r = db.prepare("insert or ignore into notifications (customer_id, account_id, kind, title, body, ref) values (?, ?, ?, ?, ?, ?)").run(customerId, accountId, kind, title, body, ref);
  if (r.changes) {
    const c = CUSTOMERS[customerId];
    const to = c ? `${c.firstName.toLowerCase()}.${c.lastName.toLowerCase()}@exemple.invalid` : customerId;
    appendFileSync(join(DATA_DIR, "outbox.log"), `${new Date().toISOString()} | SIMULATED email to ${to} | ${title} | ${body}\n`);
  }
  return r.changes > 0;
}

type Row = { id: number; customer_id: string; network: NetworkName; delay: number };
// Une passe de surveillance : renvoie le nombre d'alertes créées.
export async function runAlerts(configOf: (r: any) => Promise<WalletConfig>, networks: NetworkName[] = ["regtest", "signet"]): Promise<{ created: number; errors: string[] }> {
  const rows = (db.prepare("select * from accounts").all() as (Row & Record<string, unknown>)[]).filter((r) => networks.includes(r.network));
  let created = 0;
  const errors: string[] = [];
  for (const row of rows) {
    try {
      const cfg = await configOf(row);
      const threshold = Math.ceil(cfg.delay / 3);
      for (const u of await scan(cfg, backends[row.network])) {
        if (u.confirmations === 0) continue;
        const coin = `${u.txid.slice(0, 10)}…:${u.vout} (${u.value} sats)`;
        if (u.recoveryOpensIn === 0)
          created += +notify(row.customer_id, row.id, "recovery-ouverte", "Recovery possible on one of your coins",
            `Coin ${coin} has not moved for ${cfg.delay} blocks: Swissquote and your trusted contact can now move it together. Refresh your coins if this is not a recovery you asked for.`,
            `${row.id}:${u.txid}:${u.vout}:open`);
        else if (u.recoveryOpensIn <= threshold)
          created += +notify(row.customer_id, row.id, "recovery-bientot", `Recovery possible in ${u.recoveryOpensIn} block(s)`,
            `Coin ${coin} will become spendable by Swissquote + your trusted contact in ${u.recoveryOpensIn} block(s). To prevent this, refresh your coins (transfer to yourself).`,
            `${row.id}:${u.txid}:${u.vout}:soon`);
      }
    } catch (e: any) {
      errors.push(`account ${row.id} (${row.network}): ${e.message}`);
    }
  }
  return { created, errors };
}
