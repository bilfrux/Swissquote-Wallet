// Langues proposées par Swissquote en Suisse (balises hreflang de swissquote.com : en-CH, fr-CH, de-CH, it-CH).
// Traduits : site public (marchés, connexion), cadre de l'appli, accueil et comptes ; écrans crypto en français (i18n-crypto-fr.ts).
import { createContext, useContext, useState, type ReactNode } from "react";
import { CRYPTO_FR } from "./i18n-crypto-fr";

export type Lang = "en" | "fr" | "de" | "it";
export const LANGS: { id: Lang; label: string; name: string }[] = [
  { id: "en", label: "EN", name: "English" },
  { id: "fr", label: "FR", name: "Français" },
  { id: "de", label: "DE", name: "Deutsch" },
  { id: "it", label: "IT", name: "Italiano" },
];

type Dict = Record<string, string>;
const en: Dict = {
  "login.unreachable": "Cannot reach the Swissquote server (bank-mock). Open the app at the address shown when the demo starts (for example http://localhost:5183) and check that the demo is running.",
  "login.bad": "Incorrect username or password.",
  "ov.title": "Overview",
  "ov.client": "Client",
  "ov.dailySim": "daily change (simulated)",
  "ov.total": "Total value",
  "ov.portfolio": "Portfolio",
  "ov.accounts": "Accounts",
  "ov.crypto": "Crypto",
  "ov.create": "Create",
  "ov.cash": "Cash",
  "ov.savings": "Savings",
  "ov.receive": "Receive",
  "ov.send": "Send",
  "ov.transactions": "Transactions",
  "ov.chfAccounts": "CHF accounts",
  "ov.custody": "Swissquote crypto account",
  "ov.custodyNote": "held in custody by Swissquote",
  "ov.selfCustody": "Crypto · self-custody",
  "ov.btcWallet": "Bitcoin wallet",
  "ov.onlyYou": "only you hold the key",
  "ov.createWallet": "Create my wallet",
  "ov.usdc": "USDC on Ethereum",
  "ov.sameWallet": "same wallet, only you hold the key",
  "ov.recent": "Recent transactions",
  "ov.perf": "Portfolio performance",
  "ov.yourWallet": "Your Bitcoin wallet",
  "ov.walletText": "Only you hold the key. If you lose it, Swissquote and your trusted contact can together help you recover your funds, without ever being able to act alone.",
  "ov.open": "Open",
  "ov.openWallet": "Open my wallet",
  "ac.title": "Accounts",
  "ac.sim": "Accounts and transactions simulated for the demo",
  "ac.date": "Date",
  "ac.desc": "Description",
  "ac.amount": "Amount",
  "ac.loading": "Loading…",
  // en-tête public
  "pub.help": "Help", "pub.discover": "Discover our services", "pub.login": "Login", "pub.signup": "Sign up",
  "pub.signupSoon": "Account opening is not part of this demo: log in with a demo client.",
  // rail public
  "rail.tools": "Tools", "rail.markets": "Markets", "rail.inspiration": "Inspiration", "rail.esg": "ESG", "rail.crypto": "Crypto hub",
  // marchés
  "mk.title": "Markets", "mk.search": "Search by name, symbol or ISIN", "mk.regions": "Regions", "mk.global": "Global overview",
  "mk.switzerland": "Switzerland", "mk.us": "US", "mk.germany": "Germany", "mk.euronext": "Euronext", "mk.canada": "Canada", "mk.austria": "Austria",
  "mk.italy": "Italy", "mk.uk": "UK", "mk.scandinavia": "Scandinavia", "mk.products": "Products", "mk.themes": "Themes trading", "mk.dots": "Swiss DOTS",
  "mk.structured": "Structured products", "mk.warrants": "Warrants & derivatives", "mk.options": "Options & futures",
  "mk.daily": "Daily overview", "mk.performers": "View performers", "mk.components": "All components",
  "mk.demo": "Demonstration data (simulated), not market data.", "mk.crypto": "Self-custody crypto wallet: log in to open yours.",
  // connexion
  "login.title": "Log in to Swissquote", "login.user": "Username", "login.userPh": "Enter your username", "login.userForgot": "Forgot your username?",
  "login.pwd": "Password", "login.pwdPh": "Enter your password", "login.pwdForgot": "Forgot your password?", "login.submit": "Log in",
  "login.passkey": "Log in with a passkey", "login.help": "Need help logging in?", "login.new": "New to Swissquote?", "login.become": "Become a client",
  "login.show": "Show the password", "login.hide": "Hide the password",
  "login.demo": "Simulated bank for the demo. Demo clients: CH-0002 / demo5678, CH-0003 / demo0003.",
  "login.forgotDemo": "Demo: use one of the demo clients shown below.",
  // cadre de l'appli
  "nav.home": "Home", "nav.banking": "Banking", "nav.crypto": "Crypto", "nav.demo": "Demo",
  "rail.portfolio": "Portfolio", "rail.accounts": "Accounts", "rail.cryptoAssets": "Crypto assets", "rail.security": "Security", "rail.attacks": "Attacks",
  "shell.logout": "Log out", "shell.myAccount": "My account", "shell.simBank": "Simulated bank", "shell.language": "Language",
  "foot.total": "Total value", "foot.cash": "CHF accounts", "foot.crypto": "Crypto", "foot.network": "Bitcoin network", "foot.sim": "Simulated bank for the demo",
};
const fr: Dict = {
  "login.unreachable": "Impossible de joindre le serveur Swissquote (bank-mock). Ouvrez l'appli à l'adresse indiquée au lancement de la démo (par exemple http://localhost:5183) et vérifiez que la démo tourne.",
  "login.bad": "Nom d'utilisateur ou mot de passe incorrect.",
  "ov.title": "Aperçu",
  "ov.client": "Client",
  "ov.dailySim": "variation du jour (simulée)",
  "ov.total": "Valeur totale",
  "ov.portfolio": "Portefeuille",
  "ov.accounts": "Comptes",
  "ov.crypto": "Crypto",
  "ov.create": "Créer",
  "ov.cash": "Liquidités",
  "ov.savings": "Épargne",
  "ov.receive": "Recevoir",
  "ov.send": "Envoyer",
  "ov.transactions": "Transactions",
  "ov.chfAccounts": "Comptes CHF",
  "ov.custody": "Compte crypto Swissquote",
  "ov.custodyNote": "conservé par Swissquote",
  "ov.selfCustody": "Crypto · self-custody",
  "ov.btcWallet": "Wallet Bitcoin",
  "ov.onlyYou": "vous seul détenez la clé",
  "ov.createWallet": "Créer mon wallet",
  "ov.usdc": "USDC sur Ethereum",
  "ov.sameWallet": "même wallet, vous seul détenez la clé",
  "ov.recent": "Transactions récentes",
  "ov.perf": "Performance du portefeuille",
  "ov.yourWallet": "Votre wallet Bitcoin",
  "ov.walletText": "Vous seul détenez la clé. Si vous la perdez, Swissquote et votre contact de confiance peuvent ensemble vous aider à récupérer vos fonds, sans jamais pouvoir agir seuls.",
  "ov.open": "Ouvrir",
  "ov.openWallet": "Ouvrir mon wallet",
  "ac.title": "Comptes",
  "ac.sim": "Comptes et opérations simulés pour la démo",
  "ac.date": "Date",
  "ac.desc": "Description",
  "ac.amount": "Montant",
  "ac.loading": "Chargement…",
  "pub.help": "Aide", "pub.discover": "Découvrir nos services", "pub.login": "Connexion", "pub.signup": "Ouvrir un compte",
  "pub.signupSoon": "L'ouverture de compte ne fait pas partie de cette démo : connectez-vous avec un client de démonstration.",
  "rail.tools": "Outils", "rail.markets": "Marchés", "rail.inspiration": "Inspiration", "rail.esg": "ESG", "rail.crypto": "Crypto hub",
  "mk.title": "Marchés", "mk.search": "Rechercher par nom, symbole ou ISIN", "mk.regions": "Régions", "mk.global": "Vue d'ensemble",
  "mk.switzerland": "Suisse", "mk.us": "États-Unis", "mk.germany": "Allemagne", "mk.euronext": "Euronext", "mk.canada": "Canada", "mk.austria": "Autriche",
  "mk.italy": "Italie", "mk.uk": "Royaume-Uni", "mk.scandinavia": "Scandinavie", "mk.products": "Produits", "mk.themes": "Trading thématique", "mk.dots": "Swiss DOTS",
  "mk.structured": "Produits structurés", "mk.warrants": "Warrants et dérivés", "mk.options": "Options et futures",
  "mk.daily": "Aperçu du jour", "mk.performers": "Voir les performances", "mk.components": "Toutes les composantes",
  "mk.demo": "Données de démonstration (simulées), pas des données de marché.", "mk.crypto": "Wallet crypto en self-custody : connectez-vous pour ouvrir le vôtre.",
  "login.title": "Connexion à Swissquote", "login.user": "Nom d'utilisateur", "login.userPh": "Saisissez votre nom d'utilisateur", "login.userForgot": "Nom d'utilisateur oublié ?",
  "login.pwd": "Mot de passe", "login.pwdPh": "Saisissez votre mot de passe", "login.pwdForgot": "Mot de passe oublié ?", "login.submit": "Connexion",
  "login.passkey": "Connexion avec une passkey", "login.help": "Besoin d'aide pour vous connecter ?", "login.new": "Nouveau chez Swissquote ?", "login.become": "Devenir client-e",
  "login.show": "Afficher le mot de passe", "login.hide": "Masquer le mot de passe",
  "login.demo": "Banque simulée pour la démo. Clients de démo : CH-0002 / demo5678, CH-0003 / demo0003.",
  "login.forgotDemo": "Démo : utilisez l'un des clients de démonstration indiqués ci-dessous.",
  "nav.home": "Accueil", "nav.banking": "Banque", "nav.crypto": "Crypto", "nav.demo": "Démo",
  "rail.portfolio": "Portefeuille", "rail.accounts": "Comptes", "rail.cryptoAssets": "Actifs crypto", "rail.security": "Sécurité", "rail.attacks": "Attaques",
  "shell.logout": "Déconnexion", "shell.myAccount": "Mon compte", "shell.simBank": "Banque simulée", "shell.language": "Langue",
  "foot.total": "Valeur totale", "foot.cash": "Comptes CHF", "foot.crypto": "Crypto", "foot.network": "Réseau Bitcoin", "foot.sim": "Banque simulée pour la démo",
};
const de: Dict = {
  "login.unreachable": "Der Swissquote-Server (bank-mock) ist nicht erreichbar. Öffnen Sie die App unter der beim Start der Demo angezeigten Adresse (z. B. http://localhost:5183) und prüfen Sie, ob die Demo läuft.",
  "login.bad": "Benutzername oder Passwort falsch.",
  "ov.title": "Übersicht",
  "ov.client": "Kunde",
  "ov.dailySim": "Tagesveränderung (simuliert)",
  "ov.total": "Gesamtwert",
  "ov.portfolio": "Portfolio",
  "ov.accounts": "Konten",
  "ov.crypto": "Krypto",
  "ov.create": "Erstellen",
  "ov.cash": "Bargeld",
  "ov.savings": "Sparen",
  "ov.receive": "Empfangen",
  "ov.send": "Senden",
  "ov.transactions": "Transaktionen",
  "ov.chfAccounts": "CHF-Konten",
  "ov.custody": "Swissquote-Kryptokonto",
  "ov.custodyNote": "von Swissquote verwahrt",
  "ov.selfCustody": "Krypto · Selbstverwahrung",
  "ov.btcWallet": "Bitcoin-Wallet",
  "ov.onlyYou": "nur Sie haben den Schlüssel",
  "ov.createWallet": "Mein Wallet erstellen",
  "ov.usdc": "USDC auf Ethereum",
  "ov.sameWallet": "gleiches Wallet, nur Sie haben den Schlüssel",
  "ov.recent": "Letzte Transaktionen",
  "ov.perf": "Portfolio-Performance",
  "ov.yourWallet": "Ihr Bitcoin-Wallet",
  "ov.walletText": "Nur Sie haben den Schlüssel. Wenn Sie ihn verlieren, können Swissquote und Ihre Vertrauensperson Ihnen gemeinsam helfen, Ihre Mittel wiederzuerlangen, ohne je allein handeln zu können.",
  "ov.open": "Öffnen",
  "ov.openWallet": "Mein Wallet öffnen",
  "ac.title": "Konten",
  "ac.sim": "Konten und Transaktionen für die Demo simuliert",
  "ac.date": "Datum",
  "ac.desc": "Beschreibung",
  "ac.amount": "Betrag",
  "ac.loading": "Wird geladen…",
  "pub.help": "Hilfe", "pub.discover": "Unsere Dienstleistungen", "pub.login": "Login", "pub.signup": "Konto eröffnen",
  "pub.signupSoon": "Die Kontoeröffnung ist nicht Teil dieser Demo: Melden Sie sich mit einem Demo-Kunden an.",
  "rail.tools": "Tools", "rail.markets": "Märkte", "rail.inspiration": "Inspiration", "rail.esg": "ESG", "rail.crypto": "Krypto-Hub",
  "mk.title": "Märkte", "mk.search": "Suche nach Name, Symbol oder ISIN", "mk.regions": "Regionen", "mk.global": "Globale Übersicht",
  "mk.switzerland": "Schweiz", "mk.us": "USA", "mk.germany": "Deutschland", "mk.euronext": "Euronext", "mk.canada": "Kanada", "mk.austria": "Österreich",
  "mk.italy": "Italien", "mk.uk": "Grossbritannien", "mk.scandinavia": "Skandinavien", "mk.products": "Produkte", "mk.themes": "Themen-Trading", "mk.dots": "Swiss DOTS",
  "mk.structured": "Strukturierte Produkte", "mk.warrants": "Warrants & Derivate", "mk.options": "Optionen & Futures",
  "mk.daily": "Tagesübersicht", "mk.performers": "Top & Flop anzeigen", "mk.components": "Alle Komponenten",
  "mk.demo": "Demonstrationsdaten (simuliert), keine Marktdaten.", "mk.crypto": "Krypto-Wallet in Selbstverwahrung: Melden Sie sich an, um Ihres zu öffnen.",
  "login.title": "Bei Swissquote anmelden", "login.user": "Benutzername", "login.userPh": "Geben Sie Ihren Benutzernamen ein", "login.userForgot": "Benutzername vergessen?",
  "login.pwd": "Passwort", "login.pwdPh": "Geben Sie Ihr Passwort ein", "login.pwdForgot": "Passwort vergessen?", "login.submit": "Anmelden",
  "login.passkey": "Mit einem Passkey anmelden", "login.help": "Brauchen Sie Hilfe beim Anmelden?", "login.new": "Neu bei Swissquote?", "login.become": "Kunde werden",
  "login.show": "Passwort anzeigen", "login.hide": "Passwort verbergen",
  "login.demo": "Simulierte Bank für die Demo. Demo-Kunden: CH-0002 / demo5678, CH-0003 / demo0003.",
  "login.forgotDemo": "Demo: Verwenden Sie einen der unten angegebenen Demo-Kunden.",
  "nav.home": "Startseite", "nav.banking": "Banking", "nav.crypto": "Krypto", "nav.demo": "Demo",
  "rail.portfolio": "Portfolio", "rail.accounts": "Konten", "rail.cryptoAssets": "Krypto-Assets", "rail.security": "Sicherheit", "rail.attacks": "Angriffe",
  "shell.logout": "Abmelden", "shell.myAccount": "Mein Konto", "shell.simBank": "Simulierte Bank", "shell.language": "Sprache",
  "foot.total": "Gesamtwert", "foot.cash": "CHF-Konten", "foot.crypto": "Krypto", "foot.network": "Bitcoin-Netzwerk", "foot.sim": "Simulierte Bank für die Demo",
};
const it: Dict = {
  "login.unreachable": "Impossibile raggiungere il server Swissquote (bank-mock). Apri l'app all'indirizzo indicato all'avvio della demo (ad esempio http://localhost:5183) e verifica che la demo sia in esecuzione.",
  "login.bad": "Nome utente o password errati.",
  "ov.title": "Panoramica",
  "ov.client": "Cliente",
  "ov.dailySim": "variazione giornaliera (simulata)",
  "ov.total": "Valore totale",
  "ov.portfolio": "Portafoglio",
  "ov.accounts": "Conti",
  "ov.crypto": "Crypto",
  "ov.create": "Crea",
  "ov.cash": "Liquidità",
  "ov.savings": "Risparmio",
  "ov.receive": "Ricevi",
  "ov.send": "Invia",
  "ov.transactions": "Transazioni",
  "ov.chfAccounts": "Conti CHF",
  "ov.custody": "Conto crypto Swissquote",
  "ov.custodyNote": "custodito da Swissquote",
  "ov.selfCustody": "Crypto · autocustodia",
  "ov.btcWallet": "Wallet Bitcoin",
  "ov.onlyYou": "solo tu possiedi la chiave",
  "ov.createWallet": "Crea il mio wallet",
  "ov.usdc": "USDC su Ethereum",
  "ov.sameWallet": "stesso wallet, solo tu possiedi la chiave",
  "ov.recent": "Transazioni recenti",
  "ov.perf": "Performance del portafoglio",
  "ov.yourWallet": "Il tuo wallet Bitcoin",
  "ov.walletText": "Solo tu possiedi la chiave. Se la perdi, Swissquote e la tua persona di fiducia possono aiutarti insieme a recuperare i fondi, senza mai poter agire da soli.",
  "ov.open": "Apri",
  "ov.openWallet": "Apri il mio wallet",
  "ac.title": "Conti",
  "ac.sim": "Conti e operazioni simulati per la demo",
  "ac.date": "Data",
  "ac.desc": "Descrizione",
  "ac.amount": "Importo",
  "ac.loading": "Caricamento…",
  "pub.help": "Aiuto", "pub.discover": "Scopri i nostri servizi", "pub.login": "Login", "pub.signup": "Apri un conto",
  "pub.signupSoon": "L'apertura del conto non fa parte di questa demo: accedi con un cliente demo.",
  "rail.tools": "Strumenti", "rail.markets": "Mercati", "rail.inspiration": "Ispirazione", "rail.esg": "ESG", "rail.crypto": "Crypto hub",
  "mk.title": "Mercati", "mk.search": "Cerca per nome, simbolo o ISIN", "mk.regions": "Regioni", "mk.global": "Panoramica globale",
  "mk.switzerland": "Svizzera", "mk.us": "Stati Uniti", "mk.germany": "Germania", "mk.euronext": "Euronext", "mk.canada": "Canada", "mk.austria": "Austria",
  "mk.italy": "Italia", "mk.uk": "Regno Unito", "mk.scandinavia": "Scandinavia", "mk.products": "Prodotti", "mk.themes": "Trading tematico", "mk.dots": "Swiss DOTS",
  "mk.structured": "Prodotti strutturati", "mk.warrants": "Warrant e derivati", "mk.options": "Opzioni e future",
  "mk.daily": "Panoramica del giorno", "mk.performers": "Vedi le performance", "mk.components": "Tutte le componenti",
  "mk.demo": "Dati dimostrativi (simulati), non dati di mercato.", "mk.crypto": "Wallet crypto in autocustodia: accedi per aprire il tuo.",
  "login.title": "Accedi a Swissquote", "login.user": "Nome utente", "login.userPh": "Inserisci il tuo nome utente", "login.userForgot": "Nome utente dimenticato?",
  "login.pwd": "Password", "login.pwdPh": "Inserisci la tua password", "login.pwdForgot": "Password dimenticata?", "login.submit": "Accedi",
  "login.passkey": "Accedi con una passkey", "login.help": "Serve aiuto per accedere?", "login.new": "Nuovo su Swissquote?", "login.become": "Diventa cliente",
  "login.show": "Mostra la password", "login.hide": "Nascondi la password",
  "login.demo": "Banca simulata per la demo. Clienti demo: CH-0002 / demo5678, CH-0003 / demo0003.",
  "login.forgotDemo": "Demo: usa uno dei clienti demo indicati qui sotto.",
  "nav.home": "Home", "nav.banking": "Banca", "nav.crypto": "Crypto", "nav.demo": "Demo",
  "rail.portfolio": "Portafoglio", "rail.accounts": "Conti", "rail.cryptoAssets": "Asset crypto", "rail.security": "Sicurezza", "rail.attacks": "Attacchi",
  "shell.logout": "Esci", "shell.myAccount": "Il mio conto", "shell.simBank": "Banca simulata", "shell.language": "Lingua",
  "foot.total": "Valore totale", "foot.cash": "Conti CHF", "foot.crypto": "Crypto", "foot.network": "Rete Bitcoin", "foot.sim": "Banca simulata per la demo",
};
const DICTS: Record<Lang, Dict> = { en, fr, de, it };

