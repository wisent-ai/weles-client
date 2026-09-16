import {
  ZERO, SIXTY_FOUR, ONE_TWENTY_EIGHT, TWO_HUNDRED, TWO_FIFTY_FOUR,
  MAX_REQUEST_BYTES, REQUEST_VERSION, EMAIL, UUID, DIRECTORY_KEYS,
  OPERATIONS, BRIDGE_MODES,
} from './contract.mjs';

export function emailText(value, maximum) {
  return typeof value === 'string' && value.length <= maximum && EMAIL.test(value);
}

export function lowercaseUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

export function exactName(value, maximum) {
  return typeof value === 'string'
    && value.length > ZERO
    && value.length <= maximum
    && /^[A-Za-z\d._-]+$/.test(value);
}

function directoryBlock(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === DIRECTORY_KEYS.length
    && DIRECTORY_KEYS.every((key) => Object.hasOwn(value, key))
    && exactName(value.provider, ONE_TWENTY_EIGHT)
    && lowercaseUuid(value.tenant_id)
    && lowercaseUuid(value.principal_object_id)
    && emailText(value.account_upn, TWO_FIFTY_FOUR);
}

export function sameDirectory(value, directory) {
  return Boolean(directory)
    && Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === DIRECTORY_KEYS.length
    && DIRECTORY_KEYS.every((key) => value[key] === directory[key]);
}

export async function readRequest(stream = process.stdin) {
  const chunks = [];
  let received = ZERO;
  for await (const chunk of stream) {
    received += chunk.length;
    if (received > MAX_REQUEST_BYTES) throw new Error('credential request exceeded size limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  try {
    const request = JSON.parse(bytes.toString('utf8'));
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('credential request must be an object');
    }
    return request;
  } finally {
    bytes.fill(ZERO);
    for (const chunk of chunks) chunk.fill(ZERO);
  }
}

export function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('credential request must be an object');
  }
  const allowed = new Set([
    'version', 'request_id', 'mode', 'action_log_id', 'credential_id',
    'operation', 'provider', 'consumer', 'purpose', 'account_email',
    'directory', 'approval_id', 'resume_token', 'baseline_revision',
    'field', 'status', 'created_at', 'dry_run', 'signup_origin',
  ]);
  if (Object.keys(request).some((key) => !allowed.has(key))) {
    throw new Error('credential request contains unknown fields');
  }
  if (request.version !== REQUEST_VERSION) throw new Error('unsupported credential request version');
  if (typeof request.request_id !== 'string'
      || request.request_id.length !== SIXTY_FOUR
      || /[^a-fA-F\d]/.test(request.request_id)) {
    throw new Error('invalid credential request id');
  }
  if (!exactName(request.credential_id, TWO_HUNDRED)) throw new Error('invalid credential item id');
  if (!exactName(request.provider, ONE_TWENTY_EIGHT)) throw new Error('invalid credential provider');
  if (!exactName(request.field, ONE_TWENTY_EIGHT)) throw new Error('invalid credential field');
  if (!exactName(request.consumer, TWO_HUNDRED)) throw new Error('invalid credential consumer');
  if (!OPERATIONS.includes(request.operation)) throw new Error('invalid credential operation');
  if (request.account_email !== null && !emailText(request.account_email, TWO_FIFTY_FOUR)) {
    throw new Error('invalid credential account email');
  }
  if (request.directory !== null && !directoryBlock(request.directory)) {
    throw new Error('invalid credential directory block');
  }
  if (request.signup_origin !== null && request.signup_origin !== undefined) {
    let origin;
    try { origin = new URL(request.signup_origin); } catch {
      throw new Error('invalid credential signup origin');
    }
    if (origin.protocol !== 'https:' || origin.origin !== request.signup_origin) {
      throw new Error('invalid credential signup origin');
    }
  }
  if (!Number.isSafeInteger(request.baseline_revision) || request.baseline_revision < ZERO) {
    throw new Error('invalid credential baseline revision');
  }
  if (typeof request.purpose !== 'string'
      || request.purpose.length === ZERO
      || Buffer.byteLength(request.purpose, 'utf8') > TWO_HUNDRED
      || Array.from(request.purpose).some((character) => /\p{Cc}/u.test(character))) {
    throw new Error('invalid credential purpose');
  }
  if (request.status !== 'pending' || (request.dry_run !== true && request.dry_run !== false)) {
    throw new Error('invalid credential request state');
  }
  if (!BRIDGE_MODES.includes(request.mode)) throw new Error('invalid credential bridge mode');
  if (request.mode !== 'resume' && (request.approval_id !== null || request.resume_token !== null)) {
    throw new Error('only resume mode may carry an approval');
  }
  if (request.mode === 'submit' && request.action_log_id !== null) {
    throw new Error('submit mode must not carry an action log id');
  }
  if (request.mode === 'status' && !exactName(request.action_log_id, TWO_HUNDRED)) {
    throw new Error('status mode requires an exact action log id');
  }
  if (request.mode === 'resume'
      && (!exactName(request.approval_id, SIXTY_FOUR) || !exactName(request.resume_token, ONE_TWENTY_EIGHT))) {
    throw new Error('resume mode requires an exact approval id and resume token');
  }
  if (request.mode === 'resume' && request.action_log_id !== null
      && !exactName(request.action_log_id, TWO_HUNDRED)) {
    throw new Error('resume mode carries either no action log id or an exact one');
  }
  if (request.mode === 'resume' && request.dry_run) throw new Error('resume mode must not be a dry run');
}
