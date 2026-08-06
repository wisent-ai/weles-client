import { createHash, randomUUID, verify as verifySignature } from 'node:crypto';

const SENSITIVE_KEY = /password|secret|token|cookie|authorization|proxy.?auth/i;
// A resume token is the single-use continuation handle Weles issues for its own
// paused approval, not credential material, so it may travel back in task input.
// `redact` still matches it, so it never reaches a log or an error detail.
const RESUMPTION_KEY = /^resume_?token$/i;
const REDACTED = '[REDACTED]';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);

async function boundedResponseText(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new WelesClientError('response-too-large', 'Weles response exceeded the size limit');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new WelesClientError('response-too-large', 'Weles response exceeded the size limit');
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new WelesClientError('response-too-large', 'Weles response exceeded the size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

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

  async get(taskId, options = {}) {
    const id = requireText(taskId, 'taskId');
    const response = await this.request(`tasks/${encodeURIComponent(id)}`, {
      method: 'GET',
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
    let text;
    try {
      text = await boundedResponseText(response);
    } catch (error) {
      if (error instanceof WelesClientError) throw error;
      throw new WelesClientError('transport-failed', 'The Weles response body did not complete', redact(error));
    }
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
    if (SENSITIVE_KEY.test(key) && !RESUMPTION_KEY.test(key)) {
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
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname))) {
    throw new WelesClientError('insecure-endpoint', 'endpoint must use HTTPS or HTTP on a loopback host');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new WelesClientError('invalid-endpoint', 'endpoint must not contain credentials, query, or fragment');
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
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


export const WELES_CLIENT_FIRST_USE_PRODUCT_ID = 'weles-client';
export const WELES_CLIENT_FIRST_USE_JOURNEY_ID = 'first-use';
export const WELES_CLIENT_FIRST_USE_JOURNEY_VERSION = '2026-08-04.1';
export const WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID = '12000000-0000-4000-8000-000000000008';
export const WELES_CLIENT_FIRST_USE_SOURCE_REVISION = 'weles-client-first-use-2026-08-04';
export const WELES_CLIENT_FIRST_SUCCESS_FACT = 'workflow_receipt_verified';

const WELES_CLIENT_FIRST_USE_DEFINITION = {
  analytics_contract: {
    completion_event: 'onboarding_completed',
    contract_version: '1',
    exposure_event: 'onboarding_step_viewed',
    first_success_event: 'onboarding_first_success_observed',
    primary_action_event: 'onboarding_step_completed',
    surface: 'sdk_first_use',
  },
  entry_screen_id: 'receipt-contract',
  experiment_contract: null,
  first_success_fact: WELES_CLIENT_FIRST_SUCCESS_FACT,
  journey_id: WELES_CLIENT_FIRST_USE_JOURNEY_ID,
  journey_version: WELES_CLIENT_FIRST_USE_JOURNEY_VERSION,
  product_id: WELES_CLIENT_FIRST_USE_PRODUCT_ID,
  published_at: '2026-08-04T00:00:00Z',
  schema_version: 1,
  screens: [
    {
      actions: ['continue'],
      body_key: 'weles-client.onboarding.receipt-contract.body',
      completion_evidence: null,
      entry_conditions: null,
      fallback_screen_id: null,
      presentation: {
        body: 'Use caller-owned trusted public keys and the public receipt contract; provisioning and private Weles state remain outside onboarding.',
        renderer: 'explanation',
        title: 'Trust receipts, not private service state',
      },
      required: true,
      screen_id: 'receipt-contract',
      screen_kind: 'explanation',
      title_key: 'weles-client.onboarding.receipt-contract.title',
      transitions: [
        {
          next_screen_id: 'verify-receipt',
          priority: 10,
          reason_code: 'canonical_progression',
        },
      ],
    },
    {
      actions: ['verify_receipt'],
      body_key: 'weles-client.onboarding.verify-receipt.body',
      completion_evidence: {
        fact: WELES_CLIENT_FIRST_SUCCESS_FACT,
        kind: 'fact',
        operator: 'eq',
        value: true,
      },
      entry_conditions: null,
      fallback_screen_id: null,
      presentation: {
        body: 'Call verifyReceipt with a real signed Weles receipt and trusted keys. Completion requires valid cryptography and claim-matching returned claims.',
        renderer: 'machine_result',
        title: 'Verify one real workflow receipt',
      },
      required: true,
      screen_id: 'verify-receipt',
      screen_kind: 'machine_result',
      title_key: 'weles-client.onboarding.verify-receipt.title',
      transitions: [],
    },
  ],
  source_revision: WELES_CLIENT_FIRST_USE_SOURCE_REVISION,
};

function canonicalizeOnboardingValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeOnboardingValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeOnboardingValue(entry)]));
  }
  return value;
}

const WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION = JSON.stringify(
  canonicalizeOnboardingValue(WELES_CLIENT_FIRST_USE_DEFINITION),
);

export const WELES_CLIENT_FIRST_USE_FALLBACK = Object.freeze({
  journey_version_id: WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID,
  definition: WELES_CLIENT_FIRST_USE_DEFINITION,
  canonical_definition: WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION,
  content_sha256: createHash('sha256').update(WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION).digest('hex'),
  source_revision: WELES_CLIENT_FIRST_USE_SOURCE_REVISION,
});

function assertFirstUseIdentity(productId, journeyId) {
  if (productId !== WELES_CLIENT_FIRST_USE_PRODUCT_ID || journeyId !== WELES_CLIENT_FIRST_USE_JOURNEY_ID) {
    throw new WelesClientError('onboarding-identity-mismatch', 'The onboarding request does not belong to Weles Client first use');
  }
}

function assertCanonicalFirstUseBundle(bundle) {
  requireObject(bundle, 'onboarding bundle');
  if (bundle.journey_version_id !== WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID
    || bundle.source_revision !== WELES_CLIENT_FIRST_USE_SOURCE_REVISION
    || bundle.canonical_definition !== WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION
    || bundle.content_sha256 !== WELES_CLIENT_FIRST_USE_FALLBACK.content_sha256) {
    throw new WelesClientError('onboarding-bundle-mismatch', 'The Weles Client onboarding bundle is not the pinned canonical journey');
  }
  return bundle;
}

class VersionPinnedWelesClientOnboardingTransport {
  constructor(transport) {
    requireObject(transport, 'transport');
    for (const operation of ['readBundle', 'readState', 'collectEvent', 'assignExperiment']) {
      if (typeof transport[operation] !== 'function') {
        throw new WelesClientError('invalid-onboarding-transport', `transport.${operation} must be a function`);
      }
    }
    this.transport = transport;
  }

  async readBundle(productId, journeyId) {
    assertFirstUseIdentity(productId, journeyId);
    return assertCanonicalFirstUseBundle(await this.transport.readBundle(
      productId,
      journeyId,
      WELES_CLIENT_FIRST_USE_JOURNEY_VERSION,
    ));
  }

  readState(productId, attemptId, subjectHash) {
    assertFirstUseIdentity(productId, WELES_CLIENT_FIRST_USE_JOURNEY_ID);
    return this.transport.readState(productId, attemptId, subjectHash);
  }

  collectEvent(event) {
    requireObject(event, 'onboarding event');
    assertFirstUseIdentity(event.product_id, WELES_CLIENT_FIRST_USE_JOURNEY_ID);
    return this.transport.collectEvent(event);
  }

  assignExperiment(input) {
    requireObject(input, 'experiment assignment');
    assertFirstUseIdentity(input.product_id, WELES_CLIENT_FIRST_USE_JOURNEY_ID);
    return this.transport.assignExperiment(input);
  }
}