const KEY = "sq-lang";
// tr(texte anglais, variables) : écrans crypto, la clé est le texte anglais lui-même (repli : l'anglais).
type Vars = Record<string, string | number>;
const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? `{${k}}`)) : s);
type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string; tr: (en: string, v?: Vars) => string };
const LangCtx = createContext<Ctx>({ lang: "en", setLang: () => undefined, t: (k) => en[k] ?? k, tr: (e, v) => fill(e, v) });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(() => (LANGS.some((l) => l.id === localStorage.getItem(KEY)) ? (localStorage.getItem(KEY) as Lang) : "en"));
  const setLang = (l: Lang) => { localStorage.setItem(KEY, l); document.documentElement.lang = l; set(l); };
  const t = (k: string) => DICTS[lang][k] ?? en[k] ?? k;
  const tr = (e: string, v?: Vars) => fill((lang === "fr" ? CRYPTO_FR[e] : undefined) ?? e, v);
  return <LangCtx.Provider value={{ lang, setLang, t, tr }}>{children}</LangCtx.Provider>;
}
export const useT = () => useContext(LangCtx);

// Sélecteur de langue (« EN ▾ ») : en-tête public, connexion, appli.
export function LangSelect() {
  const { lang, setLang, t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="lang-select">
      <button className="lang-btn" aria-label={t("shell.language")} aria-expanded={open} onClick={() => setOpen(!open)}>
        {LANGS.find((l) => l.id === lang)!.label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="lang-menu" role="menu">
          {LANGS.map((l) => (
            <button key={l.id} role="menuitem" className={l.id === lang ? "on" : ""} onClick={() => { setLang(l.id); setOpen(false); }}>
              <strong>{l.label}</strong> {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
