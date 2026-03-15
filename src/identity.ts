/**
 * Persistent identity using ECDSA P-256 keypair.
 * Stored in localStorage as JWK. Short ID derived from SHA-256 of public key.
 */

const STORAGE_KEY = "tbdchat_identity";

export type Identity = {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
  shortId: string;
};

let _identity: Identity | null = null;

async function deriveShortId(publicKey: JsonWebKey): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(publicKey));
  const hash = await crypto.subtle.digest("SHA-256", raw);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function initIdentity(): Promise<Identity> {
  // Try loading from localStorage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored) as { publicKey: JsonWebKey; privateKey: JsonWebKey };
    const shortId = await deriveShortId(parsed.publicKey);
    _identity = { publicKey: parsed.publicKey, privateKey: parsed.privateKey, shortId };
    return _identity;
  }

  // Generate new keypair
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  localStorage.setItem(STORAGE_KEY, JSON.stringify({ publicKey, privateKey }));

  const shortId = await deriveShortId(publicKey);
  _identity = { publicKey, privateKey, shortId };
  return _identity;
}

export function getShortId(): string {
  if (!_identity) throw new Error("Identity not initialized");
  return _identity.shortId;
}
