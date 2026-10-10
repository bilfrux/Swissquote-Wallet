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
      setStatus("Récupération de la clé publique de Swissquote…");
      const swissquote = await fetchSwissquoteKey();
      // Clé du tiers vérifiée AVANT d'ouvrir le wallet : pas de graine créée pour rien.
      parseAccountKey(tiersKey, NETWORK);
      let client = ownKey.trim();
      let walletId: string | undefined;
      if (source === "wallet") {
        setStatus("Création de votre wallet dans la fenêtre « Wallet du client »…");
        const r = await walletRequest<{ accountKey: string; walletId: string }>("create", { label: "Wallet Bitcoin Swissquote" });
        client = r.accountKey;
        walletId = r.walletId;
      }
      const cfg = await createWalletConfig({ network: NETWORK, delay: DELAY, client, swissquote, tiers: tiersKey });
      setStatus("Enregistrement auprès de Swissquote…");
      const { accountId } = await registerAccount({ delay: DELAY, client: cfg.client.raw, tiers: cfg.tiers.raw, tiersName });
      const account: BtcAccount = { id: accountId, client: cfg.client.raw, swissquote, tiers: cfg.tiers.raw, tiersName, delay: DELAY, walletId };
      if (walletId) {
        setStatus("Enregistrement de la politique dans votre wallet…");
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
      <h2>Créer mon wallet Bitcoin</h2>
      <ul className="promise">
        <li><strong>Vous seul détenez la clé.</strong> Elle est créée dans votre Wallet du client ; Swissquote ne la voit jamais.</li>
        <li><strong>Vous dépensez seul, à tout moment</strong>, même si Swissquote est indisponible.</li>
        <li><strong>Si vous perdez votre wallet</strong>, Swissquote et votre tiers de confiance peuvent ensemble déplacer vos bitcoins vers un nouveau wallet, mais seulement pour des coins restés immobiles {DELAY} blocs. Le réseau Bitcoin l'impose ; Swissquote ne peut rien faire seule.</li>
      </ul>

      <div className="step">
        <h3>1. Votre tiers de confiance</h3>
        <p className="note">Une personne de confiance, indépendante de Swissquote (proche, notaire…). Elle crée sa clé dans la <a href={CONSOLE_URL} target="_blank" rel="noreferrer">console guardian</a> et vous transmet sa clé publique.</p>
        <div className="row two">
          <label><span>Nom</span><input value={tiersName} onChange={(e) => setTiersName(e.target.value)} placeholder="Marie Dupont" /></label>
          <label><span>Clé publique du tiers</span><input className="mono" value={tiersKey} onChange={(e) => setTiersKey(e.target.value)} placeholder="[empreinte/48'/1'/0'/2']tpub…" /></label>
        </div>
      </div>

      <div className="step">
        <h3>2. Votre wallet</h3>
        <button disabled={!tiersReady || !!status} onClick={() => create("wallet")}>Créer mon wallet avec le Wallet du client</button>
        <details>
          <summary>J'ai déjà un wallet compatible (Bitcoin Core, Liana…)</summary>
          <label><span>Ma clé publique de compte</span><input className="mono" value={ownKey} onChange={(e) => setOwnKey(e.target.value)} placeholder="[empreinte/48'/1'/0'/2']tpub…" /></label>
          <button className="secondary" disabled={!tiersReady || !ownKey.trim() || !!status} onClick={() => create("paste")}>Créer le compte avec cette clé</button>
        </details>
        {status && <p className="note">{status}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}
