import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const bridge = resolve(here, '../bin/weles-skarbiec-acquire.mjs');
const credentialId = 'weles-supabase-personal-access-token';
const writer = 'weles-supabase-personal-access-token-writer';
const actionLogId = 'action-contract-test';
const requestId = 'a'.repeat(64);
const entraCredentialId = 'weles-microsoft-lukasz-wisent-com-password';
const entraTenantId = '23572277-0021-42ac-b2b9-10bd86c7d2af';
const entraPrincipalObjectId = '1f636f97-b07f-4e9b-952a-5d069ccc5b20';
const entraDirectory = Object.freeze({
  provider: 'microsoft_entra',
  tenant_id: entraTenantId,
  principal_object_id: entraPrincipalObjectId,
  account_upn: 'lukasz@wisent.com',
});

function request(overrides = {}) {
  return {
    version: 'skarbiec.credential-operation.v3',
    request_id: requestId,
    mode: 'submit',
    action_log_id: null,
    approval_id: null,
    resume_token: null,
    credential_id: credentialId,
    operation: 'acquire',
    provider: 'supabase',
    consumer: writer,
    purpose: 'verify the public credential bridge contract',
    account_email: 'owner@example.com',
    directory: null,
    baseline_revision: 0,
    field: 'api_key',
    status: 'pending',
    created_at: '2026-08-04T00:00:00Z',
    dry_run: false,
    ...overrides,
  };
}

function entraRequest(overrides = {}) {
  return request({
    credential_id: entraCredentialId,
    operation: 'rotate',
    provider: 'microsoft_entra',
    consumer: `${entraCredentialId}-writer`,
    field: 'password',
    account_email: null,
    directory: { ...entraDirectory },
    purpose: 'verify the Entra password lifecycle contract',
    ...overrides,
  });
}

function entraConstraints(operation) {
  return {
    request_id: requestId,
    vault_item_id: entraCredentialId,
    vault_field: 'password',
    provider: 'microsoft_entra',
    operation,
    directory: { ...entraDirectory },
  };
}

function forwardsDirectory(url) {
  const directory = mkdtempSync(join(tmpdir(), 'weles-forwards-'));
  if (url) {
    writeFileSync(join(directory, 'weles-admission.local'), `${url}\n`, { mode: 0o600 });
  }
  return directory;
}

function environmentFor(url) {
  return {
    STADO_FORWARDS_DIR: forwardsDirectory(url),
    WELES_TOKEN: 'contract-test-token-0123456789',
    WISENT_ORGANIZATION_ID: 'contract-test-organization',
  };
}

function invoke(body, environment) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [bridge], {
      env: { ...process.env, ...environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`bridge exited ${code}: ${stderr}`));
        return;
      }
      resolvePromise(JSON.parse(stdout));
    });
    child.stdin.end(JSON.stringify(body));
  });
}

function jsonServer(routes) {
  return http.createServer((incoming, response) => {
    const route = routes[`${incoming.method} ${incoming.url}`];
    if (!route) {
      response.statusCode = 404;
      response.end('{}');
      return;
    }
    let body = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk) => { body += chunk; });
    incoming.on('end', () => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(route(body ? JSON.parse(body) : undefined)));
    });
  });
}

async function listening(server, context) {
  await new Promise((resolvePromise) => server.listen(0, 'localhost', resolvePromise));
  context.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
  const address = server.address();
  assert.equal(typeof address, 'object');
  return environmentFor(`http://localhost:${address.port}/api/v1/`);
}

