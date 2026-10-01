// What must never leave this client in a log or a report, and how much of a
// response it will read.
//
// Split out of a 604-line index.mjs. A secret in a diagnostic is the defect
// this file exists to prevent, so the patterns and the two functions that
// use them sit together.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { WelesClientError } from '../error.mjs';

const SENSITIVE_KEY = /password|secret|token|cookie|authorization|proxy.?auth/i;
// A resume token is the single-use continuation handle Weles issues for its own
// paused approval, not credential material, so it may travel back in task input.
// `redact` still matches it, so it never reaches a log or an error detail.
const RESUMPTION_KEY = /^resume_?token$/i;
const REDACTED = '[REDACTED]';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);
const CONTROLLED_HEADERS = new Set([
  "authorization",
  "x-wisent-organization-id",
  "content-type",
  "accept",
]);
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const ASCII_WHITESPACE_OR_CONTROL = /[\x00-\x20\x7f]/;

async function boundedResponseText(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new WelesClientError('response-too-large', 'Weles response exceeded the size limit');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new WelesClientError('response-too-large', 'Weles response exceeded the size limit');
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new WelesClientError('response-too-large', 'Weles response exceeded the size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// One GET whose response Weles holds until the answer exists, read under the
// same size limit. A blocking read is answered when the task ends, which can
// be hours later; the global fetch abandons headers after five minutes, so
// this read goes through node:http/node:https, which end the exchange only
// when the server or the connection does.
function heldGet(url, headers) {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = send(url, { method: 'GET', headers }, (incoming) => {
      const chunks = [];
      let received = 0;
      incoming.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          incoming.destroy();
          reject(new WelesClientError('response-too-large', 'Weles response exceeded the size limit'));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on('end', () => {
        resolve({ status: incoming.statusCode, text: Buffer.concat(chunks).toString('utf8') });
      });
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}


function redact(value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item)]));
  }
  return value;
}

function assertNoSensitiveFields(value, path = "value") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) && !RESUMPTION_KEY.test(key)) {
      throw new WelesClientError('plaintext-secret-denied', 'Send a credential reference instead of sensitive plaintext', { path: `${path}.${key}` });
    }
    assertNoSensitiveFields(item, `${path}.${key}`);
  }
}


export {
  ASCII_WHITESPACE_OR_CONTROL,
  CONTROLLED_HEADERS,
  LOOPBACK_HOSTS,
  MAX_RESPONSE_BYTES,
  REDACTED,
  RESUMPTION_KEY,
  SENSITIVE_KEY,
  UUID_PATTERN,
  boundedResponseText,
  heldGet,
};
export { assertNoSensitiveFields, redact };
