/*
 * Paramètre `operation` de /connect/authorize : décrit l'opération notariale à laquelle
 * le notaire consent. JSON encodé en base64url sans remplissage (contrat Gateway V2, §2).
 *
 * La validation locale ne remplace pas celle du Gateway : elle attrape tôt les erreurs
 * évidentes (type inconnu, champ manquant ou non attendu, empreinte mal formée, `count`
 * hors bornes) pour éviter d'ouvrir une popup vouée à l'échec.
 */
import { base64url } from './encoding';
import { BnaasConnectError } from './errors';

export type OperationType =
  | 'certify_document'
  | 'revoke_certification'
  | 'upload_notarial_document'
  | 'open_dossier'
  | 'record_event'
  | 'close_dossier'
  | 'sign_document';

export interface OperationDocument {
  /** Nom affiché au notaire comme « déclaré par l'application » (1 à 200 caractères). */
  name?: string;
  /** Empreinte SHA-256 du document, 64 caractères hexadécimaux. C'est elle qui fait foi. */
  sha256: string;
}

interface OperationBase {
  /**
   * Identifiant (UUID) d'une préparation enregistrée par un collaborateur d'étude via
   * `POST /api/v1/connect/preparations` (côté serveur). L'opération doit être identique
   * à celle de la préparation.
   */
  preparationId?: string;
}

/** Opération notariale à faire consentir. Champs autorisés selon `type` (contrat §2). */
export type Operation =
  | (OperationBase & { type: 'certify_document'; document: OperationDocument; dossierId?: string })
  | (OperationBase & { type: 'revoke_certification'; certId: string })
  | (OperationBase & { type: 'upload_notarial_document'; document: OperationDocument })
  | (OperationBase & { type: 'open_dossier'; document?: OperationDocument; count?: number })
  | (OperationBase & { type: 'record_event'; document?: OperationDocument; dossierId: string; count?: number })
  | (OperationBase & { type: 'close_dossier'; dossierId: string })
  | (OperationBase & { type: 'sign_document'; document: Required<OperationDocument> });

type Rule = 'required' | 'optional' | 'none';
interface TypeRules { document: Rule; documentName?: boolean; dossierId: Rule; certId: Rule; count: boolean }

/** Table du §2 de docs/oauth-connect.md (Gateway). */
export const OPERATION_RULES: Readonly<Record<OperationType, TypeRules>> = Object.freeze({
  certify_document:         { document: 'required', dossierId: 'optional', certId: 'none',     count: false },
  revoke_certification:     { document: 'none',     dossierId: 'none',     certId: 'required', count: false },
  upload_notarial_document: { document: 'required', dossierId: 'none',     certId: 'none',     count: false },
  open_dossier:             { document: 'optional', dossierId: 'none',     certId: 'none',     count: true },
  record_event:             { document: 'optional', dossierId: 'required', certId: 'none',     count: true },
  close_dossier:            { document: 'none',     dossierId: 'required', certId: 'none',     count: false },
  sign_document:            { document: 'required', documentName: true, dossierId: 'none', certId: 'none', count: false },
});

export const MAX_COUNT = 10;
export const MAX_OPERATION_BYTES = 2048;
const MAX_NAME = 200;
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KNOWN_KEYS = new Set(['type', 'document', 'dossierId', 'certId', 'count', 'preparationId']);

const fail = (detail: string): never => { throw new BnaasConnectError('invalid_operation', detail); };
const isPresent = (v: unknown) => v !== undefined && v !== null;

/**
 * Valide l'opération et en renvoie une copie normalisée (empreinte et UUID en minuscules,
 * champs absents retirés). Lève `BnaasConnectError('invalid_operation', détail)`.
 */
export function normalizeOperation(input: Operation): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('operation : objet attendu');
  const op = input as unknown as Record<string, unknown>;

  for (const key of Object.keys(op)) {
    if (!KNOWN_KEYS.has(key) && isPresent(op[key])) fail(`operation.${key} : champ inconnu`);
  }

  const type = op.type as OperationType;
  const rules = typeof type === 'string' && Object.prototype.hasOwnProperty.call(OPERATION_RULES, type)
    ? OPERATION_RULES[type] : null;
  if (!rules) fail(`operation.type inconnu (${Object.keys(OPERATION_RULES).join(', ')})`);
  const r = rules as TypeRules;

  const out: Record<string, unknown> = { type };

  const doc = op.document as Record<string, unknown> | undefined | null;
  if (isPresent(doc)) {
    if (r.document === 'none') fail(`operation.document non attendu pour ${type}`);
    if (typeof doc !== 'object' || Array.isArray(doc)) fail('operation.document : objet attendu');
    const d = doc as Record<string, unknown>;
    const sha = typeof d.sha256 === 'string' ? d.sha256.toLowerCase() : '';
    if (!SHA256_RE.test(sha)) fail('operation.document.sha256 : empreinte SHA-256 (64 caractères hexadécimaux) attendue');
    const document: Record<string, unknown> = {};
    if (isPresent(d.name)) {
      if (typeof d.name !== 'string' || d.name.trim().length === 0 || d.name.trim().length > MAX_NAME) {
        fail(`operation.document.name : 1 à ${MAX_NAME} caractères`);
      }
      document.name = (d.name as string).trim();
    }
    document.sha256 = sha;
    out.document = document;
  } else if (r.document === 'required') {
    fail(`operation.document requis pour ${type}`);
  }
  if (r.documentName && !(out.document as Record<string, unknown> | undefined)?.name) {
    fail(`operation.document.name requis pour ${type}`);
  }

  for (const field of ['dossierId', 'certId'] as const) {
    const v = op[field];
    if (!isPresent(v)) {
      if (r[field] === 'required') fail(`operation.${field} requis pour ${type}`);
      continue;
    }
    if (r[field] === 'none') fail(`operation.${field} non attendu pour ${type}`);
    if (typeof v !== 'string' || v.length === 0) fail(`operation.${field} : chaîne non vide attendue`);
    out[field] = v;
  }

  if (isPresent(op.count)) {
    if (!r.count) fail(`operation.count non attendu pour ${type}`);
    const c = op.count as number;
    if (!Number.isInteger(c) || c < 1 || c > MAX_COUNT) fail(`operation.count : entier de 1 à ${MAX_COUNT}`);
    out.count = c;
  }

  if (isPresent(op.preparationId)) {
    const pid = typeof op.preparationId === 'string' ? op.preparationId.toLowerCase() : '';
    if (!UUID_RE.test(pid)) fail('operation.preparationId : UUID attendu');
    out.preparationId = pid;
  }

  return out;
}

/** Valide puis encode l'opération : base64url (sans remplissage) du JSON en UTF-8. */
export function encodeOperation(op: Operation): string {
  const bytes = new TextEncoder().encode(JSON.stringify(normalizeOperation(op)));
  if (bytes.length > MAX_OPERATION_BYTES) fail(`operation trop volumineuse (> ${MAX_OPERATION_BYTES} octets)`);
  return base64url(bytes);
}
