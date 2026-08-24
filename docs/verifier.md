# Verifier

How does a caller decide whether to rely on a Weles response? By verifying,
not by trusting: `weles-client` checks a signed receipt against a key map the
caller owns, and every ambiguous condition in the client — an unknown key, an
oversized response, a suspicious input field — is an error, never a warning.
This page documents `verifyReceipt`, `verifyFirstReceipt`, and the client's
fail-closed behavior, all implemented in [`src/index.mjs`](../src/index.mjs).
The complete error-code catalog is [errors](errors.md); runnable
demonstrations are under [examples](examples/README.md).

## What a receipt is

A receipt (`schema: weles.receipt.current`) carries three verification
fields plus displayed copies of the six bound claims:

| Field | Meaning |
|---|---|
| `schema` | Exactly `weles.receipt.current`; anything else is refused |
| `keyId` | Names the trusted public key in the caller's key map |
| `signature` | Base64 signature over the `signedPayload` bytes |
| `signedPayload` | The exact JSON text of the signed claims |
| `taskId`, `organizationId`, `origin`, `action`, `outcome`, `evidenceDigest` | Displayed copies of the signed claims |

The signature covers `signedPayload` only; the displayed fields exist so a
human or a database can read the receipt without parsing the payload, and
verification proves they have not drifted from what was signed.
`evidenceDigest` commits the receipt to the run's retained evidence without
containing it. First-use receipts additionally carry signed `subject`,
`audience`, and `product` claims.

## `verifyReceipt(receipt, keys)`

`keys` is a caller-owned map (plain object or `Map`) of key ID to PEM public
key. The checks run in order — the first failure throws, and each failure has
one stable code:

| Step | Check | Failure code |
|---|---|---|
| 1 | Receipt is an object with non-empty `schema`, `keyId`, `signature`, `signedPayload` | `invalid-input` |
| 2 | `schema` is exactly `weles.receipt.current` | `unsupported-receipt` |
| 3 | `keyId` resolves in the caller's key map | `unknown-receipt-key` |
| 4 | Signature verifies over the exact `signedPayload` bytes (`node:crypto` `verify` with algorithm `null` — the key type, e.g. Ed25519, decides) | `invalid-receipt-signature` |
| 5 | `signedPayload` parses as a JSON object | `invalid-receipt-payload` |
| 6 | Every displayed field equals its signed claim (`taskId`, `organizationId`, `origin`, `action`, `outcome`, `evidenceDigest`) | `receipt-claim-mismatch` |

On success it returns the frozen signed claims plus the `keyId` that
verified them. Captured against a synthetic receipt
([quick-start](quick-start.md)):

```json
{
  "taskId": "0191e080-5bc7-4fb5-95d5-1b51028a629c",
  "organizationId": "c6f5d5e8-6e35-478a-a4f7-f7c9b1a68737",
  "origin": "https://example.com",
  "action": "example_check",
  "outcome": "completed",
  "evidenceDigest": "16198c79f4c65a8410a1eba8eee702a948f1161e1ebe114ce13fda98a2c27344",
  "keyId": "docs-demo-key"
}
```

A receipt never supplies its own verification key; key distribution,
rotation, revocation, freshness, evidence availability, and the decision to
rely on the claims remain with the caller (README, "Explicit non-goals").
Verification proves exactly one thing: a key you already trusted signed
exactly this payload, and the displayed fields match it.

Verification is not opt-in on the request path: `submit`, `get`, and `cancel`
each call `verifyReceipt` on any `receipt` present in the response before
returning it, so a response with a bad receipt throws instead of being
returned.

## `verifyFirstReceipt(options)`

The onboarding variant first runs the full `verifyReceipt`, then requires
three additional signed claims and compares them to the caller context:
`subject` must equal the onboarding subject (`receipt-subject-mismatch`),
`audience` must equal the SDK audience (`receipt-audience-mismatch`), and
`product` must be `weles-client` (`receipt-product-mismatch`). A missing
required claim is `invalid-receipt-payload` with the field named. Only this
function can provide the `workflow_receipt_verified` completion fact; the
completion evidence records the task ID, outcome, evidence digest, and
receipt key ID, and a runtime that does not accept the canonical
first-success step throws `onboarding-not-completed`.

