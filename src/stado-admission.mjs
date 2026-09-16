import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const GROUP_WORLD_WRITE = 0o22;
const GROUP_WORLD_ACCESS = 0o77;
const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);

function stadoForwardsDirectory() {
  const configured = process.env.STADO_FORWARDS_DIR?.trim() ?? '';
  if (configured) return configured;
  const home = process.env.HOME?.trim() ?? '';
  if (!home) throw new Error('HOME is required to locate the Stado forwards directory');
  return join(home, '.stado', 'forwards');
}

function ownedFile(path, unsafeBits) {
  if (typeof process.getuid !== 'function') {
    throw new Error('a POSIX user id is required to validate the Stado file');
  }
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${path} does not exist`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${path} is not a regular file`);
  if (stats.uid !== process.getuid()) throw new Error(`${path} is not owned by this user`);
  if ((stats.mode & unsafeBits) !== 0) throw new Error(`${path} has unsafe permissions`);
  return readFileSync(path, 'utf8');
}

export function resolveWelesEndpoint() {
  const path = join(stadoForwardsDirectory(), 'weles-admission.local');
  const [first, ...rest] = ownedFile(path, GROUP_WORLD_WRITE).split('\n');
  if (rest.some((line) => line.trim().length > 0)) {
    throw new Error(`${path} must contain exactly one forward URL line`);
  }
  const value = first.trim();
  if (!value) throw new Error(`${path} contains no forward URL`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${path} does not contain an absolute URL`);
  }
  if (url.protocol !== 'https:'
      && !(url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname))) {
    throw new Error(`${path} must use HTTPS or HTTP on a loopback host`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${path} must not carry credentials, a query, or a fragment`);
  }
  return url.href;
}

export function readCredentialAdmissionBearer() {
  const configured = process.env.WELES_TOKEN?.trim();
  if (configured) return configured;
  const home = process.env.HOME?.trim();
  const path = process.env.WELES_TOKEN_FILE?.trim()
    || (home && join(home, '.stado', 'skarbiec-weles-credential-client-token'));
  if (!path) throw new Error('HOME or WELES_TOKEN_FILE is required for the credential admission bearer');
  const bearer = ownedFile(path, GROUP_WORLD_ACCESS).trim();
  if (!bearer || /\s/.test(bearer)) throw new Error(`${path} must contain one credential admission bearer`);
  return bearer;
}
