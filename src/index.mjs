import { randomUUID, verify as verifySignature } from 'node:crypto';

const SENSITIVE_KEY = /password|secret|token|cookie|authorization|proxy.?auth/i;
const REDACTED = '[REDACTED]';
const SUPPORTED_RECEIPT_SCHEMAS = Object.freeze({
  'weles.receipt.v1': true,
  'weles.receipt.current': true,
});

export const WelesSchemas = Object.freeze({
  task: 'weles.task.v1',
  cancellation: 'weles.cancellation.v1',
  taskStatus: 'weles.task-status.v1',
  receipt: 'weles.receipt.v1',
  version: 'weles.version.v1',
});

export class WelesClientError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'WelesClientError';
    this.code = code;
    this.details = details;
  }
}

export class WelesClient {
  constructor(options) {
    requireObject(options, 'options');
    this.endpoint = secureBaseUrl(options.endpoint);
    this.bearer = requireText(options.bearer, 'bearer');
    this.organizationId = requireText(options.organizationId, 'organizationId');
    this.allowedOrigins = new Set(requireTextArray(options.allowedOrigins, 'allowedOrigins').map(normalizeOrigin));
    this.allowedActions = new Set(requireTextArray(options.allowedActions, 'allowedActions'));
    this.receiptKeys = new Map(Object.entries(options.receiptKeys ?? {}));
    this.fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.fetch !== 'function') {
      throw new WelesClientError('invalid-client', 'A Fetch-compatible implementation is required');
    }
  }

  async submit(request, options = {}) {
    requireObject(request, 'request');
    const origin = normalizeOrigin(request.origin);
    const action = requireText(request.action, 'action');
    if (!this.allowedOrigins.has(origin)) {
      throw new WelesClientError('origin-denied', 'The workflow origin is not in the client allowlist', { origin });
    }
    if (!this.allowedActions.has(action)) {
      throw new WelesClientError('action-denied', 'The workflow action is not in the client allowlist', { action });
    }
    assertNoSensitiveFields(request.input ?? {}, 'input');
    const idempotencyKey = requireText(options.idempotencyKey ?? randomUUID(), 'idempotencyKey');
    const body = {
      schema: WelesSchemas.task,
      organizationId: this.organizationId,
      origin,
      action,
      input: request.input ?? {},
      credentialRefs: requireOptionalTextArray(request.credentialRefs, 'credentialRefs'),
      evidencePolicy: request.evidencePolicy ?? 'receipt',
      justification: requireText(request.justification, 'justification'),
    };
    const response = await this.request('tasks', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
      signal: options.signal,
    });
    if (response.receipt) {
      verifyReceipt(response.receipt, this.receiptKeys);
    }
    return response;
  }

  async cancel(taskId, options = {}) {
    const id = requireText(taskId, 'taskId');
    const idempotencyKey = requireText(options.idempotencyKey ?? randomUUID(), 'idempotencyKey');
    const response = await this.request(`tasks/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        schema: WelesSchemas.cancellation,
        organizationId: this.organizationId,
        reason: requireText(options.reason, 'reason'),
      },
      signal: options.signal,
    });
    if (response.receipt) {
      verifyReceipt(response.receipt, this.receiptKeys);
    }
    return response;
  }

  async get(taskId, options = {}) {
    const id = requireText(taskId, 'taskId');
    const response = await this.request(`tasks/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal: options.signal,
    });
    if (response.schema !== WelesSchemas.taskStatus) {
      throw new WelesClientError('unsupported-task-status', 'The task status schema is not supported', {
        schema: response.schema,
      });
    }
    if (response.receipt) verifyReceipt(response.receipt, this.receiptKeys);
    return response;
  }
  async version(options = {}) {
    const response = await this.request('version', {
      method: 'GET',
      signal: options.signal,
    });
    if (response.schema !== WelesSchemas.version) {
      throw new WelesClientError('unsupported-service-version', 'The service version schema is not supported', {
        schema: response.schema,
      });
    }
    return response;
  }


  async request(path, options) {
    let response;
    try {
      response = await this.fetch(new URL(path, this.endpoint), {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.bearer}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          Accept: 'application/json',
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: options.signal,
      });
    } catch (error) {
      throw new WelesClientError('transport-failed', 'The Weles request did not complete', redact(error));
    }
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new WelesClientError('invalid-response', 'Weles returned a non-JSON response', { status: response.status });
    }
    if (!response.ok) {
      throw new WelesClientError('request-rejected', 'Weles rejected the request', {
        status: response.status,
        response: redact(payload),
      });
    }
    requireObject(payload, 'response');
    return payload;
  }
}

