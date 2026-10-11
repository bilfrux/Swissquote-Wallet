// Étape 22 : site public (page « Marchés », données simulées), page de connexion et langues (EN, FR, DE, IT).
// Prérequis : scripts/demo/signet-ports.sh (appli APP_URL, bank-mock :4000). Une seule connexion (quota Esplora).
import { chromium } from "playwright-core";
import { makeReport } from "./lib.ts";

const APP = process.env.APP_URL ?? "http://localhost:5183";
const SHOTS = "docs/validation/captures";
const { report, summary } = makeReport();
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errs: string[] = [], failed: string[] = [];

try {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  p.on("console", (m) => m.type() === "error" && errs.push(m.text())); p.on("pageerror", (e) => errs.push(e.message));
  p.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).host}${new URL(r.url()).pathname}`); });
  await p.goto(APP); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload();

  // 22-1 Page « Marchés » avant connexion.
  const cards = p.getByTestId("markets").locator("article");
  await cards.first().waitFor();
  const n = await cards.count();
  const head = (await p.locator(".pub-head").textContent()) ?? "";
  await p.screenshot({ path: `${SHOTS}/etape-22-1-marches-en.png` });
  report("22-1", "Accueil public « Marchés » : aperçu du jour (10 cartes simulées avec courbe), en-tête Aide / langue / Login / Sign up", n === 10 && /Login/.test(head) && /Sign up/.test(head) && (await p.locator(".mk-spark").count()) === 10, `${n} cartes ; en-tête : ${head.replace(/\s+/g, " ")}`);

  // 22-2 Langue : FR appliquée partout et mémorisée après rechargement.
  await p.getByRole("button", { name: "Language" }).click();
  await p.getByRole("menuitem", { name: /FR/ }).click();
  const h1fr = await p.locator("h1").textContent();
  await p.reload();
  const h1reload = await p.locator("h1").textContent();
  report("22-2", "Choix de la langue (FR) appliqué et mémorisé après rechargement", h1fr === "Marchés" && h1reload === "Marchés", `titre : ${h1fr} ; après rechargement : ${h1reload}`);

  // 22-3 Connexion (FR) : libellés traduits, refus traduit, mot de passe affichable, connexion réussie.
  await p.getByRole("button", { name: "Connexion", exact: true }).click();
  await p.getByRole("heading", { name: "Connexion à Swissquote" }).waitFor();
  await p.screenshot({ path: `${SHOTS}/etape-22-2-connexion-fr.png` });
  await p.getByLabel("Nom d'utilisateur").fill("CH-0003");
  await p.getByLabel("Mot de passe", { exact: true }).fill("faux");
  await p.getByRole("button", { name: "Afficher le mot de passe" }).click();
  const shown = await p.getByLabel("Mot de passe", { exact: true }).getAttribute("type");
  const before = errs.length;
  await p.getByRole("button", { name: "Connexion", exact: true }).click();
  const bad = (await p.locator(".error").textContent()) ?? "";
  errs.splice(before); failed.splice(failed.findIndex((f) => f.startsWith("403")), 1); // refus volontaire
  await p.getByLabel("Mot de passe", { exact: true }).fill("demo0003");
  await p.getByRole("button", { name: "Connexion", exact: true }).click();
  await p.getByRole("button", { name: "Déconnexion" }).waitFor({ timeout: 20000 });
  report("22-3", "Connexion en français : mauvais mot de passe refusé avec un message traduit, mot de passe affichable, puis connexion réussie", bad === "Nom d'utilisateur ou mot de passe incorrect." && shown === "text", `refus : ${bad} ; champ affiché en clair : ${shown}`);

  // 22-6 Écrans crypto en français : wallet existant (accueil du wallet) ou création du wallet.
  await p.locator(".d-topnav").getByRole("button", { name: "Crypto", exact: true }).click();
  const crypto = p.getByTestId("wallet-page").or(p.getByRole("heading", { name: "Créer mon wallet Bitcoin" }));
  await crypto.first().waitFor({ timeout: 20000 });
  const cryptoText = ((await p.locator("main").textContent()) ?? "").replace(/\s+/g, " ");
  const frWords = ["Valeur crypto totale", "Variation du jour", "Mon wallet", "Recevoir", "Envoyer"].filter((w) => cryptoText.includes(w));
  const created = await p.getByTestId("wallet-page").isVisible();
  const enLeft = ["Total crypto value", "Daily change", "My wallet", "Receive", "Create my Bitcoin wallet"].filter((w) => cryptoText.includes(w));
  await p.screenshot({ path: `${SHOTS}/etape-22-6-crypto-fr.png` });
  report("22-6", "Écrans crypto en français (wallet : valeur totale, variation du jour, Mon wallet, Recevoir / Envoyer), sans libellé anglais restant parmi ceux contrôlés",
    (created ? frWords.length === 5 : cryptoText.includes("Créer mon wallet Bitcoin")) && enLeft.length === 0,
    `${created ? "wallet existant" : "création du wallet"} ; trouvés : ${frWords.join(", ") || "—"} ; anglais restant : ${enLeft.join(", ") || "aucun"}`);

  // 22-4 L'appli suit la langue (DE), puis déconnexion → retour à « Marchés ».
  await p.locator(".d-topnav").getByRole("button", { name: "Accueil", exact: true }).click();
  await p.getByRole("button", { name: "Langue" }).click();
  await p.getByRole("menuitem", { name: /DE/ }).click();
  await p.getByRole("heading", { name: "Übersicht" }).waitFor();
  const nav = (await p.locator(".d-topnav").textContent()) ?? "";
  await p.screenshot({ path: `${SHOTS}/etape-22-3-appli-de.png` });
  await p.getByRole("button", { name: "Abmelden" }).click();
  const back = await p.getByRole("heading", { name: "Märkte" }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  report("22-4", "Appli connectée en allemand (menus, aperçu, pied de page) ; déconnexion : retour à la page « Märkte »", /Startseite/.test(nav) && back, `menu : ${nav} ; retour aux marchés : ${back}`);

  // 22-5 Téléphone : page publique utilisable, bouton de connexion visible.
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await m.goto(APP); await m.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await m.reload();
  await m.getByTestId("markets").locator("article").first().waitFor();
  await m.screenshot({ path: `${SHOTS}/etape-22-4-marches-telephone.png` });
  await m.getByRole("button", { name: "Login", exact: true }).click();
  const formOk = await m.getByLabel("Username").isVisible();
  await m.screenshot({ path: `${SHOTS}/etape-22-5-connexion-telephone.png` });
  report("22-5", "Téléphone : page « Markets » puis page de connexion utilisables", formOk, `formulaire visible : ${formOk}`);
} finally {
  await b.close();
}
report("22-x", "Aucune erreur dans les consoles (hors refus volontaire du mauvais mot de passe)", errs.length === 0, `${errs.join(" | ") || "aucune"} ; réponses en erreur : ${[...new Set(failed)].join(", ") || "aucune"}`);
process.exit(summary() ? 0 : 1);
