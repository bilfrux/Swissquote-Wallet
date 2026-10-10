// Connexion à la banque SIMULÉE (identifiants de démo : CH-0001 / demo1234).
import { useState } from "react";
import { type Session, login } from "../lib/bank";

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [id, setId] = useState("CH-0001");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="login">
      <div className="login-card">
        <div className="logo">Swissquote</div>
        <h1>Connexion à votre e-banking</h1>
        <form onSubmit={async (e) => { e.preventDefault(); setError(null); try { onLogin(await login(id.trim(), pwd)); } catch (err: any) { setError(err.message); } }}>
          <label><span>Identifiant client</span><input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" /></label>
          <label><span>Mot de passe</span><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit">Se connecter</button>
        </form>
        <p className="note small-text">Banque simulée pour la démo · identifiant CH-0001, mot de passe demo1234</p>
      </div>
    </div>
  );
}
