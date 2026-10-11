// Onglet « Wallet crypto » : création du wallet, compte actif, ou mode recovery (cas particulier).
// Le compte actif (clés publiques) vient de Swissquote si elle répond, sinon du cache local : la dépense ne dépend pas d'elle.
import { useEffect, useState } from "react";
import { type WalletConfig, createWalletConfig } from "@sq/bitcoin";
import { type Session, walletAccounts } from "../lib/bank";
import { type BtcAccount, NETWORK, loadActiveAccount, saveActiveAccount } from "../lib/config";
import { Recovery } from "../recovery/Recovery";
import { CreateWallet } from "./CreateWallet";
import { WalletHome } from "./WalletHome";

export function CryptoTab({ session, onBalance }: { session: Session; onBalance: (s: bigint | null) => void }) {
  const cid = session.customer.id;
  const [account, setAccount] = useState<BtcAccount | null | undefined>(undefined);
  const [cfg, setCfg] = useState<WalletConfig | null>(null);
  const [recovering, setRecovering] = useState(() => localStorage.getItem(`sq-wallet:recovery:${NETWORK}`) !== null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const cached = loadActiveAccount(cid);
    walletAccounts().then(
      (list) => {
        if (cached && list.some((a) => a.client === cached.client)) return setAccount(cached);
        const last = list[list.length - 1]; // nouvel appareil : le compte le plus récent du client
        if (!last) return setAccount(cached ?? null);
        const a: BtcAccount = { id: last.id, client: last.client, swissquote: last.swissquote, tiers: last.tiers, tiersName: last.tiersName, delay: last.delay };
        saveActiveAccount(cid, a);
        setAccount(a);
      },
      () => { setAccount(cached ?? null); if (cached) setNotice("Swissquote is unreachable: account loaded from this device. You can still spend."); },
    );
  }, [cid]);
  useEffect(() => {
    setCfg(null); // jamais l'ancienne configuration avec le nouveau compte
    if (!account) { if (account === null) onBalance(null); return; }
    createWalletConfig({ network: NETWORK, ...account }).then(setCfg);
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  const activate = (a: BtcAccount) => { saveActiveAccount(cid, a); setAccount(a); };
  if (account === undefined) return <section><p>Loading…</p></section>;
  if (recovering)
    return <Recovery onCancel={() => setRecovering(false)} onDone={(a) => { activate(a); setRecovering(false); setNotice("Recovery complete: here is your new wallet."); }} />;
  return (
    <>
      {notice && <p className="note banner">{notice}</p>}
      {!account && (
        <>
          <CreateWallet onCreated={(a) => { activate(a); setNotice("Your Bitcoin wallet has been created. Only you hold its key."); }} />
          <p className="center"><button className="link" onClick={() => setRecovering(true)}>I had a wallet and lost it: recover my bitcoin</button></p>
        </>
      )}
      {account && cfg && <WalletHome key={cfg.client.raw} customerId={cid} cfg={cfg} account={account} onLost={() => setRecovering(true)} onBalance={onBalance} />}
    </>
  );
}
