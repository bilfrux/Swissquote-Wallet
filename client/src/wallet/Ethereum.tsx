// Compte Ethereum (Sepolia) : un Safe dont le propriétaire est la clé Ethereum du Wallet du client (même phrase que
// le Bitcoin). Swissquote et le tiers sont les deux gardiens du module de recovery (seuil 2, délai appliqué par le contrat).
// L'appli prépare les opérations ; le Wallet du client les décode, les fait confirmer et les signe ; un paymaster
// (tiers, pas Swissquote) paie les frais : le client n'a pas besoin d'ETH.
import { useEffect, useState } from "react";
import { type Address, formatUnits, getAddress, isAddress, parseUnits } from "viem";
import { EXPLORER, USDC_DECIMALS, publicClient, RECOVERY_DELAY_LABEL, RECOVERY_MODULE, activationCalls, buildSponsoredOp, cancelRecoveryCalls, finalizeRecoveryCall, readState, recoveryAbi, safeAddressOf, sendOp, startRecoveryCall, usdcTransferCall } from "@sq/evm";
import { type EvmAccount, evmAccounts, evmSignRecovery, registerEvm, relayCreate, relayGet, syncEvm, verifyIdentity } from "../lib/bank";
import { encodeFunctionData } from "viem";
import { walletRequest } from "../lib/walletBridge";

