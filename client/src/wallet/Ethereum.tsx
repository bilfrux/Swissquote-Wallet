// Compte Ethereum (Sepolia) : un Safe dont le propriétaire est la clé Ethereum du Wallet du client (même phrase que
// le Bitcoin). Swissquote et le tiers sont les deux gardiens du module de recovery (seuil 2, délai appliqué par le contrat).
// L'appli prépare les opérations ; le Wallet du client les décode, les fait confirmer et les signe ; un paymaster
// (tiers, pas Swissquote) paie les frais : le client n'a pas besoin d'ETH.
// Même mise en page que la fiche Bitcoin : en-tête (solde, état, actions), panneau d'action, onglets.
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { type Address, encodeFunctionData, formatUnits, getAddress, isAddress, parseUnits } from "viem";
import { type Activity, EXPLORER, USDC_DECIMALS, publicClient, RECOVERY_DELAY_LABEL, RECOVERY_MODULE, activationCalls, activity, buildSponsoredOp, cancelRecoveryCalls, contactChangeCalls, finalizeRecoveryCall, readState, recoveryAbi, safeAddressOf, sendOp, startRecoveryCall, usdcTransferCall } from "@sq/evm";
import { type EvmAccount, changeEvmTiers, evmAccounts, evmSignRecovery, registerEvm, relayCreate, relayGet, syncEvm, verifyIdentity } from "../lib/bank";
import { priceOf, usePrices } from "../lib/market";
import { PriceChart } from "../ui/PriceChart";
import { walletRequest } from "../lib/walletBridge";
import { useT } from "../i18n";
import { num } from "../ui/format";
import { IconBank, IconReceive, IconRefresh, IconSend, IconShield } from "../ui/icons";
import { useIsMobile } from "../ui/useIsMobile";

const CONSOLE_URL = import.meta.env.VITE_GUARDIAN_CONSOLE_URL ?? "http://localhost:5174";

type State = Awaited<ReturnType<typeof readState>>;
const cacheKey = (cid: string) => `sq-wallet:evm:${cid}`;
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const usdc = (v: bigint) => `${formatUnits(v, USDC_DECIMALS)} USDC`;
export type EvmInfo = { added: boolean; safe?: Address; usdc?: bigint };
type Panel = "receive" | "send" | "recover";
type SubTab = "activity" | "assets" | "security";
const KIND: Record<Activity["kind"], string> = {
  "usdc-in": "USDC received", "usdc-out": "USDC sent", "recovery-started": "Recovery started (Swissquote + trusted contact)",
  "recovery-completed": "Recovery completed: new owner", "recovery-cancelled": "Recovery cancelled", "signatures-invalidated": "Leftover guardian signatures invalidated",
};

