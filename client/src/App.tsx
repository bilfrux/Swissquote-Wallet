// Appli Swissquote (banque SIMULÉE) : connexion, aperçu, comptes, wallet crypto self-custody, démo.
import { useEffect, useState } from "react";
import { type BankAccount, type Session, clearSession, loadSession, me } from "./lib/bank";
import { NETWORK } from "./lib/config";
import { Login } from "./bank/Login";
import { Overview } from "./bank/Overview";
import { Accounts } from "./bank/Accounts";
import { CryptoTab } from "./wallet/CryptoTab";
import { AttackPanel } from "./attacks/AttackPanel";

type Tab = "apercu" | "comptes" | "crypto" | "demo";

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [tab, setTab] = useState<Tab>("apercu");
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    me().then((m) => setAccounts(m.accounts), (e) => { setError(e.message); if (/session/.test(e.message)) { clearSession(); setSession(null); } });
  }, [session]);

  if (!session) return <Login onLogin={setSession} />;
  const tabs: [Tab, string][] = [["apercu", "Aperçu"], ["comptes", "Comptes"], ["crypto", "Wallet crypto"], ...(NETWORK === "regtest" ? [["demo", "Démo · Attaques"] as [Tab, string]] : [])];
  return (
    <>
      <header className="topbar">
        <div className="logo">Swissquote</div>
        <nav>{tabs.map(([t, label]) => <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{label}</button>)}</nav>
        <div className="user">
          {session.customer.firstName} {session.customer.lastName}
          <button className="link light" onClick={() => { clearSession(); setSession(null); setAccounts(null); }}>Déconnexion</button>
        </div>
      </header>
      <main>
        <p className="badge">Banque simulée · réseau Bitcoin {NETWORK}</p>
        {error && <p className="error">{error}</p>}
        {tab === "apercu" && <Overview accounts={accounts} btcSats={btcSats} onOpenWallet={() => setTab("crypto")} />}
        {tab === "comptes" && <Accounts accounts={accounts} />}
        {/* L'onglet crypto reste monté (masqué) pour que le solde BTC de l'aperçu soit à jour. */}
        <div hidden={tab !== "crypto"}><CryptoTab session={session} onBalance={setBtcSats} /></div>
        {tab === "demo" && <AttackPanel />}
      </main>
    </>
  );
}
