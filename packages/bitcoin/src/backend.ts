// Accès à la chaîne : Esplora (signet) ou RPC bitcoind (regtest). Aucune dépendance à Swissquote.
export type ChainUtxo = { txid: string; vout: number; value: bigint; height: number | null; address: string };

export interface ChainBackend {
  tipHeight(): Promise<number>;
  utxos(addresses: string[]): Promise<ChainUtxo[]>;
  txHex(txid: string): Promise<string>;
  // Diffuse et renvoie le txid, ou lève l'erreur réelle renvoyée par le nœud.
  broadcast(hex: string): Promise<string>;
}

export class EsploraBackend implements ChainBackend {
  constructor(private base: string) {}
  private async get(path: string, init?: RequestInit) {
    const r = await fetch(this.base + path, init);
    const body = await r.text();
    if (!r.ok) throw new Error(body || `HTTP ${r.status}`);
    return body;
  }
  async tipHeight() {
    return Number(await this.get("/blocks/tip/height"));
  }
  async utxos(addresses: string[]) {
    const out: ChainUtxo[] = [];
    for (const address of addresses) {
      const list = JSON.parse(await this.get(`/address/${address}/utxo`));
      for (const u of list)
        out.push({ txid: u.txid, vout: u.vout, value: BigInt(u.value), height: u.status.confirmed ? u.status.block_height : null, address });
    }
    return out;
  }
  txHex(txid: string) {
    return this.get(`/tx/${txid}/hex`);
  }
  broadcast(hex: string) {
    return this.get("/tx", { method: "POST", body: hex });
  }
}

// RPC bitcoind. `url` peut contenir les identifiants (Node) ou pointer vers un proxy qui les ajoute (navigateur).
export class BitcoindBackend implements ChainBackend {
  private endpoint: string;
  private auth?: string;
  // bitcoind n'accepte qu'un scantxoutset à la fois (« Scan already in progress ») : file d'attente.
  private scanQueue: Promise<unknown> = Promise.resolve();
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
}
