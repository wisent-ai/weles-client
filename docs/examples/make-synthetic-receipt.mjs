#!/usr/bin/env node
// make-synthetic-receipt.mjs — generate a locally signed receipt to exercise
// the verifier without any deployment, credential, or network access.
//
// A synthetic receipt proves NOTHING about a workflow: it exists so you can
// see verifyReceipt succeed and fail before your deployment issues real ones.
// Run: node docs/examples/make-synthetic-receipt.mjs <output-dir>
import { generateKeyPairSync, sign, createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });

// 1. An Ed25519 key pair. In production the deployment holds the private
//    key; the caller receives only the public key, over a separately
//    authenticated channel.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(join(outDir, 'receipt-keys.json'), JSON.stringify({
  'docs-demo-key': publicKey.export({ type: 'spki', format: 'pem' }),
}, null, 2));

// 2. The six claims a workflow receipt binds together.
const evidence = JSON.stringify({ recordings: ['recordings/run-0001/'], result: { ok: true } });
const claims = {
  taskId: randomUUID(),
  organizationId: randomUUID(),
  origin: 'https://example.com',
  action: 'example_check',
  outcome: 'completed',
  evidenceDigest: createHash('sha256').update(evidence).digest('hex'),
};

// 3. The signature covers the exact JSON text of the claims — nothing else.
const signedPayload = JSON.stringify(claims);
const signature = sign(null, Buffer.from(signedPayload), privateKey).toString('base64');

// 4. The receipt: verification fields plus displayed copies of every claim.
const receipt = { schema: 'weles.receipt.current', keyId: 'docs-demo-key', signature, signedPayload, ...claims };
writeFileSync(join(outDir, 'receipt.json'), JSON.stringify(receipt, null, 2));

console.log(JSON.stringify({ wrote: ['receipt.json', 'receipt-keys.json'], dir: outDir, taskId: claims.taskId }, null, 2));
