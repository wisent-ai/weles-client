#!/usr/bin/env node
// submit-loopback-demo.mjs — the real WelesClient against a mock deployment
// on 127.0.0.1, end to end: submit → get → automatic receipt verification.
//
// The mock stands in for an operated deployment so the CLIENT-side contract
// is observable without credentials: HTTP is accepted only because the host
// is loopback, and the receipt the mock signs verifies against the same
// key map the client holds. Nothing here talks to a real Weles.
// Run: node docs/examples/submit-loopback-demo.mjs
import { createServer } from 'node:http';
import { generateKeyPairSync, sign, createHash, randomUUID } from 'node:crypto';
import { WelesClient, WelesClientError } from '../../src/index.mjs';

// --- Mock deployment: one signing key, POST /v1/tasks, GET /v1/tasks/:id ---
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const receiptKeys = { 'docs-demo-key': publicKey.export({ type: 'spki', format: 'pem' }) };
const tasks = new Map();
const organizationId = randomUUID();
const receiptFor = (task) => {
  const claims = {
    taskId: task.taskId, organizationId: task.organizationId, origin: task.origin,
    action: task.action, outcome: 'completed',
    evidenceDigest: createHash('sha256').update(JSON.stringify({ ok: true })).digest('hex'),
  };
  const signedPayload = JSON.stringify(claims);
  return { schema: 'weles.receipt.current', keyId: 'docs-demo-key',
           signature: sign(null, Buffer.from(signedPayload), privateKey).toString('base64'),
           signedPayload, ...claims };
};
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer docs-demo-org-token'
        || req.headers['x-wisent-organization-id'] !== organizationId) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'bearer and organization header must match' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/tasks') {
      const request = JSON.parse(body);
      const task = { schema: 'weles.task-status.current', taskId: randomUUID(), status: 'queued',
                     organizationId: req.headers['x-wisent-organization-id'],
                     origin: request.origin, action: request.action };
      tasks.set(task.taskId, task);
      res.end(JSON.stringify(task));
      return;
    }
    const match = req.url.match(/^\/v1\/tasks\/([0-9a-f-]+)$/);
    if (req.method === 'GET' && match) {
      const task = { ...tasks.get(match[1]), status: 'completed', outcome: 'completed' };
      res.end(JSON.stringify({ ...task, receipt: receiptFor(task) }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

// --- Caller side: allowlists, opaque credential refs, trusted keys ---
const client = new WelesClient({
  endpoint: `http://127.0.0.1:${server.address().port}/v1/`,
  bearer: 'docs-demo-org-token',
  organizationId,
  allowedOrigins: ['https://example.com'],
  allowedActions: ['example_check'],
  receiptKeys,
});

const submitted = await client.submit({
  origin: 'https://example.com',
  action: 'example_check',
  input: { query: 'docs demo' },
  credentialRefs: [],
  justification: 'Documentation walkthrough: exercise the client contract end to end',
});
console.log('submitted:', submitted.taskId, submitted.status);

// get() verifies any receipt in the response before returning it.
const finished = await client.get(submitted.taskId);
console.log('finished:', finished.status, '— receipt signed by', finished.receipt.keyId);

// The same client refuses, locally, before any request leaves the process:
const refusals = [
  ['origin outside the allowlist', () => client.submit({ origin: 'https://other.example', action: 'example_check', justification: 'x' })],
  ['action outside the allowlist', () => client.submit({ origin: 'https://example.com', action: 'other_action', justification: 'x' })],
  ['secret-shaped input key', () => client.submit({ origin: 'https://example.com', action: 'example_check', justification: 'x', input: { password: 'nope' } })],
];
for (const [label, attempt] of refusals) {
  try { await attempt(); } catch (error) {
    if (!(error instanceof WelesClientError)) throw error;
    console.log(`refused (${label}): ${error.code}`);
  }
}
server.close();
