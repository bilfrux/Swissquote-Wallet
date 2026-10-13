// Appli Swissquote (banque SIMULÉE) : connexion, accueil, banque, crypto self-custody, démo.
import { useEffect, useRef, useState } from "react";
import { type BankAccount, type Session, clearSession, cryptoLock, custody, loadSession, me } from "./lib/bank";
import { priceOf, usePrices } from "./lib/market";
import { walletBusy } from "./lib/walletBridge";
import { num } from "./ui/format";
import { PublicSite } from "./public/PublicSite";
import { Overview } from "./bank/Overview";
import { Accounts } from "./bank/Accounts";
import { CryptoTab } from "./wallet/CryptoTab";
import { CryptoGate } from "./wallet/CryptoGate";
import { openCrypto } from "./wallet/Account";
import { AttackPanel } from "./attacks/AttackPanel";
import { Shell, type Tab } from "./ui/Shell";

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [tab, setTab] = useState<Tab>("accueil");
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  // undefined : solde pas encore lu ; null : pas de wallet ; sinon solde du wallet Bitcoin (sats).
  const [btcSats, setBtcSats] = useState<bigint | null | undefined>(undefined);
  const [custodySats, setCustodySats] = useState<number>(0); // compte crypto Swissquote (en garde)
  const [usdc, setUsdc] = useState<bigint | null>(null); // compte Ethereum (USDC, 6 décimales)
  const market = usePrices();
  const [error, setError] = useState<string | null>(null);

  // Solde du compte crypto Swissquote : bank-mock ne le donne qu'une fois la partie crypto déverrouillée par la biométrie.
  const [cryptoOpen, setCryptoOpen] = useState<"full" | null>(null);
  // Reverrouillage à chaque sortie de l'onglet Crypto et quand la page du navigateur passe en arrière-plan.
  const [lockSignal, setLockSignal] = useState(0);
  const prevTab = useRef(tab);
  useEffect(() => {
    if (prevTab.current === "crypto" && tab !== "crypto") setLockSignal((n) => n + 1);
    prevTab.current = tab;
  }, [tab]);
  useEffect(() => {
    // Pas de reverrouillage pendant qu'une demande est en cours auprès du Client Wallet (sa fenêtre passe devant).
    const onHide = () => { if (document.visibilityState === "hidden" && !walletBusy()) setLockSignal((n) => n + 1); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
  useEffect(() => {
    if (!session) return;
    if (cryptoOpen) custody().then((c) => setCustodySats(c.balanceSats), () => setCustodySats(0));
    else { setCustodySats(0); setBtcSats(undefined); setUsdc(null); }
  }, [session, cryptoOpen]);
  useEffect(() => {
    if (!session) return;
    me().then((m) => setAccounts(m.accounts), (e) => { setError(e.message); if (/session/.test(e.message)) { clearSession(); setSession(null); } });
  }, [session]);

  // Changement d'onglet, éventuellement vers une section précise (ex. « recevoir » du wallet).
  const go = (t: Tab, anchor?: string) => {
    setTab(t);
    window.scrollTo({ top: 0 });
    // Panneau (recevoir, envoyer…) ou sous-onglet (securite…) de la fiche Bitcoin.
    if (anchor) setTimeout(() => openCrypto(anchor), 60);
  };

  // Pas de session (arrivée ou déconnexion) : site public, page « Marchés » puis connexion.
  if (!session) return <PublicSite onLogin={setSession} />;
  const cash = (accounts ?? []).reduce((s, a) => s + a.balance, 0);
  // Prix du marché (CoinGecko) ou cours simulé ; les coins du wallet sont sur des réseaux de test.
  const cryptoChf = (btcSats == null ? 0 : (Number(btcSats) / 1e8) * priceOf(market, "bitcoin")) + (custodySats / 1e8) * priceOf(market, "bitcoin")
    + (usdc === null ? 0 : (Number(usdc) / 1e6) * priceOf(market, "usd-coin"));
  return (
    <Shell
      tab={tab}
      onTab={go}
      user={session.customer}
      onLogout={() => { cryptoLock().finally(clearSession); setSession(null); setCryptoOpen(null); setAccounts(null); setBtcSats(undefined); setUsdc(null); }}
      totals={{ totalChf: cash + cryptoChf, cashChf: cash, crypto: btcSats === undefined ? "…" : btcSats === null ? null : `${num(cryptoChf)} CHF` }}
    >
      {error && <p className="error">{error}</p>}
      {tab === "accueil" && <Overview accounts={accounts} btcSats={btcSats} custodySats={custodySats} usdc={usdc} customerId={session.customer.id} onTab={go} />}
      {tab === "banque" && <Accounts accounts={accounts} />}
      {/* L'onglet crypto reste monté (masqué) pour que le solde BTC de l'accueil soit à jour. */}
      <div hidden={tab !== "crypto"}>
        <CryptoGate onScope={setCryptoOpen} lockSignal={lockSignal}>
          {({ recovery, onRecovered, onLeave }) => <CryptoTab session={session} onBalance={setBtcSats} custodySats={custodySats} onUsdc={setUsdc} startInRecovery={recovery} onRecovered={recovery ? onRecovered : undefined} onLeave={onLeave} />}
        </CryptoGate>
      </div>
      {tab === "demo" && <AttackPanel />}
    </Shell>
  );
}
