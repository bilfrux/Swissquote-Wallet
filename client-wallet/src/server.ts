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
import { type NetworkName, btcNetwork, createWalletConfig, keyAddressOf, simulate } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { type JsonOp, describeOp, safeAddressOf, signOp } from "@sq/evm";
import { evmAccountFromMnemonic, evmAddressFromMnemonic } from "@sq/evm/keys";
import { getAddress, type Address } from "viem";
import { type Policy, type StoredWallet, load, publicView, save } from "./store.ts";
import { open, seal, validPin } from "./vault.ts";

// Déverrouillage par code PIN : 5 essais, puis blocage de 60 s (compteur en mémoire du processus).
const attempts = new Map<string, { fails: number; until: number }>();
function unlock(w: StoredWallet, pin: unknown): string {
  if (!w.sealed) return w.mnemonic!; // wallet « non protégé » (créé avant l'étape 8)
  const a = attempts.get(w.id) ?? { fails: 0, until: 0 };
  if (a.until > Date.now()) throw new HttpError(429, `wallet locked after 5 incorrect PINs: try again in ${Math.ceil((a.until - Date.now()) / 1000)} s`);
  try {
    if (!validPin(pin)) throw new Error("format");
    const m = open(w.sealed, pin);
    attempts.delete(w.id);
    return m;
  } catch {
    a.fails += 1;
    if (a.fails >= 5) { a.fails = 0; a.until = Date.now() + 60_000; }
    attempts.set(w.id, a);
    throw new HttpError(403, a.until > Date.now() ? "incorrect PIN: wallet locked for 60 s" : `incorrect PIN (${5 - a.fails} attempt(s) left)`);
  }
}

const PORT = Number(process.env.CLIENT_WALLET_PORT ?? 5180);
// Au-delà de ce montant envoyé vers l'extérieur, le wallet exige une confirmation renforcée (en plus du PIN).
const HIGH_VALUE_SATS = BigInt(process.env.CLIENT_WALLET_HIGH_VALUE_SATS ?? 20_000_000);
const SELF = `http://localhost:${PORT}`;
const root = new URL("..", import.meta.url).pathname;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fp = (n: number) => n.toString(16).padStart(8, "0");

// nSequence BIP68 : délai relatif en blocs si les bits 31 et 22 sont à 0.
const relativeBlocks = (seq: number) => (seq & 0x80000000 || seq & 0x00400000 ? null : seq & 0xffff);

