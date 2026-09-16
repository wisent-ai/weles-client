import { REQUEST_VERSION, TWO_HUNDRED, ONE_TWENTY_EIGHT, FIVE_TWELVE } from './contract.mjs';
import { diagnostics, sanitizedName, sanitizedText, sanitizedHttpsUrl } from './diagnostics.mjs';

const STATUSES = new Set([
  'operation_plan', 'operation_queued', 'operation_completed', 'needs_configuration',
  'needs_human_approval', 'unsupported_operation', 'unsupported_secret', 'operation_failed',
]);

export function credentialResponse(value, request) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !STATUSES.has(value.status)) {
    throw new Error('Weles returned an unsupported credential-operation response');
  }
  if ((value.version !== undefined && value.version !== REQUEST_VERSION)
      || value.operation !== request.operation || value.provider !== request.provider
      || value.vaultItemId !== request.credential_id) {
    throw new Error('Weles credential-operation response identity mismatch');
  }
  const actionLogId = sanitizedName(value.actionLogId, TWO_HUNDRED);
  const sourceActionLogId = sanitizedName(value.sourceActionLogId, TWO_HUNDRED);
  if (value.status === 'operation_queued' && !actionLogId) {
    throw new Error('queued Weles credential operation is missing its action log id');
  }
  if (request.mode === 'status'
      && actionLogId !== request.action_log_id && sourceActionLogId !== request.action_log_id) {
    throw new Error('Weles credential-operation status task identity mismatch');
  }
  if (request.dry_run && ['operation_queued', 'operation_completed'].includes(value.status)) {
    throw new Error('Weles executed a credential operation submitted as a dry run');
  }
  if (!request.dry_run && value.status === 'operation_plan') {
    throw new Error('Weles returned a plan for an executable credential operation');
  }
  const result = {
    version: REQUEST_VERSION,
    status: value.status,
    operation: request.operation,
    provider: request.provider,
    vaultItemId: request.credential_id,
    actionLogId,
    sourceActionLogId,
    url: sanitizedHttpsUrl(value.url),
    buildId: sanitizedName(value.buildId, TWO_HUNDRED),
    flowName: sanitizedName(value.flowName, ONE_TWENTY_EIGHT),
    message: sanitizedText(value.message, FIVE_TWELVE),
    ...diagnostics(value, value.status, request),
  };
  if (result.status === 'needs_human_approval' && !result.approval) {
    throw new Error('Weles requested human approval without a complete approval resource');
  }
  return result;
}

export function credentialFailure(request, code, message, providerEffect = 'none') {
  return credentialResponse({
    status: providerEffect === 'unknown' ? 'operation_failed' : 'needs_configuration',
    operation: request.operation,
    provider: request.provider,
    vaultItemId: request.credential_id,
    actionLogId: request.action_log_id,
    code,
    phase: 'admission',
    retryable: false,
    providerEffect,
    message: String(message).replace(/\p{Cc}/gu, ' ').slice(0, FIVE_TWELVE),
  }, request);
}
