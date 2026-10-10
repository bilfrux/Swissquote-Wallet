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

// Défis de preuve de propriété (étape 7).
db.exec(`create table if not exists ownership_challenges (
  id text primary key, customer_id text not null, account_id integer not null, network text not null,
  change integer not null, idx integer not null, address text not null, message text not null,
  expires_at integer not null, used_at integer, verified_at integer
)`);

// Relais des demandes de signature vers le tiers de confiance (A3).
db.exec(`create table if not exists relay (
  id text primary key, customer_id text not null, psbt text not null, signed text,
  created_at text not null default (datetime('now'))
)`);

// Comptes Ethereum (étape 17) : Safe du client (adresse calculée depuis son EOA), gardien tiers. Données publiques.
db.exec(`create table if not exists evm_accounts (
  id integer primary key, customer_id text not null, owner text not null unique, safe text not null,
  tiers text not null, tiers_name text, created_at text not null default (datetime('now'))
)`);