`createWelesClientOnboarding(options)` wires that into the shared Echo
journey runtime, and pins the journey byte-for-byte: the transport wrapper
refuses any product/journey other than `weles-client`/`first-use`
(`onboarding-identity-mismatch`) and any served bundle whose version ID,
source revision, canonical definition, or content SHA-256 differs from the
bundled `WELES_CLIENT_FIRST_USE_FALLBACK` (`onboarding-bundle-mismatch`).
The journey is two screens — `receipt-contract` (explanation) and
`verify-receipt` (machine result) — and the second completes only through
`verifyFirstReceipt`.

## Fail-closed behavior

Every gate in the client resolves ambiguity by refusing:

- **Endpoint.** The base URL must be absolute HTTPS, or HTTP only on a
  loopback host (`127.0.0.1`, `localhost`, `[::1]`), with no embedded
  credentials, query, or fragment — otherwise `invalid-endpoint` /
  `insecure-endpoint` at construction, before any request.
- **Origin and action.** `allowedOrigins` and `allowedActions` must be
  non-empty at construction; every submitted origin is normalized (HTTPS or
  localhost HTTP, no path/query/fragment/credentials) and must be in the
  allowlist exactly (`origin-denied`, `action-denied`, `invalid-origin`,
  `insecure-origin`).
- **Secret-shaped input.** Any `input` key matching password, secret, token,
  cookie, authorization, or proxy-auth patterns throws
  `plaintext-secret-denied`. The single exception is the `resume_token` /
  `resumeToken` approval continuation handle — and even it is still matched
  by `redact`, so it never reaches an error detail or log. The check is by
  key name, not value inspection; keeping credential material out of
  innocently named fields remains the caller's job.
- **Transport.** A request that does not complete is `transport-failed`, and
  the client never retries on its own; reconcile with the service using the
  retained idempotency key. Response bodies are read through a hard 1 MiB
  cap — a larger declared or streamed body is `response-too-large`, read
  cancelled.
- **Responses.** Non-JSON is `invalid-response`; a non-2xx status is
  `request-rejected` with the body recursively redacted by sensitive key
  name before it appears in error details.
- **Receipts.** An unknown `keyId` fails closed (`unknown-receipt-key`);
  there is no unverified-receipt passthrough.
- **No library logging.** The client throws; it never logs, so nothing
  sensitive leaks on a path the caller did not choose.

The `weles-skarbiec-acquire` bridge extends the same posture to credential
operations: it accepts only the fixed `skarbiec.credential-operation.v3`
request, resolves the admission endpoint only from the Stado forward
directory (a missing, symlinked, loosened, or foreign-owned forward file is
an explicit `needs_configuration` with `code: WELES_ENDPOINT_UNRESOLVED`,
never an environment-variable fallback), zeroes request buffers after
parsing, and emits only sanitized, shape-checked diagnostics — an
`operation_failed` without a well-formed provider effect is reported as
`providerEffect: unknown`, which is never retried automatically. The full
bridge contract is in the [README](../README.md); its status vocabulary and
exact strings are in [errors](errors.md#credential-bridges-bin).

## Verifying a retained receipt offline

```js
import { verifyReceipt } from '@wisent-ai/weles-client';

const claims = verifyReceipt(JSON.parse(receiptText), {
  'current-signing-key': trustedPem,
});
// claims.taskId, claims.origin, claims.action, claims.outcome,
// claims.evidenceDigest, claims.keyId
```

No network, no Weles credential, no executor: the receipt bytes and a trusted
key map are sufficient. Store the signed payload, signature, key ID, verified
claims, and key-set version together (README, "Receipt verification").
[`examples/verify-receipt-offline.mjs`](examples/verify-receipt-offline.mjs)
is this loop as a runnable script, and
[quick-start](quick-start.md) shows its captured accept and refuse outputs.
