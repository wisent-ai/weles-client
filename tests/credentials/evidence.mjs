import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function privateFile(path, contents = true) {
  assert(isAbsolute(path), 'fixture paths must be absolute');
  const metadata = await lstat(path);
  assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.uid === process.getuid()
    && (metadata.mode & 0o077) === 0, 'fixture inputs must be owned regular owner-only files');
  return contents ? readFile(path) : undefined;
}
export async function evidenceFor() {
  const directory = resolve(root, '.build/credentials', randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = { status: 'running', started_at: new Date().toISOString(), commands: [], requests: [], cases: [] };
  const save = async () => writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  async function command(binary, args, { env = process.env, input, allowFailure = false } = {}) {
    const entry = { binary, args, input, started_at: new Date().toISOString() };
    report.commands.push(entry);
    await save();
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn(binary, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout = [], stderr = [];
      child.stdout.on('data', bytes => stdout.push(bytes));
      child.stderr.on('data', bytes => stderr.push(bytes));
      child.on('error', reject);
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
      child.on('close', (code, signal) => resolveResult({ code, signal,
        stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
      child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
    });
    Object.assign(entry, result, { finished_at: new Date().toISOString() });
    await save();
    if (!allowFailure) assert.equal(result.code, 0, `${binary} failed: ${result.stderr}`);
    return result;
  }
  async function request(endpoint, path, bearer) {
    const url = new URL(path, endpoint);
    assert.equal(url.origin, new URL(endpoint).origin, 'diagnostic downloads must remain on the selected endpoint');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` }, redirect: 'error' });
    const bytes = Buffer.from(await response.arrayBuffer());
    const file = `response-${report.requests.length}.bin`;
    await writeFile(resolve(directory, file), bytes, { mode: 0o600 });
    report.requests.push({ path, status: response.status, file, sha256: hash(bytes) });
    await save();
    assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`);
    return bytes;
  }
  async function cleanRevision() {
    const head = (await command('git', ['rev-parse', 'HEAD'])).stdout.trim();
    assert.equal((await command('git', ['diff', 'HEAD', '--', '.'])).stdout, '', 'qualification requires committed source');
    assert.equal((await command('git', ['ls-files', '--others', '--exclude-standard'])).stdout, '', 'qualification requires tracked source');
    return head;
  }
  return { report, directory, save, command, request, cleanRevision };
}
