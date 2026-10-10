// Accès à la chaîne : Esplora (signet) ou RPC bitcoind (regtest). Aucune dépendance à Swissquote.
export type ChainUtxo = { txid: string; vout: number; value: bigint; height: number | null; address: string };

// Transaction brute touchant le compte : entrées (avec la valeur et l'adresse dépensées) et sorties.
export type ChainTx = {
  txid: string;
  height: number | null; // null : en attente (mempool)
  time: number | null; // horodatage du bloc (s)
  fee: bigint | null;
  vin: { address: string | null; value: bigint; sequence: number }[];
  vout: { address: string | null; value: bigint }[];
};
// Taux de frais en sat/vB : rapide (~1 bloc), normal (~3 blocs), économique (~1 jour).
export type FeeRates = { fast: number; normal: number; slow: number; source: "réseau" | "par défaut" };
// Minimum de relais par défaut des nœuds Bitcoin Core : 1 sat/vB.
export const MIN_RELAY_FEE = 1;
const floorRate = (r: number | undefined, fallback: number) => Math.max(MIN_RELAY_FEE, Math.ceil(((r ?? fallback) || fallback) * 10) / 10);

export interface ChainBackend {
  tipHeight(): Promise<number>;
  utxos(addresses: string[]): Promise<ChainUtxo[]>;
  txHex(txid: string): Promise<string>;
  // Diffuse et renvoie le txid, ou lève l'erreur réelle renvoyée par le nœud.
  broadcast(hex: string): Promise<string>;
  // Transactions touchant ces adresses. `descriptors` : descripteurs PUBLICS du compte (utiles au backend bitcoind).
  history(addresses: string[], descriptors: string[]): Promise<ChainTx[]>;
  feeRates(): Promise<FeeRates>;
  // Facultatif : l'adresse a-t-elle déjà servi ? Permet une découverte par limite d'écart (gap limit) au lieu d'un nombre fixe.
  isUsed?(address: string): Promise<boolean>;
}

export class EsploraBackend implements ChainBackend {
  constructor(private base: string) {}
  // API publique limitée (ex. 700 requêtes/heure/IP chez blockstream) : cache court des lectures par adresse.
  private cache = new Map<string, { t: number; v: Promise<any> }>();
  private cached(path: string, ttl = 20_000): Promise<any> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    const v = this.get(path).then((b) => JSON.parse(b));
    v.catch(() => this.cache.delete(path));
    this.cache.set(path, { t: Date.now(), v });
    return v;
  }
  async isUsed(address: string) {
    return (await this.cached(`/address/${address}/txs`)).length > 0;
  }
  private async get(path: string, init?: RequestInit) {
    const r = await fetch(this.base + path, init);
    const body = await r.text();
    if (!r.ok) throw new Error(body || `HTTP ${r.status}`);
    return body;
  }
  async tipHeight() {
    return Number(await this.cached("/blocks/tip/height", 10_000));
  }
  async utxos(addresses: string[]) {
    const out: ChainUtxo[] = [];
    for (const address of addresses) {
      if (!(await this.isUsed(address))) continue; // adresse jamais utilisée : pas d'UTXO, pas de requête de plus
      const list = await this.cached(`/address/${address}/utxo`, 5_000);
      for (const u of list)
        out.push({ txid: u.txid, vout: u.vout, value: BigInt(u.value), height: u.status.confirmed ? u.status.block_height : null, address });
    }
    return out;
  }
  txHex(txid: string) {
    return this.get(`/tx/${txid}/hex`);
  }
  broadcast(hex: string) {
    this.cache.clear(); // après une diffusion, relire l'état réel
    return this.get("/tx", { method: "POST", body: hex });
  }
  async history(addresses: string[]) {
    const seen = new Map<string, ChainTx>();
    for (const a of addresses) {
      for (const t of await this.cached(`/address/${a}/txs`)) {
        if (seen.has(t.txid)) continue;
        seen.set(t.txid, {
          txid: t.txid,
          height: t.status.confirmed ? t.status.block_height : null,
          time: t.status.block_time ?? null,
          fee: t.fee !== undefined ? BigInt(t.fee) : null,
          vin: t.vin.map((i: any) => ({ address: i.prevout?.scriptpubkey_address ?? null, value: BigInt(i.prevout?.value ?? 0), sequence: i.sequence })),
          vout: t.vout.map((o: any) => ({ address: o.scriptpubkey_address ?? null, value: BigInt(o.value) })),
        });
      }
    }
    return [...seen.values()];
  }
  async feeRates(): Promise<FeeRates> {
    const e = await this.cached("/fee-estimates", 60_000);
    return { fast: floorRate(e["1"], 2), normal: floorRate(e["3"] ?? e["6"], 1), slow: floorRate(e["144"], 1), source: "réseau" };
  }
}

