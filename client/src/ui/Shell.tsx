// Gabarit de l'appli, sur le modèle de Swissquote :
// - ordinateur : en-tête blanc (marque, menu, compte, déconnexion), rail d'icônes à gauche, barre d'état en bas ;
// - téléphone : boutons ronds en haut, barre d'onglets en bas.
import { useState } from "react";
import { NETWORK } from "../lib/config";
import { IconBank, IconBolt, IconCrypto, IconHome, IconPortfolio, IconShield, IconUser, Logo } from "./icons";
import { num } from "./format";
import { useIsMobile } from "./useIsMobile";

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
  { id: "accueil", label: "Accueil", icon: IconHome },
  { id: "banque", label: "Banque", icon: IconBank },
  { id: "crypto", label: "Crypto", icon: IconCrypto },
  ...(NETWORK === "regtest" ? [{ id: "demo" as Tab, label: "Démo", icon: IconBolt }] : []),
];

export function Shell(p: Props) {
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  if (mobile)
    return (
      <div className="m-app">
        <div className="m-top">
          <Logo size={26} />
          <button className="round" aria-label="Mon compte" onClick={() => setSheet(!sheet)}><IconUser /></button>
        </div>
        {sheet && (
          <div className="m-sheet">
            <p><strong>{p.user.firstName} {p.user.lastName}</strong></p>
            <p className="muted small">Banque simulée · Bitcoin {NETWORK}</p>
            <button className="btn-outline-red" onClick={p.onLogout}>Déconnexion</button>
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
    { label: "Portefeuille", icon: IconPortfolio, go: () => p.onTab("accueil"), on: p.tab === "accueil" },
    { label: "Comptes", icon: IconBank, go: () => p.onTab("banque"), on: p.tab === "banque" },
    { label: "Crypto assets", icon: IconCrypto, go: () => p.onTab("crypto"), on: p.tab === "crypto" },
    { label: "Sécurité", icon: IconShield, go: () => p.onTab("crypto", "securite"), on: false },
    ...(NETWORK === "regtest" ? [{ label: "Attaques", icon: IconBolt, go: () => p.onTab("demo"), on: p.tab === "demo" }] : []),
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
          <span className="account-pill"><IconUser /> {p.user.firstName} {p.user.lastName}</span>
          <button className="btn-outline-red" onClick={p.onLogout}>Déconnexion</button>
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
        <span>Valeur totale <strong>{num(p.totals.totalChf)} CHF</strong></span>
        <span>Comptes CHF <strong>{num(p.totals.cashChf)} CHF</strong></span>
        <span>Crypto <strong>{p.totals.btc ?? "—"}</strong></span>
        <span>Réseau Bitcoin <strong>{NETWORK}</strong></span>
        <span className="sim">Banque simulée pour la démo</span>
      </footer>
    </div>
  );
}
