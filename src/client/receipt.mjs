// Checking that a receipt was signed by a key the caller trusts, and that a
// first receipt says what the first-use journey promised.
//
// Split out of a 604-line index.mjs.

import { createHash, verify as verifySignature } from "node:crypto";

import { WelesClientError } from "./error.mjs";
import {
  WELES_CLIENT_FIRST_SUCCESS_FACT,
  WELES_CLIENT_FIRST_USE_JOURNEY_ID,
  WELES_CLIENT_FIRST_USE_JOURNEY_VERSION,
  WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID,
  WELES_CLIENT_FIRST_USE_PRODUCT_ID,
  WELES_CLIENT_FIRST_USE_SOURCE_REVISION,
} from "./identity.mjs";
import { requireObject, requireText } from "./input/validate.mjs";

function verifyReceipt(receipt, keys) {
  requireObject(receipt, 'receipt');
  const schema = requireText(receipt.schema, 'receipt.schema');
  if (schema !== 'weles.receipt.current') {
    throw new WelesClientError('unsupported-receipt', 'The receipt schema is not supported', { schema });
  }
  const keyId = requireText(receipt.keyId, 'receipt.keyId');
  const signature = requireText(receipt.signature, 'receipt.signature');
  const signedPayload = requireText(receipt.signedPayload, 'receipt.signedPayload');
  const keyMap = keys instanceof Map ? keys : new Map(Object.entries(keys ?? {}));
  const publicKey = keyMap.get(keyId);
  if (!publicKey) {
    throw new WelesClientError('unknown-receipt-key', 'No trusted public key matches the receipt key identifier', { keyId });
  }
  const valid = verifySignature(null, Buffer.from(signedPayload), publicKey, Buffer.from(signature, 'base64'));
  if (!valid) {
    throw new WelesClientError('invalid-receipt-signature', 'The receipt signature is invalid', { keyId });
  }
  let claims;
  try {
    claims = JSON.parse(signedPayload);
  } catch {
    throw new WelesClientError('invalid-receipt-payload', 'The signed receipt payload is not JSON');
  }
  requireObject(claims, 'receipt claims');
  for (const field of ['taskId', 'organizationId', 'origin', 'action', 'outcome', 'evidenceDigest']) {
    if (receipt[field] !== claims[field]) {
      throw new WelesClientError('receipt-claim-mismatch', 'A displayed receipt field differs from the signed claim', { field });
    }
  }
  return Object.freeze({ ...claims, keyId });
}


function requiredReceiptClaim(claims, field) {
  const value = claims[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new WelesClientError('invalid-receipt-payload', `The signed receipt ${field} claim is required`, { field });
  }
  return value;
}

async function verifyFirstReceipt(options) {
  requireObject(options, 'options');
  if (!options.client || typeof options.client.complete !== 'function') {
    throw new WelesClientError('invalid-onboarding-runtime', 'A started shared Echo JourneyClient is required');
  }
  const subject = requireText(options.subject, 'subject');
  const audience = requireText(options.audience, 'audience');
  const claims = verifyReceipt(options.receipt, options.keys);
  const receiptSubject = requiredReceiptClaim(claims, 'subject');
  const receiptAudience = requiredReceiptClaim(claims, 'audience');
  const receiptProduct = requiredReceiptClaim(claims, 'product');
  if (receiptSubject !== subject) {
    throw new WelesClientError('receipt-subject-mismatch', 'The signed receipt subject does not match the onboarding subject');
  }
  if (receiptAudience !== audience) {
    throw new WelesClientError('receipt-audience-mismatch', 'The signed receipt audience does not match the SDK audience');
  }
  if (receiptProduct !== WELES_CLIENT_FIRST_USE_PRODUCT_ID) {
    throw new WelesClientError('receipt-product-mismatch', 'The signed receipt product is not Weles Client');
  }
  const evidenceDigest = requiredReceiptClaim(claims, 'evidenceDigest');
  const taskId = requiredReceiptClaim(claims, 'taskId');
  const outcome = requiredReceiptClaim(claims, 'outcome');
  const completed = await options.client.complete(
    { [WELES_CLIENT_FIRST_SUCCESS_FACT]: true },
    `receipt:${createHash('sha256').update(evidenceDigest).digest('hex')}`,
    {
      first_success_fact: WELES_CLIENT_FIRST_SUCCESS_FACT,
      task_id: taskId,
      outcome,
      evidence_digest: evidenceDigest,
      receipt_key_id: requiredReceiptClaim(claims, 'keyId'),
      receipt_audience: receiptAudience,
      receipt_product: receiptProduct,
    },
  );
  if (completed !== true) {
    throw new WelesClientError('onboarding-not-completed', 'The verified receipt did not satisfy the canonical first-success step');
  }
  return Object.freeze({
    fact: WELES_CLIENT_FIRST_SUCCESS_FACT,
    evidence: Object.freeze({ [WELES_CLIENT_FIRST_SUCCESS_FACT]: true }),
    claims,
  });
}
export { verifyFirstReceipt, verifyReceipt };
