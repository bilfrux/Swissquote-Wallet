// Étape 37 : coffre biométrique du Wallet du client (côté serveur), qui remplace le PIN depuis l'étape 36.
// Wallet isolé :5197 (stockage neuf) ; regtest pour la signature. Prérequis : npm run regtest:up
// Limite : le secret PRF est ici 32 octets aléatoires qui tiennent lieu de la sortie de l'authentificateur. Ce test
// vérifie le chiffrement, le déverrouillage et la migration ; pas la biométrie WebAuthn elle-même dans le navigateur.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { buildSpend, createWalletConfig, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { openBio, seal } from "../../client-wallet/src/vault.ts";
import { makeReport, miner, rpc } from "./lib.ts";

const WALLET = "http://localhost:5197";
const DATA = `${process.cwd()}/.local/e2e-37-bio`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "client-wallet"], { env: { ...process.env, CLIENT_WALLET_PORT: "5197", CLIENT_WALLET_DATA: DATA }, stdio: "ignore", detached: true });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${WALLET}/api/wallets`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const post = async (path: string, body: unknown) => { const r = await fetch(WALLET + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
const list = async () => (await (await fetch(`${WALLET}/api/wallets`)).json()) as any[];
const b64u = (n: number) => randomBytes(n).toString("base64url");
const bioKey = () => ({ credentialId: b64u(32), prfSalt: b64u(32), prf: b64u(32) });
const { report, summary } = makeReport();

try {
  const none = await post("/api/wallets", { network: "regtest" });
  const pinOnly = await post("/api/wallets", { network: "regtest", pin: "482916" });
  const badBio = await post("/api/wallets", { network: "regtest", bio: { credentialId: "x", prfSalt: "y", prf: "z" } });
  report("37-1", "Création sans biométrie, avec un PIN seul ou avec une clé biométrique invalide : refusée",
    none.status === 400 && pinOnly.status === 400 && badBio.status === 400, `${none.body.error} | ${pinOnly.body.error} | ${badBio.body.error}`);

  const bio = bioKey();
  const c = await post("/api/wallets", { network: "regtest", bio });
  const words: string[] = c.body.mnemonic.split(" ");
  const file = readFileSync(`${DATA}/wallets.json`, "utf8");
  const stored = JSON.parse(file)[0];
  // Comme au test 8-6 : aucune paire de mots consécutifs de la phrase, aucun mot dans la partie chiffrée.
  const pairs = words.slice(1).map((w, i) => `${words[i]} ${w}`).filter((p) => file.includes(p));
  const plainWords = [...pairs, ...words.filter((w) => new RegExp(`\\b${w}\\b`).test(JSON.stringify(stored.bio)))];
  report("37-2", "Graine chiffrée sur le disque par le secret biométrique : ni la phrase ni ses mots en clair, pas de PIN ; HKDF + AES-256-GCM ; le bon secret la redonne",
    !file.includes(c.body.mnemonic) && plainWords.length === 0 && !stored.mnemonic && !stored.sealed && stored.bio?.kdf === "hkdf-sha256-prf" && !file.includes(bio.prf) && openBio(stored.bio, bio.prf) === c.body.mnemonic,
    `paires ou mots en clair : ${plainWords.length} ; champs stockés : ${Object.keys(stored).join(", ")} ; secret PRF sur le disque : ${file.includes(bio.prf)}`);

  const view = (await list())[0];
  report("37-3", "Vue publique : identifiant de la passkey et sel PRF seulement (ni phrase, ni texte chiffré, ni secret)",
    view.protected === true && view.unlock?.pin === false && view.unlock?.bio?.credentialId === bio.credentialId && view.unlock?.bio?.prfSalt === bio.prfSalt && !("bio" in view) && !JSON.stringify(view).includes(stored.bio.ct) && !JSON.stringify(view).includes(bio.prf),
    JSON.stringify(view.unlock));

  // Compte regtest de ce wallet, financé, pour une vraie signature
  const sqKey = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const tKey = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: c.body.wallet.accountKey, swissquote: sqKey, tiers: tKey });
  await post(`/api/wallets/${c.body.wallet.id}/policy`, { policy: { network: "regtest", delay: 6, swissquote: sqKey, tiers: tKey } });
  const m = await miner();
  await m.pay(outputAt(cfg, 0, 0).getAddress(), 0.05);
  await m.mine(1);
  const { psbt } = await buildSpend({ cfg, backend: rpc, utxos: await scan(cfg, rpc), path: "client", feeRate: 2, to: m.addr, amount: 1_000_000n });

  const wrong = await post("/api/sign", { psbt, network: "regtest", prf: b64u(32) });
  const missing = await post("/api/sign", { psbt, network: "regtest" });
  const pin = await post("/api/sign", { psbt, network: "regtest", pin: "482916" });
  report("37-4", "Signature avec un autre secret biométrique, sans rien, ou avec un PIN : refusée",
    wrong.status === 403 && missing.status === 403 && pin.status === 403, `${wrong.body.error} | ${missing.body.error} | ${pin.body.error}`);

  const ok = await post("/api/sign", { psbt, network: "regtest", prf: bio.prf });
  report("37-5", "Signature avec le bon secret biométrique : PSBT signé (une signature ajoutée)", ok.status === 200 && ok.body.added === 1, `${ok.status} ajoutées=${ok.body.added}`);

  for (let i = 0; i < 5; i++) await post("/api/sign", { psbt, network: "regtest", prf: b64u(32) });
  const locked = await post("/api/sign", { psbt, network: "regtest", prf: bio.prf });
  report("37-6", "Après 5 échecs : wallet bloqué, même le bon secret est refusé pendant 60 s", locked.status === 429, `${locked.status} ${locked.body.error}`);

  // Ancien wallet protégé par PIN (avant l'étape 36) : migration vers la biométrie, puis le PIN ne sert plus.
  const pinPhrase = newMnemonic();
  const pinAccount = accountKey(masterFromMnemonic(pinPhrase, "regtest"));
  const pinWallet = { id: "bbbbbbbb", label: "ancien PIN", sealed: seal(pinPhrase, "730215"), accountKey: pinAccount, createdAt: new Date().toISOString() };
  // Ancien wallet en clair (avant l'étape 8)
  const clearPhrase = newMnemonic();
  const clearWallet = { id: "aaaaaaaa", label: "ancien clair", mnemonic: clearPhrase, accountKey: accountKey(masterFromMnemonic(clearPhrase, "regtest")), createdAt: new Date().toISOString() };
  writeFileSync(`${DATA}/wallets.json`, JSON.stringify([...JSON.parse(readFileSync(`${DATA}/wallets.json`, "utf8")), pinWallet, clearWallet], null, 2));

  const prove = (body: object) => post("/api/prove", { accountKey: pinAccount, change: 0, index: 0, message: "défi étape 37", network: "regtest", ...body });
  const before = (await list()).find((w) => w.id === "bbbbbbbb");
  const pinBio = bioKey();
  const migrateWrong = await post("/api/wallets/bbbbbbbb/unlock", { op: "set-bio", auth: { pin: "000000" }, bio: pinBio });
  const migrate = await post("/api/wallets/bbbbbbbb/unlock", { op: "set-bio", auth: { pin: "730215" }, bio: pinBio });
  const migrated = JSON.parse(readFileSync(`${DATA}/wallets.json`, "utf8")).find((w: any) => w.id === "bbbbbbbb");
  const byBio = await prove({ prf: pinBio.prf });
  const byPin = await prove({ pin: "730215" });
  report("37-7", "Ancien wallet PIN : signalé PIN sans biométrie ; migration refusée avec un PIN faux, acceptée avec le bon ; ensuite le PIN est supprimé et seule la biométrie signe",
    before?.unlock?.pin === true && before?.unlock?.bio === null && migrateWrong.status === 403 && migrate.status === 200 && !migrated.sealed && !!migrated.bio && openBio(migrated.bio, pinBio.prf) === pinPhrase && byBio.status === 200 && !!byBio.body.signature && byPin.status === 403,
    `avant : ${JSON.stringify(before?.unlock)} ; PIN faux : ${migrateWrong.status} ; migration : ${migrate.status} ; champs stockés : ${Object.keys(migrated).join(", ")} ; preuve par biométrie : ${byBio.status} ; par l'ancien PIN : ${byPin.status} ${byPin.body.error}`);

  const protPin = await post("/api/wallets/aaaaaaaa/protect", { pin: "730215" });
  const protBio = await post("/api/wallets/aaaaaaaa/protect", { bio: bioKey() });
  const after = readFileSync(`${DATA}/wallets.json`, "utf8");
  report("37-8", "Ancien wallet en clair : protection par PIN refusée, protection biométrique acceptée ; la phrase en clair disparaît du disque",
    protPin.status === 400 && protBio.status === 200 && protBio.body.protected === true && !after.includes(clearPhrase),
    `PIN : ${protPin.status} ${protPin.body.error} ; biométrie : ${protBio.status} protected=${protBio.body.protected} ; phrase encore sur le disque : ${after.includes(clearPhrase)}`);
} finally {
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
