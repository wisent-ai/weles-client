import { TWO_HUNDRED, ENTRA_TASK_ACTIONS, NO_TASK_ACTIONS, contractFor } from './contract.mjs';
import { exactName, sameDirectory } from './input.mjs';

export function reportedOperation(task) {
  const result = task?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const reported = result.service_action?.credential_operation ?? result.pending_review;
  return reported && typeof reported === 'object' && !Array.isArray(reported) ? reported : undefined;
}

export function credentialResult(value, request) {
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
    return request.operation === 'verify' ? ['microsoft_verify_password'] : ['microsoft_reset_password'];
  }
  if (request.credential_id === 'weles-semantic-scholar-api') {
    return ['generic_keeper_task', 'semanticscholar_key_followup'];
  }
  return ['generic_keeper_task'];
}

export function taskRecord(value, request) {
  const task = value?.task ?? value?.job ?? value;
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error('Weles task status response is invalid');
  }
  const taskId = task.id ?? task.taskId;
  if (taskId !== request.action_log_id || !expectedTaskActions(request).includes(task.action)) {
    throw new Error('Weles task status response identity mismatch');
  }
  if (task.action !== 'semanticscholar_key_followup') {
    const constraints = task.params?.constraints;
    if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)
        || constraints.request_id !== request.request_id
        || constraints.vault_item_id !== request.credential_id
        || constraints.vault_field !== request.field
        || constraints.provider !== request.provider
        || (request.provider === 'microsoft' && constraints.account_email !== request.account_email)
        || (request.provider === 'microsoft_entra' && !sameDirectory(constraints.directory, request.directory))
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

export function normalizedTaskStatus(status) {
  if (['accepted', 'queued', 'pending', 'running'].includes(status)) return 'operation_queued';
  if (status === 'pending_review') return 'needs_human_approval';
  if (status === 'completed') return 'operation_completed';
  if (['failed', 'cancelled', 'rejected', 'timed_out'].includes(status)) return 'operation_failed';
  throw new Error('Weles returned an unsupported task status');
}

export function semanticScholarTransition(task, request) {
  if (request.credential_id !== 'weles-semantic-scholar-api' || task.status !== 'completed') return null;
  const details = task.action === 'generic_keeper_task'
    ? task.result?.semantic_scholar_followup : task.result?.service_action?.semantic_scholar_key_followup;
  const nextActionLogId = task.action === 'generic_keeper_task'
    ? details?.action_log_id : details?.next_action_log_id;
  if (exactName(nextActionLogId, TWO_HUNDRED)) {
    return { status: 'operation_queued', actionLogId: nextActionLogId, sourceActionLogId: request.action_log_id };
  }
  if (task.action === 'semanticscholar_key_followup' && details?.status === 'validated') {
    return { status: 'operation_completed', actionLogId: request.action_log_id };
  }
  return { status: 'operation_failed', actionLogId: request.action_log_id };
}

export function approvedTransition(task, request) {
  if (task.status !== 'approved') return null;
  const nextActionLogId = task.result?.approved_job_id;
  return exactName(nextActionLogId, TWO_HUNDRED)
    ? { status: 'operation_queued', actionLogId: nextActionLogId, sourceActionLogId: request.action_log_id }
    : null;
}
