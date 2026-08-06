#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const REQUEST_VERSION = 'skarbiec.credential-operation.v3';
const STADO_FORWARD_SERVICE = 'weles-admission';
const GROUP_WORLD_WRITE = Number('0o22');
const ACQUIRE_ONLY = Object.freeze(['acquire']);
const MICROSOFT_OPERATIONS = Object.freeze(['rotate', 'verify']);
const ENTRA_OPERATIONS = Object.freeze(['adopt', 'rotate', 'reset', 'verify']);
const ENTRA_ORIGIN = 'https://login.microsoftonline.com';
const ENTRA_TENANT_ID = '23572277-0021-42ac-b2b9-10bd86c7d2af';
const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DIAGNOSTIC_CODE = /^[A-Z][A-Z\d_]{0,63}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const EVIDENCE_DIGEST = /^[a-fA-F\d]{64}$/;
const DIAGNOSTIC_PHASES = Object.freeze([
  'admission',
  'placement',
  'credential_read',
  'entra_sign_in',
  'identity_verification',
  'password_change',
  'fresh_login_verification',
  'skarbiec_stage',
  'skarbiec_commit',
  'rollback',
]);
const ROLLBACK_STATUSES = Object.freeze(['none', 'completed', 'failed', 'unknown']);
const PROVIDER_EFFECTS = Object.freeze(['none', 'changed', 'unknown']);
const TERMINAL_FAILURE_STATUSES = Object.freeze(['operation_failed']);
const OPERATIONS = Object.freeze(['acquire', 'adopt', 'rotate', 'reset', 'verify', 'remove']);
const BRIDGE_MODES = Object.freeze(['submit', 'status', 'resume']);
const DIRECTORY_KEYS = Object.freeze(['provider', 'tenant_id', 'principal_object_id', 'account_upn']);
const ENTRA_TASK_ACTIONS = Object.freeze({
  adopt: Object.freeze(['microsoft_entra_adopt_password']),
  verify: Object.freeze(['microsoft_entra_verify_password']),
  rotate: Object.freeze(['microsoft_entra_reset_password']),
  reset: Object.freeze(['microsoft_entra_reset_password']),
});
const NO_TASK_ACTIONS = Object.freeze([]);
const CONTRACTS = Object.freeze({
  'weles-semantic-scholar-api': Object.freeze({ provider: 'semantic_scholar', secret: 'semantic_scholar.api_key', origin: 'https://www.semanticscholar.org', field: 'api_key', consumer: 'weles-semantic-scholar-api-writer', operations: ACQUIRE_ONLY }),
  'weles-github-admin-org-token': Object.freeze({ provider: 'github', secret: 'github.admin_org_token', origin: 'https://github.com', field: 'api_key', consumer: 'weles-github-admin-org-token-writer', operations: ACQUIRE_ONLY }),
  'weles-supabase-personal-access-token': Object.freeze({ provider: 'supabase', secret: 'supabase.personal_access_token', origin: 'https://supabase.com', field: 'api_key', consumer: 'weles-supabase-personal-access-token-writer', operations: ACQUIRE_ONLY }),
  'weles-snapchat-snap-kit-api': Object.freeze({ provider: 'snapchat', secret: 'snapchat.snap_kit_api_token', origin: 'https://kit.snapchat.com', field: 'api_key', consumer: 'weles-snapchat-snap-kit-api-writer', operations: ACQUIRE_ONLY }),
  'weles-microsoft-jakub-wisent-ai-password': Object.freeze({ provider: 'microsoft_entra', secret: 'weles-microsoft-jakub-wisent-ai-password', origin: ENTRA_ORIGIN, field: 'password', consumer: 'weles-microsoft-jakub-wisent-ai-password-writer', operations: ENTRA_OPERATIONS, accountUpn: 'jakub@wisent.ai', tenantId: ENTRA_TENANT_ID, principalObjectId: '4c888895-03cf-4ab1-a11e-46942c568217' }),
  'weles-microsoft-lukasz-wisent-com-password': Object.freeze({ provider: 'microsoft_entra', secret: 'weles-microsoft-lukasz-wisent-com-password', origin: ENTRA_ORIGIN, field: 'password', consumer: 'weles-microsoft-lukasz-wisent-com-password-writer', operations: ENTRA_OPERATIONS, accountUpn: 'lukasz@wisent.com', tenantId: ENTRA_TENANT_ID, principalObjectId: '1f636f97-b07f-4e9b-952a-5d069ccc5b20' }),
});
const MICROSOFT_CREDENTIAL_ID = /^weles-microsoft-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?-password$/;