export const EthIcon = ({ size = 44 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#627eea" /><path d="M22 7 13 22.3l9 5.3 9-5.3L22 7Z" fill="#fff" /><path d="m13 24.1 9 12.9 9-12.9-9 5.3-9-5.3Z" fill="#fff" fillOpacity=".75" /></svg>
);

export function Ethereum({ customerId, accountKey, tiersName, onInfo }: { customerId: string; accountKey: string; tiersName?: string | null; onInfo?: (i: EvmInfo) => void }) {
  const mobile = useIsMobile();
  const market = usePrices();
  const { tr, lang } = useT();
  const loc = lang === "fr" ? "fr-CH" : "en-GB";
  const USDC_CHF = priceOf(market, "usd-coin");
  const [acc, setAcc] = useState<EvmAccount | null | undefined>(undefined);
  const [sq, setSq] = useState<Address | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [acts, setActs] = useState<{ items: Activity[]; since: bigint } | null>(null);
  const [actsError, setActsError] = useState<string | null>(null);
  const [tiersAddr, setTiersAddr] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<{ label: string; hash: string }[]>([]); // opérations de cette session, la plus récente d'abord
  // Opération préparée, en attente de signature : la fenêtre du wallet s'ouvre sur un clic (sinon le navigateur la bloque).
  const [ready, setReady] = useState<{ label: string; op: Awaited<ReturnType<typeof buildSponsoredOp>>; after?: (blockNumber: bigint) => Promise<void> } | null>(null);
  const [panel, setPanel] = useState<Panel>("receive");
  const [sub, setSub] = useState<SubTab>("activity");
  const [qr, setQr] = useState("");
  const [allActs, setAllActs] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cached = JSON.parse(localStorage.getItem(cacheKey(customerId)) ?? "null");
    evmAccounts().then(
      (r) => { const a = r.accounts.at(-1) ?? null; setSq(a?.swissquote ?? null); setAcc(a); if (a) localStorage.setItem(cacheKey(customerId), JSON.stringify(a)); },
      () => { setAcc(cached); setSq(cached?.swissquote ?? null); },
    );
  }, [customerId]);
  const refresh = useCallback(async (blockNumber?: bigint) => {
    if (!acc) return;
    try { setState(await readState(acc.safe, blockNumber)); } catch (e: any) { setError(`${tr("chain read failed:")} ${e.message}`); }
    setActsError(null);
    activity(acc.safe).then(setActs, (e) => setActsError(e?.shortMessage ?? e?.message ?? String(e)));
  }, [acc]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { onInfo?.({ added: !!acc, safe: acc?.safe, usdc: state?.usdc }); }, [acc, state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (acc) QRCode.toString(`ethereum:${acc.safe}@11155111`, { type: "svg", margin: 1, width: 180 }).then(setQr, () => setQr("")); }, [acc]);

  const run = (label: string, f: () => Promise<void>) => async () => {
    setError(null); setBusy(label);
    try { await f(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  // 1) Prépare l'opération et la fait parrainer ; 2) sur un clic, la fait signer dans le Wallet du client, l'envoie,
  // puis relit l'état AU bloc de l'inclusion (le nœud public peut renvoyer un état en retard).
  type Prepared = NonNullable<typeof ready>;
  const prepare = async (label: string, calls: Parameters<typeof buildSponsoredOp>[1], from: { safe: Address; owner: Address } = acc!, after?: (blockNumber: bigint) => Promise<void>) => {
    const op = await buildSponsoredOp(from, calls);
    const prepared = { label, op, after };
    setReady(prepared);
    return prepared;
  };
  const signAndSend = async (prepared: Prepared = ready!) => {
    const { signature } = await walletRequest<{ signature: string }>("evm-sign", { op: prepared.op });
    const r = await sendOp(prepared.op, signature);
    setTxs((t) => [{ label: prepared.label, hash: r.txHash }, ...t]);
    const after = prepared.after;
    setReady(null);
    await refresh(r.blockNumber);
    if (after) await after(r.blockNumber);
  };
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent<Panel>).detail; if (t === "receive" || t === "send" || t === "recover") setPanel(t); };
    window.addEventListener("sq-evm", on);
    return () => window.removeEventListener("sq-evm", on);
  }, []);
  const open = (p: Panel) => { setPanel(p); if (mobile) setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); };

  if (acc === undefined) return <section className="card" data-testid="evm-card"><p className="muted">{tr("Loading…")}</p></section>;
  if (!acc)
    return (
      <section className="card evm" data-testid="evm-card">
        <div className="asset-id"><EthIcon /><div><h1>Ethereum · USDC</h1><p className="muted small">{tr("Sepolia testnet · not added yet")}</p></div></div>
        <p className="small">{tr("Add an Ethereum account to your wallet: same Client Wallet, same secret phrase. Recovery works as for Bitcoin: Swissquote and your trusted contact together, after a delay enforced by the contract, which you can cancel.")}</p>
        <label>{tr("{who}'s Ethereum address", { who: tiersName ?? tr("Trusted contact") })}
          <input className="mono" placeholder="0x…" value={tiersAddr} onChange={(e) => setTiersAddr(e.target.value.trim())} />
        </label>
        <p className="muted small">{tr("Shown in their guardian console (same phrase as their Bitcoin key).")}</p>
        <button className="btn-primary" disabled={!!busy || !isAddress(tiersAddr)} onClick={run("add", async () => {
          const { evmAddress } = await walletRequest<{ evmAddress: string }>("evm-address", { accountKey });
          const a = await registerEvm(evmAddress, getAddress(tiersAddr), tiersName);
          setSq(a.swissquote); setAcc(a);
          localStorage.setItem(cacheKey(customerId), JSON.stringify(a));
        })}>{busy === "add" ? tr("Waiting for your Client Wallet…") : tr("Add my Ethereum account")}</button>
        {error && <p className="error">{error}</p>}
      </section>
    );

  const label = (a: string) => (sq && a.toLowerCase() === sq.toLowerCase() ? "Swissquote" : a.toLowerCase() === acc.tiers.toLowerCase() ? acc.tiersName ?? tr("trusted contact") : short(a));
  const active = !!(state?.deployed && state.moduleEnabled && state.threshold === 2n);
  const balance = state?.usdc ?? 0n;
  const status = !state ? null : state.pending ? { cls: "bad", text: tr("Recovery in progress") } : active ? { cls: "ok", text: tr("Protected: Swissquote + {who}, {d} delay", { who: acc.tiersName ?? "contact", d: RECOVERY_DELAY_LABEL }) } : { cls: "warn", text: tr("Not active yet") };

  const header = (
    <section className="card asset-head">
      <div className="asset-id">
        <EthIcon />
        <div><h1>Ethereum · USDC</h1><p className="muted small">{tr("self-custody")} · Sepolia · <a className="mono" href={`${EXPLORER}/address/${acc.safe}`} target="_blank" rel="noreferrer" title={acc.safe}>{short(acc.safe)}</a> <button className="link small" onClick={() => { navigator.clipboard?.writeText(acc.safe); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? tr("copied") : "⧉"}</button><span hidden data-testid="evm-safe">{acc.safe}</span></p></div>
        {!mobile && <button className="link refresh" onClick={() => refresh()}><IconRefresh /> {tr("Reload")}</button>}
      </div>
      <div className="asset-balance">
        <p className="asset-btc" data-testid="evm-usdc">{state ? usdc(balance) : "…"}</p>
        <p className="muted">≈ {num((Number(balance) / 10 ** USDC_DECIMALS) * USDC_CHF)} CHF <span className="small">({market?.["usd-coin"].source === "CoinGecko" ? tr("market price, test coins have no value") : tr("simulated rate")}) · {tr("0 ETH needed")}</span></p>
        {status && <span className={`chip ${status.cls}`}><IconShield /> {status.text}</span>}
      </div>
      <div className="round-actions asset-actions">
        <button className={panel === "receive" ? "on" : ""} onClick={() => open("receive")}><span className="round dark"><IconReceive /></span>{tr("Receive")}</button>
        <button className={panel === "send" ? "on" : ""} disabled={!active} onClick={() => open("send")}><span className="round dark"><IconSend /></span>{tr("Send")}</button>
        <button className={panel === "recover" ? "on" : ""} disabled={!active} onClick={() => open("recover")}><span className="round dark"><IconShield /></span>{tr("Recover")}</button>
        <button disabled title={tr("Swissquote account ↔ wallet transfers: Bitcoin only for now")}><span className="round dark"><IconBank /></span>{tr("Transfer (soon)")}</button>
      </div>
      {active && <p className="small muted span-all" data-testid="evm-guardians">{tr("Recovery guardians:")} {state!.guardians.map(label).join(" + ")} {tr("(both needed) · owner: your Client Wallet")} ({short(state!.owners[0])})</p>}
    </section>
  );

  const alerts = (
    <>
      {state && !active && (
        <div className="warning">
          <p>{tr("Not active yet. Activating creates your account on-chain and sets its two recovery guardians: Swissquote and {who} (both needed, {d} delay that you can cancel). Network fees are sponsored: you need no ETH.", { who: acc.tiersName ?? tr("your trusted contact"), d: RECOVERY_DELAY_LABEL })}</p>
          <button disabled={!!busy || !sq} onClick={run("activate", async () => { await prepare("Activation", activationCalls(acc.safe, sq!, acc.tiers)); })}>
            {busy === "activate" ? tr("Preparing…") : tr("Activate my Ethereum account")}
          </button>
        </div>
      )}
      {state?.pending && (
        <div className="warning" data-testid="evm-pending">
          <p><strong>{tr("Recovery in progress on this account")}</strong>: {tr("ownership would go to {who} after {t}. If you did not ask for it, cancel it now.", { who: state.pending.newOwners.map(short).join(", "), t: new Date(state.pending.executeAfter * 1000).toLocaleString(loc) })}</p>
          <button disabled={!!busy} onClick={run("cancel", async () => { await prepare("Recovery cancelled", cancelRecoveryCalls()); })}>{busy === "cancel" ? tr("Preparing…") : tr("Cancel this recovery")}</button>
        </div>
      )}
      {ready && (
        <div className="note banner" data-testid="evm-ready">
          <p>{tr(ready.label === "USDC sent" ? "Transfer" : ready.label)} {tr("prepared, network fees sponsored. Confirm it in your Client Wallet: it decodes the operation itself.")}</p>
          <button disabled={!!busy} onClick={run("sign", signAndSend)}>{busy === "sign" ? tr("Waiting for your Client Wallet, then the network…") : tr("Sign with my Client Wallet")}</button>
        </div>
      )}
      {txs.map((t, i) => (
        <p key={t.hash} className={i === 0 ? "success" : "muted small"} data-testid={i === 0 ? "evm-last-tx" : "evm-tx"}>{tr(t.label)}: <a href={`${EXPLORER}/tx/${t.hash}`} target="_blank" rel="noreferrer" className="mono">{t.hash}</a></p>
      ))}
      {error && <p className="error">{error}</p>}
    </>
  );

  const sidePanel = panel === "send" && active ? (
    <section className="card side-panel">
      <div className="panel-head"><h2>{tr("Send USDC")}</h2><button className="link" aria-label={tr("Close")} onClick={() => setPanel("receive")}>✕</button></div>
      <div className="send">
        <label>{tr("Recipient")}<input className="mono" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} /></label>
        <label>{tr("Amount (USDC)")}<input placeholder="1" value={amount} onChange={(e) => setAmount(e.target.value.trim())} /></label>
        <button className="btn-primary wide" disabled={!!busy || !isAddress(to) || !(Number(amount) > 0)} onClick={run("send", async () => {
          const prepared = await prepare("USDC sent", [usdcTransferCall(getAddress(to), parseUnits(amount, USDC_DECIMALS))]);
          await signAndSend(prepared);
        })}>
          {busy === "send" ? tr("Preparing…") : tr("Send USDC")}
        </button>
        <p className="muted small">{tr("Fees sponsored by a paymaster (third party, not Swissquote). Your Client Wallet shows the transfer in clear before signing.")}</p>
      </div>
    </section>
  ) : panel === "recover" && state ? (
    <section className="card side-panel">
      <div className="panel-head"><h2>{tr("Recover this account")}</h2><button className="link" aria-label={tr("Close")} onClick={() => setPanel("receive")}>✕</button></div>
      <EvmRecovery acc={acc} state={state} busy={busy} run={run} prepare={async (...args) => { await prepare(...args); }}
        onRecovered={async (blockNumber) => {
          const a = await syncEvm(acc.safe, blockNumber);
          setAcc(a); localStorage.setItem(cacheKey(customerId), JSON.stringify(a));
          await refresh(blockNumber);
          // Règle du projet après toute recovery : invalider les signatures de gardiens déjà collectées (nonce du module).
          await prepare("Leftover guardian signatures invalidated", [{ to: RECOVERY_MODULE, value: 0n, data: encodeFunctionData({ abi: recoveryAbi, functionName: "invalidateNonce" }) }], { safe: a.safe, owner: a.owner });
          setPanel("receive");
        }} />
    </section>
  ) : (
    <section className="card side-panel">
      <h2>{tr("Receive USDC")}</h2>
      {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
      <p className="mono address">{acc.safe}</p>
      <div className="btn-row">
        <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(acc.safe)}>{tr("Copy address")}</button>
      </div>
      <p className="muted small"><a href={`${EXPLORER}/address/${acc.safe}`} target="_blank" rel="noreferrer">{tr("View in explorer")}</a></p>
      <p className="muted small">{tr("Ethereum Sepolia only. Send USDC (test) to this address; no ETH is needed to use it.")}</p>
    </section>
  );

  const chart = <section className="card"><PriceChart coin="usd-coin" label="USDC · USDC/CHF" /></section>;
  const tabs = (
    <section className="card">
      <div className="segmented crypto-tabs evm-tabs">
        {([["activity", "Activity"], ["assets", "Assets"], ["security", "Security"]] as const).map(([k, l]) => (
          <button key={k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>{tr(l)}</button>
        ))}
      </div>
      {sub === "activity" && (
        <div data-testid="evm-activity">
          {!acts && !actsError && <p className="muted small">{tr("Loading…")}</p>}
          {!acts && actsError && <p className="error small">{tr("Activity unavailable (public node):")} {actsError} <button className="link" onClick={() => refresh()}>{tr("Retry")}</button></p>}
          {acts && acts.items.length === 0 && <p className="muted small">{tr("No activity in the recent blocks.")}</p>}
          {acts && acts.items.length > 0 && (
            <div className="tx-list">
              {(allActs ? acts.items : acts.items.slice(0, 8)).map((h) => {
                const dir = h.kind === "usdc-in" ? "in" : h.kind === "usdc-out" ? "out" : "self";
                return (
                  <div key={`${h.txHash}:${h.logIndex}`} className={`tx-row kind-${h.kind}`}>
                    <span className={`tx-icon ${dir}`}>{dir === "in" ? <IconReceive /> : dir === "out" ? <IconSend /> : <IconShield />}</span>
                    <div className="tx-main">
                      <p className="tx-kind">{tr(KIND[h.kind])}</p>
                      <p className="muted small">
                        {h.time ? new Date(h.time * 1000).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" }) : `${tr("block")} ${h.blockNumber}`}
                        {h.counterparty && <> · {dir === "in" ? tr("from") : tr("to")} {label(h.counterparty)}</>} · <a href={`${EXPLORER}/tx/${h.txHash}`} target="_blank" rel="noreferrer">{tr("explorer")}</a>
                      </p>
                    </div>
                    <p className={`tx-amount ${dir === "out" ? "neg" : dir === "in" ? "pos" : "muted"}`}>{h.amount !== undefined ? `${dir === "out" ? "−" : "+"}${usdc(h.amount)}` : ""}</p>
                  </div>
                );
              })}
            </div>
          )}
          {acts && acts.items.length > 8 && <button className="link" onClick={() => setAllActs(!allActs)}>{allActs ? tr("Show less") : tr("Show all ({n})", { n: acts.items.length })}</button>}
          {acts && <p className="muted small">{tr("Read on-chain since block {b} (the public node keeps a limited history).", { b: acts.since.toString() })}</p>}
        </div>
      )}
      {sub === "assets" && (
        <table>
          <thead><tr><th>{tr("Asset")}</th><th>{tr("Balance")}</th><th>{tr("Value")}</th></tr></thead>
          <tbody>
            <tr><td>{tr("USDC (test, Circle)")}</td><td>{usdc(balance)}</td><td>≈ {num((Number(balance) / 10 ** USDC_DECIMALS) * USDC_CHF)} CHF</td></tr>
            <tr><td>ETH</td><td>0 ETH</td><td className="muted">{tr("not needed: fees are sponsored")}</td></tr>
          </tbody>
        </table>
      )}
      {sub === "security" && (
        <div>
          <div className="sec-grid">
            <div className="sec-item"><p className="sec-who">{tr("You")}</p><p className="small">{tr("Spend on your own, at any time, with your Client Wallet")}{state?.owners[0] ? ` (${short(state.owners[0])})` : ""}.</p></div>
            <div className="sec-item"><p className="sec-who">Swissquote + {acc.tiersName ?? tr("trusted contact")}</p><p className="small">{tr("Only together, then a {d} delay enforced by the contract, during which you can cancel.", { d: RECOVERY_DELAY_LABEL })}</p></div>
            <div className="sec-item"><p className="sec-who">{tr("Swissquote alone")}</p><p className="small">{tr("Cannot start a recovery, nor spend anything.")}</p></div>
          </div>
          {active && state && (
            <EvmChangeContact acc={acc} guardians={state.guardians} pending={!!state.pending} busy={busy} run={run}
              prepare={async (label, calls, after) => { await prepare(label, calls, acc, after); }}
              onChanged={(a) => { setAcc(a); localStorage.setItem(cacheKey(customerId), JSON.stringify(a)); }} />
          )}
          {active && <button className="link" onClick={() => open("recover")}>{tr("Lost the key of this Ethereum account? Recover it")}</button>}
        </div>
      )}
    </section>
  );

  return (
    <div className={mobile ? "crypto m evm" : "d-page crypto evm"} data-testid="evm-card">
      {alerts}
      {/* Même arbre en téléphone et en ordinateur (seule la classe change) : basculer de mise en page au passage des 820 px
          ne remonte pas les composants, donc n'efface pas un formulaire en cours (étape 57). En téléphone, le CSS remet le
          panneau latéral juste sous l'en-tête. */}
      <div className={mobile ? "crypto-grid stack" : "crypto-grid"}>
        <div className="crypto-main">{header}{chart}{tabs}</div>
        <div ref={panelRef} className="crypto-side">{sidePanel}</div>
      </div>
    </div>
  );
}

// Recovery Ethereum depuis un nouvel appareil : re-KYC, nouvelle clé (nouveau Wallet du client), signature de Swissquote,
// demande au tiers par le relais, puis démarrage, délai appliqué par le contrat, et finalisation. Les signatures des
// gardiens sont relayées par le Safe de la NOUVELLE clé (frais parrainés) : personne n'a besoin d'ETH.
function EvmRecovery({ acc, state, busy, run, prepare, onRecovered }: {
  acc: EvmAccount; state: State; busy: string | null;
  run: (label: string, f: () => Promise<void>) => () => Promise<void>;
  prepare: (label: string, calls: Parameters<typeof buildSponsoredOp>[1], from?: { safe: Address; owner: Address }, after?: (b: bigint) => Promise<void>) => Promise<void>;
  onRecovered: (blockNumber: bigint) => Promise<void>;
}) {
  const { tr } = useT();
  // Progression mémorisée dans la session (comme la recovery Bitcoin) : un remontage ou un rechargement ne la perd pas.
  // Données publiques ou à usage unique (jeton de re-KYC de 10 min, signatures des gardiens, clés publiques).
  const persisted = <T,>(name: string, initial: T) => {
    const key = `sq-evm-recovery:${acc.safe}:${name}`;
    const [v, setV] = useState<T>(() => JSON.parse(sessionStorage.getItem(key) ?? "null") ?? initial);
    return [v, (x: T) => { sessionStorage.setItem(key, JSON.stringify(x)); setV(x); }] as const;
  };
  const [kyc, setKyc] = useState({ lastName: "", birthDate: "", otp: "" });
  const [token, setToken] = persisted<string | null>("token", null);
  const [newWallet, setNewWallet] = persisted<string | null>("newWallet", null); // clé publique Bitcoin du nouveau wallet (le désigne)
  const [newOwner, setNewOwner] = persisted<Address | null>("newOwner", null);
  const [sqSig, setSqSig] = persisted<{ signer: Address; signature: `0x${string}`; nonce: string } | null>("sqSig", null);
  const [relayId, setRelayId] = persisted<string | null>("relayId", null);
  const [tSig, setTSig] = persisted<{ signer: Address; signature: `0x${string}` } | null>("tSig", null);
  const restart = () => { for (const k of Object.keys(sessionStorage)) if (k.startsWith(`sq-evm-recovery:${acc.safe}:`)) sessionStorage.removeItem(k); location.reload(); };
  const [now, setNow] = useState(Date.now());
  // Le contrat compare le délai à l'horodatage du DERNIER BLOC, pas à l'horloge du navigateur.
  const [chainTime, setChainTime] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // Heure de la chaîne interrogée seulement autour de l'échéance (le nœud public limite le débit).
  const due = state.pending ? state.pending.executeAfter * 1000 - now <= 0 : false;
  useEffect(() => {
    if (!due) return;
    const poll = () => publicClient.getBlock().then((b) => setChainTime(Number(b.timestamp)), () => undefined);
    poll();
    const c = setInterval(poll, 5000);
    return () => clearInterval(c);
  }, [due]);
  const relaySafe = newOwner ? { safe: safeAddressOf(newOwner), owner: newOwner } : null;
  const pendingToMe = state.pending && newOwner && state.pending.newOwners.map((o) => o.toLowerCase()).includes(newOwner.toLowerCase());
  const left = state.pending ? state.pending.executeAfter * 1000 - now : 0;
  return (
    <div className="card recovery-evm" data-testid="evm-recovery">
      <h4>{tr("Recover this Ethereum account")}</h4>
      <p className="small">{tr("Swissquote and {who} must both sign; the contract then waits {d}, during which the current key can cancel.", { who: acc.tiersName ?? tr("your trusted contact"), d: RECOVERY_DELAY_LABEL })}</p>
      {!token && (
        <div className="step">
          <p>{tr("1. Verify your identity with Swissquote")}</p>
          <input placeholder={tr("Last name")} value={kyc.lastName} onChange={(e) => setKyc({ ...kyc, lastName: e.target.value })} />
          <input placeholder={tr("Date of birth (YYYY-MM-DD)")} value={kyc.birthDate} onChange={(e) => setKyc({ ...kyc, birthDate: e.target.value })} />
          <input placeholder={tr("Code received by SMS")} value={kyc.otp} onChange={(e) => setKyc({ ...kyc, otp: e.target.value })} />
          <button disabled={!!busy} onClick={run("kyc", async () => setToken((await verifyIdentity(kyc)).token))}>{tr("Verify my identity")}</button>
        </div>
      )}
      {token && !newOwner && (
        <div className="step">
          <p>{tr("2. Your new key: a new Client Wallet on this device")}</p>
          {!newWallet
            ? <button disabled={!!busy} onClick={run("new-wallet", async () => setNewWallet((await walletRequest<{ accountKey: string }>("create", { label: "Wallet after recovery" })).accountKey))}>{tr("Create a new Client Wallet")}</button>
            : <button disabled={!!busy} onClick={run("new-owner", async () => setNewOwner((await walletRequest<{ evmAddress: Address }>("evm-address", { accountKey: newWallet })).evmAddress))}>{tr("Get its Ethereum address")}</button>}
        </div>
      )}
      {newOwner && !state.pending && (
        <div className="step">
          <p>{tr("New owner:")} <span className="mono" data-testid="evm-new-owner">{newOwner}</span></p>
          {!sqSig && <button disabled={!!busy} onClick={run("sq", async () => setSqSig(await evmSignRecovery(token!, acc.safe, newOwner)))}>{tr("Request Swissquote's signature")}</button>}
          {sqSig && !relayId && <button disabled={!!busy} onClick={run("relay", async () => setRelayId(await relayCreate(JSON.stringify({ kind: "evm-recovery", safe: acc.safe, newOwner, nonce: sqSig.nonce }))))}>{tr("Send the request to {who}", { who: acc.tiersName ?? tr("your trusted contact") })}</button>}
          {relayId && !tSig && (
            <>
              <p className="small">{tr("Link for {who}:", { who: acc.tiersName ?? tr("your trusted contact") })} <span className="mono" data-testid="evm-relay-link">{`${CONSOLE_URL}/?req=${relayId}`}</span></p>
              <button disabled={!!busy} onClick={run("fetch", async () => { const r = await relayGet(relayId); if (!r.signed) throw new Error(tr("not signed yet")); setTSig(JSON.parse(r.signed)); })}>{tr("Fetch the trusted contact's signature")}</button>
            </>
          )}
          {sqSig && tSig && (
            <button disabled={!!busy} onClick={run("start", () => prepare("Recovery started", [startRecoveryCall(acc.safe, newOwner, [sqSig, tSig])], relaySafe!))}>{tr("Start the recovery")}</button>
          )}
        </div>
      )}
      {token && <p className="small"><button className="link" onClick={restart}>{tr("Restart this recovery")}</button></p>}
      {pendingToMe && (
        <div className="step" data-testid="evm-countdown">
          {left > 0
            ? <p>{tr("Recovery started. The contract allows it to complete in")} <strong>{Math.ceil(left / 1000)} s</strong>.</p>
            : chainTime <= state.pending!.executeAfter && now < (state.pending!.executeAfter + 60) * 1000 // repli si l'heure de la chaîne reste illisible
            ? <p>{tr("Delay elapsed: waiting for the next block to confirm it on-chain…")}</p>
            : <button disabled={!!busy} onClick={run("finalize", () => prepare("Recovery completed", [finalizeRecoveryCall(acc.safe)], relaySafe!, async (b) => {
                for (const k of Object.keys(sessionStorage)) if (k.startsWith(`sq-evm-recovery:${acc.safe}:`)) sessionStorage.removeItem(k);
                await onRecovered(b);
              }))}>{tr("Complete the recovery")}</button>}
        </div>
      )}
    </div>
  );
}

// Changement du contact de confiance Ethereum (étape 58) : un seul lot signé dans le Client Wallet (annulation d'une
// recovery en cours s'il y en a, retrait de l'ancien contact, ajout du nouveau, invalidation des signatures collectées).
// Le wallet affiche l'ancienne et la nouvelle adresse ; Swissquote met ensuite son registre à jour d'après la chaîne.
function EvmChangeContact({ acc, guardians, pending, busy, run, prepare, onChanged }: {
  acc: EvmAccount; guardians: Address[]; pending: boolean; busy: string | null;
  run: (label: string, f: () => Promise<void>) => () => Promise<void>;
  prepare: (label: string, calls: ReturnType<typeof contactChangeCalls>, after: (blockNumber: bigint) => Promise<void>) => Promise<void>;
  onChanged: (a: EvmAccount) => void;
}) {
  const { tr } = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const invalid = !isAddress(addr) ? null : [acc.owner, acc.safe, ...guardians].some((x) => x.toLowerCase() === addr.toLowerCase()) ? tr("This address is already your key, your account or a guardian.") : null;
  if (!open)
    return (
      <div className="sec-item" data-testid="evm-contact">
        <p className="sec-who">{tr("Trusted contact")}: {acc.tiersName ?? tr("your trusted contact")}</p>
        <p className="small mono">{acc.tiers}</p>
        <button className="btn-secondary" onClick={() => setOpen(true)}>{tr("Change my trusted contact")}</button>
      </div>
    );
  return (
    <div className="sec-item" data-testid="evm-contact-form">
      <p className="sec-who">{tr("Change my trusted contact")}</p>
      <label><span>{tr("New contact's name")}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marie Dupont" /></label>
      <label><span>{tr("New contact's Ethereum address")}</span><input className="mono" value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="0x…" /></label>
      <p className="small">{tr("Shown in their guardian console. Check it with them by another means: your Client Wallet will show it again before signing.")}{pending ? ` ${tr("The recovery in progress will be cancelled in the same operation.")}` : ""}</p>
      {invalid && <p className="error">{invalid}</p>}
      <p>
        <button className="btn-secondary" onClick={() => { setOpen(false); setName(""); setAddr(""); }}>{tr("Cancel")}</button>{" "}
        <button disabled={!!busy || !name.trim() || !isAddress(addr) || !!invalid} onClick={run("contact", async () => {
          const to = getAddress(addr), n = name.trim();
          await prepare("Trusted contact changed", contactChangeCalls(acc.tiers, to, guardians, pending), async (b) => { onChanged(await changeEvmTiers(acc.safe, to, n, b)); setOpen(false); });
        })}>{busy === "contact" ? tr("Preparing…") : tr("Prepare the change")}</button>
      </p>
    </div>
  );
}
