/* Briques du protocole, sans dépendance au DOM (testables isolément). */
import { BnaasConnectError } from './errors';
import type { OperationType } from './operation';

export const DEFAULT_AUTH_URL = 'https://auth.test.bnaas.ca';
export const DEFAULT_API_URL = 'https://api.test.bnaas.ca';

/** Résumé de l'opération consentie, tel que renvoyé par le Gateway. */
export interface ConsentedOperation {
  type: OperationType;
  [field: string]: unknown;
}

export interface TokenResult {
  /** Jeton d'identité notariale opaque (`bnaas_nit_…`) : 5 min, **usage unique**, lié à l'opération. */
  token: string;
  /** Expiration ISO 8601 du jeton. */
  expires_at: string;
  /**
   * Identifiant **stable et global** du notaire (identité Fabric, ex. `notaire_…`). À indexer
   * pour lier / dédoublonner les comptes notaires — jamais le `token`.
   */
  sub: string;
  /** Identifiant du consentement donné par le notaire (traçabilité, historique). */
  consent_id: string;
  /** Opération consentie (résumé normalisé par le Gateway). */
  operation: ConsentedOperation;
}

const stripSlash = (u: string) => u.replace(/\/+$/, '');

export interface AuthorizeUrlArgs {
  authUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** Opération déjà encodée (base64url). */
  operation: string;
  forceReauth?: boolean;
}

export function buildAuthorizeUrl(a: AuthorizeUrlArgs): string {
  const qs = new URLSearchParams({
    client_id: a.clientId,
    redirect_uri: a.redirectUri,
    response_type: 'code',
    state: a.state,
    code_challenge: a.codeChallenge,
    code_challenge_method: 'S256',
    operation: a.operation,
  });
  if (a.forceReauth) qs.set('force_reauth', '1');
  return `${stripSlash(a.authUrl)}/connect/authorize?${qs.toString()}`;
}

export interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/** Lit `?code&state` ou `?error&error_description&state`. `null` si ce n'est pas un retour OAuth. */
export function parseCallback(search: string): CallbackParams | null {
  const q = new URLSearchParams(search);
  const code = q.get('code') || undefined;
  const error = q.get('error') || undefined;
  if (!code && !error) return null;
  return {
    code,
    error,
    state: q.get('state') || undefined,
    errorDescription: q.get('error_description') || undefined,
  };
}

/** Lève `state_mismatch` si le `state` reçu est absent ou différent de celui émis. */
export function verifyState(expected: string, received: string | undefined | null): void {
  if (!expected || !received || received !== expected) throw new BnaasConnectError('state_mismatch');
}

/**
 * Transforme un retour vérifié en code ou en erreur. Le `state` est vérifié AVANT de
 * considérer l'erreur : une erreur non liée à notre demande n'est pas digne de confiance.
 */
export function resolveCallback(expectedState: string, cb: CallbackParams): string {
  verifyState(expectedState, cb.state);
  if (cb.error) throw new BnaasConnectError(cb.error, cb.errorDescription);
  if (!cb.code) throw new BnaasConnectError('invalid_response', 'code absent');
  return cb.code;
}

export interface ExchangeArgs {
  apiUrl: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}

/** `POST /api/v1/oauth/token` (JSON, sans en-tête Authorization). */
export async function exchangeCode(a: ExchangeArgs): Promise<TokenResult> {
  const f = a.fetchImpl ?? fetch;
  const res = await f(`${stripSlash(a.apiUrl)}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code: a.code, code_verifier: a.codeVerifier, client_id: a.clientId, redirect_uri: a.redirectUri }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const detail = typeof err.detail === 'string' ? err.detail : typeof err.title === 'string' ? err.title : undefined;
    throw new BnaasConnectError('token_exchange_failed', detail, res.status);
  }
  const body = (await res.json().catch(() => null)) as TokenResult | null;
  if (!body || typeof body.token !== 'string' || typeof body.sub !== 'string') {
    throw new BnaasConnectError('token_exchange_failed', 'réponse inattendue', res.status);
  }
  return body;
}
