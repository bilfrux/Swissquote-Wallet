// ================================================================================================
//  WALLET DU CLIENT : implémentation de référence d'un wallet externe (en production : wallet matériel
//  ou appli téléphone). Processus séparé de l'appli Swissquote, stockage propre (client-wallet/data/).
//  - génère la graine avec @scure/bip39, l'affiche UNE fois, ne transmet que la clé publique étendue ;
//  - signe uniquement après un écran de confirmation qui décode le PSBT (sorties, montants, frais, chemin).
//  Son API n'accepte que des requêtes de sa propre origine : l'appli de la banque ne peut ni lire une clé,
//  ni obtenir une signature sans passer par l'écran de confirmation de ce wallet.
// ================================================================================================
import { createServer, type IncomingMessage } from "node:http";
import react from "@vitejs/plugin-react";
import { createServer as createVite } from "vite";
import { btc } from "@bitcoinerlab/descriptors-scure";
import { base64 } from "@scure/base";
import { Signer } from "bip322-js";
import { BitcoindBackend, type ChainBackend, EsploraBackend, type NetworkName, addresses, btcNetwork, buildSpend, createWalletConfig, finalizePsbt, keyAddressOf, scan, simulate } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { type JsonOp, describeOp, ownersOf, readState, safeAddressOf, signOp } from "@sq/evm";
import { evmAccountFromMnemonic, evmAddressFromMnemonic } from "@sq/evm/keys";
import { getAddress, type Address } from "viem";
import { type Policy, type StoredWallet, load, publicView, save } from "./store.ts";
import { open, openBio, sealBio, validBio, validPin, validPrf } from "./vault.ts";

// Déverrouillage par code PIN (`pin`) ou par biométrie (`prf` : secret rendu par la passkey du wallet après Touch ID,
// Face ID…), selon ce que le client a activé. 5 échecs, puis blocage de 60 s (compteur en mémoire du processus).
type Auth = { pin?: unknown; prf?: unknown };
const attempts = new Map<string, { fails: number; until: number }>();
function unlock(w: StoredWallet, auth: Auth): string {
  if (!w.sealed && !w.bio) return w.mnemonic!; // wallet « non protégé » (créé avant l'étape 8)
  const a = attempts.get(w.id) ?? { fails: 0, until: 0 };
  if (a.until > Date.now()) throw new HttpError(429, `wallet locked after 5 failed unlocks: try again in ${Math.ceil((a.until - Date.now()) / 1000)} s`);
  const bio = auth?.prf !== undefined;
  try {
    let m: string;
    if (bio) { if (!w.bio || !validPrf(auth.prf)) throw new Error("bio"); m = openBio(w.bio, auth.prf); }
    else { if (!w.sealed || !validPin(auth?.pin)) throw new Error("pin"); m = open(w.sealed, auth.pin); }
    attempts.delete(w.id);
    return m;
  } catch {
    a.fails += 1;
    if (a.fails >= 5) { a.fails = 0; a.until = Date.now() + 60_000; }
    attempts.set(w.id, a);
    const what = bio ? (w.bio ? "biometric unlock failed" : "biometrics not enabled for this wallet") : w.sealed ? "incorrect PIN" : "no PIN for this wallet: use biometrics";
    throw new HttpError(403, a.until > Date.now() ? `${what}: wallet locked for 60 s` : `${what} (${5 - a.fails} attempt(s) left)`);
  }
}
const authOf = (body: any): Auth => ({ pin: body?.pin, prf: body?.prf });

const PORT = Number(process.env.CLIENT_WALLET_PORT ?? 5180);
// Au-delà de ce montant envoyé vers l'extérieur, le wallet exige une confirmation renforcée (en plus du PIN ou de la biométrie).
const HIGH_VALUE_SATS = BigInt(process.env.CLIENT_WALLET_HIGH_VALUE_SATS ?? 20_000_000);
const SELF = `http://localhost:${PORT}`;
// Interface réseau : boucle locale seulement (jamais le Wi-Fi). En-têtes Host acceptés : contre le « DNS rebinding »
// (une page d'un autre domaine qui se ferait résoudre en 127.0.0.1 lirait l'API en même origine, sans en-tête Origin).
const HOST = process.env.CLIENT_WALLET_HOST ?? "localhost";
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const root = new URL("..", import.meta.url).pathname;