const CONSOLE_URL = import.meta.env.VITE_GUARDIAN_CONSOLE_URL ?? "http://localhost:5174";

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
  const [txs, setTxs] = useState<{ label: string; hash: string }[]>([]); // opérations de cette session, la plus récente d'abord
  // Opération préparée, en attente de signature : la fenêtre du wallet s'ouvre sur un clic (sinon le navigateur la bloque).
  const [ready, setReady] = useState<{ label: string; op: Awaited<ReturnType<typeof buildSponsoredOp>>; after?: (blockNumber: bigint) => Promise<void> } | null>(null);
  const [recovering, setRecovering] = useState(false);

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
  const prepare = async (label: string, calls: Parameters<typeof buildSponsoredOp>[1], from: { safe: Address; owner: Address } = acc!, after?: (blockNumber: bigint) => Promise<void>) => {
    setReady({ label, op: await buildSponsoredOp(from, calls), after });
  };
  const signAndSend = async () => {
    const { signature } = await walletRequest<{ signature: string }>("evm-sign", { op: ready!.op });
    const r = await sendOp(ready!.op, signature);
    setTxs((t) => [{ label: ready!.label, hash: r.txHash }, ...t]);
    const after = ready!.after;
    setReady(null);
    await refresh(r.blockNumber);
    if (after) await after(r.blockNumber);
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
          <p>{ready.label === "USDC sent" ? "Transfer" : ready.label} prepared, network fees sponsored. Confirm it in your Client Wallet: it decodes the operation itself.</p>
          <button disabled={!!busy} onClick={run("sign", signAndSend)}>{busy === "sign" ? "Waiting for your Client Wallet, then the network…" : "Sign with my Client Wallet"}</button>
        </div>
      )}
      {!recovering && active && <p><button className="link" onClick={() => setRecovering(true)}>Lost the key of this Ethereum account? Recover it</button></p>}
      {recovering && state && (
        <EvmRecovery acc={acc} state={state} busy={busy} run={run} prepare={prepare}
          onRecovered={async (blockNumber) => {
            const a = await syncEvm(acc.safe);
            setAcc(a); localStorage.setItem(cacheKey(customerId), JSON.stringify({ ...a, swissquote: sq })); setRecovering(false);
            await refresh(blockNumber);
            // Règle du projet après toute recovery : invalider les signatures de gardiens déjà collectées (nonce du module).
            await prepare("Leftover guardian signatures invalidated", [{ to: RECOVERY_MODULE, value: 0n, data: encodeFunctionData({ abi: recoveryAbi, functionName: "invalidateNonce" }) }], { safe: a.safe, owner: a.owner });
          }} />
      )}
      {txs.map((t, i) => (
        <p key={t.hash} className={i === 0 ? "success" : "muted small"} data-testid={i === 0 ? "evm-last-tx" : "evm-tx"}>{t.label}: <a href={`${EXPLORER}/tx/${t.hash}`} target="_blank" rel="noreferrer" className="mono">{t.hash}</a></p>
      ))}
      {error && <p className="error">{error}</p>}
    </section>
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
  const [kyc, setKyc] = useState({ lastName: "", birthDate: "", otp: "" });
  const [token, setToken] = useState<string | null>(null);
  const [newWallet, setNewWallet] = useState<string | null>(null); // clé publique Bitcoin du nouveau wallet (le désigne)
  const [newOwner, setNewOwner] = useState<Address | null>(null);
  const [sqSig, setSqSig] = useState<{ signer: Address; signature: `0x${string}`; nonce: string } | null>(null);
  const [relayId, setRelayId] = useState<string | null>(null);
  const [tSig, setTSig] = useState<{ signer: Address; signature: `0x${string}` } | null>(null);
  const [now, setNow] = useState(Date.now());
  // Le contrat compare le délai à l'horodatage du DERNIER BLOC, pas à l'horloge du navigateur.
  const [chainTime, setChainTime] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const poll = () => publicClient.getBlock().then((b) => setChainTime(Number(b.timestamp)), () => undefined);
    poll();
    const c = setInterval(poll, 6000);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);
  const relaySafe = newOwner ? { safe: safeAddressOf(newOwner), owner: newOwner } : null;
  const pendingToMe = state.pending && newOwner && state.pending.newOwners.map((o) => o.toLowerCase()).includes(newOwner.toLowerCase());
  const left = state.pending ? state.pending.executeAfter * 1000 - now : 0;
  return (
    <div className="card recovery-evm" data-testid="evm-recovery">
      <h4>Recover this Ethereum account</h4>
      <p className="small">Swissquote and {acc.tiersName ?? "your trusted contact"} must both sign; the contract then waits {RECOVERY_DELAY_LABEL}, during which the current key can cancel.</p>
      {!token && (
        <div className="step">
          <p>1. Verify your identity with Swissquote</p>
          <input placeholder="Last name" value={kyc.lastName} onChange={(e) => setKyc({ ...kyc, lastName: e.target.value })} />
          <input placeholder="Date of birth (YYYY-MM-DD)" value={kyc.birthDate} onChange={(e) => setKyc({ ...kyc, birthDate: e.target.value })} />
          <input placeholder="Code received by SMS" value={kyc.otp} onChange={(e) => setKyc({ ...kyc, otp: e.target.value })} />
          <button disabled={!!busy} onClick={run("kyc", async () => setToken((await verifyIdentity(kyc)).token))}>Verify my identity</button>
        </div>
      )}
      {token && !newOwner && (
        <div className="step">
          <p>2. Your new key: a new Client Wallet on this device</p>
          {!newWallet
            ? <button disabled={!!busy} onClick={run("new-wallet", async () => setNewWallet((await walletRequest<{ accountKey: string }>("create", { label: "Wallet after recovery" })).accountKey))}>Create a new Client Wallet</button>
            : <button disabled={!!busy} onClick={run("new-owner", async () => setNewOwner((await walletRequest<{ evmAddress: Address }>("evm-address", { accountKey: newWallet })).evmAddress))}>Get its Ethereum address</button>}
        </div>
      )}
      {newOwner && !state.pending && (
        <div className="step">
          <p>New owner: <span className="mono" data-testid="evm-new-owner">{newOwner}</span></p>
          {!sqSig && <button disabled={!!busy} onClick={run("sq", async () => setSqSig(await evmSignRecovery(token!, acc.safe, newOwner)))}>Request Swissquote's signature</button>}
          {sqSig && !relayId && <button disabled={!!busy} onClick={run("relay", async () => setRelayId(await relayCreate(JSON.stringify({ kind: "evm-recovery", safe: acc.safe, newOwner, nonce: sqSig.nonce }))))}>Send the request to {acc.tiersName ?? "your trusted contact"}</button>}
          {relayId && !tSig && (
            <>
              <p className="small">Link for {acc.tiersName ?? "your trusted contact"}: <span className="mono" data-testid="evm-relay-link">{`${CONSOLE_URL}/?req=${relayId}`}</span></p>
              <button disabled={!!busy} onClick={run("fetch", async () => { const r = await relayGet(relayId); if (!r.signed) throw new Error("not signed yet"); setTSig(JSON.parse(r.signed)); })}>Fetch the trusted contact's signature</button>
            </>
          )}
          {sqSig && tSig && (
            <button disabled={!!busy} onClick={run("start", () => prepare("Recovery started", [startRecoveryCall(acc.safe, newOwner, [sqSig, tSig])], relaySafe!))}>Start the recovery</button>
          )}
        </div>
      )}
      {pendingToMe && (
        <div className="step" data-testid="evm-countdown">
          {left > 0
            ? <p>Recovery started. The contract allows it to complete in <strong>{Math.ceil(left / 1000)} s</strong>.</p>
            : chainTime <= state.pending!.executeAfter
            ? <p>Delay elapsed: waiting for the next block to confirm it on-chain…</p>
            : <button disabled={!!busy} onClick={run("finalize", () => prepare("Recovery completed", [finalizeRecoveryCall(acc.safe)], relaySafe!, async (b) => {
                await onRecovered(b);
              }))}>Complete the recovery</button>}
        </div>
      )}
    </div>
  );
}
