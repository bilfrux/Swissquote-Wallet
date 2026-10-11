// Site public (avant connexion), sur le modèle de swissquote.com : page « Marchés » (aperçu du jour, données SIMULÉES)
// et page de connexion. Seule la connexion est fonctionnelle (banque simulée, bank-mock).
import { useMemo, useState } from "react";
import { type Session, login, loginWithPasskey } from "../lib/bank";
import { LangSelect, useT } from "../i18n";
import { Logo } from "../ui/icons";

type Page = "markets" | "login";

export function PublicSite({ onLogin, initial = "markets" }: { onLogin: (s: Session) => void; initial?: Page }) {
  const [page, setPage] = useState<Page>(initial);
  return page === "login"
    ? <LoginPage onLogin={onLogin} onHome={() => setPage("markets")} />
    : <MarketsPage onLogin={() => setPage("login")} />;
}

// ---------------- En-tête public ----------------
function PublicHeader({ onLogin, onHome }: { onLogin: () => void; onHome: () => void }) {
  const { t } = useT();
  const [note, setNote] = useState(false);
  return (
    <header className="pub-head">
      <button className="pub-logo" onClick={onHome} aria-label="Swissquote"><Logo size={34} /></button>
      <div className="pub-actions">
        <button className="pub-help" aria-label={t("pub.help")} title={t("pub.help")}>?</button>
        <LangSelect />
        <button className="pub-discover hide-m">{t("pub.discover")}</button>
        <button className="pub-login" onClick={onLogin}>{t("pub.login")}</button>
        <button className="pub-signup hide-m" onClick={() => setNote(!note)}>{t("pub.signup")}</button>
      </div>
      {note && <p className="pub-note note banner">{t("pub.signupSoon")}</p>}
    </header>
  );
}

// ---------------- Page « Marchés » (données simulées) ----------------
type Flag = "ch" | "de" | "us" | "fr" | "eu" | "oil" | "gold" | "btc";
const ROWS: { sym: string; name: string; flag: Flag; price: number; unit?: string; change: number; seed: number }[] = [
  { sym: "SMI", name: "SWISS MARKET INDEX SMI® PR", flag: "ch", price: 13787.4, change: 1.1, seed: 1 },
  { sym: "DAX", name: "DAX (PERFORMANCE INDEX)", flag: "de", price: 25102.34, change: 1.19, seed: 2 },
  { sym: "NDX", name: "NASDAQ 100 INDEX", flag: "us", price: 30883.148, change: 0.51, seed: 3 },
  { sym: "PX1", name: "CAC 40", flag: "fr", price: 7803.33, change: 0.95, seed: 4 },
  { sym: "SX5E", name: "EURO STOXX 50", flag: "eu", price: 6173.37, change: 0.76, seed: 5 },
  { sym: ".DJIA", name: "DOW JONES INDUS AVERAGE", flag: "us", price: 51654.95, change: 0.83, seed: 6 },
  { sym: ".OIL", name: "OIL WTI CRUDE FUTURE", flag: "oil", price: 91.66, unit: "USD", change: 0.19, seed: 7 },
  { sym: "XAU", name: "GOLD 1OZ", flag: "gold", price: 4194.46, unit: "USD", change: 0.01, seed: 8 },
  { sym: "SPX", name: "S&P 500 INDEX", flag: "us", price: 7012.58, change: 0.64, seed: 9 },
  { sym: "BTC/USD", name: "Bitcoin", flag: "btc", price: 86213.5, unit: "USD", change: -0.42, seed: 10 },
];

