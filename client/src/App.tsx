// Appli Swissquote (banque SIMULÉE) : connexion, accueil, banque, crypto self-custody, démo.
import { useEffect, useState } from "react";
import { type BankAccount, type Session, clearSession, loadSession, me } from "./lib/bank";
import { BTC_CHF } from "./lib/config";
import { btcFmt } from "./lib/format";
import { Login } from "./bank/Login";
import { Overview } from "./bank/Overview";
import { Accounts } from "./bank/Accounts";
import { CryptoTab } from "./wallet/CryptoTab";
import { AttackPanel } from "./attacks/AttackPanel";
import { Shell, type Tab } from "./ui/Shell";

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [tab, setTab] = useState<Tab>("accueil");
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    me().then((m) => setAccounts(m.accounts), (e) => { setError(e.message); if (/session/.test(e.message)) { clearSession(); setSession(null); } });
  }, [session]);

  // Changement d'onglet, éventuellement vers une section précise (ex. « recevoir » du wallet).
  const go = (t: Tab, anchor?: string) => {
    setTab(t);
    window.scrollTo({ top: 0 });
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  if (!session) return <Login onLogin={setSession} />;
  const cash = (accounts ?? []).reduce((s, a) => s + a.balance, 0);
  const btcChf = btcSats === null ? 0 : (Number(btcSats) / 1e8) * BTC_CHF;
  return (
    <Shell
      tab={tab}
      onTab={go}
      user={session.customer}
      onLogout={() => { clearSession(); setSession(null); setAccounts(null); setBtcSats(null); }}
      totals={{ totalChf: cash + btcChf, cashChf: cash, btc: btcSats === null ? null : btcFmt(btcSats) }}
    >
      {error && <p className="error">{error}</p>}
      {tab === "accueil" && <Overview accounts={accounts} btcSats={btcSats} customerId={session.customer.id} onTab={go} />}
      {tab === "banque" && <Accounts accounts={accounts} />}
      {/* L'onglet crypto reste monté (masqué) pour que le solde BTC de l'accueil soit à jour. */}
      <div hidden={tab !== "crypto"}><CryptoTab session={session} onBalance={setBtcSats} /></div>
      {tab === "demo" && <AttackPanel />}
    </Shell>
  );
}
