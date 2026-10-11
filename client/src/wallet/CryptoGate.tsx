// Écran de verrouillage de la partie crypto : la session bancaire ne suffit pas, il faut valider la biométrie du client
// (passkey WebAuthn). L'interface n'est qu'un confort : le vrai contrôle est dans bank-mock (cryptoLock.ts), qui refuse
// les routes crypto sans passkey vérifiée. Si bank-mock est injoignable, rien de ce qu'il protège n'est atteignable ;
// le client peut toujours dépenser seul avec son Client Wallet (biométrie du wallet), donc on n'enferme pas l'interface.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type CryptoLock, cryptoLock, cryptoLockStatus, cryptoUnlock, registerPasskey } from "../lib/bank";
import { useT } from "../i18n";

const POLL_MS = 15_000;

export function CryptoGate({ onScope, lockSignal, children }: {
  onScope: (s: "full" | null) => void;
  lockSignal: number; // incrémenté par l'appli à chaque fois qu'il faut reverrouiller

  children: (o: { recovery: boolean; onRecovered: () => void; onLeave: () => void }) => ReactNode;
}) {
  const { tr } = useT();
  const [lock, setLock] = useState<CryptoLock | null | "offline">(null);
  const [recovery, setRecovery] = useState(false); // l'utilisateur a choisi « j'ai perdu mon wallet / mon appareil »
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setLock(await cryptoLockStatus()); } catch (e: any) { if (e instanceof TypeError) setLock("offline"); else setError(e.message); }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t); }, [refresh]);
  // Signal de l'appli (sortie de l'onglet Crypto, page du navigateur masquée) : on reverrouille tout de suite, côté serveur d'abord.
  useEffect(() => {
    if (lockSignal === 0) return;
    setRecovery(false);
    cryptoLock().then(refresh);
  }, [lockSignal, refresh]);

  const offline = lock === "offline";
  const open = offline || (!!lock && (!lock.enabled || lock.scope === "full"));
  useEffect(() => { onScope(open ? "full" : null); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (f: () => Promise<unknown>) => async () => {
    setBusy(true); setError(null);
    try { await f(); await refresh(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (lock === null) return <section><p>{tr("Loading…")}</p></section>;
  // En recovery, l'écran fait lui-même le re-KYC, qui ouvre côté serveur le niveau « recovery » (cryptoLock.ts).
  if (open || recovery)
    return (
      <>
        {offline &&<p className="note banner">{tr("Swissquote is unreachable: the biometric lock cannot be checked. Spending still requires your Client Wallet's biometrics.")}</p>}
        {children({ recovery: recovery && !open, onRecovered: () => { setRecovery(false); refresh(); }, onLeave: () => { setRecovery(false); cryptoLock().then(refresh); } })}
      </>
    );

  const none = lock.passkeys === 0;
  return (
    <section data-testid="crypto-locked">
      <h2>{tr("Crypto is locked")}</h2>
      <p>{tr("Your password is not enough to reach your crypto: confirm with your biometrics (Touch ID, Face ID, Windows Hello). Swissquote's servers check it, so nobody who only has your password can use this part.")}</p>
      {none && <p className="note">{tr("No biometrics are enabled for your account yet: enable them on this device to continue.")}</p>}
      <p>
        <button disabled={busy} onClick={run(() => (none ? registerPasskey() : cryptoUnlock()))}>{none ? tr("Enable biometrics") : tr("Unlock with biometrics")}</button>
      </p>
      {error && <p className="error">{error}</p>}
      <p className="center"><button className="link" onClick={() => setRecovery(true)}>{tr("I lost my device or my biometrics: recover my wallet")}</button></p>
    </section>
  );
}