// Kit de sortie : dépenser avec sa clé sans le site, sans bank-mock, sans compte Swissquote. Seuls ce wallet, sa politique
// enregistrée (données publiques) et un accès à la chaîne Bitcoin sont nécessaires : bitcoind (regtest) ou une API Esplora
// publique (signet), jamais Swissquote.
const chainFor = (n: NetworkName): ChainBackend =>
  n === "regtest" ? new BitcoindBackend(process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443")
    : new EsploraBackend(process.env.ESPLORA_URL ?? "https://blockstream.info/signet/api");

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fp = (n: number) => n.toString(16).padStart(8, "0");

// nSequence BIP68 : délai relatif en blocs si les bits 31 et 22 sont à 0.
const relativeBlocks = (seq: number) => (seq & 0x80000000 || seq & 0x00400000 ? null : seq & 0xffff);

// Décodage du PSBT pour l'écran de confirmation : quel wallet, quel chemin, où va l'argent, combien de frais.
// `nextPolicy` (facultative) : nouvelle politique du compte, envoyée par le site pour un CHANGEMENT DE CONTACT DE CONFIANCE.
// Elle ne sert qu'à reconnaître les sorties de la nouvelle règle (même clé du client, mêmes clés Swissquote : le client y
// dépense toujours seul) et à afficher le nouveau contact. Jamais enregistrée ici : la politique du wallet ne change qu'après
// diffusion, par la demande « policy » du site.
async function describe(psbt: string, network: NetworkName, nextPolicy?: Policy) {
  const tx = btc.Transaction.fromPSBT(base64.decode(psbt.trim()));
  const fps = new Set<string>();
  const inputs = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    for (const [, d] of inp.bip32Derivation ?? []) fps.add(fp((d as any).fingerprint));
    inputs.push({ value: String(inp.witnessUtxo?.amount ?? 0n), delay: relativeBlocks(inp.sequence!) });
  }
  const wallet = load().find((w) => fps.has(w.id));
  const path = inputs.every((i) => i.delay !== null) ? "recovery" : inputs.every((i) => i.delay === null) ? "client" : "mixte";
  let outputs: { address: string; value: string; mine: string | null }[];
  let contactChange: { from: string | null; to: string | null; key: string; delay: number } | null = null;
  if (wallet?.policy) {
    const cfg = await createWalletConfig({ ...wallet.policy, client: wallet.accountKey });
    outputs = simulate(cfg, psbt).outputs.map((o) => ({ address: o.address, value: String(o.value), mine: o.own ? (o.own.change ? "change (this account)" : "this account") : null }));
    if (nextPolicy) {
      if (nextPolicy.network !== wallet.policy.network || nextPolicy.network !== network) throw new HttpError(400, "the new policy is for another network");
      if (nextPolicy.swissquote !== wallet.policy.swissquote || nextPolicy.delay !== wallet.policy.delay) throw new HttpError(400, "a change of trusted contact must keep the same Swissquote key and delay");
      const next = await createWalletConfig({ ...nextPolicy, client: wallet.accountKey }).catch((e) => { throw new HttpError(400, `invalid new policy: ${e.message}`); });
      const nextAddresses = new Set(addresses(next, 60).map((a) => a.address));
      outputs = outputs.map((o) => (!o.mine && nextAddresses.has(o.address) ? { ...o, mine: "new account (new trusted contact)" } : o));
      contactChange = outputs.some((o) => o.mine === "new account (new trusted contact)")
        ? { from: wallet.policy.tiersName ?? null, to: nextPolicy.tiersName ?? null, key: nextPolicy.tiers, delay: nextPolicy.delay }
        : null;
    }
  } else {
    outputs = Array.from({ length: tx.outputsLength }, (_, i) => {
      const o = tx.getOutput(i);
      return { address: btc.Address(btcNetwork(network)).encode(btc.OutScript.decode(o.script!)), value: String(o.amount), mine: null };
    });
  }
  const fee = inputs.reduce((s, i) => s + BigInt(i.value), 0n) - outputs.reduce((s, o) => s + BigInt(o.value), 0n);
  // Montant qui quitte le compte (sorties qui ne sont pas au client ; sans politique connue, toutes les sorties).
  const external = outputs.filter((o) => !o.mine);
  const sent = external.reduce((s, o) => s + BigInt(o.value), 0n);
  const high = sent >= HIGH_VALUE_SATS;
  return { wallet: wallet ? publicView(wallet) : null, path, delay: inputs[0]?.delay ?? null, inputs, outputs, fee: String(fee), sent: String(sent), high, highValueSats: String(HIGH_VALUE_SATS), confirmTarget: high ? external[0]?.address ?? null : null, contactChange };
}

