// The names this package promises, and nothing else.
//
// index.mjs was 604 lines: the client, the redaction rules, the input checks,
// the receipt verification and the first-use journey in one file. They are
// five files under src/client/ now, and this is the surface, so every caller
// and every bin script keeps importing the same names from the same place.

export { WelesClientError } from "./client/error.mjs";
export {
  WELES_CLIENT_FIRST_SUCCESS_FACT,
  WELES_CLIENT_FIRST_USE_JOURNEY_ID,
  WELES_CLIENT_FIRST_USE_JOURNEY_VERSION,
  WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID,
  WELES_CLIENT_FIRST_USE_PRODUCT_ID,
  WELES_CLIENT_FIRST_USE_SOURCE_REVISION,
} from "./client/identity.mjs";
export { WelesClient } from "./client/client.mjs";
export { assertNoSensitiveFields, redact } from "./client/input/safety.mjs";
export { verifyFirstReceipt, verifyReceipt } from "./client/receipt.mjs";
export {
  WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION,
  WELES_CLIENT_FIRST_USE_DEFINITION,
  createWelesClientOnboarding,
} from "./client/onboarding.mjs";
