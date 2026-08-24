#!/usr/bin/env node
// verify-receipt-offline.mjs — verify a retained Weles receipt against a
// caller-owned key map. No network, no Weles credential, no executor.
// Run: node docs/examples/verify-receipt-offline.mjs <receipt.json> <receipt-keys.json>
import { readFileSync } from 'node:fs';
import { verifyReceipt, WelesClientError } from '../../src/index.mjs';

const [receiptPath, keysPath] = process.argv.slice(2);
if (!receiptPath || !keysPath) {
  console.error('usage: verify-receipt-offline.mjs <receipt.json> <receipt-keys.json>');
  process.exit(2);
}

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const keys = JSON.parse(readFileSync(keysPath, 'utf8'));

try {
  // Every check is fail-closed: schema, key resolution, Ed25519 signature
  // over the exact signedPayload bytes, payload parse, and displayed-field
  // equality against the signed claims — in that order.
  const claims = verifyReceipt(receipt, keys);
  console.log(JSON.stringify({ verified: true, claims }, null, 2));
} catch (error) {
  if (error instanceof WelesClientError) {
    // `code` is the stable machine answer; `details` is already redacted.
    console.error(JSON.stringify({ verified: false, code: error.code, message: error.message, details: error.details ?? null }));
    process.exit(1);
  }
  throw error;
}
