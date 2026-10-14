// Authentification par passkey (WebAuthn) de la banque simulée, avec @simplewebauthn/server (aucune crypto maison) :
// - connexion sans mot de passe ;
// - ré-authentification « step-up » avant un envoi de montant élevé (vérification de l'utilisateur exigée : biométrie / PIN de l'appareil).
// La passkey authentifie le client auprès de Swissquote ; elle ne signe aucune transaction Bitcoin.
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { CUSTOMERS } from "./bank.ts";
import { db } from "./db.ts";

export const RP_ID = process.env.BANK_MOCK_RP_ID ?? "localhost";
// Mêmes origines par défaut que le CORS de server.ts.
const ORIGINS = (process.env.BANK_MOCK_ORIGINS ?? "http://localhost:5173,http://localhost:5174,http://localhost:5175").split(",");
const TTL = 5 * 60 * 1000;

db.exec(`
  create table if not exists passkeys (
    id text primary key, customer_id text not null, public_key text not null, counter integer not null,
    transports text, created_at text not null default (datetime('now'))
  );
  create table if not exists webauthn_challenges (
    customer_id text not null, purpose text not null, challenge text not null, expires_at integer not null,
    primary key (customer_id, purpose)
  );
  create table if not exists stepups (
    id integer primary key, customer_id text not null, network text, amount_sats integer, destination text,
    created_at text not null default (datetime('now'))
  );
`);

type Purpose = "register" | "login" | "stepup" | "crypto";
const saveChallenge = (c: string, p: Purpose, challenge: string) =>
  db.prepare("insert or replace into webauthn_challenges (customer_id, purpose, challenge, expires_at) values (?, ?, ?, ?)").run(c, p, challenge, Date.now() + TTL);
function takeChallenge(c: string, p: Purpose): string {
  const row = db.prepare("select challenge, expires_at from webauthn_challenges where customer_id = ? and purpose = ?").get(c, p) as any;
  db.prepare("delete from webauthn_challenges where customer_id = ? and purpose = ?").run(c, p); // usage unique
  if (!row || row.expires_at < Date.now()) throw new Error("WebAuthn challenge missing or expired");
  return row.challenge;
}
const credentialsOf = (c: string) => db.prepare("select * from passkeys where customer_id = ?").all(c) as any[];
const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");

export const passkeyCount = (c: string) => credentialsOf(c).length;

export async function registrationOptions(customerId: string) {
  const c = CUSTOMERS[customerId];
  const opts = await generateRegistrationOptions({
    rpName: "Swissquote (simulated bank)", rpID: RP_ID, userName: customerId, userDisplayName: `${c.firstName} ${c.lastName}`,
    userID: new TextEncoder().encode(customerId), attestationType: "none",
    excludeCredentials: credentialsOf(customerId).map((k) => ({ id: k.id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  saveChallenge(customerId, "register", opts.challenge);
  return opts;
}

export async function verifyRegistration(customerId: string, response: any) {
  const v = await verifyRegistrationResponse({
    response, expectedChallenge: takeChallenge(customerId, "register"), expectedOrigin: ORIGINS, expectedRPID: RP_ID, requireUserVerification: true,
  });
  if (!v.verified) throw new Error("passkey rejected");
  const cred = v.registrationInfo.credential;
  db.prepare("insert or replace into passkeys (id, customer_id, public_key, counter, transports) values (?, ?, ?, ?, ?)")
    .run(cred.id, customerId, b64u(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []));
  return { registered: true, count: passkeyCount(customerId) };
}

export async function authenticationOptions(customerId: string, purpose: "login" | "stepup" | "crypto") {
  const creds = credentialsOf(customerId);
  if (!creds.length) throw new Error("no passkey registered for this client");
  const opts = await generateAuthenticationOptions({
    rpID: RP_ID, userVerification: "required",
    allowCredentials: creds.map((k) => ({ id: k.id, transports: JSON.parse(k.transports ?? "[]") })),
  });
  saveChallenge(customerId, purpose, opts.challenge);
  return opts;
}

// Vérifie une assertion (connexion ou step-up) ; met à jour le compteur anti-clonage.
export async function verifyAuthentication(customerId: string, purpose: "login" | "stepup" | "crypto", response: any) {
  const k = db.prepare("select * from passkeys where id = ? and customer_id = ?").get(String(response?.id ?? ""), customerId) as any;
  if (!k) throw new Error("unknown passkey for this client");
  const v = await verifyAuthenticationResponse({
    response, expectedChallenge: takeChallenge(customerId, purpose), expectedOrigin: ORIGINS, expectedRPID: RP_ID, requireUserVerification: true,
    credential: { id: k.id, publicKey: new Uint8Array(Buffer.from(k.public_key, "base64url")), counter: k.counter, transports: JSON.parse(k.transports ?? "[]") },
  });
  if (!v.verified) throw new Error("passkey authentication rejected");
  db.prepare("update passkeys set counter = ? where id = ?").run(v.authenticationInfo.newCounter, k.id);
  return v.authenticationInfo;
}

export const recordStepup = (c: string, network: string, amountSats: number, destination: string) =>
  db.prepare("insert into stepups (customer_id, network, amount_sats, destination) values (?, ?, ?, ?)").run(c, network, amountSats, destination);

export const newSessionToken = () => randomBytes(32).toString("hex");
