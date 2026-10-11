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
import { LangSelect, useT } from "../i18n";

export type Tab = "accueil" | "banque" | "crypto" | "demo";
type Props = {
  tab: Tab;
  onTab: (t: Tab, anchor?: string) => void;
  user: { firstName: string; lastName: string };
  onLogout: () => void;
  totals: { totalChf: number; cashChf: number; crypto: string | null };
  children: React.ReactNode;
};

// Libellés : clés de traduction (i18n.tsx).
const TABS: { id: Tab; label: string; icon: () => React.ReactElement }[] = [
  { id: "accueil", label: "nav.home", icon: IconHome },
  { id: "banque", label: "nav.banking", icon: IconBank },
  { id: "crypto", label: "nav.crypto", icon: IconCrypto },
  ...(NETWORK === "regtest" ? [{ id: "demo" as Tab, label: "nav.demo", icon: IconBolt }] : []),
];

export function Shell(p: Props) {
  const mobile = useIsMobile();
  const { t } = useT();
  const [sheet, setSheet] = useState(false);
  const RAIL: { label: string; icon: () => React.ReactElement; go: () => void; on: boolean }[] = [
    { label: t("rail.portfolio"), icon: IconPortfolio, go: () => p.onTab("accueil"), on: p.tab === "accueil" },
    { label: t("rail.accounts"), icon: IconBank, go: () => p.onTab("banque"), on: p.tab === "banque" },
    { label: t("rail.cryptoAssets"), icon: IconCrypto, go: () => p.onTab("crypto"), on: p.tab === "crypto" },
    { label: t("rail.security"), icon: IconShield, go: () => p.onTab("crypto", "securite"), on: false },
    ...(NETWORK === "regtest" ? [{ label: t("rail.attacks"), icon: IconBolt, go: () => p.onTab("demo"), on: p.tab === "demo" }] : []),
  ];
  // Même arbre pour les deux mises en page : le contenu (<main>) garde sa position, donc franchir le seuil
  // téléphone/ordinateur (rotation, redimensionnement) ne démonte pas l'appli et ne perd pas son état.
  return (
    <div className={mobile ? "m-app" : "d-app"}>
      {mobile ? (
        <>
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
              <p className="muted small">{t("shell.simBank")} · Bitcoin {NETWORK}</p>
              <LangSelect />
              <AccountSecurity />
              <button className="btn-outline-red" onClick={p.onLogout}>{t("shell.logout")}</button>
            </div>
          )}
        </>
      ) : (
        <header className="d-header">
          <Logo />
          <nav className="d-topnav">
            {TABS.map((tb) => (
              <button key={tb.id} className={p.tab === tb.id ? "active" : ""} onClick={() => p.onTab(tb.id)}>{t(tb.label)}</button>
            ))}
          </nav>
          <div className="d-header-right">
            <LangSelect />
            <NotificationBell />
            <div className="bell-wrap">
              <button className="account-pill" aria-label="My account" onClick={() => setSheet(!sheet)}><IconUser /> {p.user.firstName} {p.user.lastName}</button>
              {sheet && <div className="bell-panel"><p><strong>{p.user.firstName} {p.user.lastName}</strong></p><AccountSecurity /></div>}
            </div>
            <button className="btn-outline-red" onClick={p.onLogout}>{t("shell.logout")}</button>
          </div>
        </header>
      )}
      <div className={mobile ? "m-body" : "d-body"}>
        {!mobile && (
          <aside className="d-rail">
            {RAIL.map((r) => (
              <button key={r.label} className={r.on ? "on" : ""} onClick={r.go}><r.icon /><span>{r.label}</span></button>
            ))}
          </aside>
        )}
        <main className={mobile ? "m-main" : "d-main"}>{p.children}</main>
      </div>
      {mobile ? (
        <nav className="m-tabbar">
          {TABS.map((tb) => (
            <button key={tb.id} className={p.tab === tb.id ? "active" : ""} onClick={() => p.onTab(tb.id)}>
              <tb.icon />
              <span>{t(tb.label)}</span>
            </button>
          ))}
        </nav>
      ) : (
        <footer className="d-status">
          <span>{t("foot.total")} <strong>{num(p.totals.totalChf)} CHF</strong></span>
          <span>{t("foot.cash")} <strong>{num(p.totals.cashChf)} CHF</strong></span>
          <span>{t("foot.crypto")} <strong>{p.totals.crypto ?? "—"}</strong></span>
          <span>{t("foot.network")} <strong>{NETWORK}</strong></span>
          <span className="sim">{t("foot.sim")}</span>
        </footer>
      )}
    </div>
  );
}