// Opération Ethereum : à quel wallet appartient le Safe, et que fait-elle (décodée ici, sans faire confiance à l'appli).
// Propriétaire lu on-chain si le Safe existe (après une recovery, ce n'est plus la clé qui a servi à le créer),
// sinon déduit de l'adresse (Safe pas encore déployé).
async function describeEvm(op: JsonOp, wallets: StoredWallet[]) {
  if (!op?.sender || !op.callData) throw new HttpError(400, "operation missing");
  const sender = getAddress(op.sender);
  const owners = (await ownersOf(sender).catch(() => { throw new HttpError(502, "cannot read the account on-chain"); })).map((a) => getAddress(a));
  const w = owners.length
    ? wallets.find((x) => x.evmAddress && owners.includes(getAddress(x.evmAddress)))
    : wallets.find((x) => x.evmAddress && safeAddressOf(x.evmAddress as Address) === sender);
  if (!w) throw new HttpError(400, "this operation is not for an account controlled by your wallets");
  // Gardiens actuels, lus on-chain par le wallet lui-même : seule base pour accepter un changement de contact (étape 58).
  const guardians = owners.length ? (await readState(sender).catch(() => { throw new HttpError(502, "cannot read the account on-chain"); })).guardians : [];
  let d;
  try { d = describeOp(op, {}, getAddress(w.evmAddress!), guardians); } catch (e: any) { throw new HttpError(400, `operation not decodable: ${e.message}`); }
  return { wallet: publicView(w), owner: w.evmAddress, ...d };
}

