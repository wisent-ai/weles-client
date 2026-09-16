// What this client is, in the identifiers the first-use journey and the
// receipt check both name.
//
// Split out of a 604-line index.mjs, and on its own because the journey
// declares these and the receipt check verifies them, so neither has to
// import the other.

const WELES_CLIENT_FIRST_USE_PRODUCT_ID = 'weles-client';
const WELES_CLIENT_FIRST_USE_JOURNEY_ID = 'first-use';
const WELES_CLIENT_FIRST_USE_JOURNEY_VERSION = '2026-08-04.1';
const WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID = '12000000-0000-4000-8000-000000000008';
const WELES_CLIENT_FIRST_USE_SOURCE_REVISION = 'weles-client-first-use-2026-08-04';
const WELES_CLIENT_FIRST_SUCCESS_FACT = 'workflow_receipt_verified';

export {
  WELES_CLIENT_FIRST_SUCCESS_FACT,
  WELES_CLIENT_FIRST_USE_JOURNEY_ID,
  WELES_CLIENT_FIRST_USE_JOURNEY_VERSION,
  WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID,
  WELES_CLIENT_FIRST_USE_PRODUCT_ID,
  WELES_CLIENT_FIRST_USE_SOURCE_REVISION,
};
