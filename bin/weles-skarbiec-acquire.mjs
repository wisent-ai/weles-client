#!/usr/bin/env node
import { WelesClient } from '../src/index.mjs';
import { resolveWelesEndpoint } from '../src/stado-admission.mjs';
import {
  ZERO, FIVE_TWELVE, TWO_HUNDRED, ONE_TWENTY_EIGHT, ACTION, contractFor,
} from '../src/credential/contract.mjs';
import { readRequest, validateRequest } from '../src/credential/input.mjs';
import {
  diagnostics, sanitizedText, sanitizedCode, sanitizedPhase, sanitizedName, sanitizedHttpsUrl,
} from '../src/credential/diagnostics.mjs';
import {
  taskRecord, credentialResult, reportedOperation, semanticScholarTransition,
  approvedTransition, normalizedTaskStatus,
} from '../src/credential/tasks.mjs';

function requiredEnvironment(name) {
  const value = process.env[name]?.trim() ?? '';
  if (!value) throw new Error(`${name} is required`);
  return value;
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

const request = await readRequest();
validateRequest(request);
const contract = contractFor(request);
// A Microsoft password lifecycle names its exact writer consumer for rotate and
// verify and its exact reader consumer for adopt: Skarbiec stages the adopt
// candidate against the reader consumer, so only that consumer may read it back.
const microsoftConsumer = request.provider === 'microsoft'
    && MICROSOFT_CREDENTIAL_ID.test(request.credential_id)
    && [`${request.credential_id}-writer`, `${request.credential_id}-reader-password`].includes(request.consumer);
if (!contract
    || contract.provider !== request.provider
    || contract.field !== request.field
    || (contract.consumer !== request.consumer && !microsoftConsumer)) {
  await emit(unsupported(
    request,
    'needs_configuration',
    `No exact Weles credential contract for ${request.credential_id}/${request.provider}/${request.consumer}`,
  ));
  process.exit(ZERO);
}
if (request.signup_origin && request.signup_origin !== contract.origin) {
  await emit(unsupported(
    request,
    'needs_configuration',
    'Signup origin differs from the registered credential capture origin',
    'WELES_CREDENTIAL_ORIGIN_MISMATCH',
    'admission',
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
// Only a derived generic contract has a caller-declared site. A named contract
// owns its origin, so a signup origin aimed at one of those items is refused
// instead of redirecting a reviewed flow to another host.
if (request.signup_origin && contract.signupOrigin === undefined) {
  await emit(unsupported(
    request,
    'needs_configuration',
    `A signup origin is only accepted for a generic provider, not ${request.credential_id}/${request.provider}`,
    'SIGNUP_ORIGIN_NOT_ACCEPTED',
    'admission',
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

const identity = callerIdentity(endpoint);
const client = new WelesClient({
  endpoint,
  bearer: identity.bearer,
  organizationId: identity.organizationId,
  allowedOrigins: [contract.origin],
  allowedActions: [ACTION],
});
if (request.mode === 'status') {
  const task = taskRecord(await client.get(request.action_log_id), request);
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
    ...(contract.signupOrigin ? { signupOrigin: contract.signupOrigin } : {}),
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
}, { idempotencyKey: request.request_id });

const operationResult = credentialResult(response, request);
const allowedStatuses = new Set([
  'operation_plan', 'operation_queued', 'operation_completed',
  'needs_configuration', 'needs_human_approval', 'unsupported_operation',
  'unsupported_secret', 'operation_failed',
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
