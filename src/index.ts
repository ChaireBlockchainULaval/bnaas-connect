/*
 * @chaireblockchainulaval/bnaas-connect
 * SDK « Se connecter avec BNAAS » — OAuth 2.0 Authorization Code + PKCE.
 *
 * Permet à une application tierce d'obtenir un jeton d'identité notariale sans
 * copier-coller. Aucune dépendance (crypto.subtle natif). Navigateur uniquement.
 *
 * Modes de livraison du code :
 *  - Popup + postMessage (chemin rapide, session BNAAS déjà active).
 *  - Repli redirection : si la popup a dû faire un login interactif, la politique
 *    COOP du fournisseur d'identité coupe window.opener. La popup retombe alors
 *    sur le redirect_uri (même origine que l'appli ouvrante) ; le SDK y relaie le
 *    code via BroadcastChannel à l'instance connect() de l'ouvreur.
 *    → l'appli doit appeler handleRedirectCallback() sur sa page de redirect_uri.
 *  - Redirection pleine page (preferRedirect ou popup bloquée) : handleRedirectCallback()
 *    renvoie directement le jeton.
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
const CHANNEL = 'bnaas_connect';

type Mode = 'popup' | 'redirect';

interface PendingState {
  state: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  apiUrl: string;
  mode: Mode;
}

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

interface RelayMessage {
  type?: string;
  state?: string;
  code?: string;
  error?: string;
}

/* --------------------------------- API SDK --------------------------------- */

/**
 * Lance le flux et résout avec { token, expires_at }.
 * Ouvre une popup ; si elle est bloquée, bascule en redirection pleine page.
 * Si la popup a dû faire un login interactif (opener coupé par COOP), le code est
 * récupéré via BroadcastChannel — à condition que la page redirect_uri appelle
 * handleRedirectCallback().
 */
export async function connect(opts: ConnectOptions): Promise<TokenResult> {
  const cfg = { ...DEFAULTS, ...opts };
  if (!cfg.clientId || !cfg.redirectUri) throw new Error('clientId et redirectUri sont requis');

  const state = randomString(24);
  const { codeVerifier, codeChallenge } = await makePkce();
  const authorizeUrl = buildAuthorizeUrl({ portalUrl: cfg.portalUrl, clientId: cfg.clientId, redirectUri: cfg.redirectUri, state, codeChallenge });
  const portalOrigin = new URL(cfg.portalUrl).origin;

  const persist = (mode: Mode) => {
    const pending: PendingState = { state, codeVerifier, clientId: cfg.clientId, redirectUri: cfg.redirectUri, apiUrl: cfg.apiUrl, mode };
    sessionStorage.setItem(SS_KEY, JSON.stringify(pending));
  };

  // Redirection pleine page explicite.
  if (cfg.preferRedirect) {
    persist('redirect');
    window.location.href = authorizeUrl;
    return new Promise<TokenResult>(() => {});
  }

  const popup = window.open(authorizeUrl, 'bnaas_connect', 'width=460,height=640');

  // Popup bloquée → repli redirection pleine page.
  if (!popup) {
    persist('redirect');
    window.location.href = authorizeUrl;
    return new Promise<TokenResult>(() => {});
  }

  // Popup ouverte. Pas de persistance nécessaire : en cas de repli, la popup
  // relaie le code lu dans son URL (détection via window.name), et c'est cette
  // instance-ci qui valide le state et détient le code_verifier.
  return new Promise<TokenResult>((resolve, reject) => {
    let settled = false;
    const channel = new BroadcastChannel(CHANNEL);
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      channel.removeEventListener('message', onRelay);
      channel.close();
      clearInterval(closedTimer);
    };

    const complete = async (code: string) => {
      settled = true; cleanup();
      try { popup.close(); } catch { /* ignore */ }
      try {
        resolve(await exchange({ apiUrl: cfg.apiUrl, code, codeVerifier, clientId: cfg.clientId, redirectUri: cfg.redirectUri }));
      } catch (e) { reject(e as Error); }
    };

    // Chemin rapide : postMessage direct depuis le portail (opener intact).
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== portalOrigin) return;
      const data = event.data as RelayMessage;
      if (!data || data.type !== 'bnaas_connect') return;
      if (data.state && data.state !== state) return;
      if (settled) return;
      if (data.error) { settled = true; cleanup(); reject(new Error(data.error)); return; }
      void complete(data.code as string);
    };

    // Repli : relais du code depuis la page redirect_uri (même origine que l'ouvreur).
    const onRelay = (event: MessageEvent) => {
      const data = event.data as RelayMessage;
      if (!data || data.type !== 'bnaas_connect_relay') return;
      if (data.state !== state) return;
      if (settled) return;
      if (data.error) { settled = true; cleanup(); reject(new Error(data.error)); return; }
      void complete(data.code as string);
    };

    window.addEventListener('message', onMessage);
    channel.addEventListener('message', onRelay);

    const closedTimer = setInterval(() => {
      if (popup.closed && !settled) { cleanup(); reject(new Error('popup_closed')); }
    }, 500);
  });
}

/**
 * À appeler au chargement de la page de callback (redirect_uri).
 * - Si la fenêtre est une popup en repli : relaie le code à l'ouvreur puis se ferme
 *   (renvoie null — c'est l'instance connect() de l'ouvreur qui résout).
 * - Si redirection pleine page : échange et renvoie { token, expires_at }.
 * - Sinon (aucun flux en attente) : renvoie null.
 */
export async function handleRedirectCallback(): Promise<TokenResult | null> {
  const q = new URLSearchParams(window.location.search);
  const code = q.get('code');
  const state = q.get('state');
  const error = q.get('error');
  if (!code && !error) return null;

  // Détection fiable de la popup : window.name est fixé par window.open() et
  // persiste à travers le login interactif (contrairement à window.opener, coupé
  // par COOP). Dans ce cas on relaie le code+state (lus dans l'URL) à l'ouvreur,
  // qui valide le state et détient le code_verifier.
  if (window.name === 'bnaas_connect') {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: 'bnaas_connect_relay', state: state || undefined, code: code || undefined, error: error || undefined });
    channel.close();
    try { window.close(); } catch { /* ignore */ }
    return null;
  }

  // Sinon : redirection pleine page. On a besoin du code_verifier persisté.
  const raw = sessionStorage.getItem(SS_KEY);
  if (!raw) return null;
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
