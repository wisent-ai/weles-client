# Examples — weles-client in practice

Executable examples, each runnable from a plain checkout with Node alone: no
deployment, no credential, no network beyond loopback. Every command sequence
below was executed as written; the printed output in
[quick-start](../quick-start.md) is from these runs.

## Index

1. [`make-synthetic-receipt.mjs`](make-synthetic-receipt.mjs) — generate an
   Ed25519 key pair and a locally signed `weles.receipt.current` document, so
   the verifier has something to accept and reject. A synthetic receipt proves
   nothing about a workflow; it exists to exercise `verifyReceipt` before your
   deployment issues real ones.

   ```sh
   node docs/examples/make-synthetic-receipt.mjs /tmp/weles-demo
   ```

2. [`verify-receipt-offline.mjs`](verify-receipt-offline.mjs) — verify a
   retained receipt against a caller-owned key map, offline. Prints the frozen
   claims on success; prints `{ verified: false, code, message, details }` and
   exits 1 on any refusal.

   ```sh
   node docs/examples/verify-receipt-offline.mjs /tmp/weles-demo/receipt.json /tmp/weles-demo/receipt-keys.json
   ```

3. [`submit-loopback-demo.mjs`](submit-loopback-demo.mjs) — the real
   `WelesClient` against a mock deployment on `127.0.0.1`: construct with
   allowlists and trusted keys, `submit`, `get` (which auto-verifies the
   response receipt), then three local refusals — `origin-denied`,
   `action-denied`, `plaintext-secret-denied` — captured before any request
   leaves the process.

   ```sh
   node docs/examples/submit-loopback-demo.mjs
   ```

## What these examples deliberately do not show

- No real deployment endpoint, organization ID, or bearer — those arrive with
  a provisioned deployment (README, "Access").
- No credential material anywhere: the client rejects secret-shaped input
  keys by name, and the examples send only opaque references.
- No trust decision: verification proves one trusted key signed exactly this
  payload and the displayed fields match it. Whether to rely on the claims —
  key rotation, freshness, evidence retention — stays with the caller
  ([verifier](../verifier.md)).