const FlagIcon = ({ f }: { f: Flag }) => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="mk-flag">
    <defs><clipPath id={`c-${f}`}><circle cx="11" cy="11" r="11" /></clipPath></defs>
    <g clipPath={`url(#c-${f})`}>
      {f === "ch" && <><rect width="22" height="22" fill="#e8312f" /><path d="M9.2 5h3.6v4.2H17v3.6h-4.2V17H9.2v-4.2H5V9.2h4.2Z" fill="#fff" /></>}
      {f === "de" && <><rect width="22" height="7.4" fill="#111" /><rect y="7.3" width="22" height="7.4" fill="#dd0000" /><rect y="14.6" width="22" height="7.4" fill="#ffce00" /></>}
      {f === "fr" && <><rect width="7.4" height="22" fill="#1f3fa5" /><rect x="7.3" width="7.4" height="22" fill="#fff" /><rect x="14.6" width="7.4" height="22" fill="#e1251b" /></>}
      {f === "us" && <><rect width="22" height="22" fill="#fff" />{[0, 2, 4, 6, 8, 10].map((i) => <rect key={i} y={i * 2 + 1} width="22" height="1.7" fill="#d22f3a" />)}<rect width="11" height="11" fill="#2a3a8c" /></>}
      {f === "eu" && <><rect width="22" height="22" fill="#1f3fa5" />{Array.from({ length: 12 }, (_, i) => <circle key={i} cx={11 + 6 * Math.cos((i * Math.PI) / 6)} cy={11 + 6 * Math.sin((i * Math.PI) / 6)} r="1" fill="#ffcc00" />)}</>}
      {f === "oil" && <><rect width="22" height="22" fill="#fff" /><path d="M7 5h8v12H7Z M7 9h8 M7 13h8" stroke="#333" strokeWidth="1.3" fill="none" /></>}
      {f === "gold" && <><rect width="22" height="22" fill="#e6b450" /><path d="M5 15h12l-2-5H7Z" fill="#c8932c" /></>}
      {f === "btc" && <><rect width="22" height="22" fill="#f7931a" /><text x="11" y="16" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Arial">₿</text></>}
    </g>
  </svg>
);

// Série simulée déterministe (pas de données de marché) qui finit sur la variation affichée.
function series(seed: number, change: number, n = 90) {
  let x = seed * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const pts: number[] = [];
  let v = 100;
  for (let i = 0; i < n; i++) { v += (rnd() - 0.5) * 0.28 + Math.sin(i / 9 + seed) * 0.05; pts.push(v); }
  const shift = 100 * (1 + change / 100) - pts[n - 1];
  return pts.map((p, i) => p + (shift * i) / (n - 1));
}
function Spark({ seed, change }: { seed: number; change: number }) {
  const pts = useMemo(() => series(seed, change), [seed, change]);
  const W = 180, H = 74, min = Math.min(...pts, 100), max = Math.max(...pts, 100);
  const y = (v: number) => 4 + (1 - (v - min) / (max - min || 1)) * (H - 8);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = change >= 0, c = up ? "#0a8a5f" : "#d4321c";
  return (
    <svg className="mk-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={`g-${seed}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={c} stopOpacity=".28" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#g-${seed})`} />
      <line x1="0" x2={W} y1={y(100)} y2={y(100)} stroke={c} strokeOpacity=".45" strokeDasharray="2 3" />
      <path d={line} fill="none" stroke={c} strokeWidth="1.4" />
    </svg>
  );
}
const fmtPrice = (v: number) => new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: v % 1 && String(v).split(".")[1]?.length === 3 ? 3 : 2 }).format(v);
const Clock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const Expand = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" /></svg>;
const Ico = ({ d, red }: { d: string; red?: boolean }) => <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={red ? "#e8412a" : "currentColor"} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const Globe = ({ red }: { red?: boolean }) => <svg width={red ? 24 : 30} height={red ? 24 : 30} viewBox="0 0 24 24" fill="none" stroke={red ? "#e8412a" : "currentColor"} strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></svg>;

