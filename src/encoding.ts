/* Encodage base64url (RFC 4648 §5) sans remplissage, et PKCE (RFC 7636, S256). */

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Chaîne aléatoire de `length` caractères de l'alphabet base64url (crypto.getRandomValues). */
export function randomString(length = 64): string {
  // 3 octets → 4 caractères : on tire assez d'octets puis on tronque.
  const bytes = new Uint8Array(Math.ceil((length * 3) / 4));
  crypto.getRandomValues(bytes);
  return base64url(bytes).slice(0, length);
}

/** code_challenge = BASE64URL(SHA256(ASCII(code_verifier))). */
export async function pkceChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64url(digest);
}

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/** Paire PKCE : verifier de 64 caractères (RFC 7636 : 43 à 128, alphabet non réservé). */
export async function makePkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = randomString(64);
  if (!VERIFIER_RE.test(codeVerifier)) throw new Error('code_verifier invalide');
  return { codeVerifier, codeChallenge: await pkceChallenge(codeVerifier) };
}
