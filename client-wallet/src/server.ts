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
import { type Policy, type StoredWallet, load, publicView, save } from "./store.ts";

const PORT = Number(process.env.CLIENT_WALLET_PORT ?? 5180);
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
    outputs = simulate(cfg, psbt).outputs.map((o) => ({ address: o.address, value: String(o.value), mine: o.own ? (o.own.change ? "change (votre compte)" : "votre compte") : null }));
  } else {
    outputs = Array.from({ length: tx.outputsLength }, (_, i) => {
      const o = tx.getOutput(i);
      return { address: btc.Address(btcNetwork(network)).encode(btc.OutScript.decode(o.script!)), value: String(o.amount), mine: null };
    });
  }
  const fee = inputs.reduce((s, i) => s + BigInt(i.value), 0n) - outputs.reduce((s, o) => s + BigInt(o.value), 0n);
  return { wallet: wallet ? publicView(wallet) : null, path, delay: inputs[0]?.delay ?? null, inputs, outputs, fee: String(fee) };
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
      const mnemonic = newMnemonic(); // @scure/bip39, 256 bits d'entropie
      const master = masterFromMnemonic(mnemonic, network);
      const w: StoredWallet = { id: fp(master.fingerprint), label: String(body.label ?? "Mon wallet Bitcoin"), mnemonic, accountKey: accountKey(master), createdAt: new Date().toISOString() };
      save([...wallets, w]);
      // Seule réponse qui contienne la phrase : elle est affichée une fois à l'écran du wallet, puis plus jamais.
      return { wallet: publicView(w), mnemonic };
    }

    case "DELETE /api/wallets/:id": {
      if (!wallets.some((w) => w.id === id)) throw new HttpError(404, "wallet inconnu");
      save(wallets.filter((w) => w.id !== id));
      return { deleted: id };
    }

    case "POST /api/wallets/:id/policy": {
      const w = wallets.find((x) => x.id === id);
      if (!w) throw new HttpError(404, "wallet inconnu");
      const p = body.policy as Policy;
      await createWalletConfig({ ...p, client: w.accountKey }); // la politique doit compiler avec la clé de ce wallet
      w.policy = p;
      save(wallets);
      return publicView(w);
    }

    case "POST /api/describe":
      return describe(body.psbt, body.network);

    case "POST /api/prove": {
      // Preuve de propriété : signature BIP-322 « simple » d'un défi par la clé CLIENT à (change, index),
      // pour l'adresse P2WPKH de cette clé (bip322-js ne gère pas P2WSH). Ne déplace aucun fonds.
      const w = wallets.find((x) => x.accountKey === body.accountKey);
      if (!w) throw new HttpError(404, "aucun wallet de cet appareil ne correspond à ce compte");
      const change = Number(body.change), index = Number(body.index);
      if (![0, 1].includes(change) || !Number.isInteger(index) || index < 0 || index > 1_000_000) throw new HttpError(400, "chemin de clé invalide");
      if (typeof body.message !== "string" || body.message.length > 1000) throw new HttpError(400, "message invalide");
      const network: NetworkName = body.network === "signet" ? "signet" : "regtest";
      const child = masterFromMnemonic(w.mnemonic, network).derive(`m/48'/1'/0'/2'/${change}/${index}`);
      const keyAddress = keyAddressOf(child.publicKey!, network);
      const wif = btc.WIF(btcNetwork(network)).encode(child.privateKey!);
      return { signature: Signer.sign(wif, keyAddress, body.message), keyAddress };
    }

    case "POST /api/sign": {
      const d = await describe(body.psbt, body.network);
      if (!d.wallet) throw new HttpError(400, "ce PSBT ne dépense aucun coin de vos wallets");
      if (d.path !== "client") throw new HttpError(400, "ce PSBT utilise le chemin de recovery (Swissquote + tiers) : votre wallet n'a pas à le signer");
      const w = wallets.find((x) => x.id === d.wallet!.id)!;
      const r = signPsbtWithMnemonic(body.psbt, w.mnemonic, body.network);
      if (r.added === 0) throw new HttpError(400, "aucune entrée signable par ce wallet");
      return r;
    }
  }
  throw new HttpError(404, `route inconnue : ${key}`);
}

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/api/")) return vite.middlewares(req, res);
  const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  // Aucune en-tête CORS : seule l'interface du wallet (même origine) ou un outil local peut appeler l'API.
  // Un navigateur envoie toujours Origin sur un POST d'une autre origine : il est refusé AVANT exécution.
  const origin = req.headers.origin;
  if (origin && origin !== SELF) return send(403, { error: `origine refusée : ${origin}` });
  // Un POST « simple » (text/plain, formulaire) n'est pas précédé d'un contrôle CORS : on exige du JSON.
  if (req.method === "POST" && req.headers["content-type"] !== "application/json") return send(415, { error: "application/json requis" });
  let raw = "";
  for await (const c of req) raw += c;
  try { send(200, await api(req, raw ? JSON.parse(raw) : {})); }
  catch (e: any) { send(e instanceof HttpError ? e.status : 500, { error: e.message }); }
});
// Interface servie par Vite dans CE processus ; le rechargement à chaud passe par le même serveur HTTP (pas de port en plus).
const vite = await createVite({ root, configFile: false, envDir: "..", plugins: [react()], server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
server.listen(PORT, () => console.log(`[wallet du client] ${SELF}`));
