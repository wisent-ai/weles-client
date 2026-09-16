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
const ENTRA_TENANT_ID = '23572277-0021-42ac-b2b9-10bd86c7d2af';
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
  'weles-microsoft-jakub-wisent-ai-password': Object.freeze({ provider: 'microsoft_entra', secret: 'weles-microsoft-jakub-wisent-ai-password', origin: ENTRA_ORIGIN, field: 'password', consumer: 'weles-microsoft-jakub-wisent-ai-password-writer', operations: ENTRA_OPERATIONS, accountUpn: 'jakub@wisent.ai', tenantId: ENTRA_TENANT_ID, principalObjectId: '4c888895-03cf-4ab1-a11e-46942c568217' }),
  'weles-microsoft-lukasz-wisent-com-password': Object.freeze({ provider: 'microsoft_entra', secret: 'weles-microsoft-lukasz-wisent-com-password', origin: ENTRA_ORIGIN, field: 'password', consumer: 'weles-microsoft-lukasz-wisent-com-password-writer', operations: ENTRA_OPERATIONS, accountUpn: 'lukasz@wisent.com', tenantId: ENTRA_TENANT_ID, principalObjectId: '1f636f97-b07f-4e9b-952a-5d069ccc5b20' }),
});
const MICROSOFT_CREDENTIAL_ID = /^weles-microsoft-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?-password$/;

export function contractFor(request) {
  const exact = CONTRACTS[request.credential_id];
  if (exact) return exact;
  if (request.provider === 'microsoft' && MICROSOFT_CREDENTIAL_ID.test(request.credential_id)) {
    return Object.freeze({
      provider: 'microsoft',
      secret: request.credential_id,
      origin: 'https://account.live.com',
      field: 'password',
      consumer: `${request.credential_id}-writer`,
      operations: MICROSOFT_OPERATIONS,
    });
  }
  return null;
}
