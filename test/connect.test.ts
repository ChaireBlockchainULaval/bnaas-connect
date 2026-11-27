// connect() / handleRedirectCallback() avec un navigateur simulé (fenêtre, stockages, fetch).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, handleRedirectCallback } from '../src/index';

const SHA = 'b'.repeat(64);
const OK = { token: 'bnaas_nit_x', expires_at: '2026-01-01T00:00:00.000Z', sub: 'notaire_x', consent_id: 'k', operation: { type: 'certify_document' } };
const ORIGIN = 'https://app.example';
const REDIRECT = `${ORIGIN}/callback`;

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

let opened: string[];
let popupClosed: boolean;
let assigned: string[];
let fetchMock: ReturnType<typeof vi.fn>;
let search: string;

beforeEach(() => {
  vi.useFakeTimers();
  opened = []; assigned = []; popupClosed = false; search = '';
  fetchMock = vi.fn(async () => new Response(JSON.stringify(OK), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', new MemStorage());
  vi.stubGlobal('sessionStorage', new MemStorage());
  vi.stubGlobal('window', {
    location: { origin: ORIGIN, get search() { return search; }, assign: (u: string) => { assigned.push(u); } },
    open: (u: string) => { opened.push(u); return { close: () => { popupClosed = true; } }; },
    addEventListener: () => {}, removeEventListener: () => {},
    opener: null, close: () => {},
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const opts = { clientId: 'client-exemple', redirectUri: REDIRECT, operation: { type: 'certify_document' as const, document: { sha256: SHA } } };
const relay = (payload: object) => localStorage.setItem('bnaas_connect_result', JSON.stringify(payload));

describe('connect() en popup', () => {
  it('ouvre l’écran auth.*, vérifie state et échange le code', async () => {
    const p = connect(opts);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    const u = new URL(opened[0]);
    expect(u.origin + u.pathname).toBe('https://auth.test.bnaas.ca/connect/authorize');
    expect(JSON.parse(Buffer.from(u.searchParams.get('operation')!, 'base64url').toString())).toEqual({ type: 'certify_document', document: { sha256: SHA } });

    relay({ code: 'C', state: u.searchParams.get('state') });
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toEqual(OK);
    expect(popupClosed).toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.code).toBe('C');
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it('ignore un retour portant un autre state, puis expire', async () => {
    const p = connect({ ...opts, timeoutMs: 2000 });
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    relay({ code: 'VOLE', state: 'autre-state' });
    await vi.advanceTimersByTimeAsync(2500);
    await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propage access_denied et sa description (ex. invalid_preparation)', async () => {
    const p = connect(opts);
    const assertion = expect(p).rejects.toMatchObject({ code: 'access_denied', description: 'invalid_preparation' });
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    relay({ error: 'access_denied', errorDescription: 'invalid_preparation', state: new URL(opened[0]).searchParams.get('state') });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse une opération invalide sans ouvrir de fenêtre', async () => {
    await expect(connect({ ...opts, operation: { type: 'certify_document', document: { sha256: 'xyz' } } }))
      .rejects.toMatchObject({ code: 'invalid_operation' });
    await expect(connect({ clientId: 'c', redirectUri: REDIRECT } as never)).rejects.toMatchObject({ code: 'invalid_operation' });
    expect(opened).toHaveLength(0);
  });

  it('respecte authUrl, apiUrl et forceReauth', async () => {
    const p = connect({ ...opts, authUrl: 'https://auth.bnaas.ca', apiUrl: 'https://api.example', forceReauth: true });
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    const u = new URL(opened[0]);
    expect(u.origin).toBe('https://auth.bnaas.ca');
    expect(u.searchParams.get('force_reauth')).toBe('1');
    relay({ code: 'C', state: u.searchParams.get('state') });
    await vi.advanceTimersByTimeAsync(500);
    await p;
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.example/api/v1/oauth/token');
  });
});

describe('redirection pleine page', () => {
  it('redirige, puis handleRedirectCallback vérifie state et échange', async () => {
    void connect({ ...opts, preferRedirect: true });
    await vi.waitFor(() => expect(assigned).toHaveLength(1));
    const state = new URL(assigned[0]).searchParams.get('state');
    search = `?code=C&state=${state}`;
    await expect(handleRedirectCallback()).resolves.toEqual(OK);
    expect(sessionStorage.getItem('bnaas_connect_pending')).toBeNull();
  });

  it('rejette un retour dont le state diffère, sans échanger', async () => {
    void connect({ ...opts, preferRedirect: true });
    await vi.waitFor(() => expect(assigned).toHaveLength(1));
    search = '?code=C&state=forge';
    await expect(handleRedirectCallback()).rejects.toMatchObject({ code: 'state_mismatch' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('en popup (aucun flux en attente), relaie le retour et renvoie null', async () => {
    search = '?code=C&state=S';
    await expect(handleRedirectCallback()).resolves.toBeNull();
    expect(JSON.parse(localStorage.getItem('bnaas_connect_result')!)).toMatchObject({ code: 'C', state: 'S' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renvoie null hors retour OAuth', async () => {
    search = '?page=2';
    await expect(handleRedirectCallback()).resolves.toBeNull();
  });
});