function MarketsPage({ onLogin }: { onLogin: () => void }) {
  const { t } = useT();
  const regions = ["mk.switzerland", "mk.us", "mk.germany", "mk.euronext", "mk.canada", "mk.austria", "mk.italy", "mk.uk", "mk.scandinavia"];
  const products: [string, boolean][] = [["mk.themes", false], ["mk.dots", true], ["mk.structured", true], ["mk.warrants", false], ["mk.options", true]];
  const rail: [string, string, boolean][] = [
    ["rail.tools", "M4 18l5-6 3 3 6-8M15 7h4v4", false],
    ["rail.markets", "M3 14h4l3-7 4 12 3-7h4", true],
    ["rail.inspiration", "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Z", false],
    ["rail.esg", "M12 21a9 9 0 1 1 9-9M7 12h4M7 9h4M15 15l3 3", false],
    ["rail.crypto", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM10 8v8M13 8v8M9 9h4.5a1.5 1.5 0 0 1 0 3H9M9 12h5a1.5 1.5 0 0 1 0 3H9", false],
  ];
  return (
    <div className="pub">
      <PublicHeader onLogin={onLogin} onHome={() => undefined} />
      <div className="pub-body">
        <aside className="pub-rail">
          {rail.map(([k, d, on]) => (
            <button key={k} className={on ? "on" : ""} onClick={k === "rail.crypto" ? onLogin : undefined}><Ico d={d} /><span>{t(k)}</span></button>
          ))}
        </aside>
        <main className="pub-main">
          <div className="mk-top">
            <h1>{t("mk.title")}</h1>
            <label className="mk-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input placeholder={t("mk.search")} aria-label={t("mk.search")} /></label>
          </div>
          <div className="mk-grid">
            <nav className="mk-nav">
              <p className="mk-nav-title"><Globe red />{t("mk.regions")}</p>
              <button className="on">{t("mk.global")}</button>
              {regions.map((r) => <button key={r}>{t(r)} <span className="chev">›</span></button>)}
              <p className="mk-nav-title"><Ico d="M4 19h16M5 15l4-5 3 3 6-7M14 6h4v4" red />{t("mk.products")}</p>
              {products.map(([p, sub]) => <button key={p}>{t(p)} {sub && <span className="chev">›</span>}</button>)}
            </nav>
            <section className="mk-panel">
              <div className="mk-panel-head">
                <h2><Globe /> {t("mk.daily")}</h2>
                <button className="link mk-perf">{t("mk.performers")} ↗</button>
              </div>
              <div className="mk-cards" data-testid="markets">
                {ROWS.map((r) => (
                  <article key={r.sym} className="mk-card">
                    <div className="mk-card-main">
                      <p className="mk-sym"><FlagIcon f={r.flag} /> <strong>{r.sym}</strong> <span className="mk-dot" /> <span className="mk-name">{r.name}</span> <span className="mk-expand"><Expand /></span></p>
                      <p className="mk-price"><strong>{fmtPrice(r.price)}</strong>{r.unit && <span className="mk-unit"> {r.unit}</span>} <Clock /> <span className={`mk-chg ${r.change >= 0 ? "up" : "down"}`}>{r.change >= 0 ? "▲" : "▼"} {Math.abs(r.change).toFixed(2)}%</span></p>
                      {!r.unit && <button className="link mk-comp">{t("mk.components")}</button>}
                    </div>
                    <Spark seed={r.seed} change={r.change} />
                  </article>
                ))}
              </div>
              <p className="muted small">{t("mk.demo")} <button className="link" onClick={onLogin}>{t("mk.crypto")}</button></p>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------------- Page de connexion ----------------
function LoginPage({ onLogin, onHome }: { onLogin: (s: Session) => void; onHome: () => void }) {
  const { t } = useT();
  const [id, setId] = useState("");
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  return (
    <div className="pub pub-login-page">
      <header className="pub-head">
        <button className="pub-logo" onClick={onHome} aria-label="Swissquote"><Logo size={34} /></button>
        <div className="pub-actions"><LangSelect /></div>
      </header>
      <div className="lg-body">
        <section className="lg-form">
          <h1>{t("login.title")}</h1>
          <form onSubmit={async (e) => { e.preventDefault(); setError(null); try { onLogin(await login(id.trim(), pwd)); } catch (err: any) { setError(/incorrect/i.test(err.message) ? t("login.bad") : err.message); } }}>
            <label className="lg-label" htmlFor="lg-user">{t("login.user")}</label>
            <div className="lg-input">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18.5a6.5 6.5 0 0 1 11 0" /></svg>
              <input id="lg-user" value={id} onChange={(e) => setId(e.target.value)} placeholder={t("login.userPh")} autoComplete="username" autoFocus />
            </div>
            <p className="lg-link"><button type="button" className="link" onClick={() => setHint(true)}>{t("login.userForgot")}</button></p>
            <label className="lg-label" htmlFor="lg-pwd">{t("login.pwd")}</label>
            <div className="lg-input">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15" r="1" /></svg>
              <input id="lg-pwd" type={show ? "text" : "password"} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder={t("login.pwdPh")} autoComplete="current-password" />
              <button type="button" className="lg-eye" aria-label={show ? t("login.hide") : t("login.show")} onClick={() => setShow(!show)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!show && <path d="M4 4l16 16" />}</svg>
              </button>
            </div>
            <p className="lg-link"><button type="button" className="link" onClick={() => setHint(true)}>{t("login.pwdForgot")}</button></p>
            {error && <p className="error">{error}</p>}
            {hint && <p className="note banner">{t("login.forgotDemo")}</p>}
            <button type="submit" className="lg-submit">{t("login.submit")}</button>
          </form>
          <button className="lg-passkey" onClick={async () => { setError(null); try { onLogin(await loginWithPasskey(id.trim())); } catch (err: any) { setError(err.message); } }}>
            {t("login.passkey")}
          </button>
          <p className="lg-link"><button type="button" className="link" onClick={() => setHint(true)}>{t("login.help")}</button></p>
          <div className="lg-sep" />
          <p className="lg-new">{t("login.new")}<br /><button type="button" className="link" onClick={() => setHint(true)}>{t("login.become")}</button></p>
          <p className="muted small lg-demo">{t("login.demo")}</p>
        </section>
        <aside className="lg-visual" aria-hidden="true"><LoginArt /></aside>
      </div>
    </div>
  );
}

// Illustration (dessin original, dans l'esprit de la page Swissquote) : coffre, carte, téléphone et tablette sur fond corail.
function LoginArt() {
  return (
    <svg viewBox="0 0 600 560" className="lg-art">
      <defs>
        <linearGradient id="lg-bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#f6806a" /><stop offset="1" stopColor="#ee4a2b" /></linearGradient>
        <linearGradient id="lg-card" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ff8a6b" /><stop offset=".6" stopColor="#f2542f" /><stop offset="1" stopColor="#c92f17" /></linearGradient>
        <linearGradient id="lg-glass" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".7" /><stop offset="1" stopColor="#fff" stopOpacity=".25" /></linearGradient>
      </defs>
      <rect width="600" height="560" rx="22" fill="url(#lg-bg)" />
      {/* socle */}
      <path d="M90 360 330 230 560 350 320 480Z" fill="#fff" opacity=".92" />
      <path d="M90 360 320 480v22L90 382Z" fill="#e9e3e1" /><path d="M320 480 560 350v22L320 502Z" fill="#d9d1ce" />
      {/* tablette */}
      <path d="M270 250 450 155 560 215 380 310Z" fill="#f4f6fb" stroke="#e1e5ee" />
      <path d="M300 250 440 178M310 262 470 180M330 270 420 222" stroke="#c7cfdd" strokeWidth="5" strokeLinecap="round" />
      <path d="M380 255l25-14 15 4 20-18 18 6" stroke="#2fae6f" strokeWidth="3" fill="none" />
      {/* coffre en verre */}
      <path d="M150 250 240 205 320 245 230 292Z" fill="url(#lg-glass)" /><path d="M150 250v95l80 42v-95Z" fill="#fff" opacity=".55" /><path d="M230 292v95l90-47v-95Z" fill="#fff" opacity=".4" />
      <circle cx="235" cy="330" r="30" fill="#f15a3a" opacity=".85" /><path d="M235 302v56M207 330h56M215 310l40 40M255 310l-40 40" stroke="#333" strokeWidth="3" />
      {/* téléphone */}
      <path d="M180 410 290 352 345 382 235 440Z" fill="#e8412a" /><path d="M192 410 288 360 333 384 238 433Z" fill="#fff" />
      <path d="M215 410l40-21M222 418l50-26M232 424l40-21" stroke="#c7cfdd" strokeWidth="4" strokeLinecap="round" />
      {/* carte */}
      <path d="M330 330 470 258 540 296 400 368Z" fill="url(#lg-card)" /><path d="M330 330v10l70 38v-10Z" fill="#b62b15" /><path d="M400 368v10l140-72v-10Z" fill="#a8240f" />
      <circle cx="488" cy="320" r="11" fill="#eb001b" opacity=".9" /><circle cx="500" cy="314" r="11" fill="#f79e1b" opacity=".9" />
      <text x="430" y="292" fill="#fff" fontSize="15" fontWeight="700" fontFamily="Arial" transform="rotate(-27 430 292)">Swissquote</text>
      {/* pions */}
      <path d="M420 95 470 70 505 88 455 113Z" fill="#fff" /><path d="M420 95v45l35 18v-45Z" fill="#f3d6d0" /><path d="M455 113v45l50-26V88Z" fill="#e6c4bc" />
      <path d="M470 62 500 47 522 58 492 73Z" fill="#2a2a2a" /><path d="M470 62v32l22 11V73Z" fill="#111" /><path d="M492 73v32l30-15V58Z" fill="#333" />
    </svg>
  );
}
