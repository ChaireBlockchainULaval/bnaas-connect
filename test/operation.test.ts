import { describe, expect, it } from 'vitest';
import { encodeOperation, normalizeOperation, MAX_OPERATION_BYTES, type Operation } from '../src/operation';
import { BnaasConnectError } from '../src/errors';

const SHA = 'a'.repeat(64);
const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

const expectInvalid = (op: unknown, fragment: string) => {
  try {
    encodeOperation(op as Operation);
  } catch (e) {
    expect(e).toBeInstanceOf(BnaasConnectError);
    expect((e as BnaasConnectError).code).toBe('invalid_operation');
    expect((e as BnaasConnectError).description).toContain(fragment);
    return;
  }
  throw new Error('validation attendue en échec');
};

describe('encodeOperation — encodage', () => {
  it('produit du base64url sans remplissage, identique à Buffer base64url (UTF-8, accents)', () => {
    const op: Operation = { type: 'certify_document', document: { name: 'Acte de vente — Lévesque.pdf', sha256: SHA }, dossierId: 'D-123' };
    const enc = encodeOperation(op);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(enc).toBe(Buffer.from(JSON.stringify(normalizeOperation(op)), 'utf8').toString('base64url'));
    expect(decode(enc)).toEqual({ type: 'certify_document', document: { name: 'Acte de vente — Lévesque.pdf', sha256: SHA }, dossierId: 'D-123' });
  });

  it('couvre les longueurs qui donneraient du remplissage en base64 standard', () => {
    for (let n = 1; n <= 6; n++) {
      const enc = encodeOperation({ type: 'close_dossier', dossierId: 'D'.repeat(n) });
      expect(enc).not.toMatch(/[=+/]/);
      expect(decode(enc).dossierId).toBe('D'.repeat(n));
    }
  });

  it('normalise empreinte et preparationId en minuscules, retire les champs absents', () => {
    const enc = encodeOperation({
      type: 'record_event', dossierId: 'D-1', count: 3,
      document: { sha256: 'ABCDEF'.padEnd(64, 'F') },
      preparationId: '3F2504E0-4F89-11D3-9A0C-0305E82C3301',
    });
    expect(decode(enc)).toEqual({
      type: 'record_event', document: { sha256: 'abcdef'.padEnd(64, 'f') }, dossierId: 'D-1', count: 3,
      preparationId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
  });

  it('accepte chaque type du contrat dans sa forme minimale', () => {
    const ok: Operation[] = [
      { type: 'certify_document', document: { sha256: SHA } },
      { type: 'revoke_certification', certId: 'C-1' },
      { type: 'upload_notarial_document', document: { sha256: SHA } },
      { type: 'open_dossier' },
      { type: 'open_dossier', count: 10 },
      { type: 'record_event', dossierId: 'D-1' },
      { type: 'close_dossier', dossierId: 'D-1' },
      { type: 'sign_document', document: { name: 'Contrat.pdf', sha256: SHA } },
    ];
    for (const op of ok) expect(decode(encodeOperation(op)).type).toBe(op.type);
  });
});

describe('encodeOperation — validation', () => {
  it('rejette un type inconnu ou absent', () => {
    expectInvalid({ type: 'delete_everything' }, 'type inconnu');
    expectInvalid({}, 'type inconnu');
    expectInvalid(null, 'objet attendu');
  });

  it('exige une empreinte SHA-256 de 64 hexadécimaux', () => {
    expectInvalid({ type: 'certify_document', document: { sha256: 'a'.repeat(63) } }, 'sha256');
    expectInvalid({ type: 'certify_document', document: { sha256: 'g'.repeat(64) } }, 'sha256');
    expectInvalid({ type: 'certify_document', document: {} }, 'sha256');
  });

  it('applique les champs requis / non attendus par type', () => {
    expectInvalid({ type: 'certify_document' }, 'document requis');
    expectInvalid({ type: 'revoke_certification' }, 'certId requis');
    expectInvalid({ type: 'revoke_certification', certId: 'C', document: { sha256: SHA } }, 'document non attendu');
    expectInvalid({ type: 'record_event' }, 'dossierId requis');
    expectInvalid({ type: 'close_dossier', dossierId: 'D', count: 1 }, 'count non attendu');
    expectInvalid({ type: 'upload_notarial_document', document: { sha256: SHA }, dossierId: 'D' }, 'dossierId non attendu');
    expectInvalid({ type: 'sign_document', document: { sha256: SHA } }, 'name requis');
  });

  it('borne count de 1 à 10, entier', () => {
    expectInvalid({ type: 'record_event', dossierId: 'D', count: 0 }, '1 à 10');
    expectInvalid({ type: 'record_event', dossierId: 'D', count: 11 }, '1 à 10');
    expectInvalid({ type: 'record_event', dossierId: 'D', count: 2.5 }, '1 à 10');
    expectInvalid({ type: 'open_dossier', count: '3' }, '1 à 10');
  });

  it('rejette un preparationId non UUID, un champ inconnu, un nom vide', () => {
    expectInvalid({ type: 'open_dossier', preparationId: 'abc' }, 'UUID');
    expectInvalid({ type: 'open_dossier', dossier: 'D-1' }, 'champ inconnu');
    expectInvalid({ type: 'certify_document', document: { name: '  ', sha256: SHA } }, 'name');
  });

  it(`rejette une opération de plus de ${MAX_OPERATION_BYTES} octets`, () => {
    expectInvalid({ type: 'close_dossier', dossierId: 'x'.repeat(MAX_OPERATION_BYTES) }, 'volumineuse');
  });
});
