// Biométrie du Wallet du client : une passkey propre au wallet, sur cet appareil (Touch ID, Face ID, Windows Hello).
// On n'en utilise que l'extension WebAuthn « prf » : après vérification de l'utilisateur, l'authentificateur rend un
// secret de 32 octets, toujours le même pour la même passkey et le même sel. Ce secret chiffre la phrase (vault.ts).
// API WebAuthn du navigateur, sans cryptographie écrite ici. Aucune signature n'est vérifiée : sans le bon secret,
// le déchiffrement échoue.
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
// Délai de la demande de biométrie : sans authentificateur (passkey supprimée), le navigateur attendrait sans fin.
const TIMEOUT_MS = 60_000;

export type BioKey = { credentialId: string; prfSalt: string };
export type Auth = { pin: string } | { prf: string } | Record<string, never>;

export const bioAvailable = () =>
  typeof PublicKeyCredential !== "undefined" && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);

const explain = (e: any) => {
  if (e?.name === "NotAllowedError") return new Error("biometric check cancelled or not recognised");
  return e instanceof Error ? e : new Error(String(e));
};

// Crée la passkey du wallet et vérifie qu'elle sait rendre un secret (extension PRF).
export async function bioRegister(label: string): Promise<BioKey> {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: random(32), timeout: TIMEOUT_MS, // aucune vérification par un serveur : seul le secret PRF compte
        rp: { name: "Client Wallet", id: location.hostname },
        user: { id: random(16), name: `Client Wallet · ${label}`, displayName: `Client Wallet · ${label}` },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (e) { throw explain(e); }
  const prf = (cred.getClientExtensionResults() as { prf?: { enabled?: boolean } }).prf;
  if (prf?.enabled === false || prf === undefined)
    throw new Error("this device's biometrics cannot protect your phrase (WebAuthn PRF extension not supported)");
  return { credentialId: b64u(cred.rawId), prfSalt: b64u(random(32)) };
}

// Demande la biométrie et renvoie le secret qui déchiffre la phrase.
export async function bioSecret(k: BioKey): Promise<string> {
  let a: PublicKeyCredential;
  try {
    a = (await navigator.credentials.get({
      publicKey: {
        challenge: random(32), timeout: TIMEOUT_MS, rpId: location.hostname, userVerification: "required",
        allowCredentials: [{ type: "public-key", id: fromB64u(k.credentialId) }],
        extensions: { prf: { eval: { first: fromB64u(k.prfSalt) } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (e) { throw explain(e); }
  const first = (a.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  if (!first) throw new Error("this device did not return the biometric key (WebAuthn PRF extension)");
  return b64u(first);
}

// Création avec biométrie : passkey, puis secret (deux demandes de biométrie).
export async function bioEnroll(label: string) {
  const k = await bioRegister(label);
  return { ...k, prf: await bioSecret(k) };
}
