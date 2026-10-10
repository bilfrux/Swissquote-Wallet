// Connexion à la banque SIMULÉE (identifiants de démo).
import { useState } from "react";
import { type Session, login, loginWithPasskey } from "../lib/bank";
import { Logo } from "../ui/icons";

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [id, setId] = useState("CH-0002");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="login">
      <header className="login-head"><Logo /></header>
      <div className="login-card">
        <h1>Connexion</h1>
        <p className="muted small">Accédez à votre compte Swissquote</p>
        <form onSubmit={async (e) => { e.preventDefault(); setError(null); try { onLogin(await login(id.trim(), pwd)); } catch (err: any) { setError(err.message); } }}>
          <label><span>Identifiant client</span><input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" /></label>
          <label><span>Mot de passe</span><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-primary wide">Se connecter</button>
        </form>
        <button className="btn-secondary wide passkey-btn" onClick={async () => { setError(null); try { onLogin(await loginWithPasskey(id.trim())); } catch (err: any) { setError(err.message); } }}>
          Se connecter avec une passkey
        </button>
        <p className="muted small center">Banque simulée pour la démo · CH-0002 / demo5678</p>
      </div>
    </div>
  );
}
