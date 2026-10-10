// Création du wallet Bitcoin : le client désigne son tiers, puis son « Wallet du client » (appli séparée) génère
// la graine chez lui et ne renvoie que la clé publique. L'appli compile la politique et l'enregistre chez Swissquote.
import { useState } from "react";
import { createWalletConfig, parseAccountKey } from "@sq/bitcoin";
import { fetchSwissquoteKey, registerAccount } from "../lib/bank";
import { type BtcAccount, DELAY, NETWORK } from "../lib/config";
import { walletRequest } from "../lib/walletBridge";

const CONSOLE_URL = import.meta.env.VITE_GUARDIAN_CONSOLE_URL ?? "http://localhost:5174";

export function CreateWallet({ onCreated }: { onCreated: (a: BtcAccount) => void }) {
  const [tiersName, setTiersName] = useState("");
  const [tiersKey, setTiersKey] = useState("");
  const [ownKey, setOwnKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (source: "wallet" | "paste") => {
    setError(null);
    try {
      setStatus("Fetching Swissquote's public key…");
      const swissquote = await fetchSwissquoteKey();
      // Clé du tiers vérifiée AVANT d'ouvrir le wallet : pas de graine créée pour rien.
      parseAccountKey(tiersKey, NETWORK);
      let client = ownKey.trim();
      let walletId: string | undefined;
      if (source === "wallet") {
        setStatus("Creating your wallet in the “Client Wallet” window…");
        const r = await walletRequest<{ accountKey: string; walletId: string }>("create", { label: "Wallet Bitcoin Swissquote" });
        client = r.accountKey;
        walletId = r.walletId;
      }
      const cfg = await createWalletConfig({ network: NETWORK, delay: DELAY, client, swissquote, tiers: tiersKey });
      setStatus("Registering with Swissquote…");
      const { accountId } = await registerAccount({ delay: DELAY, client: cfg.client.raw, tiers: cfg.tiers.raw, tiersName });
      const account: BtcAccount = { id: accountId, client: cfg.client.raw, swissquote, tiers: cfg.tiers.raw, tiersName, delay: DELAY, walletId };
      if (walletId) {
        setStatus("Saving the policy in your wallet…");
        await walletRequest("policy", { walletId, policy: { network: NETWORK, delay: DELAY, swissquote, tiers: cfg.tiers.raw, tiersName } });
      }
      setStatus(null);
      onCreated(account);
    } catch (e: any) {
      setStatus(null);
      setError(e.message);
    }
  };
  const tiersReady = tiersName.trim().length > 0 && tiersKey.trim().length > 0;

  return (
    <section>
      <h2>Create my Bitcoin wallet</h2>
      <ul className="promise">
        <li><strong>Only you hold the key.</strong> It is created in your Client Wallet; Swissquote never sees it.</li>
        <li><strong>You spend on your own, at any time</strong>, even if Swissquote is unavailable.</li>
        <li><strong>If you lose your wallet</strong>, Swissquote and your trusted contact can together move your bitcoin to a new wallet, but only for coins that have not moved for {DELAY} blocks. The Bitcoin network enforces this; Swissquote can do nothing on its own.</li>
      </ul>

      <div className="step">
        <h3>1. Your trusted contact</h3>
        <p className="note">A person you trust, independent of Swissquote (relative, notary…). They create their key in the <a href={CONSOLE_URL} target="_blank" rel="noreferrer">guardian console</a> and send you their public key.</p>
        <div className="row two">
          <label><span>Name</span><input value={tiersName} onChange={(e) => setTiersName(e.target.value)} placeholder="Marie Dupont" /></label>
          <label><span>Trusted contact's public key</span><input className="mono" value={tiersKey} onChange={(e) => setTiersKey(e.target.value)} placeholder="[fingerprint/48'/1'/0'/2']tpub…" /></label>
        </div>
      </div>

      <div className="step">
        <h3>2. Your wallet</h3>
        <button disabled={!tiersReady || !!status} onClick={() => create("wallet")}>Create my wallet with the Client Wallet</button>
        <details>
          <summary>I already have a compatible wallet (Bitcoin Core, Liana…)</summary>
          <label><span>My account public key</span><input className="mono" value={ownKey} onChange={(e) => setOwnKey(e.target.value)} placeholder="[fingerprint/48'/1'/0'/2']tpub…" /></label>
          <button className="secondary" disabled={!tiersReady || !ownKey.trim() || !!status} onClick={() => create("paste")}>Create the account with this key</button>
        </details>
        {status && <p className="note">{status}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}
