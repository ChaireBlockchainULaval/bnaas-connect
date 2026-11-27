import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64url, makePkce, pkceChallenge, randomString } from '../src/encoding';

describe('PKCE (S256)', () => {
  it('code_challenge = BASE64URL(SHA256(verifier)), comparé à node:crypto', async () => {
    for (const v of ['dBjftJeZ4CVP-mJ92K9qnaFpmmHeGMMmKgs-cYyDf1I', 'a'.repeat(43), randomString(128)]) {
      expect(await pkceChallenge(v)).toBe(createHash('sha256').update(v).digest('base64url'));
    }
    expect(await pkceChallenge('dBjftJeZ4CVP-mJ92K9qnaFpmmHeGMMmKgs-cYyDf1I')).toBe('m5afHg1_fxUbD8cduC6DaxqhW73GSJlvywP6iqJPi8o');
  });

  it('génère un verifier conforme (43 à 128 caractères non réservés) et le challenge associé', async () => {
    const { codeVerifier, codeChallenge } = await makePkce();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(codeChallenge).toBe(await pkceChallenge(codeVerifier));
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('ne réutilise pas les valeurs aléatoires', async () => {
    const a = await makePkce();
    const b = await makePkce();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(randomString(32)).toHaveLength(32);
    expect(randomString(32)).not.toBe(randomString(32));
  });

  it('base64url : alphabet URL, sans remplissage', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(base64url(new Uint8Array([]))).toBe('');
  });
});
