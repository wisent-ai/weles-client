#!/usr/bin/env node
// Skarbiec credential bridge for self-hosted Weles: maps the
// skarbiec.credential-operation.v3 wire onto the Admission API route
// POST /v1/echo/secrets/acquire, which every admitted service may call.
//
// Environment:
//   WELES_ADMISSION_ORIGIN   absolute http(s) origin of the admission server
//                            (default http://127.0.0.1:8794); https anywhere,
//                            http only on loopback
//   WELES_TOKEN              required bearer presented to admission
//   WISENT_ORGANIZATION_ID   required organization UUID presented to admission
import { createHash } from 'node:crypto';

const ZERO = ''.length;
const ONE = 'x'.length;
const TWO = 'xx'.length;
const TEN = 'xxxxxxxxxx'.length;
const SIXTY_FOUR = Math.pow(TWO, 'xxxxxx'.length);
const ONE_TWENTY_EIGHT = Math.pow(TWO, 'xxxxxxx'.length);
const TWO_HUNDRED = TWO * Math.pow(TEN, TWO);
const TWO_FIFTY_FOUR = TWO_HUNDRED + Math.pow(TWO, 'xxxxxx'.length) - TEN;
const MAX_REQUEST_BYTES = Math.pow(TWO, 'xxxxxxxxxxxxxxxx'.length);
const REQUEST_VERSION = 'skarbiec.credential-operation.v3';
const DEFAULT_ORIGIN = 'http://127.0.0.1:8794';
const ACQUIRE_PATH = '/v1/echo/secrets/acquire';
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

function exactName(value, maximum) {
  return typeof value === 'string'
    && value.length > ZERO
    && value.length <= maximum
    && /^[A-Za-z\d._-]+$/.test(value);
}

async function readRequest() {
  const chunks = [];
  let received = ZERO;
  for await (const chunk of process.stdin) {
    received += chunk.length;
    if (received > MAX_REQUEST_BYTES) throw new Error('credential request exceeded size limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  try {
    const request = JSON.parse(bytes.toString('utf8'));
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('credential request must be an object');
    }

    return request;
  } finally {
    bytes.fill(ZERO);
    for (const chunk of chunks) chunk.fill(ZERO);
  }
}

function validateRequest(request) {
  const allowed = new Set([
    'version', 'request_id', 'mode', 'action_log_id', 'approval_id',
    'resume_token', 'credential_id', 'operation', 'provider', 'consumer',
    'purpose', 'account_email', 'signup_origin', 'directory',
    'baseline_revision', 'field', 'status', 'created_at', 'dry_run',
  ]);
  if (Object.keys(request).some((key) => !allowed.has(key))) {
    throw new Error('credential request contains unknown fields');
  }
  if (request.version !== REQUEST_VERSION) {
    throw new Error(`unsupported credential request version: ${String(request.version)}`);
  }
  if (typeof request.request_id !== 'string'
      || request.request_id.length !== SIXTY_FOUR
      || /[^a-fA-F\d]/.test(request.request_id)) {
    throw new Error('invalid credential request id');
  }
  if (!exactName(request.credential_id, TWO_HUNDRED)) throw new Error('invalid credential item id');
  if (!exactName(request.provider, ONE_TWENTY_EIGHT)) throw new Error('invalid credential provider');
  if (!exactName(request.field, ONE_TWENTY_EIGHT)) throw new Error('invalid credential field');
  if (!exactName(request.consumer, TWO_HUNDRED)) throw new Error('invalid credential consumer');
  if (!['acquire', 'rotate', 'verify', 'remove'].includes(request.operation)) {
    throw new Error(`invalid credential operation: ${String(request.operation)}`);
  }
  if (request.account_email !== null && request.account_email !== undefined
      && (typeof request.account_email !== 'string'
        || request.account_email.length > TWO_FIFTY_FOUR
        || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(request.account_email))) {
    throw new Error('invalid credential account email');
  }
  if (request.status !== 'pending' || (request.dry_run !== true && request.dry_run !== false)) {
    throw new Error('invalid credential request state');
  }
  if (!['submit', 'status'].includes(request.mode)) {
    throw new Error(`invalid credential bridge mode: ${String(request.mode)}`);
  }
}