test('submit and status preserve the exact Skarbiec credential contract', async (context) => {
  let submitted;
  const server = jsonServer({
    'POST /api/v1/tasks': (body) => {
      submitted = body;
      return {
        credential: {
          status: 'operation_queued',
          operation: 'acquire',
          provider: 'supabase',
          secret: 'supabase.personal_access_token',
          vaultItemId: credentialId,
          actionLogId,
          message: 'queued by contract test',
        },
      };
    },
    [`GET /api/v1/tasks/${actionLogId}`]: () => ({
      task: {
        id: actionLogId,
        action: 'generic_keeper_task',
        status: 'completed',
        params: {
          constraints: {
            request_id: requestId,
            vault_item_id: credentialId,
            vault_field: 'api_key',
            provider: 'supabase',
            operation: 'acquire',
          },
        },
      },
    }),
  });
  const environment = await listening(server, context);

  const queued = await invoke(request(), environment);
  assert.deepEqual(queued, {
    status: 'operation_queued',
    operation: 'acquire',
    provider: 'supabase',
    actionLogId,
    vaultItemId: credentialId,
    message: 'queued by contract test',
  });
  assert.equal(submitted.action, 'skarbiec_credential_acquire');
  assert.equal(submitted.input.version, 'skarbiec.credential-operation.v3');
  assert.equal(submitted.input.mode, 'submit');
  assert.equal(submitted.input.directory, null);
  assert.equal(submitted.input.approvalId, null);
  assert.equal(submitted.input.resumeToken, null);
  assert.equal(submitted.input.field, 'api_key');
  assert.equal(submitted.input.consumer, writer);
  assert.equal(submitted.input.baselineRevision, 0);

  const completed = await invoke(request({
    mode: 'status',
    action_log_id: actionLogId,
  }), environment);
  assert.equal(completed.status, 'operation_completed');
  assert.equal(completed.actionLogId, actionLogId);
  assert.equal(completed.vaultItemId, credentialId);
  assert.equal(Object.hasOwn(completed, 'providerEffect'), false);
});

test('a v2 request is rejected without reaching Weles', async () => {
  await assert.rejects(
    invoke(
      request({ version: 'skarbiec.credential-operation.v2' }),
      environmentFor('http://localhost:1/api/v1/'),
    ),
    /unsupported credential request version/,
  );
});

test('a non-contract writer fails closed without calling Weles', async () => {
  const result = await invoke(
    request({ consumer: 'arbitrary-writer' }),
    environmentFor('http://localhost:1/api/v1/'),
  );

  assert.equal(result.status, 'needs_configuration');
  assert.equal(result.vaultItemId, credentialId);
  assert.match(result.message, /No exact Weles credential contract/);
});

test('an unresolved Stado forward fails closed before any request', async () => {
  const result = await invoke(request(), environmentFor(null));

  assert.equal(result.status, 'needs_configuration');
  assert.equal(result.code, 'WELES_ENDPOINT_UNRESOLVED');
  assert.equal(result.phase, 'admission');
  assert.match(result.message, /weles-admission\.local does not exist/);
});

test('a directory block outside the bridge contract fails closed', async () => {
  const result = await invoke(
    entraRequest({
      directory: { ...entraDirectory, principal_object_id: '4c888895-03cf-4ab1-a11e-46942c568217' },
    }),
    environmentFor('http://localhost:1/api/v1/'),
  );

  assert.equal(result.status, 'needs_configuration');
  assert.equal(result.code, 'ENTRA_IDENTITY_CONTRACT_MISMATCH');
  assert.equal(result.phase, 'admission');
  assert.equal(result.vaultItemId, entraCredentialId);
});

test('a directory block under another provider fails closed', async () => {
  const result = await invoke(
    request({ directory: { ...entraDirectory } }),
    environmentFor('http://localhost:1/api/v1/'),
  );

  assert.equal(result.status, 'needs_configuration');
  assert.equal(result.code, 'ENTRA_IDENTITY_CONTRACT_MISMATCH');
  assert.equal(result.phase, 'admission');
});

