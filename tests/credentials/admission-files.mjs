// Stado's forward file is read from a real directory under this checkout's
// ignored .build: a missing file is refused as missing, and a file this user
// cannot inspect is refused with the operating system's cause, not as missing.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { chmod, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWelesEndpoint } from '../../src/stado-admission.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const forwards = join(root, '.build', 'admission-files', 'forwards');
const file = join(forwards, 'weles-admission.local');
const original = process.env.STADO_FORWARDS_DIR;
const { mode } = await stat(root);
await rm(join(root, '.build', 'admission-files'), { recursive: true, force: true });
await mkdir(forwards, { recursive: true });
process.env.STADO_FORWARDS_DIR = forwards;
try {
  assert.throws(resolveWelesEndpoint, { message: `${file} does not exist` });

  // No read, write or search for anyone: lstat of a file inside must fail.
  await chmod(forwards, mode & ~(constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO));
  assert.throws(resolveWelesEndpoint, (error) => {
    assert.match(error.message, /cannot be inspected: EACCES/);
    assert.ok(error.message.startsWith(file), error.message);
    return true;
  });
  console.log('admission-files: missing and uninspectable forward files are refused with their cause');
} finally {
  await chmod(forwards, mode);
  await rm(join(root, '.build', 'admission-files'), { recursive: true, force: true });
  if (original === undefined) delete process.env.STADO_FORWARDS_DIR;
  else process.env.STADO_FORWARDS_DIR = original;
}
