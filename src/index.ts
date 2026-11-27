/*
 * @chaireblockchainulaval/bnaas-connect — V2
 * Consentement du notaire à CHAQUE opération notariale (OAuth 2.0 Authorization Code + PKCE).
 *
 * 1. connect({ operation }) ouvre une popup sur l'écran BNAAS
 *    `https://auth.test.bnaas.ca/connect/authorize` (production : auth.bnaas.ca) ;
 * 2. le notaire se connecte au besoin, puis autorise ou refuse cette opération précise ;
 * 3. BNAAS renvoie la popup sur le `redirect_uri` de l'application (`?code&state` ou
 *    `?error=access_denied&error_description=…&state`). Cette page appelle
 *    handleRedirectCallback(), qui relaie le retour à la fenêtre ouvrante (même origine)
 *    par localStorage — canal qui survit à la coupure de window.opener (COOP) ;
 * 4. la fenêtre ouvrante vérifie `state`, puis échange le code contre un nit
 *    (`POST /api/v1/oauth/token`) : 5 min, usage unique, lié à l'opération consentie.
 *
 * Aucune dépendance (crypto.subtle natif). Navigateur uniquement.
 */
import { makePkce, randomString } from './encoding';
import { BnaasConnectError } from './errors';
import { encodeOperation, type Operation } from './operation';
import {
  DEFAULT_API_URL, DEFAULT_AUTH_URL, buildAuthorizeUrl, exchangeCode, parseCallback, resolveCallback,
  type CallbackParams, type TokenResult,
} from './protocol';

export { BnaasConnectError } from './errors';
export { encodeOperation, normalizeOperation, OPERATION_RULES, MAX_COUNT } from './operation';
export type { Operation, OperationDocument, OperationType } from './operation';
export type { TokenResult, ConsentedOperation } from './protocol';

export interface ConnectOptions {
  /** `client_id` enregistré côté BNAAS. */
  clientId: string;
  /** URL de callback enregistrée (même origine que la page qui appelle connect()). */
  redirectUri: string;
  /** Opération notariale à faire consentir (obligatoire). */
  operation: Operation;
  /** Exiger que le notaire ressaisisse son mot de passe (`force_reauth=1`). */
  forceReauth?: boolean;
  /** Origine de l'écran de consentement. Défaut : `https://auth.test.bnaas.ca`. */
  authUrl?: string;
  /** URL du Gateway (échange du code). Défaut : `https://api.test.bnaas.ca`. */
  apiUrl?: string;
  /** Redirection pleine page au lieu de la popup (le résultat arrive via handleRedirectCallback). */
  preferRedirect?: boolean;
  /** Délai d'abandon du flux en popup, en ms. Défaut : 300 000 (5 min). */
  timeoutMs?: number;
}

const SS_KEY = 'bnaas_connect_pending';    // sessionStorage : mode redirection pleine page
const RESULT_KEY = 'bnaas_connect_result'; // localStorage : relais popup → ouvreur
const MSG_TYPE = 'bnaas_connect';
const DEFAULT_TIMEOUT_MS = 300_000;

interface PendingState {
  state: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  apiUrl: string;
}

interface RelayPayload extends CallbackParams { ts?: number }

function assertUrl(name: string, value: string): void {
  try { new URL(value); } catch { throw new BnaasConnectError('invalid_config', `${name} : URL absolue attendue`); }
}

/**
 * Demande le consentement du notaire pour `operation` et résout avec le nit.
 * Popup par défaut ; si elle est bloquée (ou `preferRedirect`), redirection pleine page :
 * la promesse ne se résout alors jamais et le résultat est rendu par handleRedirectCallback().
 * Rejette avec une `BnaasConnectError` (voir `code` / `description`).
 */
