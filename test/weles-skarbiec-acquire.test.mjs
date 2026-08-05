import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const bridge = resolve(here, '../bin/weles-skarbiec-acquire.mjs');
const credentialId = 'weles-supabase-personal-access-token';
const writer = 'weles-supabase-personal-access-token-writer';
const actionLogId = 'action-contract-test';

function request(overrides = {}) {
  return {
    version: 'skarbiec.credential-operation.v1',
    request_id: 'a'.repeat(64),
    mode: 'submit',
    action_log_id: null,
    credential_id: credentialId,
    operation: 'acquire',
    provider: 'supabase',
    consumer: writer,
    purpose: 'verify the public credential bridge contract',
    account_email: 'owner@example.com',
    baseline_revision: 0,
    field: 'api_key',
    status: 'pending',
    created_at: '2026-08-04T00:00:00Z',
    dry_run: false,
    ...overrides,
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

test('submit and status preserve the exact Skarbiec credential contract', async (context) => {
  let submitted;
  const server = http.createServer((incoming, response) => {
    if (incoming.method === 'POST' && incoming.url === '/api/v1/tasks') {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk) => { body += chunk; });
      incoming.on('end', () => {
        submitted = JSON.parse(body);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          credential: {
            status: 'operation_queued',
            operation: 'acquire',
            provider: 'supabase',
            secret: 'supabase.personal_access_token',
            vaultItemId: credentialId,
            actionLogId,
            message: 'queued by contract test',
          },
        }));
      });
      return;
    }
    if (incoming.method === 'GET' && incoming.url === `/api/v1/tasks/${actionLogId}`) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        task: {
          id: actionLogId,
          action: 'generic_keeper_task',
          status: 'completed',
          params: {
            constraints: {
              request_id: 'a'.repeat(64),
              vault_item_id: credentialId,
              vault_field: 'api_key',
              provider: 'supabase',
              operation: 'acquire',
            },
          },
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolvePromise) => server.listen(0, 'localhost', resolvePromise));
  context.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const environment = {
    WELES_URL: `http://localhost:${address.port}/api/v1/`,
    WELES_TOKEN: 'contract-test-token-0123456789',
    WISENT_ORGANIZATION_ID: 'contract-test-organization',
  };

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
});

test('a non-contract writer fails closed without calling Weles', async () => {
  const result = await invoke(request({ consumer: 'arbitrary-writer' }), {
    WELES_URL: 'http://localhost:1/api/v1/',
    WELES_TOKEN: 'contract-test-token-0123456789',
    WISENT_ORGANIZATION_ID: 'contract-test-organization',
  });

  assert.equal(result.status, 'needs_configuration');
  assert.equal(result.vaultItemId, credentialId);
  assert.match(result.message, /No exact Weles credential contract/);
});
