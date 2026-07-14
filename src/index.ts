/*
 * @chaireblockchainulaval/bnaas-connect
 * SDK « Se connecter avec BNAAS » — OAuth 2.0 Authorization Code + PKCE.
 *
 * Obtient un jeton d'identité notariale sans copier-coller. Aucune dépendance
 * (crypto.subtle natif). Navigateur uniquement.
 *
 * Livraison du code à la fenêtre ouvrante :
 *  - Chemin rapide : postMessage depuis le portail (session BNAAS déjà active).
 *  - Repli robuste : si un login interactif a eu lieu, la politique COOP du
 *    fournisseur d'identité coupe window.opener ET le navigateur efface
 *    window.name. La popup retombe alors sur le redirect_uri (même origine que
 *    l'appli ouvrante) et communique le code via localStorage + l'événement
 *    « storage » — canal fiable entre fenêtres de même origine, qui survit à
 *    l'aller-retour cross-origin.
 *    → l'appli doit appeler handleRedirectCallback() sur sa page de redirect_uri.
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

const SS_KEY = 'bnaas_connect_pending';   // sessionStorage : mode redirection pleine page
const RESULT_KEY = 'bnaas_connect_result'; // localStorage : relais popup → ouvreur

interface PendingState {
  state: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  apiUrl: string;
}

interface RelayPayload {
  state?: string;
  code?: string;
  error?: string;
  ts?: number;
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

/* --------------------------------- API SDK --------------------------------- */

/**
 * Lance le flux et résout avec { token, expires_at }.
 * Popup par défaut ; repli redirection si la popup est bloquée. Le cas « login
 * interactif » (COOP) est couvert via localStorage, à condition que la page
 * redirect_uri appelle handleRedirectCallback().
 */
export async function connect(opts: ConnectOptions): Promise<TokenResult> {
  const cfg = { ...DEFAULTS, ...opts };
  if (!cfg.clientId || !cfg.redirectUri) throw new Error('clientId et redirectUri sont requis');

  const state = randomString(24);
  const { codeVerifier, codeChallenge } = await makePkce();
  const authorizeUrl = buildAuthorizeUrl({ portalUrl: cfg.portalUrl, clientId: cfg.clientId, redirectUri: cfg.redirectUri, state, codeChallenge });
  const portalOrigin = new URL(cfg.portalUrl).origin;

  // Redirection pleine page (même fenêtre) : persister pour l'échange au retour.
  const persistRedirect = () => {
    const pending: PendingState = { state, codeVerifier, clientId: cfg.clientId, redirectUri: cfg.redirectUri, apiUrl: cfg.apiUrl };
    sessionStorage.setItem(SS_KEY, JSON.stringify(pending));
  };

  if (cfg.preferRedirect) {
    persistRedirect();
    window.location.href = authorizeUrl;
    return new Promise<TokenResult>(() => {});
  }

  const popup = window.open(authorizeUrl, 'bnaas_connect', 'width=460,height=640');
  if (!popup) {
    persistRedirect();
    window.location.href = authorizeUrl;
    return new Promise<TokenResult>(() => {});
  }

  return new Promise<TokenResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      clearInterval(closedTimer);
    };

    const finish = async (payload: RelayPayload) => {
      if (settled) return;
      settled = true; cleanup();
      try { popup.close(); } catch { /* ignore */ }
      try { localStorage.removeItem(RESULT_KEY); } catch { /* ignore */ }
      if (payload.error) { reject(new Error(payload.error)); return; }
      try {
        resolve(await exchange({ apiUrl: cfg.apiUrl, code: payload.code as string, codeVerifier, clientId: cfg.clientId, redirectUri: cfg.redirectUri }));
      } catch (e) { reject(e as Error); }
    };

    // Chemin rapide : postMessage direct du portail (opener intact).
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== portalOrigin) return;
      const d = event.data as RelayPayload & { type?: string };
      if (!d || d.type !== 'bnaas_connect') return;
      if (d.state && d.state !== state) return;
      void finish({ code: d.code, error: d.error });
    };

    // Repli COOP : relais via localStorage depuis la page redirect_uri.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== RESULT_KEY || !e.newValue) return;
      let d: RelayPayload;
      try { d = JSON.parse(e.newValue); } catch { return; }
      if (d.state !== state) return;
      void finish({ code: d.code, error: d.error });
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);

    // Fallback robuste : relire localStorage à chaque tick, indépendamment de
    // l'événement storage (qui peut ne pas traverser) ET de popup.closed (peu
    // fiable quand COOP neutralise le handle de la popup).
    const closedTimer = setInterval(() => {
      if (settled) return;
      try {
        const raw = localStorage.getItem(RESULT_KEY);
        if (raw) {
          const d: RelayPayload = JSON.parse(raw);
          if (d.state === state) { void finish({ code: d.code, error: d.error }); return; }
        }
      } catch { /* ignore */ }
      if (popup.closed) { cleanup(); reject(new Error('popup_closed')); }
    }, 400);
  });
}

/**
 * À appeler au chargement de la page de callback (redirect_uri).
 * - Redirection pleine page (même fenêtre) : échange et renvoie { token, expires_at }.
 * - Popup (fenêtre séparée) : relaie le code à l'ouvreur via localStorage puis se
 *   ferme (renvoie null — c'est connect() de l'ouvreur qui résout).
 * - Aucun flux en attente : renvoie null.
 */
export async function handleRedirectCallback(): Promise<TokenResult | null> {
  const q = new URLSearchParams(window.location.search);
  const code = q.get('code');
  const state = q.get('state');
  const error = q.get('error');
  if (!code && !error) return null;

  // Redirection pleine page : le code_verifier est dans le sessionStorage de CETTE fenêtre.
  const raw = sessionStorage.getItem(SS_KEY);
  if (raw) {
    sessionStorage.removeItem(SS_KEY);
    const pending: PendingState = JSON.parse(raw);
    if (state && pending.state && state !== pending.state) throw new Error('state_mismatch');
    if (error) throw new Error(error);
    return exchange({
      apiUrl: pending.apiUrl, code: code as string, codeVerifier: pending.codeVerifier,
      clientId: pending.clientId, redirectUri: pending.redirectUri,
    });
  }

  // Popup : relayer à l'ouvreur (même origine) via localStorage, puis fermer.
  const payload: RelayPayload = { state: state || undefined, code: code || undefined, error: error || undefined, ts: Date.now() };
  try { localStorage.setItem(RESULT_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
  // Laisser le temps à l'événement storage de partir avant de fermer.
  setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 100);
  return null;
}

export default { connect, handleRedirectCallback };
