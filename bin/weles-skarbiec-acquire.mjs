#!/usr/bin/env node
import { WelesClient } from '../src/index.mjs';

const ZERO = ''.length;
const ONE = 'x'.length;
const TWO = 'xx'.length;
const TEN = 'xxxxxxxxxx'.length;
const SIXTY_FOUR = Math.pow(TWO, 'xxxxxx'.length);
const ONE_TWENTY_EIGHT = Math.pow(TWO, 'xxxxxxx'.length);
const TWO_HUNDRED = TWO * Math.pow(TEN, TWO);
const TWO_FIFTY_FOUR = TWO_HUNDRED + Math.pow(TWO, 'xxxxxx'.length) - TEN;
const FIVE_TWELVE = Math.pow(TWO, 'xxxxxxxxx'.length);
const MAX_REQUEST_BYTES = Math.pow(TWO, 'xxxxxxxxxxxxxxxx'.length);
const HTTP_TIMEOUT_MS = Number('30000');
const ACTION = 'skarbiec_credential_acquire';
const ACQUIRE_ONLY = Object.freeze(['acquire']);
const MICROSOFT_OPERATIONS = Object.freeze(['rotate', 'verify']);
const CONTRACTS = Object.freeze({
  'weles-semantic-scholar-api': Object.freeze({ provider: 'semantic_scholar', secret: 'semantic_scholar.api_key', origin: 'https://www.semanticscholar.org', field: 'api_key', consumer: 'weles-semantic-scholar-api-writer', operations: ACQUIRE_ONLY }),
  'weles-github-admin-org-token': Object.freeze({ provider: 'github', secret: 'github.admin_org_token', origin: 'https://github.com', field: 'api_key', consumer: 'weles-github-admin-org-token-writer', operations: ACQUIRE_ONLY }),
  'weles-supabase-personal-access-token': Object.freeze({ provider: 'supabase', secret: 'supabase.personal_access_token', origin: 'https://supabase.com', field: 'api_key', consumer: 'weles-supabase-personal-access-token-writer', operations: ACQUIRE_ONLY }),
  'weles-snapchat-snap-kit-api': Object.freeze({ provider: 'snapchat', secret: 'snapchat.snap_kit_api_token', origin: 'https://kit.snapchat.com', field: 'api_key', consumer: 'weles-snapchat-snap-kit-api-writer', operations: ACQUIRE_ONLY }),
});
const MICROSOFT_CREDENTIAL_ID = /^weles-microsoft-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?-password$/;

function contractFor(request) {
  const exact = CONTRACTS[request.credential_id];
  if (exact) return exact;
  if (MICROSOFT_CREDENTIAL_ID.test(request.credential_id)) {
    return Object.freeze({
      provider: 'microsoft',
      secret: request.credential_id,
      origin: 'https://account.live.com',
      field: 'password',
      consumer: `${request.credential_id}-writer`,
      operations: MICROSOFT_OPERATIONS,
    });
  }
  return null;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim() ?? '';
  if (!value) throw new Error(`${name} is required`);
  return value;
}

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
    'version',
    'request_id',
    'mode',
    'action_log_id',
    'credential_id',
    'operation',
    'provider',
    'consumer',
    'purpose',
    'account_email',
    'baseline_revision',
    'field',
    'status',
    'created_at',
    'dry_run',
  ]);
  if (Object.keys(request).some((key) => !allowed.has(key))) {
    throw new Error('credential request contains unknown fields');
  }
  if (request.version !== 'skarbiec.credential-operation.v1') {
    throw new Error('unsupported credential request version');
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
    throw new Error('invalid credential operation');
  }
  if (request.account_email !== null
      && (typeof request.account_email !== 'string'
        || request.account_email.length > TWO_FIFTY_FOUR
        || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(request.account_email))) {
    throw new Error('invalid credential account email');
  }
  if (!Number.isSafeInteger(request.baseline_revision) || request.baseline_revision < ZERO) {
    throw new Error('invalid credential baseline revision');
  }
  if (typeof request.purpose !== 'string'
      || request.purpose.length === ZERO
      || Buffer.byteLength(request.purpose, 'utf8') > TWO_HUNDRED
      || Array.from(request.purpose).some((character) => /\p{Cc}/u.test(character))) {
    throw new Error('invalid credential purpose');
  }
  if (request.status !== 'pending' || (request.dry_run !== true && request.dry_run !== false)) {
    throw new Error('invalid credential request state');
  }
  if (!['submit', 'status'].includes(request.mode)) {
    throw new Error('invalid credential bridge mode');
  }
  if (request.mode === 'submit' && request.action_log_id !== null) {
    throw new Error('submit mode must not carry an action log id');
  }
  if (request.mode === 'status' && !exactName(request.action_log_id, TWO_HUNDRED)) {
    throw new Error('status mode requires an exact action log id');
  }
}

