// A Microsoft and a Microsoft Entra verify request through both installed
// credential adapters, bin/weles-skarbiec-acquire.mjs and
// bin/weles-skarbiec-acquire-admission.mjs, with a Stado forwards directory of
// this run's own that holds no Weles admission forward. Each adapter must
// admit the request, read its contract and answer one JSON status on stdout
// with exit 0: needs_configuration at the admission phase, naming the missing
// forward, with no provider effect. A crash, a usage refusal or any other
// status fails the run. Nothing reaches a provider or Weles.
//
// The run's report is .build/credentials/<run>/report.json. A defect register
// that measures a repair by this journey names the defect and its criterion in
// WELES_CLIENT_TEST_DEFECT and WELES_CLIENT_TEST_CRITERION; a passing run then
// also writes criterion.json beside the report.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REQUEST_VERSION, ZERO } from '../../src/credential/contract.mjs';
import { evidenceFor, hash, root } from './evidence.mjs';

const defectId = process.env.WELES_CLIENT_TEST_DEFECT?.trim();
const criterion = process.env.WELES_CLIENT_TEST_CRITERION?.trim();
assert.equal(Boolean(defectId), Boolean(criterion),
  'WELES_CLIENT_TEST_DEFECT and WELES_CLIENT_TEST_CRITERION are named together or not at all');
const evidence = await evidenceFor();
const { report } = evidence;
report.journey = 'microsoft-request';
report.revision = await evidence.cleanRevision();

const forwards = join(root, '.build', 'microsoft-request', 'forwards');
const missingForward = join(forwards, 'weles-admission.local');
const accounts = [
  { provider: 'microsoft', item: 'microsoft-journey-account', email: 'journey@example.invalid', directory: null },
  {
    provider: 'microsoft_entra',
    item: 'entra-journey-account',
    email: null,
    directory: {
      provider: 'microsoft_entra',
      tenant_id: randomUUID(),
      principal_object_id: randomUUID(),
      account_upn: 'journey@example.invalid',
    },
  },
];
const adapters = ['weles-skarbiec-acquire.mjs', 'weles-skarbiec-acquire-admission.mjs'];

function verifyRequest(account) {
  return {
    version: REQUEST_VERSION,
    // The request id is a SHA-256 hex digest, as Skarbiec writes it.
    request_id: hash(randomUUID()),
    mode: 'submit',
    action_log_id: null,
    credential_id: account.item,
    operation: 'verify',
    provider: account.provider,
    consumer: `${account.item}-writer`,
    purpose: 'Check that a Microsoft request is admitted and answered',
    account_email: account.email,
    directory: account.directory,
    approval_id: null,
    resume_token: null,
    baseline_revision: ZERO,
    field: 'password',
    status: 'pending',
    created_at: new Date().toISOString(),
    dry_run: true,
    signup_origin: null,
  };
}

async function writeCriterionReport() {
  const path = join(evidence.directory, 'criterion.json');
  await writeFile(path, `${JSON.stringify({
    defectId,
    criterion,
    sourceRevision: report.revision,
    result: report.status,
    binarySha256: hash(await readFile(process.execPath)),
    testSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    observedFinalState: { answers: report.cases },
    commands: report.commands.map(({ binary, args, code }) => ({ executable: binary, args, exit: code })),
  }, null, '  ')}\n`, { mode: constants.S_IRUSR | constants.S_IWUSR });
  return path;
}

await rm(join(root, '.build', 'microsoft-request'), { recursive: true, force: true });
await mkdir(forwards, { recursive: true });
const env = { PATH: process.env.PATH, HOME: process.env.HOME, STADO_FORWARDS_DIR: forwards };
try {
  for (const adapter of adapters) {
    for (const account of accounts) {
      const { stdout } = await evidence.command(process.execPath, [join(root, 'bin', adapter)], {
        env,
        input: verifyRequest(account),
      });
      const answer = JSON.parse(stdout);
      report.cases.push({ adapter, provider: account.provider, answer });
      assert.equal(answer.status, 'needs_configuration', stdout);
      assert.equal(answer.provider, account.provider);
      assert.equal(answer.vaultItemId, account.item);
      assert.equal(answer.phase, 'admission');
      assert.equal(answer.providerEffect, 'none');
      assert.equal(answer.code, 'WELES_ENDPOINT_UNRESOLVED');
      assert.ok(answer.message.includes(`${missingForward} does not exist`), answer.message);
    }
  }
  report.status = 'passed';
  console.log(`microsoft-request: both adapters answer Microsoft and Entra requests; report ${join(evidence.directory, 'report.json')}`);
  if (defectId) console.log(`microsoft-request: criterion report ${await writeCriterionReport()}`);
} catch (error) {
  report.status = 'failed';
  report.failure = error.message;
  throw error;
} finally {
  report.finished_at = new Date().toISOString();
  await evidence.save();
  await rm(join(root, '.build', 'microsoft-request'), { recursive: true, force: true });
}
