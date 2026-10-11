// Courbe de prix d'un actif (style plateforme Swissquote) : aire verte ou rouge selon la tendance de la période,
// étiquette du dernier prix, axes, réticule au survol (prix et date), sélecteur de période. Données : lib/market.
import { useEffect, useMemo, useRef, useState } from "react";
import { type Coin, PERIODS, type Period, history } from "../lib/market";
import { num } from "./format";
import { useT } from "../i18n";

const W = 640, H = 240, PAD = { l: 8, r: 64, t: 14, b: 26 };

export function PriceChart({ coin, label }: { coin: Coin; label: string }) {
  const { tr, lang } = useT();
  const loc = lang === "fr" ? "fr-CH" : "en-GB";
  const [period, setPeriod] = useState<Period>("1M");
  const [pts, setPts] = useState<[number, number][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let live = true;
    setPts(null); setError(null);
    history(coin, period).then((p) => live && setPts(p), (e) => live && setError(e.message));
    return () => { live = false; };
  }, [coin, period]);

  const g = useMemo(() => {
    if (!pts || pts.length < 2) return null;
    const ys = pts.map((p) => p[1]);
    let min = Math.min(...ys), max = Math.max(...ys);
    if (max - min < max * 0.002) { min -= max * 0.001; max += max * 0.001; } // stablecoin : éviter une courbe « en dents de scie »
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
    const line = pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const up = ys[ys.length - 1] >= ys[0];
    const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
    const xt = [0, 1, 2, 3, 4].map((i) => t0 + ((t1 - t0) * i) / 4);
    return { x, y, line, up, ticks, xt, first: ys[0], last: ys[ys.length - 1], min, max, t0, t1 };
  }, [pts]);

  const fmtDate = (t: number) => new Date(t).toLocaleString(loc, period === "1D" ? { hour: "2-digit", minute: "2-digit" } : period === "1Y" ? { month: "short", year: "2-digit" } : { day: "2-digit", month: "short" });
  const decimals = coin === "usd-coin" ? 4 : 0;
  const price = (v: number) => num(v, decimals);
  const onMove = (e: React.MouseEvent) => {
    if (!pts || !g || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const t = g.t0 + (((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r) * (g.t1 - g.t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - t) < Math.abs(pts[best][0] - t)) best = i;
    setHover(best);
  };
  const h = hover !== null && pts ? pts[hover] : null;
  const change = g ? ((g.last - g.first) / g.first) * 100 : 0;
  const color = g?.up ? "#0a8a5f" : "#d4321c";

  return (
    <div className="price-chart" data-testid={`price-chart-${coin}`}>
      <div className="pc-head">
        <div>
          <p className="pc-title">{label}</p>
          {g && <p className="pc-last"><strong>{price(g.last)} CHF</strong> <span className={g.up ? "up" : "down"}>{change >= 0 ? "+" : ""}{num(change, 2)}% · {period}</span></p>}
        </div>
        <div className="segmented pc-periods">
          {PERIODS.map((p) => <button key={p} className={p === period ? "on" : ""} onClick={() => setPeriod(p)}>{p}</button>)}
        </div>
      </div>
      {!pts && !error && <div className="pc-empty muted small">{tr("Loading market data…")}</div>}
      {error && <div className="pc-empty error small">{tr("Market data unavailable ({e}). Balances use the last known or simulated rate.", { e: error })}</div>}
      {g && (
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="pc-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${label} price, ${period}`}>
          <defs>
            <linearGradient id={`pc-${coin}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".22" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {g.ticks.map((v, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={g.y(v)} y2={g.y(v)} stroke="#eef1f6" />
              <text x={W - PAD.r + 6} y={g.y(v) + 4} className="pc-axis">{price(v)}</text>
            </g>
          ))}
          {g.xt.map((t, i) => <text key={i} x={g.x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} className="pc-axis">{fmtDate(t)}</text>)}
          <line x1={PAD.l} x2={W - PAD.r} y1={g.y(g.first)} y2={g.y(g.first)} stroke={color} strokeDasharray="2 3" strokeOpacity=".6" />
          <path d={`${g.line} L${g.x(g.t1)},${H - PAD.b} L${g.x(g.t0)},${H - PAD.b} Z`} fill={`url(#pc-${coin})`} />
          <path d={g.line} fill="none" stroke={color} strokeWidth="2" />
          <rect x={W - PAD.r + 2} y={g.y(g.last) - 10} width={PAD.r - 4} height="20" rx="4" fill={color} />
          <text x={W - PAD.r / 2} y={g.y(g.last) + 4} textAnchor="middle" className="pc-tag">{price(g.last)}</text>
          {h && (
            <g>
              <line x1={g.x(h[0])} x2={g.x(h[0])} y1={PAD.t} y2={H - PAD.b} stroke="#9aa3b2" strokeDasharray="3 3" />
              <circle cx={g.x(h[0])} cy={g.y(h[1])} r="4.5" fill="#fff" stroke={color} strokeWidth="2.5" />
              <g transform={`translate(${Math.min(Math.max(g.x(h[0]) - 60, PAD.l), W - PAD.r - 124)},${PAD.t})`}>
                <rect width="120" height="38" rx="5" fill="#fff" stroke="#e1e5ec" />
                <text x="8" y="16" className="pc-tip-price">CHF {price(h[1])}</text>
                <text x="8" y="30" className="pc-axis">{new Date(h[0]).toLocaleString(loc, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</text>
              </g>
            </g>
          )}
        </svg>
      )}
      <p className="muted small pc-source">{tr("Market price of {c} from CoinGecko, for information. Your coins are on a test network and have no value.", { c: coin === "bitcoin" ? tr("bitcoin (mainnet)") : "USDC" })}</p>
    </div>
  );
}
