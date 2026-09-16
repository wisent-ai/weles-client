import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bridge = 'bin/weles-skarbiec-acquire-admission.mjs';
const sources = [
  bridge, 'package.json', 'src/stado-admission.mjs',
  'src/credential/contract.mjs', 'src/credential/input.mjs',
  'src/credential/diagnostics.mjs', 'src/credential/response.mjs',
];

test('status without a declared authority refuses instead of inventing a queued operation', () => {
  const build = join(root, '.wisent-output', 'credential-bridge-tests');
  mkdirSync(build, { recursive: true });
  const evidence = mkdtempSync(join(build, 'missing-forward-'));
  const requestId = createHash('sha256').update(evidence).digest('hex');
  const request = {
    version: 'skarbiec.credential-operation.v3', request_id: requestId,
    mode: 'status', action_log_id: `credential-${requestId}`,
    credential_id: 'winston', operation: 'acquire', provider: 'winston',
    consumer: 'winston-writer', purpose: 'Verify missing credential admission configuration',
    account_email: null, signup_origin: 'https://dev.gowinston.ai', directory: null,
    baseline_revision: 0, field: 'api_key', status: 'pending',
    created_at: new Date().toISOString(), dry_run: false,
    approval_id: null, resume_token: null,
  };
  const argv = [join(root, bridge)];
  const result = spawnSync(process.execPath, argv, {
    cwd: root,
    input: JSON.stringify(request),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: evidence, STADO_FORWARDS_DIR: join(evidence, 'forwards') },
  });
  writeFileSync(join(evidence, 'request.json'), JSON.stringify(request, null, 2));
  writeFileSync(join(evidence, 'stdout.txt'), result.stdout);
  writeFileSync(join(evidence, 'stderr.txt'), result.stderr);
  writeFileSync(join(evidence, 'manifest.json'), JSON.stringify({
    revision: process.env.WISENT_SOURCE_COMMIT
      || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sources: Object.fromEntries(sources.map((path) => [path,
      createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])),
    executable: process.execPath, argv, exit_status: result.status, signal: result.signal,
    claim: 'Missing-endpoint refusal only; no provider acquisition was exercised.',
  }, null, 2));
  console.log(`Credential refusal evidence: ${evidence}`);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(readFileSync(join(evidence, 'stdout.txt'), 'utf8'));
  assert.equal(response.status, 'needs_configuration');
  assert.equal(response.code, 'WELES_ENDPOINT_UNRESOLVED');
  assert.equal(response.providerEffect, 'none');
  assert.equal(response.actionLogId, request.action_log_id);
});