test('an Entra rotation carries its directory block and typed diagnostics both ways', async (context) => {
  const entraActionLogId = 'action-entra-contract-test';
  let submitted;
  const server = jsonServer({
    'POST /api/v1/tasks': (body) => {
      submitted = body;
      return {
        credential: {
          status: 'operation_queued',
          operation: 'rotate',
          provider: 'microsoft_entra',
          secret: entraCredentialId,
          vaultItemId: entraCredentialId,
          actionLogId: entraActionLogId,
          flowName: 'microsoft-entra-password-lifecycle',
          tenantId: entraTenantId,
          principalObjectId: entraPrincipalObjectId,
          message: 'queued by contract test',
        },
      };
    },
    [`GET /api/v1/tasks/${entraActionLogId}`]: () => ({
      task: {
        id: entraActionLogId,
        action: 'microsoft_entra_reset_password',
        status: 'failed',
        params: { constraints: entraConstraints('rotate') },
        result: {
          service_action: {
            credential_operation: {
              status: 'operation_failed',
              code: 'ENTRA_IDENTITY_MISMATCH',
              phase: 'identity_verification',
              retryable: false,
              providerEffect: 'changed',
              rollbackStatus: 'failed',
              executionHost: 'charless-mac-mini.local',
              tenantId: entraTenantId,
              principalObjectId: entraPrincipalObjectId,
            },
          },
          html: '<html>never emitted</html>',
        },
      },
    }),
  });
  const environment = await listening(server, context);

  const queued = await invoke(entraRequest(), environment);
  assert.equal(queued.status, 'operation_queued');
  assert.equal(queued.actionLogId, entraActionLogId);
  assert.equal(queued.tenantId, entraTenantId);
  assert.equal(queued.principalObjectId, entraPrincipalObjectId);
  assert.equal(queued.flowName, 'microsoft-entra-password-lifecycle');
  assert.deepEqual(submitted.input.directory, entraDirectory);
  assert.equal(Object.hasOwn(submitted.input, 'accountUpn'), false);
  assert.equal(Object.hasOwn(submitted.input, 'tenantId'), false);
  assert.equal(Object.hasOwn(submitted.input, 'principalObjectId'), false);
  assert.equal(submitted.origin, 'https://login.microsoftonline.com');

  const failed = await invoke(entraRequest({
    mode: 'status',
    action_log_id: entraActionLogId,
  }), environment);
  assert.equal(failed.status, 'operation_failed');
  assert.equal(failed.code, 'ENTRA_IDENTITY_MISMATCH');
  assert.equal(failed.phase, 'identity_verification');
  assert.equal(failed.retryable, false);
  assert.equal(failed.providerEffect, 'changed');
  assert.equal(Object.hasOwn(failed, 'providerPasswordChanged'), false);
  assert.equal(failed.rollbackStatus, 'failed');
  assert.equal(failed.executionHost, 'charless-mac-mini.local');
  assert.equal(Object.hasOwn(failed, 'html'), false);
});

test('a terminal failure without a credible provider effect reads as unknown', async (context) => {
  const unknownActionLogId = 'action-entra-unknown-effect';
  const server = jsonServer({
    [`GET /api/v1/tasks/${unknownActionLogId}`]: () => ({
      task: {
        id: unknownActionLogId,
        action: 'microsoft_entra_reset_password',
        status: 'timed_out',
        params: { constraints: entraConstraints('reset') },
        result: {
          service_action: {
            credential_operation: {
              status: 'operation_failed',
              phase: 'password_change',
              providerEffect: 'maybe',
            },
          },
        },
      },
    }),
  });
  const environment = await listening(server, context);

  const failed = await invoke(entraRequest({
    mode: 'status',
    operation: 'reset',
    action_log_id: unknownActionLogId,
  }), environment);
  assert.equal(failed.status, 'operation_failed');
  assert.equal(failed.phase, 'password_change');
  assert.equal(failed.providerEffect, 'unknown');
});