async function emit(value) {
  const text = `${JSON.stringify(value)}\n`;
  await new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

function unsupported(request, status, message) {
  return {
    status,
    operation: request.operation,
    provider: request.provider,
    vaultItemId: request.credential_id,
    message,
  };
}

function credentialResult(value, request) {
  const result = value?.credential ?? value;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Weles response is missing the credential-operation result');
  }
  const secretMatches = result.secret === undefined || result.secret === contractFor(request)?.secret;
  const itemMatches = result.vaultItemId === request.credential_id
    || (result.vaultItemId === undefined && result.secret === contractFor(request)?.secret);
  if (result.provider !== request.provider
      || !secretMatches
      || !itemMatches
      || (request.provider === 'microsoft'
        ? result.operation !== request.operation
        : result.operation !== undefined && result.operation !== request.operation)) {
    throw new Error('Weles credential-operation response identity mismatch');
  }
  return result;
}

function expectedTaskActions(request) {
  if (request.provider === 'microsoft') {
    return request.operation === 'verify'
      ? ['microsoft_verify_password']
      : ['microsoft_reset_password'];
  }
  if (request.credential_id === 'weles-semantic-scholar-api') {
    return ['generic_keeper_task', 'semanticscholar_key_followup'];
  }
  return ['generic_keeper_task'];
}

function taskRecord(value, request) {
  const task = value?.task ?? value?.job ?? value;
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error('Weles task status response is invalid');
  }
  const taskId = task.id ?? task.taskId;
  if (taskId !== request.action_log_id
      || !expectedTaskActions(request).includes(task.action)) {
    throw new Error('Weles task status response identity mismatch');
  }
  if (task.action !== 'semanticscholar_key_followup') {
    const constraints = task.params?.constraints;
    if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)
        || constraints.request_id !== request.request_id
        || constraints.vault_item_id !== request.credential_id
        || constraints.vault_field !== request.field
        || constraints.provider !== request.provider
        || (request.provider === 'microsoft'
          && constraints.account_email !== request.account_email)
        || constraints.operation !== request.operation) {
      throw new Error('Weles task status response provenance mismatch');
    }
  }
  return task;
}

function normalizedTaskStatus(status) {
  if (['accepted', 'queued', 'pending', 'running'].includes(status)) return 'operation_queued';
  if (status === 'pending_review') return 'needs_human_approval';
  if (status === 'completed') return 'operation_completed';
  if (status === 'failed' || status === 'cancelled' || status === 'rejected' || status === 'timed_out') return 'operation_failed';
  throw new Error('Weles returned an unsupported task status');
}

function semanticScholarTransition(task, request) {
  if (request.credential_id !== 'weles-semantic-scholar-api'
      || task.status !== 'completed') return null;
  const details = task.action === 'generic_keeper_task'
    ? task.result?.semantic_scholar_followup
    : task.result?.service_action?.semantic_scholar_key_followup;
  const nextActionLogId = task.action === 'generic_keeper_task'
    ? details?.action_log_id
    : details?.next_action_log_id;
  if (exactName(nextActionLogId, TWO_HUNDRED)) {
    return {
      status: 'operation_queued',
      actionLogId: nextActionLogId,
      sourceActionLogId: request.action_log_id,
    };
  }
  if (task.action === 'semanticscholar_key_followup' && details?.status === 'validated') {
    return { status: 'operation_completed', actionLogId: request.action_log_id };
  }
  return { status: 'operation_failed', actionLogId: request.action_log_id };
}