export function createWelesClientOnboarding(options) {
  requireObject(options, 'options');
  if (typeof options.JourneyClient !== 'function') {
    throw new WelesClientError('invalid-onboarding-runtime', 'The shared Echo JourneyClient constructor is required');
  }
  const subject = requireText(options.subject, 'subject');
  const audience = requireText(options.audience, 'audience');
  const client = new options.JourneyClient({
    productId: WELES_CLIENT_FIRST_USE_PRODUCT_ID,
    journeyId: WELES_CLIENT_FIRST_USE_JOURNEY_ID,
    subjectHash: requireText(options.subjectHash, 'subjectHash'),
    scopeKind: options.scopeKind ?? 'workload',
    transport: new VersionPinnedWelesClientOnboardingTransport(options.transport),
    storage: options.storage,
    canonicalFallback: WELES_CLIENT_FIRST_USE_FALLBACK,
  });
  return Object.freeze({
    client,
    subject,
    audience,
    start: evidenceRevision => client.start(evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    expose: evidenceRevision => client.expose(evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    advance: evidenceRevision => client.advance({}, evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    skip: evidenceRevision => client.skip(evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    reset: evidenceRevision => client.reset(evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    flush: () => client.flush(),
    verifyFirstReceipt: (receipt, keys) => verifyFirstReceipt({
      client,
      receipt,
      keys,
      subject,
      audience,
    }),
  });
}

function requiredReceiptClaim(claims, field) {
  const value = claims[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new WelesClientError('invalid-receipt-payload', `The signed receipt ${field} claim is required`, { field });
  }
  return value;
}

export async function verifyFirstReceipt(options) {
  requireObject(options, 'options');
  if (!options.client || typeof options.client.complete !== 'function') {
    throw new WelesClientError('invalid-onboarding-runtime', 'A started shared Echo JourneyClient is required');
  }
  const subject = requireText(options.subject, 'subject');
  const audience = requireText(options.audience, 'audience');
  const claims = verifyReceipt(options.receipt, options.keys);
  const receiptSubject = requiredReceiptClaim(claims, 'subject');
  const receiptAudience = requiredReceiptClaim(claims, 'audience');
  const receiptProduct = requiredReceiptClaim(claims, 'product');
  if (receiptSubject !== subject) {
    throw new WelesClientError('receipt-subject-mismatch', 'The signed receipt subject does not match the onboarding subject');
  }
  if (receiptAudience !== audience) {
    throw new WelesClientError('receipt-audience-mismatch', 'The signed receipt audience does not match the SDK audience');
  }
  if (receiptProduct !== WELES_CLIENT_FIRST_USE_PRODUCT_ID) {
    throw new WelesClientError('receipt-product-mismatch', 'The signed receipt product is not Weles Client');
  }
  const evidenceDigest = requiredReceiptClaim(claims, 'evidenceDigest');
  const taskId = requiredReceiptClaim(claims, 'taskId');
  const outcome = requiredReceiptClaim(claims, 'outcome');
  const completed = await options.client.complete(
    { [WELES_CLIENT_FIRST_SUCCESS_FACT]: true },
    `receipt:${createHash('sha256').update(evidenceDigest).digest('hex')}`,
    {
      first_success_fact: WELES_CLIENT_FIRST_SUCCESS_FACT,
      task_id: taskId,
      outcome,
      evidence_digest: evidenceDigest,
      receipt_key_id: requiredReceiptClaim(claims, 'keyId'),
      receipt_audience: receiptAudience,
      receipt_product: receiptProduct,
    },
  );
  if (completed !== true) {
    throw new WelesClientError('onboarding-not-completed', 'The verified receipt did not satisfy the canonical first-success step');
  }
  return Object.freeze({
    fact: WELES_CLIENT_FIRST_SUCCESS_FACT,
    evidence: Object.freeze({ [WELES_CLIENT_FIRST_SUCCESS_FACT]: true }),
    claims,
  });
}