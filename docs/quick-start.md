# Quick start

How do you go from a checkout to one verified receipt? Entirely offline: the
verifier needs receipt bytes and a trusted key map, nothing else
([what-is-weles-client](what-is-weles-client.md) explains why that is the
whole trust model). Every command below was executed as written (Node v22,
macOS); the output blocks are pasted from those runs.

## Get the client

```sh
git clone https://github.com/wisent-ai/weles-client.git
cd weles-client
node --version   # any Node with node:crypto Ed25519 support (v18+)
```

There is nothing to build and nothing to install: the package is
dependency-free ESM (`src/index.mjs`), and the test suite runs with
`npm test` (`node --test`).

## Verify your first receipt

A real receipt comes from an operated deployment's terminal task response.
To see the verifier work before you have one, generate a synthetic,
locally signed receipt — it proves nothing about any workflow, but it is
byte-for-byte the same shape:

```sh
node docs/examples/make-synthetic-receipt.mjs /tmp/weles-demo
node docs/examples/verify-receipt-offline.mjs /tmp/weles-demo/receipt.json /tmp/weles-demo/receipt-keys.json
```

Captured output:

```json
{
  "verified": true,
  "claims": {
    "taskId": "0191e080-5bc7-4fb5-95d5-1b51028a629c",
    "organizationId": "c6f5d5e8-6e35-478a-a4f7-f7c9b1a68737",
    "origin": "https://example.com",
    "action": "example_check",
    "outcome": "completed",
    "evidenceDigest": "16198c79f4c65a8410a1eba8eee702a948f1161e1ebe114ce13fda98a2c27344",
    "keyId": "docs-demo-key"
  }
}
```

Verification is offline and fail-closed. Flip the receipt's `keyId` to a name
your key map does not carry and the same command refuses (captured, exit 1):

```json
{"verified":false,"code":"unknown-receipt-key","message":"No trusted public key matches the receipt key identifier","details":{"keyId":"rotated-away"}}
```

Every refusal is a `WelesClientError` with a stable `code`; the complete
catalog is in [errors](errors.md).

## Exercise the client contract on loopback

The submission path needs a deployment; its client-side contract does not.
`submit-loopback-demo.mjs` runs the real `WelesClient` against a mock
deployment on `127.0.0.1` (HTTP is accepted only because the host is
loopback):

```sh
node docs/examples/submit-loopback-demo.mjs
```

Captured output:

```text
submitted: a93d46f4-3d55-4d52-99fc-952c5ede55ae queued
finished: completed — receipt signed by docs-demo-key
refused (origin outside the allowlist): origin-denied
refused (action outside the allowlist): action-denied
refused (secret-shaped input key): plaintext-secret-denied
```

Note what happened without any flag: `get` verified the response receipt
before returning it, and the three refusals fired locally, before any request
left the process.

## Point it at a real deployment

An approved deployment provides an endpoint, an organization ID, and an
organization-scoped token (README, "Access"). The constructor refuses
anything but HTTPS (or HTTP on a loopback host), and refuses empty
allowlists:

```js
import { WelesClient } from '@wisent-ai/weles-client';

const client = new WelesClient({
  endpoint: process.env.WELES_API_BASE,
  bearer: process.env.WELES_TOKEN,
  organizationId: process.env.WISENT_ORGANIZATION_ID,
  allowedOrigins: ['https://example.com'],   // exact origins only
  allowedActions: ['example_check'],         // exact actions only
  receiptKeys: { 'current-signing-key': trustedPem },
});
```

Trusted receipt keys must arrive through a separately authenticated channel —
a receipt never supplies its own verification key. What `verifyReceipt`
checks, in what order, and what it deliberately does not check, is in
[verifier](verifier.md).