function approvedTransition(task, request) {
  if (task.status !== 'approved') return null;
  const nextActionLogId = task.result?.approved_job_id;
  return exactName(nextActionLogId, TWO_HUNDRED)
    ? {
        status: 'operation_queued',
        actionLogId: nextActionLogId,
        sourceActionLogId: request.action_log_id,
      }
    : null;
}

const request = await readRequest();
validateRequest(request);
const contract = contractFor(request);
if (!contract
    || contract.provider !== request.provider
    || contract.field !== request.field
    || contract.consumer !== request.consumer) {
  await emit(unsupported(
    request,
    'needs_configuration',
    `No exact Weles credential contract for ${request.credential_id}/${request.provider}/${request.consumer}`,
  ));
  process.exit(ZERO);
}
if (!contract.operations.includes(request.operation)) {
  await emit(unsupported(
    request,
    'unsupported_operation',
    `${request.operation} is not allowed for ${request.credential_id}/${request.provider}`,
  ));
  process.exit(ZERO);
}
if (request.provider === 'microsoft' && !request.account_email) {
  await emit(unsupported(
    request,
    'needs_configuration',
    'Microsoft credential operations require --account <email>',
  ));
  process.exit(ZERO);
}

const client = new WelesClient({
  endpoint: requiredEnvironment('WELES_URL'),
  bearer: requiredEnvironment('WELES_TOKEN'),
  organizationId: requiredEnvironment('WISENT_ORGANIZATION_ID'),
  allowedOrigins: [contract.origin],
  allowedActions: [ACTION],
});
if (request.mode === 'status') {
  const task = taskRecord(await client.get(request.action_log_id, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  }), request);
  const transition = semanticScholarTransition(task, request) ?? approvedTransition(task, request);
  const output = {
    status: transition?.status ?? normalizedTaskStatus(task.status),
    operation: request.operation,
    provider: request.provider,
    actionLogId: transition?.actionLogId ?? request.action_log_id,
    sourceActionLogId: transition?.sourceActionLogId,
    vaultItemId: request.credential_id,
    message: `Weles credential operation is ${transition?.status ?? task.status}`,
  };
  await emit(output);
  process.exit(ZERO);
}

const response = await client.submit({
  origin: contract.origin,
  action: ACTION,
  input: {
    version: request.version,
    requestId: request.request_id,
    operation: request.operation,
    credentialId: request.credential_id,
    provider: request.provider,
    field: request.field,
    consumer: request.consumer,
    purpose: request.purpose,
    accountEmail: request.account_email,
    baselineRevision: request.baseline_revision,
    dryRun: request.dry_run,
  },
  evidencePolicy: 'action-log',
  justification: request.purpose,
}, {
  idempotencyKey: request.request_id,
  signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
});

const operationResult = credentialResult(response, request);
const allowedStatuses = new Set([
  'operation_plan',
  'operation_queued',
  'needs_configuration',
  'needs_human_approval',
  'unsupported_operation',
  'unsupported_secret',
]);
if (!allowedStatuses.has(operationResult.status)) {
  throw new Error('Weles returned an unsupported credential-operation status');
}
if (request.dry_run !== (operationResult.status === 'operation_plan')) {
  throw new Error('Weles credential-operation response does not match dry-run mode');
}
const actionLogId = operationResult.actionLogId;
if (operationResult.status === 'operation_queued' && !exactName(actionLogId, TWO_HUNDRED)) {
  throw new Error('queued Weles credential operation is missing its action log id');
}
const output = {
  status: operationResult.status,
  operation: request.operation,
  provider: request.provider,
  actionLogId,
  vaultItemId: request.credential_id,
  message: typeof operationResult.message === 'string'
    && operationResult.message.length <= FIVE_TWELVE
    && !Array.from(operationResult.message).some((character) => /\p{Cc}/u.test(character))
    ? operationResult.message
    : undefined,
};
await emit(output);
