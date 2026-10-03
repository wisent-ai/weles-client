export const ZERO = 0;
export const SIXTY_FOUR = 64;
export const ONE_TWENTY_EIGHT = 128;
export const TWO_HUNDRED = 200;
export const TWO_FIFTY_FOUR = 254;
export const FIVE_TWELVE = 512;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const ACTION = 'skarbiec_credential_acquire';
export const REQUEST_VERSION = 'skarbiec.credential-operation.v3';
export const ACQUIRE_ONLY = Object.freeze(['acquire']);
export const MICROSOFT_OPERATIONS = Object.freeze(['rotate', 'verify']);
export const ENTRA_OPERATIONS = Object.freeze(['adopt', 'rotate', 'reset', 'verify']);
export const ENTRA_ORIGIN = 'https://login.microsoftonline.com';
export const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const DIAGNOSTIC_CODE = /^[A-Z][A-Z\d_]{0,63}$/;
export const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
export const EVIDENCE_DIGEST = /^[a-fA-F\d]{64}$/;
export const DIAGNOSTIC_PHASES = Object.freeze([
  'admission', 'placement', 'credential_read', 'entra_sign_in',
  'identity_verification', 'password_change', 'fresh_login_verification',
  'skarbiec_stage', 'skarbiec_commit', 'rollback',
]);
export const ROLLBACK_STATUSES = Object.freeze(['none', 'completed', 'failed', 'unknown']);
export const PROVIDER_EFFECTS = Object.freeze(['none', 'changed', 'unknown']);
export const TERMINAL_FAILURE_STATUSES = Object.freeze(['operation_failed']);
export const OPERATIONS = Object.freeze(['acquire', 'adopt', 'rotate', 'reset', 'verify', 'remove']);
export const BRIDGE_MODES = Object.freeze(['submit', 'status', 'resume']);
export const DIRECTORY_KEYS = Object.freeze(['provider', 'tenant_id', 'principal_object_id', 'account_upn']);
export const ENTRA_TASK_ACTIONS = Object.freeze({
  adopt: Object.freeze(['microsoft_entra_adopt_password']),
  verify: Object.freeze(['microsoft_entra_verify_password']),
  rotate: Object.freeze(['microsoft_entra_reset_password']),
  reset: Object.freeze(['microsoft_entra_reset_password']),
});
export const NO_TASK_ACTIONS = Object.freeze([]);
const CONTRACTS = Object.freeze({
  'weles-semantic-scholar-api': Object.freeze({ provider: 'semantic_scholar', secret: 'semantic_scholar.api_key', origin: 'https://www.semanticscholar.org', field: 'api_key', consumer: 'weles-semantic-scholar-api-writer', operations: ACQUIRE_ONLY }),
  'weles-github-admin-org-token': Object.freeze({ provider: 'github', secret: 'github.admin_org_token', origin: 'https://github.com', field: 'api_key', consumer: 'weles-github-admin-org-token-writer', operations: ACQUIRE_ONLY }),
  'weles-supabase-personal-access-token': Object.freeze({ provider: 'supabase', secret: 'supabase.personal_access_token', origin: 'https://supabase.com', field: 'api_key', consumer: 'weles-supabase-personal-access-token-writer', operations: ACQUIRE_ONLY }),
  'weles-snapchat-snap-kit-api': Object.freeze({ provider: 'snapchat', secret: 'snapchat.snap_kit_api_token', origin: 'https://kit.snapchat.com', field: 'api_key', consumer: 'weles-snapchat-snap-kit-api-writer', operations: ACQUIRE_ONLY }),
});
const MANAGED_CREDENTIAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function contractFor(request) {
  const exact = Object.hasOwn(CONTRACTS, request.credential_id) ? CONTRACTS[request.credential_id] : null;
  if (exact) return exact;
  if ((request.provider === 'microsoft' || request.provider === 'microsoft_entra')
      && MANAGED_CREDENTIAL_ID.test(request.credential_id)) {
    return Object.freeze({
      provider: request.provider,
      secret: request.credential_id,
      origin: request.provider === 'microsoft_entra' ? ENTRA_ORIGIN : 'https://account.live.com',
      field: 'password',
      consumer: `${request.credential_id}-writer`,
      operations: request.provider === 'microsoft_entra' ? ENTRA_OPERATIONS : MICROSOFT_OPERATIONS,
    });
  }
  return null;
}
