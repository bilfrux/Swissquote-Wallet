// Gabarit de l'appli, sur le modèle de Swissquote :
// - ordinateur : en-tête blanc (marque, menu, compte, déconnexion), rail d'icônes à gauche, barre d'état en bas ;
// - téléphone : boutons ronds en haut, barre d'onglets en bas.
import { useState } from "react";
import { NETWORK } from "../lib/config";
import { IconBank, IconBolt, IconCrypto, IconHome, IconPortfolio, IconShield, IconUser, Logo } from "./icons";
import { num } from "./format";
import { useIsMobile } from "./useIsMobile";
import { NotificationBell } from "./NotificationBell";
import { AccountSecurity } from "./AccountSecurity";

export type Tab = "accueil" | "banque" | "crypto" | "demo";
type Props = {
  tab: Tab;
  onTab: (t: Tab, anchor?: string) => void;
  user: { firstName: string; lastName: string };
  onLogout: () => void;
  totals: { totalChf: number; cashChf: number; btc: string | null };
  children: React.ReactNode;
};

const TABS: { id: Tab; label: string; icon: () => React.ReactElement }[] = [
  { id: "accueil", label: "Home", icon: IconHome },
  { id: "banque", label: "Banking", icon: IconBank },
  { id: "crypto", label: "Crypto", icon: IconCrypto },
  ...(NETWORK === "regtest" ? [{ id: "demo" as Tab, label: "Demo", icon: IconBolt }] : []),
];

export function Shell(p: Props) {
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  if (mobile)
    return (
      <div className="m-app">
        <div className="m-top">
          <Logo size={26} />
          <div className="m-top-actions">
            <NotificationBell round />
            <button className="round" aria-label="My account" onClick={() => setSheet(!sheet)}><IconUser /></button>
          </div>
        </div>
        {sheet && (
          <div className="m-sheet">
            <p><strong>{p.user.firstName} {p.user.lastName}</strong></p>
            <p className="muted small">Simulated bank · Bitcoin {NETWORK}</p>
            <AccountSecurity />
            <button className="btn-outline-red" onClick={p.onLogout}>Log out</button>
          </div>
        )}
        <main className="m-main">{p.children}</main>
        <nav className="m-tabbar">
          {TABS.map((t) => (
            <button key={t.id} className={p.tab === t.id ? "active" : ""} onClick={() => p.onTab(t.id)}>
              <t.icon />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    );

  const RAIL: { label: string; icon: () => React.ReactElement; go: () => void; on: boolean }[] = [
    { label: "Portfolio", icon: IconPortfolio, go: () => p.onTab("accueil"), on: p.tab === "accueil" },
    { label: "Accounts", icon: IconBank, go: () => p.onTab("banque"), on: p.tab === "banque" },
    { label: "Crypto assets", icon: IconCrypto, go: () => p.onTab("crypto"), on: p.tab === "crypto" },
    { label: "Security", icon: IconShield, go: () => p.onTab("crypto", "securite"), on: false },
    ...(NETWORK === "regtest" ? [{ label: "Attacks", icon: IconBolt, go: () => p.onTab("demo"), on: p.tab === "demo" }] : []),
  ];
  return (
    <div className="d-app">
      <header className="d-header">
        <Logo />
        <nav className="d-topnav">
          {TABS.map((t) => (
            <button key={t.id} className={p.tab === t.id ? "active" : ""} onClick={() => p.onTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="d-header-right">
          <NotificationBell />
          <div className="bell-wrap">
            <button className="account-pill" aria-label="My account" onClick={() => setSheet(!sheet)}><IconUser /> {p.user.firstName} {p.user.lastName}</button>
            {sheet && <div className="bell-panel"><p><strong>{p.user.firstName} {p.user.lastName}</strong></p><AccountSecurity /></div>}
          </div>
          <button className="btn-outline-red" onClick={p.onLogout}>Log out</button>
        </div>
      </header>
      <div className="d-body">
        <aside className="d-rail">
          {RAIL.map((r) => (
            <button key={r.label} className={r.on ? "on" : ""} onClick={r.go}><r.icon /><span>{r.label}</span></button>
          ))}
        </aside>
        <main className="d-main">{p.children}</main>
      </div>
      <footer className="d-status">
        <span>Total value <strong>{num(p.totals.totalChf)} CHF</strong></span>
        <span>CHF accounts <strong>{num(p.totals.cashChf)} CHF</strong></span>
        <span>Crypto <strong>{p.totals.btc ?? "—"}</strong></span>
        <span>Bitcoin network <strong>{NETWORK}</strong></span>
        <span className="sim">Simulated bank for the demo</span>
      </footer>
    </div>
  );
}
