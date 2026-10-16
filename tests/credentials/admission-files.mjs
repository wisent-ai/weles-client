// Stado's forward file is read from a real directory under this checkout's
// ignored .build: a missing file is refused as missing, and a file this user
// cannot inspect is refused with the operating system's cause, not as missing.
// The run is bound to the committed revision and kept as a report beside the
// other credential journeys (.build/credentials/<run>/report.json).
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { chmod, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveWelesEndpoint } from '../../src/stado-admission.mjs';
import { evidenceFor, root } from './evidence.mjs';

const evidence = await evidenceFor();
const { report } = evidence;
report.journey = 'admission-files';
report.revision = await evidence.cleanRevision();
const forwards = join(root, '.build', 'admission-files', 'forwards');
const file = join(forwards, 'weles-admission.local');
const original = process.env.STADO_FORWARDS_DIR;
const { mode } = await stat(root);

function refusal(name, check) {
  assert.throws(resolveWelesEndpoint, (error) => {
    report.cases.push({ name, refusal: error.message });
    check(error.message);
    return true;
  });
}

await rm(join(root, '.build', 'admission-files'), { recursive: true, force: true });
await mkdir(forwards, { recursive: true });
process.env.STADO_FORWARDS_DIR = forwards;
try {
  refusal('missing forward file', (message) => assert.equal(message, `${file} does not exist`));

  // No read, write or search for anyone: lstat of a file inside must fail.
  await chmod(forwards, mode & ~(constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO));
  refusal('uninspectable forward file', (message) => {
    assert.match(message, /cannot be inspected: EACCES/);
    assert.ok(message.startsWith(file), message);
  });
  report.status = 'passed';
  console.log(`admission-files: missing and uninspectable forward files are refused with their cause; report ${join(evidence.directory, 'report.json')}`);
} catch (error) {
  report.status = 'failed';
  report.failure = error.message;
  throw error;
} finally {
  report.finished_at = new Date().toISOString();
  await evidence.save();
  await chmod(forwards, mode);
  await rm(join(root, '.build', 'admission-files'), { recursive: true, force: true });
  if (original === undefined) delete process.env.STADO_FORWARDS_DIR;
  else process.env.STADO_FORWARDS_DIR = original;
}