export function verifyReceipt(receipt, keys) {
  requireObject(receipt, 'receipt');
  const schema = requireText(receipt.schema, 'receipt.schema');
  if (!SUPPORTED_RECEIPT_SCHEMAS[schema]) {
    throw new WelesClientError('unsupported-receipt', 'The receipt schema is not supported', { schema });
  }
  const keyId = requireText(receipt.keyId, 'receipt.keyId');
  const signature = requireText(receipt.signature, 'receipt.signature');
  const signedPayload = requireText(receipt.signedPayload, 'receipt.signedPayload');
  const keyMap = keys instanceof Map ? keys : new Map(Object.entries(keys ?? {}));
  const publicKey = keyMap.get(keyId);
  if (!publicKey) {
    throw new WelesClientError('unknown-receipt-key', 'No trusted public key matches the receipt key identifier', { keyId });
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length % 4 !== 0) {
    throw new WelesClientError('invalid-receipt-signature', 'The receipt signature is not canonical base64', { keyId });
  }
  let valid;
  try {
    valid = verifySignature(null, Buffer.from(signedPayload), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    throw new WelesClientError('invalid-receipt-key', 'The trusted receipt key is not a usable Ed25519 public key', { keyId });
  }
  if (!valid) {
    throw new WelesClientError('invalid-receipt-signature', 'The receipt signature is invalid', { keyId });
  }
  let claims;
  try {
    claims = JSON.parse(signedPayload);
  } catch {
    throw new WelesClientError('invalid-receipt-payload', 'The signed receipt payload is not JSON');
  }
  requireObject(claims, 'receipt claims');
  for (const field of ['schema', 'taskId', 'organizationId', 'origin', 'action', 'outcome', 'evidenceDigest', 'keyId']) {
    requireText(claims[field], `receipt claims.${field}`);
  }
  if (!SUPPORTED_RECEIPT_SCHEMAS[claims.schema] || !['succeeded', 'failed', 'cancelled'].includes(claims.outcome)
      || typeof claims.evidenceDigest !== 'string' || !/^[0-9a-f]{64}$/.test(claims.evidenceDigest)) {
    throw new WelesClientError('invalid-receipt-payload', 'The signed receipt claims violate the receipt contract');
  }
  for (const field of ['schema', 'taskId', 'organizationId', 'origin', 'action', 'outcome', 'evidenceDigest', 'keyId']) {
    if (receipt[field] !== claims[field]) {
      throw new WelesClientError('receipt-claim-mismatch', 'A displayed receipt field differs from the signed claim', { field });
    }
  }
  return Object.freeze({ ...claims, keyId });
}

export function redact(value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item)]));
  }
  return value;
}

export function assertNoSensitiveFields(value, path = 'value') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new WelesClientError('plaintext-secret-denied', 'Send a credential reference instead of sensitive plaintext', { path: `${path}.${key}` });
    }
    assertNoSensitiveFields(item, `${path}.${key}`);
  }
}

function secureBaseUrl(value) {
  let url;
  try {
    url = new URL(requireText(value, 'endpoint'));
  } catch {
    throw new WelesClientError('invalid-endpoint', 'endpoint must be an absolute URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new WelesClientError('insecure-endpoint', 'endpoint must use HTTPS or HTTP on localhost');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return new URL('/api/v1/', url);
}

function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(requireText(value, 'origin'));
  } catch {
    throw new WelesClientError('invalid-origin', 'origin must be an absolute URL origin');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new WelesClientError('insecure-origin', 'origin must use HTTPS or HTTP on localhost');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new WelesClientError('invalid-origin', 'origin must not contain a path, credentials, query, or fragment');
  }
  return url.origin;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WelesClientError('invalid-input', `${name} must be an object`);
  }
  return value;
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WelesClientError('invalid-input', `${name} must be a non-empty string`);
  }
  return value;
}

function requireTextArray(value, name) {
  if (!Array.isArray(value) || !value.length) {
    throw new WelesClientError('invalid-input', `${name} must be a non-empty string array`);
  }
  return value.map(item => requireText(item, name));
}

function requireOptionalTextArray(value, name) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new WelesClientError('invalid-input', `${name} must be a string array`);
  }
  return value.map(item => requireText(item, name));
}
