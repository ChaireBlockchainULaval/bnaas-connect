import { describe, expect, it, vi } from 'vitest';
import { buildAuthorizeUrl, exchangeCode, parseCallback, resolveCallback, verifyState } from '../src/protocol';
import { BnaasConnectError } from '../src/errors';

const caught = (fn: () => unknown) => {
  try { fn(); } catch (e) { return { code: (e as BnaasConnectError).code, description: (e as BnaasConnectError).description }; }
  return null;
};

describe('buildAuthorizeUrl', () => {
  const base = {
    authUrl: 'https://auth.test.bnaas.ca/', clientId: 'client-exemple', redirectUri: 'https://app.example/callback',
    state: 'st', codeChallenge: 'cc', operation: 'eyJ0eXBlIjoib3Blbl9kb3NzaWVyIn0',
  };

  it('vise /connect/authorize avec tous les paramètres du contrat', () => {
    const u = new URL(buildAuthorizeUrl(base));
    expect(u.origin + u.pathname).toBe('https://auth.test.bnaas.ca/connect/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'client-exemple', redirect_uri: 'https://app.example/callback', response_type: 'code',
      state: 'st', code_challenge: 'cc', code_challenge_method: 'S256', operation: 'eyJ0eXBlIjoib3Blbl9kb3NzaWVyIn0',
    });
  });

  it('ajoute force_reauth=1 seulement sur demande', () => {
    expect(new URL(buildAuthorizeUrl({ ...base, forceReauth: true })).searchParams.get('force_reauth')).toBe('1');
    expect(new URL(buildAuthorizeUrl({ ...base, forceReauth: false })).searchParams.has('force_reauth')).toBe(false);
  });
});

describe('vérification de state', () => {
  it('accepte uniquement le state émis', () => {
    expect(caught(() => verifyState('abc', 'abc'))).toBeNull();
    expect(caught(() => verifyState('abc', 'abd'))?.code).toBe('state_mismatch');
    expect(caught(() => verifyState('abc', undefined))?.code).toBe('state_mismatch');
    expect(caught(() => verifyState('abc', ''))?.code).toBe('state_mismatch');
    expect(caught(() => verifyState('', ''))?.code).toBe('state_mismatch');
  });

  it('parseCallback lit code, erreur et description', () => {
    expect(parseCallback('?foo=1')).toBeNull();
    expect(parseCallback('?code=C&state=S')).toEqual({ code: 'C', state: 'S', error: undefined, errorDescription: undefined });
    expect(parseCallback('?error=access_denied&error_description=invalid_preparation&state=S')).toEqual({
      code: undefined, state: 'S', error: 'access_denied', errorDescription: 'invalid_preparation',
    });
  });

  it('resolveCallback vérifie state avant de considérer une erreur', () => {
    expect(resolveCallback('S', { code: 'C', state: 'S' })).toBe('C');
    expect(caught(() => resolveCallback('S', { code: 'C', state: 'X' }))?.code).toBe('state_mismatch');
    expect(caught(() => resolveCallback('S', { error: 'access_denied', state: 'X' }))?.code).toBe('state_mismatch');
    expect(caught(() => resolveCallback('S', { error: 'access_denied', errorDescription: 'consent_refused', state: 'S' })))
      .toEqual({ code: 'access_denied', description: 'consent_refused' });
    expect(caught(() => resolveCallback('S', { state: 'S' }))?.code).toBe('invalid_response');
  });
});

describe('exchangeCode', () => {
  const args = { apiUrl: 'https://api.test.bnaas.ca', code: 'C', codeVerifier: 'V', clientId: 'cid', redirectUri: 'https://app.example/callback' };
  const okBody = { token: 'bnaas_nit_x', expires_at: '2026-01-01T00:00:00.000Z', sub: 'notaire_x', consent_id: 'k', operation: { type: 'open_dossier' } };

  it('POST JSON sur /api/v1/oauth/token, sans en-tête Authorization', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(okBody), { status: 200 }));
    await expect(exchangeCode({ ...args, fetchImpl: fetchImpl as unknown as typeof fetch })).resolves.toEqual(okBody);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test.bnaas.ca/api/v1/oauth/token');
    expect(init.method).toBe('POST');
    expect(Object.keys(init.headers as Record<string, string>).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'C', code_verifier: 'V', client_id: 'cid', redirect_uri: 'https://app.example/callback' });
  });

  it('remonte le statut et le détail en cas d’échec', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ detail: 'code expiré' }), { status: 400 }));
    await expect(exchangeCode({ ...args, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toMatchObject({ code: 'token_exchange_failed', status: 400, description: 'code expiré' });
  });
});
