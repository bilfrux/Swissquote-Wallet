// Création du compte Bitcoin à partir des clés PUBLIQUES : celle du client (tirée de son wallet externe),
// celle de Swissquote et celle du tiers de confiance.
import { useState } from "react";
import type { AccountInput } from "../lib/config";
import { fetchSwissquoteKey } from "../lib/bank";

const FORMAT = "[empreinte/48'/1'/0'/2']tpub…";

export function AccountSetup({ initial, onCreate }: { initial: AccountInput | null; onCreate: (a: AccountInput) => Promise<void> }) {
  const [form, setForm] = useState<AccountInput>(initial ?? { client: "", swissquote: "", tiers: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (k: keyof AccountInput, label: string, help: string) => (
    <label>
      <span>{label}</span>
      <textarea rows={2} className="mono" placeholder={FORMAT} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      <small>{help}</small>
    </label>
  );
  return (
    <section>
      <h2>Créer le compte Bitcoin</h2>
      <p className="note">
        Swissquote ne détient jamais votre clé privée. Collez la clé publique de compte exportée de votre wallet
        (Liana, Bitcoin Core, Ledger…), au format {FORMAT}.
      </p>
      {field("client", "Votre clé publique (wallet externe)", "Exportée de votre wallet : sert à dériver vos adresses.")}
      {field("swissquote", "Clé publique du guardian Swissquote", "Fournie par Swissquote : ne peut jamais dépenser seule.")}
      <button
        className="secondary small"
        onClick={async () => {
          setError(null);
          try { setForm({ ...form, swissquote: await fetchSwissquoteKey() }); } catch (e: any) { setError(`Swissquote injoignable : ${e.message}`); }
        }}
      >
        Obtenir la clé de Swissquote
      </button>
      {field("tiers", "Clé publique de votre tiers de confiance", "Choisie par vous : nécessaire, avec Swissquote, pour une recovery.")}
      {error && <p className="error">{error}</p>}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try { await onCreate(form); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
        }}
      >
        Créer le compte
      </button>
    </section>
  );
}
