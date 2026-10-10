// Compte Ethereum (Sepolia) : un Safe dont le propriétaire est la clé Ethereum du Wallet du client (même phrase que
// le Bitcoin). Swissquote et le tiers sont les deux gardiens du module de recovery (seuil 2, délai appliqué par le contrat).
// L'appli prépare les opérations ; le Wallet du client les décode, les fait confirmer et les signe ; un paymaster
// (tiers, pas Swissquote) paie les frais : le client n'a pas besoin d'ETH.
import { useEffect, useState } from "react";
import { type Address, formatUnits, getAddress, isAddress, parseUnits } from "viem";
import { EXPLORER, USDC_DECIMALS, RECOVERY_DELAY_LABEL, activationCalls, buildSponsoredOp, cancelRecoveryCalls, readState, sendOp, usdcTransferCall } from "@sq/evm";
import { type EvmAccount, evmAccounts, registerEvm } from "../lib/bank";
import { walletRequest } from "../lib/walletBridge";

type State = Awaited<ReturnType<typeof readState>>;
const cacheKey = (cid: string) => `sq-wallet:evm:${cid}`;
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function Ethereum({ customerId, accountKey, tiersName }: { customerId: string; accountKey: string; tiersName?: string | null }) {
  const [acc, setAcc] = useState<EvmAccount | null | undefined>(undefined);
  const [sq, setSq] = useState<Address | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [tiersAddr, setTiersAddr] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ label: string; hash: string } | null>(null);
  // Opération préparée, en attente de signature : la fenêtre du wallet s'ouvre sur un clic (sinon le navigateur la bloque).
  const [ready, setReady] = useState<{ label: string; op: Awaited<ReturnType<typeof buildSponsoredOp>> } | null>(null);

  useEffect(() => {
    const cached = JSON.parse(localStorage.getItem(cacheKey(customerId)) ?? "null");
    evmAccounts().then(
      (r) => { setSq(r.swissquote); const a = r.accounts.at(-1) ?? null; setAcc(a); if (a) localStorage.setItem(cacheKey(customerId), JSON.stringify({ ...a, swissquote: r.swissquote })); },
      () => { setAcc(cached); setSq(cached?.swissquote ?? null); },
    );
  }, [customerId]);
  const refresh = (blockNumber?: bigint) => acc && readState(acc.safe, blockNumber).then(setState, (e) => setError(`chain read failed: ${e.message}`));
  useEffect(() => { refresh(); }, [acc]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (label: string, f: () => Promise<void>) => async () => {
    setError(null); setBusy(label);
    try { await f(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  // 1) Prépare l'opération et la fait parrainer ; 2) sur un clic, la fait signer dans le Wallet du client, l'envoie,
  // puis relit l'état AU bloc de l'inclusion (le nœud public peut renvoyer un état en retard).
  const prepare = async (label: string, calls: Parameters<typeof buildSponsoredOp>[1]) => {
    setLastTx(null);
    setReady({ label, op: await buildSponsoredOp(acc!.owner, calls) });
  };
  const signAndSend = async () => {
    const { signature } = await walletRequest<{ signature: string }>("evm-sign", { op: ready!.op });
    const r = await sendOp(ready!.op, signature);
    setLastTx({ label: ready!.label, hash: r.txHash });
    setReady(null);
    await refresh(r.blockNumber);
  };

  if (acc === undefined) return null;
  if (!acc)
    return (
      <section className="card evm" data-testid="evm-card">
        <h3>Ethereum · USDC (Sepolia testnet)</h3>
        <p className="small">Add an Ethereum account to your wallet: same Client Wallet, same secret phrase. Recovery works as for Bitcoin: Swissquote and your trusted contact together, after a delay enforced by the contract, which you can cancel.</p>
        <label>{tiersName ?? "Trusted contact"}'s Ethereum address
          <input className="mono" placeholder="0x…" value={tiersAddr} onChange={(e) => setTiersAddr(e.target.value.trim())} />
        </label>
        <p className="muted small">Shown in their guardian console (same phrase as their Bitcoin key).</p>
        <button disabled={!!busy || !isAddress(tiersAddr)} onClick={run("add", async () => {
          const { evmAddress } = await walletRequest<{ evmAddress: string }>("evm-address", { accountKey });
          const a = await registerEvm(evmAddress, getAddress(tiersAddr), tiersName);
          setSq(a.swissquote); setAcc(a);
          localStorage.setItem(cacheKey(customerId), JSON.stringify(a));
        })}>{busy === "add" ? "Waiting for your Client Wallet…" : "Add my Ethereum account"}</button>
        {error && <p className="error">{error}</p>}
      </section>
    );

  const label = (a: string) => (sq && a.toLowerCase() === sq.toLowerCase() ? "Swissquote" : a.toLowerCase() === acc.tiers.toLowerCase() ? acc.tiersName ?? "trusted contact" : short(a));
  const active = state?.deployed && state.moduleEnabled && state.threshold === 2n;
  return (
    <section className="card evm" data-testid="evm-card">
      <h3>Ethereum · USDC (Sepolia testnet)</h3>
      <p className="small">Account <a className="mono" href={`${EXPLORER}/address/${acc.safe}`} target="_blank" rel="noreferrer" data-testid="evm-safe">{acc.safe}</a></p>
      <p className="evm-balance" data-testid="evm-usdc">{state ? `${formatUnits(state.usdc, USDC_DECIMALS)} USDC` : "…"}</p>
      {state && !active && (
        <div className="note">
          <p>Not active yet. Activating creates your account on-chain and sets its two recovery guardians: Swissquote and {acc.tiersName ?? "your trusted contact"} (both needed, {RECOVERY_DELAY_LABEL} delay that you can cancel). Network fees are sponsored: you need no ETH.</p>
          <button disabled={!!busy || !sq} onClick={run("activate", () => prepare("Activation", activationCalls(acc.safe, sq!, acc.tiers)))}>
            {busy === "activate" ? "Preparing…" : "Activate my Ethereum account"}
          </button>
        </div>
      )}
      {state?.pending && (
        <div className="warning" data-testid="evm-pending">
          <p><strong>Recovery in progress on this account</strong>: ownership would go to {state.pending.newOwners.map(short).join(", ")} after {new Date(state.pending.executeAfter * 1000).toLocaleString("en-GB")}. If you did not ask for it, cancel it now.</p>
          <button disabled={!!busy} onClick={run("cancel", () => prepare("Recovery cancelled", cancelRecoveryCalls()))}>{busy === "cancel" ? "Preparing…" : "Cancel this recovery"}</button>
        </div>
      )}
      {active && (
        <>
          <p className="small muted" data-testid="evm-guardians">Recovery guardians: {state!.guardians.map(label).join(" + ")} (both needed) · owner: your Client Wallet ({short(state!.owners[0])})</p>
          <div className="send">
            <label>Recipient<input className="mono" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} /></label>
            <label>Amount (USDC)<input placeholder="1" value={amount} onChange={(e) => setAmount(e.target.value.trim())} /></label>
            <button disabled={!!busy || !isAddress(to) || !(Number(amount) > 0)} onClick={run("send", () => prepare("USDC sent", [usdcTransferCall(getAddress(to), parseUnits(amount, USDC_DECIMALS))]))}>
              {busy === "send" ? "Preparing…" : "Send USDC"}
            </button>
            <p className="muted small">Fees sponsored by a paymaster (third party, not Swissquote).</p>
          </div>
        </>
      )}
      {ready && (
        <div className="note" data-testid="evm-ready">
          <p>{ready.label === "Activation" ? "Activation" : ready.label === "USDC sent" ? "Transfer" : "Cancellation"} prepared, network fees sponsored. Confirm it in your Client Wallet: it decodes the operation itself.</p>
          <button disabled={!!busy} onClick={run("sign", signAndSend)}>{busy === "sign" ? "Waiting for your Client Wallet, then the network…" : "Sign with my Client Wallet"}</button>
        </div>
      )}
      {lastTx && <p className="success" data-testid="evm-last-tx">{lastTx.label}: <a href={`${EXPLORER}/tx/${lastTx.hash}`} target="_blank" rel="noreferrer" className="mono">{lastTx.hash}</a></p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