async function emit(value) {
  const text = `${JSON.stringify(value)}\n`;
  await new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

const request = await readRequest();
validateRequest(request);

if (request.mode === 'status') {
  // Status settles from the vault itself: the worker commits the credential
  // through a managed write and Skarbiec's own lifecycle state advances, so a
  // separate admission poll would read a different authority than the one
  // that authorizes the write. Tell the caller to look there.
  await emit({
    status: 'operation_queued',
    operation: request.operation,
    provider: request.provider,
    vaultItemId: request.credential_id,
    message: 'status settles through the Skarbiec vault lifecycle record',
  });
  process.exit(ZERO);
}

const originEnv = process.env.WELES_ADMISSION_ORIGIN?.trim() || DEFAULT_ORIGIN;
let origin;
try {
  origin = new URL(originEnv);
} catch {
  throw new Error(`WELES_ADMISSION_ORIGIN is not an absolute URL: ${originEnv}`);
}
const loopbackHost = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopbackHost)) {
  throw new Error('WELES_ADMISSION_ORIGIN must use HTTPS, or HTTP on a loopback host');
}
if (origin.username || origin.password || origin.search || origin.hash) {
  throw new Error('WELES_ADMISSION_ORIGIN must not contain credentials, query, or fragment');
}

const bearer = process.env.WELES_TOKEN?.trim();
if (!bearer) throw new Error('WELES_TOKEN is required');
const organizationId = (process.env.WISENT_ORGANIZATION_ID ?? '').trim().toLowerCase();
if (!UUID_PATTERN.test(organizationId)) {
  throw new Error('WISENT_ORGANIZATION_ID must be a UUID');
}
const headers = {
  Authorization: `Bearer ${bearer}`,
  'X-Wisent-Organization-ID': organizationId,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const response = await fetch(new URL(ACQUIRE_PATH, origin), {
  method: 'POST',
  headers,
  body: JSON.stringify({
    version: request.version,
    request_id: request.request_id,
    mode: request.mode,
    action_log_id: request.action_log_id,
    credential_id: request.credential_id,
    operation: request.operation,
    provider: request.provider,
    consumer: request.consumer,
    purpose: request.purpose,
    account_email: request.account_email,
    signup_origin: request.signup_origin,
    directory: request.directory,
    baseline_revision: request.baseline_revision,
    field: request.field,
    dry_run: request.dry_run,
  }),
  signal: AbortSignal.timeout(Number(process.env.WELES_ADMISSION_TIMEOUT_MS || 30000)),
});
const text = await response.text();
let payload = {};
try {
  payload = text ? JSON.parse(text) : {};
} catch {
  throw new Error(`admission returned non-JSON (HTTP ${response.status}): ${text.slice(ZERO, 200)}`);
}
if (!response.ok) {
  await emit({
    status: 'needs_configuration',
    operation: request.operation,
    provider: request.provider,
    vaultItemId: request.credential_id,
    code: payload.code ?? null,
    phase: payload.phase ?? 'admission',
    retryable: false,
    message: `admission rejected the operation (HTTP ${response.status}): ${payload.error ?? text.slice(ZERO, 160)}`,
  });
  process.exit(ZERO);
}

const allowedStatuses = new Set([
  'operation_plan', 'operation_queued', 'operation_completed',
  'needs_configuration', 'needs_human_approval', 'unsupported_operation',
  'unsupported_secret', 'operation_failed',
]);
// Admission wraps every success as { ok: true, data: <result> }; unwrap it
// so the status fields the Skarbiec wire expects sit at the top level.
if (payload && payload.ok === true && payload.data && typeof payload.data === 'object') {
  payload = payload.data;
}
const status = typeof payload.status === 'string' ? payload.status : '';
if (!allowedStatuses.has(status)) {
  throw new Error(`admission returned an unsupported credential-operation status: ${status || '(empty)'}`);
}
await emit({
  status,
  operation: request.operation,
  provider: request.provider,
  vaultItemId: request.credential_id,
  actionLogId: typeof payload.action_log_id === 'string' ? payload.action_log_id
    : typeof payload.actionLogId === 'string' ? payload.actionLogId : null,
  sourceActionLogId: typeof payload.source_action_log_id === 'string' ? payload.source_action_log_id
    : typeof payload.sourceActionLogId === 'string' ? payload.sourceActionLogId : null,
  message: typeof payload.message === 'string' ? payload.message.slice(ZERO, 512) : null,
  receipt: payload.receipt ?? null,
  approval: payload.approval ?? null,
  providerEffect: payload.provider_effect ?? payload.providerEffect ?? null,
  rollbackStatus: payload.rollback_status ?? payload.rollbackStatus ?? null,
  executionHost: payload.execution_host ?? payload.executionHost ?? null,
});
