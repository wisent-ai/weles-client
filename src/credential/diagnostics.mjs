import {
  ZERO, SIXTY_FOUR, ONE_TWENTY_EIGHT, TWO_HUNDRED, TWO_FIFTY_FOUR,
  FIVE_TWELVE, DIAGNOSTIC_CODE, DIAGNOSTIC_PHASES, TIMESTAMP,
  EVIDENCE_DIGEST, PROVIDER_EFFECTS, TERMINAL_FAILURE_STATUSES,
  ROLLBACK_STATUSES, OPERATIONS,
} from './contract.mjs';
import { exactName, emailText, lowercaseUuid } from './input.mjs';

export function sanitizedText(value, maximum) {
  return typeof value === 'string'
    && value.length > ZERO
    && value.length <= maximum
    && !Array.from(value).some((character) => /\p{Cc}/u.test(character))
    ? value : undefined;
}

function sanitizedMember(value, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : undefined;
}

export function sanitizedCode(value) {
  return typeof value === 'string' && DIAGNOSTIC_CODE.test(value) ? value : undefined;
}

export function sanitizedPhase(value) {
  return sanitizedMember(value, DIAGNOSTIC_PHASES);
}

function sanitizedFlag(value) {
  return value === true || value === false ? value : undefined;
}

function sanitizedUuid(value) {
  return lowercaseUuid(value) ? value : undefined;
}

export function sanitizedName(value, maximum) {
  return exactName(value, maximum) ? value : undefined;
}

export function sanitizedHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > FIVE_TWELVE) return undefined;
  let url;
  try { url = new URL(value); } catch { return undefined; }
  return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
}

function sanitizedTimestamp(value) {
  return typeof value === 'string' && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
    ? value : undefined;
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

function reportedEffect(source, status) {
  return sanitizedEffect(source?.providerEffect)
    ?? (TERMINAL_FAILURE_STATUSES.includes(status) ? 'unknown' : undefined);
}

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

function sanitizedReceipt(value, request) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  let changedAt = value.changed_at;
  if (changedAt !== null) changedAt = sanitizedTimestamp(changedAt);
  const receipt = {
    tenant_id: sanitizedUuid(value.tenant_id),
    principal_object_id: sanitizedUuid(value.principal_object_id),
    account_upn: sanitizedEmail(value.account_upn),
    operation: sanitizedMember(value.operation, OPERATIONS),
    request_id: sanitizedDigest(value.request_id),
    evidence_digest: sanitizedDigest(value.evidence_digest),
    execution_host: sanitizedName(value.execution_host, ONE_TWENTY_EIGHT),
    changed_at: changedAt,
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

export function diagnostics(source, status, request) {
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
