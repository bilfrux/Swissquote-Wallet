import { useEffect, useState } from "react";
import { type WalletConfig, createWalletConfig } from "@sq/bitcoin";
import { type AccountInput, DELAY, NETWORK, clearAccountInput, loadAccountInput, saveAccountInput } from "./lib/config";
import { AccountSetup } from "./wallet/AccountSetup";
import { registerAccount } from "./lib/bank";
import { Recovery } from "./recovery/Recovery";
import { Account } from "./wallet/Account";

export function App() {
  const [input, setInput] = useState<AccountInput | null>(loadAccountInput);
  const [cfg, setCfg] = useState<WalletConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(() => localStorage.getItem(`sq-wallet:recovery:${NETWORK}`) !== null);

  useEffect(() => {
    if (!input) return setCfg(null);
    createWalletConfig({ network: NETWORK, delay: DELAY, ...input }).then(setCfg, (e) => setError(e.message));
  }, [input]);

  return (
    <main>
      <header>
        <h1>Swissquote · Wallet self-custody</h1>
        <p className="badge">Banque simulée · réseau {NETWORK} · délai de recovery {DELAY} blocs</p>
      </header>
      {error && <p className="error">{error}</p>}
      {notice && <p className="note">{notice}</p>}
      {recovering && (
        <Recovery
          onCancel={() => setRecovering(false)}
          onDone={() => { setRecovering(false); setInput(loadAccountInput()); setNotice("Recovery terminée : voici votre nouveau compte."); }}
        />
      )}
      {!input && !recovering && (
        <AccountSetup
          initial={null}
          onCreate={async (a) => {
            await createWalletConfig({ network: NETWORK, delay: DELAY, ...a }); // valide avant d'enregistrer
            saveAccountInput(a);
            setInput(a);
            // Enregistrement auprès de Swissquote (guardian) : utile pour une future recovery, jamais requis pour dépenser.
            registerAccount({ delay: DELAY, client: a.client, tiers: a.tiers }).then(
              () => setNotice("Compte enregistré auprès du guardian Swissquote."),
              (e) => setNotice(`Compte créé, mais pas encore enregistré auprès de Swissquote (${e.message}).`),
            );
          }}
        />
      )}
      {!input && !recovering && (
        <p><button className="link" onClick={() => setRecovering(true)}>J'ai perdu la clé de mon wallet : récupérer mon compte</button></p>
      )}
      {cfg && !recovering && <Account cfg={cfg} onReset={() => { clearAccountInput(); setInput(null); }} />}
    </main>
  );
}
