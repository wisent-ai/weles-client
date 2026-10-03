import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveWelesEndpoint } from '../../src/stado-admission.mjs';
import { evidenceFor, hash, privateFile, root } from './evidence.mjs';

const evidence = await evidenceFor();
const { report, command, request, save } = evidence;
const origins = { microsoft: 'https://account.live.com', microsoft_entra: 'https://login.microsoftonline.com' };
const bridges = { hosted: 'weles-skarbiec-acquire.mjs', admission: 'weles-skarbiec-acquire-admission.mjs' };
function wire(account, revision) {
  return {
    version: 'skarbiec.credential-operation.v3', request_id: randomBytes(32).toString('hex'),
    mode: 'submit', action_log_id: null, credential_id: account.item, operation: 'verify',
    provider: account.provider, consumer: `${account.item}-writer`, purpose: 'Qualify credential bridge identity binding',
    account_email: account.provider === 'microsoft' ? account.email : null,
    directory: account.provider === 'microsoft_entra' ? { provider: account.provider, ...account.directory } : null,
    approval_id: null, resume_token: null, baseline_revision: revision, field: 'password',
    status: 'pending', created_at: new Date().toISOString(), dry_run: false, signup_origin: null,
  };
}
try {
  const { values } = parseArgs({ options: { fixture: { type: 'string' }, 'admission-report': { type: 'string' } } });
  assert(values.fixture, '--fixture is required');
  const fixturePath = resolve(values.fixture);
  const build = await realpath(resolve(root, '.build'));
  assert((await realpath(fixturePath)).startsWith(build + sep), 'fixture must be inside this checkout’s ignored .build directory');
  const bytes = await privateFile(fixturePath);
  const fixture = JSON.parse(bytes.toString());
  assert.equal(fixture.dedicated, true, 'fixture must use dedicated provider accounts, vault and Stado-selected worker');
  assert.equal(fixture.vault_served_to_worker, true, 'the real fixture vault must be served to the worker’s Skarbiec authority');
  assert.equal(fixture.accounts.length, 2);
  assert.deepEqual(fixture.accounts.map(account => account.provider).sort(), ['microsoft', 'microsoft_entra']);
  assert.notEqual(fixture.accounts[0].item, fixture.accounts[1].item);
  assert.match(fixture.execution_host, /^[A-Za-z0-9._-]+$/);
  assert.match(fixture.worker_revision, /^[a-f0-9]{40}$/);
  assert(isAbsolute(fixture.skarbiec_binary));
  await privateFile(fixture.vault_file, false);
  const tokens = {};
  for (const name of ['hosted', 'admission', 'diagnostics']) {
    tokens[name] = (await privateFile(fixture[`${name}_bearer_file`])).toString().trim();
    assert(tokens[name] && !/\s/.test(tokens[name]), 'bearer file must hold exactly one token');
  }
  assert.equal(typeof fixture.organization_id, 'string');
  report.fixture = fixturePath;
  report.fixture_sha256 = hash(bytes);
  report.source_revision = await evidence.cleanRevision();
  report.skarbiec = { binary: fixture.skarbiec_binary, sha256: hash(await readFile(fixture.skarbiec_binary)),
    version: (await command(fixture.skarbiec_binary, ['--version'])).stdout };
  report.node = { path: process.execPath, version: process.version, sha256: hash(await readFile(process.execPath)) };
  const endpoint = resolveWelesEndpoint();
  const health = JSON.parse((await request(endpoint, '/healthz', tokens.diagnostics)).toString());
  assert.equal(health.sourceRevision, fixture.worker_revision);
  report.worker_revision = health.sourceRevision;
  if (values['admission-report']) {
    const previousPath = resolve(values['admission-report']);
    assert((await realpath(previousPath)).startsWith(build + sep));
    const previous = JSON.parse((await privateFile(previousPath)).toString());
    assert.equal(previous.status, 'awaiting_observation');
    for (const key of ['source_revision', 'fixture_sha256', 'worker_revision']) assert.equal(previous[key], report[key]);
    assert.equal(previous.skarbiec.sha256, report.skarbiec.sha256);
    assert.deepEqual(previous.node, report.node);
    report.cases = previous.cases;
    report.previous_report = previousPath;
  }
  let pending = false;
  for (const [mode, executable] of Object.entries(bridges)) {
    const bridge = resolve(root, 'bin', executable);
    const env = { ...process.env, SKARBIEC_VAULT_FILE: fixture.vault_file,
      SKARBIEC_WELES_CREDENTIAL_COMMAND: bridge, WELES_TOKEN: tokens[mode],
      WISENT_ORGANIZATION_ID: fixture.organization_id };
    const status = async item => JSON.parse((await command(fixture.skarbiec_binary,
      ['credential', 'status', item, '--local'], { env })).stdout);
    const invoke = async input => command(process.execPath, [bridge], { env, input, allowFailure: true });
    for (const account of fixture.accounts) {
      let recorded = report.cases.find(entry => entry.mode === mode && entry.item === account.item);
      if (recorded?.verified) continue;
      if (!recorded) {
        const before = await status(account.item);
        assert.equal(before.credential, account.item);
        assert.equal(before.lifecycle_state, 'managed');
        assert(!before.request_id || before.settled === true, 'never replace an unfinished operation');
        if (account.provider === 'microsoft_entra') {
          for (const key of ['tenant_id', 'principal_object_id', 'account_upn']) assert.equal(before.directory?.[key], account.directory[key]);
        }
        const inconsistent = wire(account, before.revision);
        inconsistent.directory = account.provider === 'microsoft_entra' ? null
          : { provider: 'microsoft_entra', ...fixture.accounts.find(entry => entry.provider === 'microsoft_entra').directory };
        const badDirectory = await invoke(inconsistent);
        assert.equal(badDirectory.code, 0);
        const directoryRefusal = JSON.parse(badDirectory.stdout);
        assert.equal(directoryRefusal.code, 'ENTRA_IDENTITY_CONTRACT_MISMATCH');
        assert.equal(directoryRefusal.providerEffect, 'none');
        if (account.provider === 'microsoft_entra') {
          const wrongField = await invoke({ ...wire(account, before.revision), field: 'api_key' });
          assert.equal(wrongField.code, 0);
          assert.equal(JSON.parse(wrongField.stdout).code, 'ENTRA_IDENTITY_CONTRACT_MISMATCH');
          assert.equal(JSON.parse(wrongField.stdout).providerEffect, 'none');
        }
        const wrongWriter = wire(account, before.revision);
        wrongWriter.consumer = `${account.item}-reader`;
        const denied = await invoke(wrongWriter);
        assert.equal(denied.code, 0);
        const writerRefusal = JSON.parse(denied.stdout);
        assert.equal(writerRefusal.code, 'WELES_CREDENTIAL_CONTRACT_MISMATCH');
        assert.equal(writerRefusal.providerEffect, 'none');
        assert(!writerRefusal.actionLogId);
        const unchanged = await status(account.item);
        assert.equal(unchanged.revision, before.revision);
        assert.equal(unchanged.request_id, before.request_id);
        recorded = { mode, item: account.item, provider: account.provider, before, refusals_verified: true };
        report.cases.push(recorded);
        await save();
        const identity = account.provider === 'microsoft_entra'
          ? ['--expect-tenant', account.directory.tenant_id, '--expect-object-id', account.directory.principal_object_id, '--expect-upn', account.directory.account_upn]
          : ['--account', account.email];
        recorded.admission = JSON.parse((await command(fixture.skarbiec_binary, ['credential', 'verify', account.item,
          '--local', '--provider', account.provider, '--consumer', `${account.item}-writer`,
          '--purpose', 'Qualify deployment-owned credential bridge', ...identity], { env })).stdout);
        await save();
        assert.equal(recorded.admission.ok, true);
        assert.equal(recorded.admission.credential, account.item);
        assert.match(recorded.admission.request_id, /^[a-f0-9]{64}$/);
      }
      const observed = await status(account.item);
      recorded.observed = observed;
      assert.equal(observed.request_id, recorded.admission.request_id);
      assert.equal(observed.credential, account.item);
      assert.equal(observed.operation, 'verify');
      if (observed.settled !== true) {
        report.status = 'awaiting_observation';
        report.error = { message: 'Continue this recorded operation with --admission-report; never resubmit it.' };
        process.exitCode = 1;
        pending = true;
        break;
      }
      assert.equal(observed.externally_verified, true);
      assert.equal(observed.lifecycle_state, 'managed');
      assert.equal(observed.weles.provider, account.provider);
      assert.equal(observed.weles.execution_host, fixture.execution_host);
      const runId = observed.weles.action_log_id;
      assert.match(runId, /^[A-Za-z0-9._-]+$/);
      const prefix = `/diagnostics/${encodeURIComponent(runId)}`;
      const inventory = JSON.parse((await request(endpoint, prefix, tokens.diagnostics)).toString());
      assert(inventory.files.some(file => /\.(?:png|jpe?g|webp)$/.test(file.path)), 'retain actual provider visual evidence');
      let capture;
      for (const file of inventory.files) {
        assert(file.download_url.startsWith(`${prefix}/file?path=`));
        const contents = await request(endpoint, file.download_url, tokens.diagnostics);
        if (/(^|\/)credential_capture\.json$/.test(file.path)) {
          assert.equal(capture, undefined, 'capture acknowledgement must be unambiguous');
          capture = JSON.parse(contents.toString());
        }
      }
      assert(capture, 'a process exit alone does not prove provider verification');
      assert.equal(capture.requestId, observed.request_id);
      assert.equal(capture.vaultItemId, account.item);
      assert.equal(capture.operation, 'verify');
      assert.equal(capture.field, 'password');
      assert.equal(capture.sourceOrigin, origins[account.provider]);
      if (account.provider === 'microsoft_entra') {
        for (const key of ['tenant_id', 'principal_object_id', 'account_upn']) assert.equal(observed.receipt?.[key], account.directory[key]);
        assert.equal(observed.receipt.request_id, observed.request_id);
      }
      const unrelated = { ...wire(account, recorded.before.revision), mode: 'status', action_log_id: runId };
      const mismatch = await invoke(unrelated);
      if (mode === 'hosted') {
        assert.notEqual(mismatch.code, 0, 'hosted task must reject another request identity');
        assert.match(mismatch.stderr, /Weles task status response provenance mismatch/);
      } else {
        assert.equal(mismatch.code, 0);
        assert.equal(JSON.parse(mismatch.stdout).code, 'WELES_CREDENTIAL_REQUEST_NOT_FOUND');
      }
      const persisted = await status(account.item);
      assert.equal(persisted.externally_verified, true);
      assert.equal(persisted.request_id, observed.request_id);
      assert.equal(persisted.revision, observed.revision);
      assert.deepEqual(persisted.receipt, observed.receipt);
      recorded.persisted = persisted;
      recorded.verified = true;
      await save();
    }
    if (pending) break;
  }
  assert.equal(hash(await readFile(fixture.skarbiec_binary)), report.skarbiec.sha256);
  assert.equal(await evidence.cleanRevision(), report.source_revision);
  if (!pending) {
    assert.equal(report.cases.length, 4);
    assert(report.cases.every(entry => entry.verified));
    report.status = 'passed';
  }
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  await save();
  console.log(resolve(evidence.directory, 'report.json'));
}
