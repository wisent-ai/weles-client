// Refusing an input by name before it reaches the wire.
//
// Split out of a 604-line index.mjs. Each check states what it wanted, so a
// caller learns which field is wrong rather than that something is.

import {
  ASCII_WHITESPACE_OR_CONTROL,
  LOOPBACK_HOSTS,
  UUID_PATTERN,
} from "./safety.mjs";
import { WelesClientError } from "../error.mjs";

function secureBaseUrl(value) {
  let url;
  try {
    url = new URL(requireText(value, 'endpoint'));
  } catch {
    throw new WelesClientError('invalid-endpoint', 'endpoint must be an absolute URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname))) {
    throw new WelesClientError('insecure-endpoint', 'endpoint must use HTTPS or HTTP on a loopback host');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new WelesClientError('invalid-endpoint', 'endpoint must not contain credentials, query, or fragment');
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(requireText(value, 'origin'));
  } catch {
    throw new WelesClientError('invalid-origin', 'origin must be an absolute URL origin');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new WelesClientError('insecure-origin', 'origin must use HTTPS or HTTP on localhost');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new WelesClientError('invalid-origin', 'origin must not contain a path, credentials, query, or fragment');
  }
  return url.origin;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WelesClientError('invalid-input', `${name} must be an object`);
  }
  return value;
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WelesClientError('invalid-input', `${name} must be a non-empty string`);
  }
  return value;
}

function requireBearer(value) {
  if (typeof value !== 'string' || !value || ASCII_WHITESPACE_OR_CONTROL.test(value)) {
    throw new WelesClientError(
      'invalid-input',
      'bearer must be a non-empty token without ASCII whitespace or control characters',
    );
  }
  return value;
}

function requireUuid(value, name) {
  const normalized = requireText(value, name).trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new WelesClientError('invalid-input', `${name} must be a UUID`);
  }
  return normalized;
}

function requireTextArray(value, name) {
  if (!Array.isArray(value) || !value.length) {
    throw new WelesClientError('invalid-input', `${name} must be a non-empty string array`);
  }
  return value.map(item => requireText(item, name));
}

function requireOptionalTextArray(value, name) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new WelesClientError('invalid-input', `${name} must be a string array`);
  }
  return value.map(item => requireText(item, name));
}


export const WELES_CLIENT_FIRST_USE_PRODUCT_ID = 'weles-client';
export const WELES_CLIENT_FIRST_USE_JOURNEY_ID = 'first-use';
export const WELES_CLIENT_FIRST_USE_JOURNEY_VERSION = '2026-08-04.1';
export const WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID = '12000000-0000-4000-8000-000000000008';
export const WELES_CLIENT_FIRST_USE_SOURCE_REVISION = 'weles-client-first-use-2026-08-04';
export const WELES_CLIENT_FIRST_SUCCESS_FACT = 'workflow_receipt_verified';


export {
  normalizeOrigin,
  requireBearer,
  requireObject,
  requireOptionalTextArray,
  requireText,
  requireTextArray,
  requireUuid,
  secureBaseUrl,
};