test('an adoption resumes its approval and returns the receipt of that principal', async (context) => {
  const adoptActionLogId = 'action-entra-adopt';
  const approval = {
    approval_id: 'approval-01H9Z',
    phase: 'identity_verification',
    provider_effect: 'none',
    expires_at: '2026-08-05T12:00:00Z',
    resume_token: 'r_9f3c2a',
    instruction: 'Confirm the Microsoft Authenticator prompt for lukasz@wisent.com.',
  };
  const receipt = {
    tenant_id: entraTenantId,
    principal_object_id: entraPrincipalObjectId,
    account_upn: 'lukasz@wisent.com',
    operation: 'adopt',
    request_id: requestId,
    evidence_digest: 'b'.repeat(64),
    execution_host: 'charless-mac-mini.local',
    changed_at: null,
    verified_at: '2026-08-05T11:59:00Z',
    action_log_id: adoptActionLogId,
  };
  let submitted;
  const server = jsonServer({
    'POST /api/v1/tasks': (body) => {
      submitted = body;
      return {
        credential: {
          status: 'needs_human_approval',
          operation: 'adopt',
          provider: 'microsoft_entra',
          secret: entraCredentialId,
          vaultItemId: entraCredentialId,
          actionLogId: adoptActionLogId,
          providerEffect: 'none',
          approval,
        },
      };
    },
    [`GET /api/v1/tasks/${adoptActionLogId}`]: () => ({
      task: {
        id: adoptActionLogId,
        action: 'microsoft_entra_adopt_password',
        status: 'completed',
        params: { constraints: entraConstraints('adopt') },
        result: {
          service_action: {
            credential_operation: {
              status: 'operation_completed',
              phase: 'skarbiec_commit',
              providerEffect: 'none',
              receipt,
            },
          },
        },
      },
    }),
  });
  const environment = await listening(server, context);

  const pending = await invoke(entraRequest({
    mode: 'resume',
    operation: 'adopt',
    approval_id: approval.approval_id,
    resume_token: approval.resume_token,
  }), environment);
  assert.equal(pending.status, 'needs_human_approval');
  assert.equal(pending.providerEffect, 'none');
  assert.deepEqual(pending.approval, approval);
  assert.equal(submitted.input.mode, 'resume');
  assert.equal(submitted.input.operation, 'adopt');
  assert.equal(submitted.input.approvalId, approval.approval_id);
  assert.equal(submitted.input.resumeToken, approval.resume_token);

  const completed = await invoke(entraRequest({
    mode: 'status',
    operation: 'adopt',
    action_log_id: adoptActionLogId,
  }), environment);
  assert.equal(completed.status, 'operation_completed');
  assert.equal(completed.providerEffect, 'none');
  assert.deepEqual(completed.receipt, receipt);
});

test('a receipt for another principal rejects the whole response', async (context) => {
  const strayActionLogId = 'action-entra-stray-receipt';
  const server = jsonServer({
    [`GET /api/v1/tasks/${strayActionLogId}`]: () => ({
      task: {
        id: strayActionLogId,
        action: 'microsoft_entra_verify_password',
        status: 'completed',
        params: { constraints: entraConstraints('verify') },
        result: {
          service_action: {
            credential_operation: {
              status: 'operation_completed',
              providerEffect: 'none',
              receipt: {
                tenant_id: entraTenantId,
                principal_object_id: '4c888895-03cf-4ab1-a11e-46942c568217',
                account_upn: 'jakub@wisent.ai',
                operation: 'verify',
                request_id: requestId,
                evidence_digest: 'c'.repeat(64),
                execution_host: 'charless-mac-mini.local',
                changed_at: null,
                verified_at: '2026-08-05T11:59:00Z',
                action_log_id: strayActionLogId,
              },
            },
          },
        },
      },
    }),
  });
  const environment = await listening(server, context);

  await assert.rejects(
    invoke(entraRequest({
      mode: 'status',
      operation: 'verify',
      action_log_id: strayActionLogId,
    }), environment),
    /receipt identity mismatch/,
  );
});
