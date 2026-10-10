// Pont vers le « Wallet du client » (appli séparée, autre origine). L'appli de la banque ouvre sa fenêtre et lui
// envoie une demande ; seul le wallet génère la graine et signe, après confirmation du client dans SA fenêtre.
// L'appli ne reçoit que des clés publiques et des PSBT signés.
import { NETWORK } from "./config";

export const WALLET_URL = import.meta.env.VITE_CLIENT_WALLET_URL ?? "http://localhost:5180";
const WALLET_ORIGIN = new URL(WALLET_URL).origin;

export function walletRequest<T>(action: "create" | "sign" | "policy" | "prove", payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let sent = false;
    let win: Window | null = null;
    const finish = (f: () => void) => { window.removeEventListener("message", onMsg); clearInterval(watch); f(); };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== WALLET_ORIGIN) return; // seule l'origine du wallet est écoutée
      if (e.data?.type === "wallet-ready" && !sent) {
        sent = true;
        win?.postMessage({ type: "wallet-request", id, action, network: NETWORK, payload }, WALLET_ORIGIN);
      }
      if (e.data?.type === "wallet-response" && e.data.id === id) finish(() => (e.data.ok ? resolve(e.data.data) : reject(new Error(e.data.error))));
    };
    window.addEventListener("message", onMsg);
    win = window.open(WALLET_URL, "sq-client-wallet", "popup,width=560,height=860");
    if (!win) return finish(() => reject(new Error("fenêtre du wallet bloquée par le navigateur")));
    const watch = setInterval(() => { if (win!.closed) finish(() => reject(new Error("fenêtre du wallet fermée sans réponse"))); }, 500);
  });
}
