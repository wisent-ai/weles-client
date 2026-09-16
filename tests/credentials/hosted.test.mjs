import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { credentialResponse } from '../../src/credential/response.mjs';
import { contractFor, ZERO } from '../../src/credential/contract.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bridge = 'bin/weles-skarbiec-acquire.mjs';
const sources = [bridge, 'src/index.mjs', 'src/stado-admission.mjs',
  ...['contract', 'input', 'diagnostics', 'tasks', 'response'].map((name) => `src/credential/${name}.mjs`)];

function request(overrides = {}) {
  return {
    version: 'skarbiec.credential-operation.v3',
    request_id: createHash('sha256').update(randomUUID()).digest('hex'),
    mode: 'submit', action_log_id: null, approval_id: null, resume_token: null,
    credential_id: 'weles-supabase-personal-access-token', operation: 'acquire', provider: 'supabase',
    consumer: 'weles-supabase-personal-access-token-writer',
    purpose: 'Verify credential bridge refusal without provider access',
    account_email: null, directory: null, signup_origin: null,
    baseline_revision: ZERO, field: 'api_key', status: 'pending',
    created_at: new Date().toISOString(), dry_run: false, ...overrides,
  };
}

function entraRequest() {
  const credential_id = 'weles-microsoft-lukasz-wisent-com-password';
  const contract = contractFor({ credential_id });
  return request({
    credential_id, provider: contract.provider, consumer: contract.consumer,
    operation: 'verify', field: contract.field,
    directory: { provider: contract.provider, tenant_id: contract.tenantId,
      principal_object_id: contract.principalObjectId, account_upn: contract.accountUpn },
  });
}

function invoke(body) {
  const build = join(root, '.wisent-output', 'credential-bridge-tests');
  mkdirSync(build, { recursive: true });
  const evidence = mkdtempSync(join(build, 'hosted-refusal-'));
  const argv = [join(root, bridge)];
  const result = spawnSync(process.execPath, argv, {
    cwd: root, input: JSON.stringify(body), encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: evidence, STADO_FORWARDS_DIR: join(evidence, 'forwards') },
  });
  writeFileSync(join(evidence, 'request.json'), JSON.stringify(body));
  writeFileSync(join(evidence, 'stdout.txt'), result.stdout);
  writeFileSync(join(evidence, 'stderr.txt'), result.stderr);
  writeFileSync(join(evidence, 'manifest.json'), JSON.stringify({
    revision: process.env.WISENT_SOURCE_COMMIT
      || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sources: Object.fromEntries(sources.map((path) => [path,
      createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])),
    executable: process.execPath, argv, exit_status: result.status, signal: result.signal,
    claim: 'Real local refusal only; no provider was simulated or contacted.',
  }));
  console.log(`Hosted refusal evidence: ${evidence}`);
  assert.equal(result.error, undefined);
  return result;
}

function refusal(body) {
  const result = invoke(body);
  assert.equal(result.status, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.status, 'needs_configuration');
  return answer;
}

test('obsolete wire requests cannot enter credential admission', () => {
  const result = invoke(request({ version: 'skarbiec.credential-operation.v2' }));
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('a different writer cannot submit the registered credential', () => {
  const answer = refusal(request({ consumer: 'arbitrary-writer' }));
  assert.equal(answer.vaultItemId, 'weles-supabase-personal-access-token');
});

test('a missing forward is reported rather than treated as provider work', () => {
  assert.equal(refusal(request()).code, 'WELES_ENDPOINT_UNRESOLVED');
});

test('another Entra principal is refused before discovery', () => {
  const body = entraRequest();
  body.directory.principal_object_id = randomUUID();
  assert.equal(refusal(body).code, 'ENTRA_IDENTITY_CONTRACT_MISMATCH');
});

test('a non-directory provider cannot accept directory authority', () => {
  assert.equal(refusal(request({ directory: entraRequest().directory })).code,
    'ENTRA_IDENTITY_CONTRACT_MISMATCH');
});

test('a declared signup origin cannot redirect a registered credential', () => {
  assert.equal(refusal(request({ signup_origin: 'https://example.com' })).code,
    'WELES_CREDENTIAL_ORIGIN_MISMATCH');
});

test('the response boundary does not turn an uncertain provider effect into no effect', () => {
  const body = entraRequest();
  const answer = credentialResponse({
    status: 'operation_failed', operation: body.operation, provider: body.provider,
    vaultItemId: body.credential_id, providerEffect: 'maybe',
  }, body);
  assert.equal(answer.providerEffect, 'unknown');
});

test('the response boundary rejects a receipt for another principal', () => {
  const body = entraRequest();
  const receipt = {
    tenant_id: body.directory.tenant_id,
    principal_object_id: body.directory.principal_object_id,
    account_upn: body.directory.account_upn,
    operation: body.operation, request_id: body.request_id,
    evidence_digest: createHash('sha256').update('local parser boundary').digest('hex'),
    execution_host: 'parser-test', changed_at: null,
    verified_at: new Date().toISOString(), action_log_id: 'parser-boundary',
  };
  const response = { status: 'operation_completed', operation: body.operation,
    provider: body.provider, vaultItemId: body.credential_id, receipt };
  assert.equal(credentialResponse(response, body).receipt.principal_object_id,
    body.directory.principal_object_id);
  receipt.principal_object_id = randomUUID();
  assert.throws(() => credentialResponse(response, body));
});

test('a paused response without a resumable approval is refused', () => {
  const body = entraRequest();
  assert.throws(() => credentialResponse({
    status: 'needs_human_approval', operation: body.operation, provider: body.provider,
    vaultItemId: body.credential_id,
  }, body));
});
