/*
 * @chaireblockchainulaval/bnaas-connect
 * SDK « Se connecter avec BNAAS » — OAuth 2.0 Authorization Code + PKCE.
 *
 * Permet à une application tierce d'obtenir un jeton d'identité notariale sans
 * copier-coller. Aucune dépendance (crypto.subtle natif). Navigateur uniquement.
 */

export interface ConnectOptions {
  /** App id Entra du tiers (= client_id enregistré côté BNAAS). */
  clientId: string;
  /** URL de callback autorisée (doit figurer dans l'allowlist BNAAS). */
  redirectUri: string;
  /** Origine du portail BNAAS (émetteur du postMessage). */
  portalUrl?: string;
  /** URL du Gateway BNAAS (échange du code). */
  apiUrl?: string;
  /** Forcer le mode redirection (au lieu de la popup). */
  preferRedirect?: boolean;
}

/** Jeton d'identité notariale (15 min, usage unique). */
export interface TokenResult {
  token: string;
  expires_at: string;
}

const DEFAULTS = {
  portalUrl: 'https://app.test.bnaas.ca',
  apiUrl: 'https://api.test.bnaas.ca',
};

const SS_KEY = 'bnaas_connect_pending';

/* ----------------------------- Utilitaires PKCE ---------------------------- */

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes).slice(0, length);
}

async function sha256Base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64url(digest);
}

async function makePkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256Base64url(codeVerifier);
  return { codeVerifier, codeChallenge };
}

/* ------------------------------ Échange du code ---------------------------- */

interface ExchangeArgs {
  apiUrl: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}

async function exchange({ apiUrl, code, codeVerifier, clientId, redirectUri }: ExchangeArgs): Promise<TokenResult> {
  const res = await fetch(`${apiUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier, client_id: clientId, redirect_uri: redirectUri }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({} as Record<string, string>));
    throw new Error(err.detail || err.title || `Token exchange failed (${res.status})`);
  }
  return res.json() as Promise<TokenResult>;
}

function buildAuthorizeUrl(o: { portalUrl: string; clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const qs = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    state: o.state,
    code_challenge: o.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${o.portalUrl}/connect?${qs.toString()}`;
}

interface PendingState {
  state: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  apiUrl: string;
}

/* --------------------------------- API SDK --------------------------------- */

/**
 * Lance le flux et résout avec { token, expires_at }.
 * Ouvre une popup ; si elle est bloquée, bascule en redirection.
 */
export async function connect(opts: ConnectOptions): Promise<TokenResult> {
  const cfg = { ...DEFAULTS, ...opts };
  if (!cfg.clientId || !cfg.redirectUri) throw new Error('clientId et redirectUri sont requis');

  const state = randomString(24);
  const { codeVerifier, codeChallenge } = await makePkce();
  const authorizeUrl = buildAuthorizeUrl({ portalUrl: cfg.portalUrl, clientId: cfg.clientId, redirectUri: cfg.redirectUri, state, codeChallenge });
  const portalOrigin = new URL(cfg.portalUrl).origin;

  const persist = () => {
    const pending: PendingState = { state, codeVerifier, clientId: cfg.clientId, redirectUri: cfg.redirectUri, apiUrl: cfg.apiUrl };
    sessionStorage.setItem(SS_KEY, JSON.stringify(pending));
  };

  // Mode redirection explicite.
  if (cfg.preferRedirect) {
    persist();
    window.location.href = authorizeUrl;
    return new Promise<TokenResult>(() => {});
  }

  const popup = window.open(authorizeUrl, 'bnaas_connect', 'width=460,height=640');

  // Popup bloquée → repli redirection.
  if (!popup) {
    persist();
    window.location.href = authorizeUrl;
    return new Promise<TokenResult>(() => {});
  }

  return new Promise<TokenResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => { window.removeEventListener('message', onMessage); clearInterval(closedTimer); };

    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== portalOrigin) return;
      const data = event.data as { type?: string; code?: string; state?: string; error?: string };
      if (!data || data.type !== 'bnaas_connect') return;
      if (data.state && data.state !== state) return;
      settled = true; cleanup();

      if (data.error) { reject(new Error(data.error)); return; }
      try {
        resolve(await exchange({ apiUrl: cfg.apiUrl, code: data.code as string, codeVerifier, clientId: cfg.clientId, redirectUri: cfg.redirectUri }));
      } catch (e) { reject(e as Error); }
    };

    window.addEventListener('message', onMessage);

    const closedTimer = setInterval(() => {
      if (popup.closed && !settled) { cleanup(); reject(new Error('popup_closed')); }
    }, 500);
  });
}

/**
 * À appeler au chargement de la page de callback en mode redirection.
 * Résout avec { token, expires_at } si un flux est en attente, sinon null.
 */
export async function handleRedirectCallback(): Promise<TokenResult | null> {
  const raw = sessionStorage.getItem(SS_KEY);
  if (!raw) return null;

  const q = new URLSearchParams(window.location.search);
  const code = q.get('code');
  const state = q.get('state');
  const error = q.get('error');
  if (!code && !error) return null;

  sessionStorage.removeItem(SS_KEY);
  const pending: PendingState = JSON.parse(raw);
  if (state && pending.state && state !== pending.state) throw new Error('state_mismatch');
  if (error) throw new Error(error);

  return exchange({
    apiUrl: pending.apiUrl, code: code as string, codeVerifier: pending.codeVerifier,
    clientId: pending.clientId, redirectUri: pending.redirectUri,
  });
}

export default { connect, handleRedirectCallback };