// Décodage du PSBT pour l'écran de confirmation : quel wallet, quel chemin, où va l'argent, combien de frais.
async function describe(psbt: string, network: NetworkName) {
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
  if (wallet?.policy) {
    const cfg = await createWalletConfig({ ...wallet.policy, client: wallet.accountKey });
    outputs = simulate(cfg, psbt).outputs.map((o) => ({ address: o.address, value: String(o.value), mine: o.own ? (o.own.change ? "change (this account)" : "this account") : null }));
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
  return { wallet: wallet ? publicView(wallet) : null, path, delay: inputs[0]?.delay ?? null, inputs, outputs, fee: String(fee), sent: String(sent), high, highValueSats: String(HIGH_VALUE_SATS), confirmTarget: high ? external[0]?.address ?? null : null };
}

// Opération Ethereum : à quel wallet appartient le Safe, et que fait-elle (décodée ici, sans faire confiance à l'appli).
function describeEvm(op: JsonOp, wallets: StoredWallet[]) {
  if (!op?.sender || !op.callData) throw new HttpError(400, "operation missing");
  const sender = getAddress(op.sender);
  const w = wallets.find((x) => x.evmAddress && safeAddressOf(x.evmAddress as Address) === sender);
  if (!w) throw new HttpError(400, "this operation is not for an account of your wallets");
  let d;
  try { d = describeOp(op); } catch (e: any) { throw new HttpError(400, `operation not decodable: ${e.message}`); }
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
      if (!validPin(body.pin)) throw new HttpError(400, "PIN required: 6 to 12 digits");
      const mnemonic = newMnemonic(); // @scure/bip39, 256 bits d'entropie
      const master = masterFromMnemonic(mnemonic, network);
      // Seule la version chiffrée par le PIN est écrite sur le disque.
      const w: StoredWallet = { id: fp(master.fingerprint), label: String(body.label ?? "Mon wallet Bitcoin"), sealed: seal(mnemonic, body.pin), accountKey: accountKey(master), evmAddress: evmAddressFromMnemonic(mnemonic), createdAt: new Date().toISOString() };
      save([...wallets, w]);
      // Seule réponse qui contienne la phrase : elle est affichée une fois à l'écran du wallet, puis plus jamais.
      return { wallet: publicView(w), mnemonic };
    }

    case "DELETE /api/wallets/:id": {
      if (!wallets.some((w) => w.id === id)) throw new HttpError(404, "unknown wallet");
      save(wallets.filter((w) => w.id !== id));
      return { deleted: id };
    }

    case "POST /api/wallets/:id/protect": {
      // Ancien wallet en clair : chiffrement par un code PIN, puis suppression de la phrase en clair.
      const w = wallets.find((x) => x.id === id);
      if (!w) throw new HttpError(404, "unknown wallet");
      if (w.sealed) throw new HttpError(409, "wallet already protected by a PIN");
      if (!validPin(body.pin)) throw new HttpError(400, "PIN required: 6 to 12 digits");
      w.sealed = seal(w.mnemonic!, body.pin);
      delete w.mnemonic;
      save(wallets);
      return publicView(w);
    }

    case "POST /api/wallets/:id/policy": {
      const w = wallets.find((x) => x.id === id);
      if (!w) throw new HttpError(404, "unknown wallet");
      const p = body.policy as Policy;
      await createWalletConfig({ ...p, client: w.accountKey }); // la politique doit compiler avec la clé de ce wallet
      w.policy = p;
      save(wallets);
      return publicView(w);
    }

    case "POST /api/wallets/:id/evm": {
      // Wallet créé avant l'étape 17 : calcul de l'adresse Ethereum (la phrase est déchiffrée par le PIN, en mémoire).
      const w = wallets.find((x) => x.id === id);
      if (!w) throw new HttpError(404, "unknown wallet");
      if (!w.evmAddress) { w.evmAddress = evmAddressFromMnemonic(unlock(w, body.pin)); save(wallets); }
      return { evmAddress: w.evmAddress };
    }

    case "POST /api/evm/describe":
      return describeEvm(body.op, wallets);

    case "POST /api/evm/sign": {
      const d = describeEvm(body.op, wallets);
      const unknown = d.calls.filter((c) => c.kind === "unknown" || c.risk);
      if (unknown.length) throw new HttpError(400, `refused: ${unknown.map((c) => c.risk ?? c.text).join("; ")}`);
      const w = wallets.find((x) => x.id === d.wallet.id)!;
      const { privateKey, account } = evmAccountFromMnemonic(unlock(w, body.pin));
      if (getAddress(account.address) !== getAddress(w.evmAddress!)) throw new HttpError(500, "derived key does not match the wallet's address");
      return { signature: signOp(body.op as JsonOp, privateKey) };
    }

    case "POST /api/describe":
      return describe(body.psbt, body.network);

    case "POST /api/prove": {
      // Preuve de propriété : signature BIP-322 « simple » d'un défi par la clé CLIENT à (change, index),
      // pour l'adresse P2WPKH de cette clé (bip322-js ne gère pas P2WSH). Ne déplace aucun fonds.
      const w = wallets.find((x) => x.accountKey === body.accountKey);
      if (!w) throw new HttpError(404, "no wallet on this device matches this account");
      const change = Number(body.change), index = Number(body.index);
      if (![0, 1].includes(change) || !Number.isInteger(index) || index < 0 || index > 1_000_000) throw new HttpError(400, "invalid key path");
      if (typeof body.message !== "string" || body.message.length > 1000) throw new HttpError(400, "invalid message");
      const network: NetworkName = body.network === "signet" ? "signet" : "regtest";
      const child = masterFromMnemonic(unlock(w, body.pin), network).derive(`m/48'/1'/0'/2'/${change}/${index}`);
      const keyAddress = keyAddressOf(child.publicKey!, network);
      const wif = btc.WIF(btcNetwork(network)).encode(child.privateKey!);
      return { signature: Signer.sign(wif, keyAddress, body.message), keyAddress };
    }

    case "POST /api/sign": {
      const d = await describe(body.psbt, body.network);
      if (!d.wallet) throw new HttpError(400, "this PSBT spends no coin of your wallets");
      if (d.path !== "client") throw new HttpError(400, "this PSBT uses the recovery path (Swissquote + trusted contact): your wallet must not sign it");
      const w = wallets.find((x) => x.id === d.wallet!.id)!;
      // Montant élevé : le client ressaisit les 6 derniers caractères de l'adresse de destination (contre une adresse substituée).
      if (d.high && String(body.confirmDest ?? "").trim().toLowerCase() !== d.confirmTarget!.slice(-6).toLowerCase())
        throw new HttpError(400, "high-value amount: enter the last 6 characters of the destination address");
      const r = signPsbtWithMnemonic(body.psbt, unlock(w, body.pin), body.network);
      if (r.added === 0) throw new HttpError(400, "no input signable by this wallet");
      return r;
    }
  }
  throw new HttpError(404, `unknown route: ${key}`);
}

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/api/")) return vite.middlewares(req, res);
  const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  // Aucune en-tête CORS : seule l'interface du wallet (même origine) ou un outil local peut appeler l'API.
  // Un navigateur envoie toujours Origin sur un POST d'une autre origine : il est refusé AVANT exécution.
  const origin = req.headers.origin;
  if (origin && origin !== SELF) return send(403, { error: `origin rejected: ${origin}` });
  // Un POST « simple » (text/plain, formulaire) n'est pas précédé d'un contrôle CORS : on exige du JSON.
  if (req.method === "POST" && req.headers["content-type"] !== "application/json") return send(415, { error: "application/json required" });
  let raw = "";
  for await (const c of req) raw += c;
  try { send(200, await api(req, raw ? JSON.parse(raw) : {})); }
  catch (e: any) { send(e instanceof HttpError ? e.status : 500, { error: e.message }); }
});
// Interface servie par Vite dans CE processus ; le rechargement à chaud passe par le même serveur HTTP (pas de port en plus).
const vite = await createVite({ root, configFile: false, envDir: "..", plugins: [react()], server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
server.listen(PORT, () => console.log(`[wallet du client] ${SELF}`));
