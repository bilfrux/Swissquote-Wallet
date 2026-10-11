// Cloche d'alertes (comme dans l'en-tête Swissquote). Les alertes viennent de bank-mock : elles informent,
// mais ne protègent pas (sans Swissquote, plus d'alertes ; la protection reste le délai on-chain et le rafraîchissement).
import { useEffect, useState } from "react";
import { type Notification, markNotificationsRead, notifications } from "../lib/bank";
import { IconBell } from "./icons";
import { useT } from "../i18n";

export function NotificationBell({ round = false }: { round?: boolean }) {
  const { tr } = useT();
  const [data, setData] = useState<{ unread: number; items: Notification[] } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () => notifications().then(setData, () => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) { await markNotificationsRead().catch(() => undefined); setData({ ...data, unread: 0 }); }
  };
  return (
    <div className="bell-wrap">
      <button className={round ? "round bell" : "bell"} aria-label={tr("Alerts") + (data?.unread ? ` (${tr("{n} unread", { n: data.unread })})` : "")} onClick={toggle}>
        <IconBell />
        {!!data?.unread && <span className="badge-count" data-testid="bell-count">{data.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" data-testid="bell-panel">
          <p className="bell-head"><strong>{tr("Alerts")}</strong> <span className="muted small">{tr("by simulated email and in the app")}</span></p>
          {!data?.items.length && <p className="muted small">{tr("No alerts.")}</p>}
          {data?.items.map((n) => (
            <div key={n.id} className={`bell-item ${n.kind}`}>
              <p className="bell-title">{n.title}</p>
              <p className="small">{n.body}</p>
              <p className="muted small">{n.createdAt.replace("T", " ").slice(0, 16)} UTC</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