// RPC bitcoind. `url` peut contenir les identifiants (Node) ou pointer vers un proxy qui les ajoute (navigateur).
export class BitcoindBackend implements ChainBackend {
  private endpoint: string;
  private auth?: string;
  // bitcoind n'accepte qu'un scantxoutset à la fois (« Scan already in progress ») : file d'attente.
  private scanQueue: Promise<unknown> = Promise.resolve();
  // Création / chargement du wallet lecture seule : sérialisé (pas de double création concurrente).
  private walletQueue: Promise<unknown> = Promise.resolve();
  constructor(url: string) {
    const u = new URL(url, typeof location !== "undefined" ? location.href : undefined);
    if (u.username) this.auth = "Basic " + btoa(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`);
    u.username = "";
    u.password = "";
    this.endpoint = u.toString();
  }
  async call(method: string, params: unknown[] = [], wallet?: string): Promise<any> {
    const url = wallet ? this.endpoint.replace(/\/?$/, `/wallet/${wallet}`) : this.endpoint;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain", ...(this.auth ? { authorization: this.auth } : {}) },
      body: JSON.stringify({ jsonrpc: "1.0", id: method, method, params }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  }
  async tipHeight() {
    return (await this.call("getblockcount")) as number;
  }
  async utxos(addresses: string[]) {
    // scantxoutset ne voit que les UTXO confirmés ; on retrouve l'adresse par le scriptPubKey.
    const spk = new Map<string, string>();
    for (const a of addresses) spk.set((await this.call("validateaddress", [a])).scriptPubKey, a);
    const scanning = this.scanQueue.then(() => this.call("scantxoutset", ["start", addresses.map((a) => `addr(${a})`)]));
    this.scanQueue = scanning.catch(() => undefined);
    const r = await scanning;
    return r.unspents.map((u: any) => ({
      txid: u.txid,
      vout: u.vout,
      value: BigInt(Math.round(u.amount * 1e8)),
      height: u.height,
      address: spk.get(u.scriptPubKey) ?? "",
    }));
  }
  txHex(txid: string) {
    return this.call("getrawtransaction", [txid]);
  }
  async broadcast(hex: string) {
    const [r] = await this.call("testmempoolaccept", [[hex]]);
    if (!r.allowed) throw new Error(r["reject-reason"]);
    return this.call("sendrawtransaction", [hex]);
  }
  // bitcoind n'indexe pas les adresses : wallet « lecture seule » (descripteurs PUBLICS, aucune clé privée),
  // créé une fois par compte, qui liste les transactions du compte.
  async history(_addresses: string[], descriptors: string[]) {
    const infos = await Promise.all(descriptors.map((d) => this.call("getdescriptorinfo", [d])));
    const name = `sq-watch-${infos.map((i) => i.checksum).join("")}`;
    const ensure = this.walletQueue.then(async () => {
      const loaded: string[] = await this.call("listwallets");
      if (loaded.includes(name)) return;
      // Existence vérifiée sans provoquer d'erreur (listwalletdir), puis chargement ou création.
      const onDisk: string[] = (await this.call("listwalletdir")).wallets.map((w: any) => w.name);
      if (onDisk.includes(name)) return this.call("loadwallet", [name]);
      await this.call("createwallet", [name, true, true, "", false, true]);
      await this.call("importdescriptors", [infos.map((i, k) => ({ desc: `${descriptors[k]}#${i.checksum}`, range: [0, 49], timestamp: 0, active: false }))], name);
    });
    this.walletQueue = ensure.catch(() => undefined);
    await ensure;
    // listsinceblock avec include_change : listtransactions masque les envois à soi-même (rafraîchissements).
    const since = await this.call("listsinceblock", ["", 1, true, false, true], name);
    const listed: any[] = since.transactions;
    const tip = await this.tipHeight();
    const out: ChainTx[] = [];
    for (const txid of [...new Set(listed.map((l) => l.txid as string))]) {
      const t = await this.call("getrawtransaction", [txid, 2]);
      // En mempool, `prevout` n'est pas fourni : on lit la sortie dépensée dans la transaction précédente.
      for (const i of t.vin) {
        if (!i.prevout && i.txid) {
          const prev = await this.call("getrawtransaction", [i.txid, 1]);
          const o = prev.vout[i.vout];
          i.prevout = { value: o.value, scriptPubKey: o.scriptPubKey };
        }
      }
      out.push({
        txid,
        height: t.confirmations ? tip - t.confirmations + 1 : null,
        time: t.blocktime ?? null,
        fee: t.fee !== undefined ? BigInt(Math.round(t.fee * 1e8)) : null,
        vin: t.vin.map((i: any) => ({ address: i.prevout?.scriptPubKey?.address ?? null, value: BigInt(Math.round((i.prevout?.value ?? 0) * 1e8)), sequence: i.sequence })),
        vout: t.vout.map((o: any) => ({ address: o.scriptPubKey?.address ?? null, value: BigInt(Math.round(o.value * 1e8)) })),
      });
    }
    return out;
  }
  // regtest : pas assez de transactions pour une estimation ; valeurs par défaut si estimatesmartfee n'en donne pas.
  async feeRates(): Promise<FeeRates> {
    const est = async (n: number) => { const r = await this.call("estimatesmartfee", [n]); return r.feerate ? r.feerate * 1e5 : undefined; };
    const [f, m, l] = await Promise.all([est(1), est(3), est(144)]);
    if (f === undefined && m === undefined) return { fast: 5, normal: 2, slow: 1, source: "par défaut" };
    return { fast: floorRate(f, 5), normal: floorRate(m, 2), slow: floorRate(l, 1), source: "réseau" };
  }
}
