// Stockage propre de bank-mock (SQLite intégré à Node, node:sqlite). Jamais lu par l'appli cliente.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATA_DIR = process.env.BANK_MOCK_DATA ?? new URL("../data/", import.meta.url).pathname;
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "bank-mock.sqlite"));
db.exec(`
  create table if not exists accounts (
    id integer primary key, customer_id text not null, network text not null, delay integer not null,
    client_key text not null, tiers_key text not null, created_at text not null default (datetime('now')),
    unique (network, client_key)
  );
  create table if not exists kyc_sessions (
    token text primary key, customer_id text not null, expires_at integer not null
  );
  create table if not exists sign_log (
    id integer primary key, customer_id text, network text, decision text not null, reason text,
    psbt text, created_at text not null default (datetime('now'))
  );
`);

// Migration : nom du tiers (ajouté à l'étape 6).
if (!(db.prepare("pragma table_info(accounts)").all() as any[]).some((c) => c.name === "tiers_name")) db.exec("alter table accounts add column tiers_name text");
