// Stado's forward file is read from a real directory under this checkout's
// ignored .build: a missing file is refused as missing, and a file this user
// cannot inspect is refused with the operating system's cause, not as missing.
// The run is bound to the committed revision and kept as a report beside the
// other credential journeys (.build/credentials/<run>/report.json). A defect
// register that measures a repair by this journey names the defect and its
// criterion in WELES_CLIENT_TEST_DEFECT and WELES_CLIENT_TEST_CRITERION; a
// passing run then also writes criterion.json beside the report: the defect,
// the criterion, the revision, the result, the digests of the Node binary and
// of this test, every command with its exit and the refusals it observed.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWelesEndpoint } from '../../src/stado-admission.mjs';
import { evidenceFor, hash, root } from './evidence.mjs';

const defectId = process.env.WELES_CLIENT_TEST_DEFECT?.trim();
const criterion = process.env.WELES_CLIENT_TEST_CRITERION?.trim();
assert.equal(Boolean(defectId), Boolean(criterion),
  'WELES_CLIENT_TEST_DEFECT and WELES_CLIENT_TEST_CRITERION are named together or not at all');
const evidence = await evidenceFor();
const { report } = evidence;
report.journey = 'admission-files';
report.revision = await evidence.cleanRevision();

async function writeCriterionReport() {
  const path = join(evidence.directory, 'criterion.json');
  await writeFile(path, `${JSON.stringify({
    defectId,
    criterion,
    sourceRevision: report.revision,
    result: report.status,
    binarySha256: hash(await readFile(process.execPath)),
    testSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    observedFinalState: { refusals: report.cases },
    commands: report.commands.map(({ binary, args, code }) => ({ executable: binary, args, exit: code })),
  }, null, '  ')}\n`, { mode: constants.S_IRUSR | constants.S_IWUSR });
  return path;
}
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
  if (defectId) console.log(`admission-files: criterion report ${await writeCriterionReport()}`);
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
