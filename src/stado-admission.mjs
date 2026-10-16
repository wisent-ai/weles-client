import { lstatSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

// Permission bits that let a group or other user write the file, and that let
// them reach it at all.
const GROUP_WORLD_WRITE = 0o22; // https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/sys_stat.h.html
const GROUP_WORLD_ACCESS = 0o77; // https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/sys_stat.h.html

/**
 * Whether `url` names this machine: `localhost`, or an address that belongs to
 * one of its internal (loopback) interfaces, as the operating system reports them.
 */
function isLoopback(url) {
  if (url.hostname === 'localhost') return true;
  const host = url.hostname.replace(/^\[(.*)\]$/u, '$1');
  return Object.values(networkInterfaces())
    .flat()
    .some((entry) => entry?.internal && entry.address === host);
}

function stadoForwardsDirectory() {
  const configured = process.env.STADO_FORWARDS_DIR?.trim();
  if (configured) return configured;
  const home = process.env.HOME?.trim();
  if (!home) throw new Error('HOME is required to locate the Stado forwards directory (or set STADO_FORWARDS_DIR)');
  return join(home, '.stado', 'forwards');
}

function ownedFile(path, unsafeBits) {
  if (typeof process.getuid !== 'function') {
    throw new Error('a POSIX user id is required to validate the Stado file');
  }
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${path} does not exist`);
    throw new Error(`${path} cannot be inspected: ${error.message}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${path} is not a regular file`);
  if (stats.uid !== process.getuid()) throw new Error(`${path} is not owned by this user`);
  if (stats.mode & unsafeBits) throw new Error(`${path} has unsafe permissions (mode ${stats.mode.toString(8)})`);
  return readFileSync(path, 'utf8');
}

export function resolveWelesEndpoint() {
  const path = join(stadoForwardsDirectory(), 'weles-admission.local');
  const [first, ...rest] = ownedFile(path, GROUP_WORLD_WRITE).split('\n');
  if (rest.some((line) => line.trim())) {
    throw new Error(`${path} must contain exactly one forward URL line`);
  }
  const value = first.trim();
  if (!value) throw new Error(`${path} contains no forward URL`);
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${path} does not contain an absolute URL: ${error.message}`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url))) {
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
  const declared = process.env.WELES_TOKEN_FILE?.trim();
  const home = process.env.HOME?.trim();
  if (!declared && !home) throw new Error('HOME or WELES_TOKEN_FILE is required for the credential admission bearer');
  const path = declared ? declared : join(home, '.stado', 'skarbiec-weles-credential-client-token');
  const bearer = ownedFile(path, GROUP_WORLD_ACCESS).trim();
  if (!bearer || /\s/.test(bearer)) throw new Error(`${path} must contain one credential admission bearer`);
  return bearer;
}
