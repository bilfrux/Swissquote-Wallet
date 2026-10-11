// Onglet « Wallet crypto » : création du wallet, compte actif, ou mode recovery (cas particulier).
// Le compte actif (clés publiques) vient du cache local de l'appareil : ni la liste ni la dépense ne dépendent de Swissquote.
import { useEffect, useState } from "react";
import { type WalletConfig, createWalletConfig } from "@sq/bitcoin";
import { type Session, registerPasskey } from "../lib/bank";
import { type BtcAccount, NETWORK, loadActiveAccount, saveActiveAccount } from "../lib/config";
import { Recovery } from "../recovery/Recovery";
import { CreateWallet } from "./CreateWallet";
import { WalletHome } from "./WalletHome";
import { useT } from "../i18n";

export function CryptoTab({ session, onBalance, custodySats = 0, onUsdc, startInRecovery = false, onRecovered, onLeave }: {
  session: Session; onBalance: (s: bigint | null) => void; custodySats?: number; onUsdc?: (u: bigint) => void;
  // Arrivée par « j'ai perdu mon wallet » depuis l'écran verrouillé ; `onRecovered` : la recovery est finie (le verrou est relu) ;
  // `onLeave` : abandon de la recovery sans être déverrouillé.
  startInRecovery?: boolean; onRecovered?: () => void; onLeave?: () => void;
}) {
  const cid = session.customer.id;
  const { tr } = useT();
  const [account, setAccount] = useState<BtcAccount | null | undefined>(undefined);
  const [cfg, setCfg] = useState<WalletConfig | null>(null);
  const [recovering, setRecovering] = useState(() => startInRecovery || localStorage.getItem(`sq-wallet:recovery:${NETWORK}`) !== null);
  const [notice, setNotice] = useState<string | null>(null);

  // Le wallet appartient à l'appareil : on ne demande pas à Swissquote quels wallets existent. Sur un appareil qui n'en a
  // pas, on propose d'en créer un, ou la recovery (qui, elle, passe volontairement par Swissquote et le contact de confiance).
  useEffect(() => { setAccount(loadActiveAccount(cid)); }, [cid]);
  useEffect(() => {
    setCfg(null); // jamais l'ancienne configuration avec le nouveau compte
    if (!account) { if (account === null) onBalance(null); return; }
    createWalletConfig({ network: NETWORK, ...account }).then(setCfg);
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  const activate = (a: BtcAccount) => { saveActiveAccount(cid, a); setAccount(a); };
  if (account === undefined) return <section><p>{tr("Loading…")}</p></section>;
  if (recovering)
    return <Recovery
      onCancel={() => { setRecovering(false); onLeave?.(); }}
      onDone={async (a) => {
        activate(a);
        setRecovering(false);
        setNotice(tr("Recovery complete: here is your new wallet."));
        // L'ancienne passkey a pu être perdue avec l'appareil : on en enregistre une nouvelle ici (biométrie de cet appareil).
        // C'est elle qui redonne l'accès complet ; la recovery seule n'ouvre que ses propres écrans.
        if (onRecovered) {
          try { await registerPasskey(); } catch (e: any) { setNotice(`${tr("Recovery complete: here is your new wallet.")} ${tr("Biometrics could not be enabled on this device:")} ${e.message}`); }
          onRecovered();
        }
      }} />;
  return (
    <>
      {notice && <p className="note banner">{notice}</p>}
      {!account && (
        <>
          <CreateWallet onCreated={(a) => { activate(a); setNotice(tr("Your Bitcoin wallet has been created. Only you hold its key.")); }} />
          <p className="center"><button className="link" onClick={() => setRecovering(true)}>{tr("I had a wallet and lost it: recover my bitcoin")}</button></p>
        </>
      )}
      {account && cfg && <WalletHome key={cfg.client.raw} customerId={cid} cfg={cfg} account={account} custodySats={custodySats} onLost={() => setRecovering(true)} onBalance={onBalance} onUsdc={onUsdc} />}
    </>
  );
}