function contractFor(request) {
  const exact = CONTRACTS[request.credential_id];
  if (exact) return exact;
  if (request.provider === 'microsoft' && MICROSOFT_CREDENTIAL_ID.test(request.credential_id)) {
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

function stadoForwardsDirectory() {
  const configured = process.env.STADO_FORWARDS_DIR?.trim() ?? '';
  if (configured) return configured;
  const home = process.env.HOME?.trim() ?? '';
  if (!home) throw new Error('HOME is required to locate the Stado forwards directory');
  return join(home, '.stado', 'forwards');
}

function forwardUrlText(path) {
  if (typeof process.getuid !== 'function') {
    throw new Error('a POSIX user id is required to validate the Stado forward');
  }
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${path} does not exist`);
  }
  if (!stats.isFile()) throw new Error(`${path} is not a regular file`);
  if (stats.uid !== process.getuid()) throw new Error(`${path} is not owned by this user`);
  if ((stats.mode & GROUP_WORLD_WRITE) !== ZERO) {
    throw new Error(`${path} is group- or world-writable`);
  }
  const [first, ...rest] = readFileSync(path, 'utf8').split('\n');
  if (rest.some((line) => line.trim().length > ZERO)) {
    throw new Error(`${path} must contain exactly one forward URL line`);
  }
  const value = first.trim();
  if (!value) throw new Error(`${path} contains no forward URL`);
  return value;
}

function forwardEndpoint(value, path) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${path} does not contain an absolute URL`);
  }
  if (url.protocol !== 'https:'
      && !(url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname))) {
    throw new Error(`${path} must use HTTPS or HTTP on a loopback host`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${path} must not carry credentials, a query, or a fragment`);
  }
  return url.href;
}

function resolveWelesEndpoint() {
  const path = join(stadoForwardsDirectory(), `${STADO_FORWARD_SERVICE}.local`);
  return forwardEndpoint(forwardUrlText(path), path);
}

function emailText(value, maximum) {
  return typeof value === 'string' && value.length <= maximum && EMAIL.test(value);
}

function lowercaseUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function exactName(value, maximum) {
  return typeof value === 'string'
    && value.length > ZERO
    && value.length <= maximum
    && /^[A-Za-z\d._-]+$/.test(value);
}

// The directory identity is a sealed item contract, never a call argument, so the
// bridge accepts exactly the four canonical fields and nothing else.
function directoryBlock(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === DIRECTORY_KEYS.length
    && DIRECTORY_KEYS.every((key) => Object.hasOwn(value, key))
    && exactName(value.provider, ONE_TWENTY_EIGHT)
    && lowercaseUuid(value.tenant_id)
    && lowercaseUuid(value.principal_object_id)
    && emailText(value.account_upn, TWO_FIFTY_FOUR);
}

function sameDirectory(value, directory) {
  return Boolean(directory)
    && Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === DIRECTORY_KEYS.length
    && DIRECTORY_KEYS.every((key) => value[key] === directory[key]);
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
    'directory',
    'approval_id',
    'resume_token',
    'baseline_revision',
    'field',
    'status',
    'created_at',
    'dry_run',
  ]);
  if (Object.keys(request).some((key) => !allowed.has(key))) {
    throw new Error('credential request contains unknown fields');
  }
  if (request.version !== REQUEST_VERSION) {
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
  if (!OPERATIONS.includes(request.operation)) {
    throw new Error('invalid credential operation');
  }
  if (request.account_email !== null && !emailText(request.account_email, TWO_FIFTY_FOUR)) {
    throw new Error('invalid credential account email');
  }
  if (request.directory !== null && !directoryBlock(request.directory)) {
    throw new Error('invalid credential directory block');
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
  if (!BRIDGE_MODES.includes(request.mode)) {
    throw new Error('invalid credential bridge mode');
  }
  if (request.mode !== 'resume'
      && (request.approval_id !== null || request.resume_token !== null)) {
    throw new Error('only resume mode may carry an approval');
  }
  if (request.mode === 'submit' && request.action_log_id !== null) {
    throw new Error('submit mode must not carry an action log id');
  }
  if (request.mode === 'status' && !exactName(request.action_log_id, TWO_HUNDRED)) {
    throw new Error('status mode requires an exact action log id');
  }
  if (request.mode === 'resume'
      && (!exactName(request.approval_id, SIXTY_FOUR)
        || !exactName(request.resume_token, ONE_TWENTY_EIGHT))) {
    throw new Error('resume mode requires an exact approval id and resume token');
  }
  if (request.mode === 'resume'
      && request.action_log_id !== null
      && !exactName(request.action_log_id, TWO_HUNDRED)) {
    throw new Error('resume mode carries either no action log id or an exact one');
  }
  if (request.mode === 'resume' && request.dry_run) {
    throw new Error('resume mode must not be a dry run');
  }
}

async function emit(value) {
  const text = `${JSON.stringify(value)}\n`;
  await new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

function unsupported(request, status, message, code, phase) {
  return {
    status,
    operation: request.operation,
    provider: request.provider,
    vaultItemId: request.credential_id,
    message,
    code: sanitizedCode(code),
    phase: sanitizedPhase(phase),
  };
}

function sanitizedText(value, maximum) {
  return typeof value === 'string'
    && value.length > ZERO
    && value.length <= maximum
    && !Array.from(value).some((character) => /\p{Cc}/u.test(character))
    ? value
    : undefined;
}

function sanitizedMember(value, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : undefined;
}

function sanitizedCode(value) {
  return typeof value === 'string' && DIAGNOSTIC_CODE.test(value) ? value : undefined;
}

function sanitizedPhase(value) {
  return sanitizedMember(value, DIAGNOSTIC_PHASES);
}

function sanitizedFlag(value) {
  return value === true || value === false ? value : undefined;
}

function sanitizedUuid(value) {
  return lowercaseUuid(value) ? value : undefined;
}

function sanitizedName(value, maximum) {
  return exactName(value, maximum) ? value : undefined;
}

function sanitizedHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > FIVE_TWELVE) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
}

function sanitizedTimestamp(value) {
  return typeof value === 'string' && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

function sanitizedEmail(value) {
  return emailText(value, TWO_FIFTY_FOUR) ? value : undefined;
}

function sanitizedDigest(value) {
  return typeof value === 'string' && EVIDENCE_DIGEST.test(value) ? value : undefined;
}

function sanitizedEffect(value) {
  return sanitizedMember(value, PROVIDER_EFFECTS);
}

// A terminally failed operation that reports no usable provider effect means
// nobody observed what happened at the provider. That is `unknown`, never `none`:
// Skarbiec must quarantine the item instead of assuming the password stands.
function reportedEffect(source, status) {
  return sanitizedEffect(source?.providerEffect)
    ?? (TERMINAL_FAILURE_STATUSES.includes(status) ? 'unknown' : undefined);
}

// An approval is a resource: either every field survives sanitizing or the whole
// object is dropped, because a partial approval cannot be resumed.
function sanitizedApproval(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const approval = {
    approval_id: sanitizedName(value.approval_id, SIXTY_FOUR),
    phase: sanitizedPhase(value.phase),
    provider_effect: sanitizedEffect(value.provider_effect),
    expires_at: sanitizedTimestamp(value.expires_at),
    resume_token: sanitizedName(value.resume_token, ONE_TWENTY_EIGHT),
    instruction: sanitizedText(value.instruction, FIVE_TWELVE),
  };
  return Object.values(approval).every((field) => field !== undefined) ? approval : undefined;
}

// The receipt answers "was exactly this principal rotated". A well-formed receipt
// for another identity, request, or operation is a protocol violation, not noise.
function sanitizedReceipt(value, request) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const receipt = {
    tenant_id: sanitizedUuid(value.tenant_id),
    principal_object_id: sanitizedUuid(value.principal_object_id),
    account_upn: sanitizedEmail(value.account_upn),
    operation: sanitizedMember(value.operation, OPERATIONS),
    request_id: sanitizedDigest(value.request_id),
    evidence_digest: sanitizedDigest(value.evidence_digest),
    execution_host: sanitizedName(value.execution_host, ONE_TWENTY_EIGHT),
    changed_at: value.changed_at === null ? null : sanitizedTimestamp(value.changed_at),
    verified_at: sanitizedTimestamp(value.verified_at),
    action_log_id: sanitizedName(value.action_log_id, TWO_HUNDRED),
  };
  if (Object.values(receipt).some((field) => field === undefined)) return undefined;
  if (receipt.tenant_id !== request.directory?.tenant_id
      || receipt.principal_object_id !== request.directory?.principal_object_id
      || receipt.account_upn !== request.directory?.account_upn
      || receipt.request_id !== request.request_id
      || receipt.operation !== request.operation) {
    throw new Error('Weles credential-operation receipt identity mismatch');
  }
  return receipt;
}

function diagnostics(source, status, request) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { providerEffect: reportedEffect(undefined, status) };
  }
  return {
    code: sanitizedCode(source.code),
    phase: sanitizedPhase(source.phase),
    retryable: sanitizedFlag(source.retryable),
    providerEffect: reportedEffect(source, status),
    rollbackStatus: sanitizedMember(source.rollbackStatus, ROLLBACK_STATUSES),
    executionHost: sanitizedName(source.executionHost, ONE_TWENTY_EIGHT),
    tenantId: sanitizedUuid(source.tenantId),
    principalObjectId: sanitizedUuid(source.principalObjectId),
    approval: sanitizedApproval(source.approval),
    receipt: sanitizedReceipt(source.receipt, request),
  };
}

function reportedOperation(task) {
  const result = task?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const reported = result.service_action?.credential_operation ?? result.pending_review;
  return reported && typeof reported === 'object' && !Array.isArray(reported) ? reported : undefined;
}

function credentialResult(value, request) {
  const result = value?.credential ?? value;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Weles response is missing the credential-operation result');
  }
  const secretMatches = result.secret === undefined || result.secret === contractFor(request)?.secret;
  const itemMatches = result.vaultItemId === request.credential_id
    || (result.vaultItemId === undefined && result.secret === contractFor(request)?.secret);
  const entraIdentityMatches = request.provider !== 'microsoft_entra'
    || ((result.tenantId === undefined || result.tenantId === request.directory.tenant_id)
      && (result.principalObjectId === undefined
        || result.principalObjectId === request.directory.principal_object_id));
  if (result.provider !== request.provider
      || !secretMatches
      || !itemMatches
      || !entraIdentityMatches
      || (request.provider === 'microsoft' || request.provider === 'microsoft_entra'
        ? result.operation !== request.operation
        : result.operation !== undefined && result.operation !== request.operation)) {
    throw new Error('Weles credential-operation response identity mismatch');
  }
  return result;
}

function expectedTaskActions(request) {
  if (request.provider === 'microsoft_entra') {
    return ENTRA_TASK_ACTIONS[request.operation] ?? NO_TASK_ACTIONS;
  }
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
        || (request.provider === 'microsoft_entra'
          && !sameDirectory(constraints.directory, request.directory))
        || constraints.operation !== request.operation) {
      throw new Error('Weles task status response provenance mismatch');
    }
  }
  if (request.provider === 'microsoft_entra') {
    const reported = reportedOperation(task) ?? {};
    if ((reported.tenantId !== undefined && reported.tenantId !== request.directory.tenant_id)
        || (reported.principalObjectId !== undefined
          && reported.principalObjectId !== request.directory.principal_object_id)) {
      throw new Error('Weles task status response identity mismatch');
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
if (request.provider === 'microsoft_entra'
    && (request.directory === null
      || request.directory.provider !== request.provider
      || request.directory.account_upn !== contract.accountUpn
      || request.directory.tenant_id !== contract.tenantId
      || request.directory.principal_object_id !== contract.principalObjectId)) {
  await emit(unsupported(
    request,
    'needs_configuration',
    `Entra account identity does not match the exact bridge contract for ${request.credential_id}`,
    'ENTRA_IDENTITY_CONTRACT_MISMATCH',
    'admission',
  ));
  process.exit(ZERO);
}
if (request.provider !== 'microsoft_entra' && request.directory !== null) {
  await emit(unsupported(
    request,
    'needs_configuration',
    `A directory identity is only accepted for provider microsoft_entra, not ${request.provider}`,
    'ENTRA_IDENTITY_CONTRACT_MISMATCH',
    'admission',
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

let endpoint;
try {
  endpoint = resolveWelesEndpoint();
} catch (error) {
  await emit(unsupported(
    request,
    'needs_configuration',
    sanitizedText(`Weles admission endpoint is unresolved: ${error.message}`, FIVE_TWELVE)
      ?? 'Weles admission endpoint is unresolved',
    'WELES_ENDPOINT_UNRESOLVED',
    'admission',
  ));
  process.exit(ZERO);
}

const client = new WelesClient({
  endpoint,
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
  const status = transition?.status ?? normalizedTaskStatus(task.status);
  const output = {
    status,
    operation: request.operation,
    provider: request.provider,
    actionLogId: transition?.actionLogId ?? request.action_log_id,
    sourceActionLogId: transition?.sourceActionLogId,
    vaultItemId: request.credential_id,
    message: `Weles credential operation is ${transition?.status ?? task.status}`,
    ...diagnostics(reportedOperation(task), status, request),
  };
  await emit(output);
  process.exit(ZERO);
}

const response = await client.submit({
  origin: contract.origin,
  action: ACTION,
  input: {
    version: request.version,
    mode: request.mode,
    requestId: request.request_id,
    operation: request.operation,
    credentialId: request.credential_id,
    provider: request.provider,
    field: request.field,
    consumer: request.consumer,
    purpose: request.purpose,
    accountEmail: request.account_email,
    directory: request.directory,
    baselineRevision: request.baseline_revision,
    actionLogId: request.action_log_id,
    approvalId: request.approval_id,
    resumeToken: request.resume_token,
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
  'operation_completed',
  'needs_configuration',
  'needs_human_approval',
  'unsupported_operation',
  'unsupported_secret',
  'operation_failed',
]);
if (!allowedStatuses.has(operationResult.status)) {
  throw new Error('Weles returned an unsupported credential-operation status');
}
if (['operation_plan', 'operation_queued'].includes(operationResult.status)
    && request.dry_run !== (operationResult.status === 'operation_plan')) {
  throw new Error('Weles credential-operation response does not match dry-run mode');
}
if (request.dry_run && operationResult.status === 'operation_completed') {
  throw new Error('Weles completed a credential operation that was submitted as a dry run');
}
const actionLogId = sanitizedName(operationResult.actionLogId, TWO_HUNDRED);
if (operationResult.status === 'operation_queued' && !actionLogId) {
  throw new Error('queued Weles credential operation is missing its action log id');
}
const output = {
  status: operationResult.status,
  operation: request.operation,
  provider: request.provider,
  actionLogId,
  sourceActionLogId: sanitizedName(operationResult.sourceActionLogId, TWO_HUNDRED),
  vaultItemId: request.credential_id,
  url: sanitizedHttpsUrl(operationResult.url),
  buildId: sanitizedName(operationResult.buildId, TWO_HUNDRED),
  flowName: sanitizedName(operationResult.flowName, ONE_TWENTY_EIGHT),
  message: sanitizedText(operationResult.message, FIVE_TWELVE),
  ...diagnostics(operationResult, operationResult.status, request),
};
await emit(output);