async function api(req: IncomingMessage, body: any): Promise<unknown> {
  const url = new URL(req.url!, SELF);
  const key = `${req.method} ${url.pathname.replace(/\/[0-9a-f]{8}(?=\/|$)/, "/:id")}`;
  const id = url.pathname.match(/\/([0-9a-f]{8})(?:\/|$)/)?.[1];
  const wallets = load();
  switch (key) {
    case "GET /api/wallets":
      return wallets.map(publicView);

    case "POST /api/wallets": {
      const network: NetworkName = body.network === "signet" ? "signet" : "regtest";
      // Les nouveaux wallets sont toujours protégés par la biométrie du device.
      if (body.bio === undefined) throw new HttpError(400, "biometrics required");
      if (!validBio(body.bio)) throw new HttpError(400, "invalid biometric key (passkey with the PRF extension required)");
      const mnemonic = newMnemonic(); // @scure/bip39, 256 bits d'entropie
      const master = masterFromMnemonic(mnemonic, network);
      // Seules les versions chiffrées (PIN et/ou biométrie) sont écrites sur le disque.
      const w: StoredWallet = {
        id: fp(master.fingerprint), label: String(body.label ?? "Mon wallet Bitcoin"),
        bio: sealBio(mnemonic, body.bio),
        accountKey: accountKey(master), evmAddress: evmAddressFromMnemonic(mnemonic), createdAt: new Date().toISOString(),
      };
      save([...wallets, w]);
      // Seule réponse qui contienne la phrase : elle est affichée une fois à l'écran du wallet, puis plus jamais.
      return { wallet: publicView(w), mnemonic };
    }

    case "DELETE /api/wallets/:id": {
      // Effacer un wallet détruit la seule copie de la graine sur l'appareil : biométrie exigée, comme pour signer.
      const w = wallets.find((x) => x.id === id);
      if (!w) throw new HttpError(404, "unknown wallet");
      unlock(w, authOf(body));
      save(wallets.filter((x) => x.id !== id));
      return { deleted: id };
    }

    case "POST /api/wallets/:id/protect": {
      // Ancien wallet en clair : chiffrement biométrique, puis suppression de la phrase en clair.
      const w = wallets.find((x) => x.id === id);
      if (!w) throw new HttpError(404, "unknown wallet");
      if (w.sealed || w.bio) throw new HttpError(409, "wallet already protected");
      if (!validBio(body.bio)) throw new HttpError(400, "invalid biometric key (passkey with the PRF extension required)");
      w.bio = sealBio(w.mnemonic!, body.bio);
      delete w.mnemonic;
      save(wallets);
      return publicView(w);
    }

    case "POST /api/wallets/:id/unlock": {
      // Seule opération : passer à la biométrie (ancien wallet PIN, ou nouvelle passkey), après déverrouillage par la façon
      // déjà active (`auth`). L'ancienne protection PIN est alors supprimée. Plus de PIN choisi ni de biométrie retirée :
      // un PIN de 6 chiffres se casse hors ligne si le fichier est volé (étape 36). `check` vérifie seulement `auth`,
      // avant de créer une passkey (sinon passkey orpheline si le PIN est faux).
      const w = wallets.find((x) => x.id === id);
      if (!w) throw new HttpError(404, "unknown wallet");
      if (!w.sealed && !w.bio) throw new HttpError(409, "wallet not protected: protect it with biometrics first");
      const op = String(body.op);
      if (op !== "set-bio" && op !== "check") throw new HttpError(400, "unknown operation (the wallet only supports switching to biometrics)");
      if (op === "set-bio" && !validBio(body.bio)) throw new HttpError(400, "invalid biometric key (passkey with the PRF extension required)");
      const mnemonic = unlock(w, authOf(body.auth));
      if (op === "check") return { ok: true };
      w.bio = sealBio(mnemonic, body.bio);
      delete w.sealed;
      save(wallets);
      return publicView(w);
    }

    case "POST /api/wallets/:id/policy": {
      // La politique décide quelles sorties le wallet reconnaît comme « à vous » et qui est le contact de confiance.
      // Une appli compromise pourrait y glisser une clé de contact à elle : l'écran du wallet l'affiche (contact, empreintes,
      // délai, changement éventuel) et l'enregistrement exige la biométrie du client, vérifiée ici.
      const w = wallets.find((x) => x.id === id);
      if (!w) throw new HttpError(404, "unknown wallet");
      const q = body.policy ?? {};
      if (!["regtest", "signet"].includes(q.network) || typeof q.swissquote !== "string" || typeof q.tiers !== "string") throw new HttpError(400, "invalid policy");
      const p: Policy = { network: q.network, delay: Number(q.delay), swissquote: q.swissquote.trim(), tiers: q.tiers.trim(), ...(typeof q.tiersName === "string" && q.tiersName.trim() ? { tiersName: q.tiersName.trim().slice(0, 80) } : {}) };
      await createWalletConfig({ ...p, client: w.accountKey }).catch((e) => { throw new HttpError(400, `invalid policy: ${e.message}`); }); // doit compiler avec la clé de ce wallet
      unlock(w, authOf(body));
      w.policy = p;
      save(wallets);
      return publicView(w);
    }

    case "POST /api/wallets/:id/evm": {
      // Wallet créé avant l'étape 17 : calcul de l'adresse Ethereum (la phrase est déchiffrée, en mémoire).
      const w = wallets.find((x) => x.id === id);
      if (!w) throw new HttpError(404, "unknown wallet");
      if (!w.evmAddress) { w.evmAddress = evmAddressFromMnemonic(unlock(w, authOf(body))); save(wallets); }
      return { evmAddress: w.evmAddress };
    }

    case "POST /api/evm/describe":
      return await describeEvm(body.op, wallets);

    case "POST /api/evm/sign": {
      const d = await describeEvm(body.op, wallets);
      const unknown = d.calls.filter((c) => c.kind === "unknown" || c.risk);
      if (unknown.length) throw new HttpError(400, `refused: ${unknown.map((c) => c.risk ?? c.text).join("; ")}`);
      const w = wallets.find((x) => x.id === d.wallet.id)!;
      const { privateKey, account } = evmAccountFromMnemonic(unlock(w, authOf(body)));
      if (getAddress(account.address) !== getAddress(w.evmAddress!)) throw new HttpError(500, "derived key does not match the wallet's address");
      return { signature: signOp(body.op as JsonOp, privateKey) };
    }

    case "POST /api/describe":
      return describe(body.psbt, body.network, body.nextPolicy);

    case "POST /api/prove": {
      // Preuve de propriété : signature BIP-322 « simple » d'un défi par la clé CLIENT à (change, index),
      // pour l'adresse P2WPKH de cette clé (bip322-js ne gère pas P2WSH). Ne déplace aucun fonds.
      const w = wallets.find((x) => x.accountKey === body.accountKey);
      if (!w) throw new HttpError(404, "no wallet on this device matches this account");
      const change = Number(body.change), index = Number(body.index);
      if (![0, 1].includes(change) || !Number.isInteger(index) || index < 0 || index > 1_000_000) throw new HttpError(400, "invalid key path");
      if (typeof body.message !== "string" || body.message.length > 1000) throw new HttpError(400, "invalid message");
      const network: NetworkName = body.network === "signet" ? "signet" : "regtest";
      const child = masterFromMnemonic(unlock(w, authOf(body)), network).derive(`m/48'/1'/0'/2'/${change}/${index}`);
      const keyAddress = keyAddressOf(child.publicKey!, network);
      const wif = btc.WIF(btcNetwork(network)).encode(child.privateKey!);
      return { signature: Signer.sign(wif, keyAddress, body.message), keyAddress };
    }

    case "POST /api/exit/prepare": {
      // Sortie d'urgence : tous les coins du wallet vers l'adresse choisie, par le chemin « votre clé seule ». Le PSBT passe
      // ensuite par le même écran de confirmation et la même signature biométrique que tout envoi (/api/describe, /api/sign).
      const w = wallets.find((x) => x.id === body.walletId);
      if (!w) throw new HttpError(404, "unknown wallet");
      if (!w.policy) throw new HttpError(409, "this wallet has no saved account policy: create or recover the account first");
      const net = w.policy.network;
      const cfg = await createWalletConfig({ ...w.policy, client: w.accountKey });
      const chain = chainFor(net);
      const utxos = await scan(cfg, chain).catch((e) => { throw new HttpError(502, `cannot read the Bitcoin network: ${e.message}`); });
      if (!utxos.length) throw new HttpError(409, "no coins found for this wallet on this network");
      const feeRate = body.feeRate === undefined ? (await chain.feeRates().catch(() => ({ normal: 2 }))).normal : Number(body.feeRate);
      if (!(feeRate >= 1 && feeRate <= 1000)) throw new HttpError(400, "invalid fee rate (1 to 1000 sat/vB)");
      const spend = await buildSpend({ cfg, backend: chain, utxos, path: "client", feeRate, to: String(body.to ?? "").trim() }).catch((e) => { throw new HttpError(400, e.message); });
      return { psbt: spend.psbt, network: net, coins: utxos.length, total: String(utxos.reduce((s, u) => s + u.value, 0n)) };
    }

    case "POST /api/exit/broadcast": {
      const w = wallets.find((x) => x.id === body.walletId);
      if (!w?.policy) throw new HttpError(404, "unknown wallet or no saved account policy");
      const d = await describe(body.psbt, w.policy.network);
      if (d.wallet?.id !== w.id || d.path !== "client") throw new HttpError(400, "this PSBT is not a client-path spend of this wallet");
      const cfg = await createWalletConfig({ ...w.policy, client: w.accountKey });
      let hex: string;
      try { hex = finalizePsbt(cfg, body.psbt).hex; } catch (e: any) { throw new HttpError(400, `PSBT not fully signed: ${e.message}`); }
      return { txid: await chainFor(w.policy.network).broadcast(hex).catch((e) => { throw new HttpError(502, `rejected by the network: ${e.message}`); }) };
    }

    case "POST /api/sign": {
      const d = await describe(body.psbt, body.network, body.nextPolicy);
      if (!d.wallet) throw new HttpError(400, "this PSBT spends no coin of your wallets");
      if (d.path !== "client") throw new HttpError(400, "this PSBT uses the recovery path (Swissquote + trusted contact): your wallet must not sign it");
      const w = wallets.find((x) => x.id === d.wallet!.id)!;
      // Montant élevé : le client ressaisit les 6 derniers caractères de l'adresse de destination (contre une adresse substituée).
      // Un seul destinataire externe dans ce cas : sinon la saisie ne vérifierait que l'un d'eux, et une autre sortie pourrait
      // emporter l'essentiel du montant vers une adresse jamais confirmée.
      if (d.high && d.outputs.filter((o) => !o.mine).length > 1)
        throw new HttpError(400, "high-value amount to several recipients: send to one recipient at a time");
      if (d.high && String(body.confirmDest ?? "").trim().toLowerCase() !== d.confirmTarget!.slice(-6).toLowerCase())
        throw new HttpError(400, "high-value amount: enter the last 6 characters of the destination address");
      const r = signPsbtWithMnemonic(body.psbt, unlock(w, authOf(body)), body.network);
      if (r.added === 0) throw new HttpError(400, "no input signable by this wallet");
      return r;
    }
  }
  throw new HttpError(404, `unknown route: ${key}`);
}

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (!HOSTS.has(String(req.headers.host))) return send(403, { error: `host rejected: ${req.headers.host}` });
  if (!req.url?.startsWith("/api/")) return vite.middlewares(req, res);
  // Aucune en-tête CORS : seule l'interface du wallet (même origine) ou un outil local peut appeler l'API.
  // Un navigateur envoie toujours Origin sur un POST d'une autre origine : il est refusé AVANT exécution.
  const origin = req.headers.origin;
  if (origin && origin !== SELF) return send(403, { error: `origin rejected: ${origin}` });
  // Un POST « simple » (text/plain, formulaire) n'est pas précédé d'un contrôle CORS : on exige du JSON.
  if (req.method === "POST" && !/^application\/json(;|$)/.test(String(req.headers["content-type"] ?? ""))) return send(415, { error: "application/json required" });
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > 1_000_000) { res.setHeader("connection", "close"); return send(413, { error: "request too large" }); } }
  let body: any = {};
  if (raw) { try { body = JSON.parse(raw); } catch { return send(400, { error: "invalid JSON" }); } }
  try { send(200, await api(req, body ?? {})); }
  catch (e: any) { send(e instanceof HttpError ? e.status : 500, { error: e.message }); }
});
// Interface servie par Vite dans CE processus ; le rechargement à chaud passe par le même serveur HTTP (pas de port en plus).
const vite = await createVite({ root, configFile: false, envDir: "..", plugins: [react()], server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
server.listen(PORT, HOST, () => console.log(`[wallet du client] ${SELF} (interface ${HOST})`));
