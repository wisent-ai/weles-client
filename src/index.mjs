import { randomUUID, verify as verifySignature } from 'node:crypto';

const SENSITIVE_KEY = /password|secret|token|cookie|authorization|proxy.?auth/i;
const REDACTED = '[REDACTED]';

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
      schema: 'weles.task.current',
      organizationId: this.organizationId,
      origin,
      action,
      input: request.input ?? {},
      credentialRefs: requireOptionalTextArray(request.credentialRefs, 'credentialRefs'),
      evidencePolicy: request.evidencePolicy ?? 'receipt',
      justification: requireText(request.justification, 'justification'),
    };
    const response = await this.request('/tasks', {
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
    const response = await this.request(`/tasks/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        schema: 'weles.cancellation.current',
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

  async request(path, options) {
    let response;
    try {
      response = await this.fetch(new URL(path, this.endpoint), {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.bearer}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...options.headers,
        },
        body: JSON.stringify(options.body),
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
  if (schema !== 'weles.receipt.current') {
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
  const valid = verifySignature(null, Buffer.from(signedPayload), publicKey, Buffer.from(signature, 'base64'));
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
  for (const field of ['taskId', 'organizationId', 'origin', 'action', 'outcome', 'evidenceDigest']) {
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
  return url;
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