export async function connect(opts: ConnectOptions): Promise<TokenResult> {
  if (!opts || !opts.clientId || !opts.redirectUri) {
    throw new BnaasConnectError('invalid_config', 'clientId et redirectUri sont requis');
  }
  if (!opts.operation) throw new BnaasConnectError('invalid_operation', 'operation requise');
  const authUrl = opts.authUrl ?? DEFAULT_AUTH_URL;
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL;
  assertUrl('redirectUri', opts.redirectUri);
  assertUrl('authUrl', authUrl);
  assertUrl('apiUrl', apiUrl);

  // Validation et encodage AVANT toute ouverture de fenêtre.
  const operation = encodeOperation(opts.operation);
  const state = randomString(32);
  const { codeVerifier, codeChallenge } = await makePkce();
  const authorizeUrl = buildAuthorizeUrl({
    authUrl, clientId: opts.clientId, redirectUri: opts.redirectUri, state, codeChallenge, operation,
    forceReauth: opts.forceReauth,
  });

  const redirectFullPage = (): Promise<TokenResult> => {
    const pending: PendingState = { state, codeVerifier, clientId: opts.clientId, redirectUri: opts.redirectUri, apiUrl };
    sessionStorage.setItem(SS_KEY, JSON.stringify(pending));
    window.location.assign(authorizeUrl);
    return new Promise<TokenResult>(() => { /* la page est quittée */ });
  };

  if (opts.preferRedirect) return redirectFullPage();

  // Un flux redirection abandonné ne doit pas être copié dans la popup (le navigateur
  // duplique sessionStorage à window.open) ; purger aussi un relais périmé.
  try { sessionStorage.removeItem(SS_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(RESULT_KEY); } catch { /* ignore */ }

  const popup = window.open(authorizeUrl, 'bnaas_connect', 'width=480,height=720');
  if (!popup) return redirectFullPage();

  const ownOrigin = window.location.origin;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<TokenResult>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      clearInterval(pollTimer);
      clearTimeout(timeoutId);
    };

    const finish = async (payload: RelayPayload) => {
      if (settled) return;
      settled = true; cleanup();
      try { popup.close(); } catch { /* ignore */ }
      try { localStorage.removeItem(RESULT_KEY); } catch { /* ignore */ }
      try {
        const code = resolveCallback(state, payload);
        resolve(await exchangeCode({ apiUrl, code, codeVerifier, clientId: opts.clientId, redirectUri: opts.redirectUri }));
      } catch (e) { reject(e); }
    };

    // Un retour portant un autre `state` appartient à un autre flux (autre onglet) : ignoré.
    const accept = (d: RelayPayload | null | undefined) => {
      if (d && d.state === state) void finish(d);
    };

    // Chemin direct : la page de callback (même origine) poste à l'ouvreur si opener existe.
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== ownOrigin) return;
      const d = event.data as (RelayPayload & { type?: string }) | null;
      if (!d || d.type !== MSG_TYPE) return;
      accept(d);
    };

    // Relais localStorage (opener coupé par COOP après le passage sur auth.*).
    const onStorage = (e: StorageEvent) => {
      if (e.key !== RESULT_KEY || !e.newValue) return;
      try { accept(JSON.parse(e.newValue)); } catch { /* ignore */ }
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);

    // popup.closed est inutilisable sous COOP (vrai dès la navigation cross-origin) : on ne
    // s'y fie pas. Succès = relais reçu ; abandon = délai écoulé.
    const pollTimer = setInterval(() => {
      if (settled) return;
      try {
        const raw = localStorage.getItem(RESULT_KEY);
        if (raw) accept(JSON.parse(raw));
      } catch { /* ignore */ }
    }, 400);

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true; cleanup();
      reject(new BnaasConnectError('timeout'));
    }, timeoutMs);
  });
}

/**
 * À appeler au chargement de la page `redirect_uri`.
 * - Redirection pleine page : vérifie `state`, échange le code et renvoie le résultat.
 * - Popup : relaie le retour à la fenêtre ouvrante puis se ferme (renvoie `null` ;
 *   c'est connect() qui vérifie `state` et résout).
 * - Pas un retour OAuth : renvoie `null`.
 */
export async function handleRedirectCallback(): Promise<TokenResult | null> {
  const cb = parseCallback(window.location.search);
  if (!cb) return null;

  const raw = sessionStorage.getItem(SS_KEY);
  if (raw) {
    sessionStorage.removeItem(SS_KEY);
    const pending = JSON.parse(raw) as PendingState;
    const code = resolveCallback(pending.state, cb);
    return exchangeCode({
      apiUrl: pending.apiUrl, code, codeVerifier: pending.codeVerifier,
      clientId: pending.clientId, redirectUri: pending.redirectUri,
    });
  }

  const payload: RelayPayload = { ...cb, ts: Date.now() };
  try { localStorage.setItem(RESULT_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
  try { window.opener?.postMessage({ type: MSG_TYPE, ...payload }, window.location.origin); } catch { /* ignore */ }
  // Laisser partir l'événement storage avant de fermer.
  setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 100);
  return null;
}

export default { connect, handleRedirectCallback };
