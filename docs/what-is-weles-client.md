# What is weles-client?

What do you install when you cannot install trust? `weles-client` is the
public, dependency-free client for authorized Weles workflows: it submits
tasks safely and verifies the signed receipts Weles returns, and on every
ambiguous condition it fails closed — a refusal is a thrown
`WelesClientError` with a stable `code`, never a warning or a silent
passthrough. The whole library is one ESM file
([`src/index.mjs`](../src/index.mjs)); the two Skarbiec credential bridges
live in [`bin/`](../bin) ([skarbiec-bridges](skarbiec-bridges.md)).

## What it is

- **A safe submission client.** `WelesClient` sends
  `weles.task.current` submissions and `weles.cancellation.current`
  cancellations, plus status reads, over HTTPS (HTTP only on a loopback
  host), with caller-declared allowlists for origins and actions, a
  mandatory `justification` on submit (`reason` on cancel), and idempotency
  keys on every mutation (`src/index.mjs`, `WelesClient`).
- **A receipt verifier.** `verifyReceipt(receipt, keys)` checks a
  `weles.receipt.current` document against a caller-owned key map, entirely
  offline, and returns the frozen signed claims ([verifier](verifier.md)).
- **A first-use gate.** `verifyFirstReceipt` and
  `createWelesClientOnboarding` bind onboarding completion to one real
  verified receipt with matching `subject`, `audience`, and `product`
  claims ([verifier](verifier.md#verifyfirstreceiptoptions)).

## What it is not

- **It does not issue receipts.** Receipts are signed by an operated Weles
  deployment; the client only verifies them against keys the caller already
  trusts. A receipt never supplies its own verification key
  (`verifyReceipt` resolves `keyId` only in the caller's map).
- **It does not hold credentials.** Task input travels as opaque
  `credentialRefs`; any secret-shaped `input` key is refused before the
  request leaves the process, and even the credential bridges accept no
  secret material on stdin and return none on stdout
  ([skarbiec-bridges](skarbiec-bridges.md)).
- **It does not decide trust.** Key distribution, rotation, revocation,
  freshness, and whether to rely on verified claims stay with the caller
  (README, "Explicit non-goals").
- **It does not log or retry.** Whatever the client cannot accept, it
  throws; error details pass through `redact` first (`src/index.mjs`,
  `redact`).

## The client-side refusals

Each of these fires locally, before any request leaves the process
(`src/index.mjs`; exact conditions in [errors](errors.md)):

| Code | Exact message |
|---|---|
| `insecure-endpoint` | `endpoint must use HTTPS or HTTP on a loopback host` |
| `invalid-endpoint` | `endpoint must be an absolute URL` / `endpoint must not contain credentials, query, or fragment` |
| `insecure-origin` | `origin must use HTTPS or HTTP on localhost` |
| `invalid-origin` | `origin must be an absolute URL origin` / `origin must not contain a path, credentials, query, or fragment` |
| `origin-denied` | `The workflow origin is not in the client allowlist` |
| `action-denied` | `The workflow action is not in the client allowlist` |
| `plaintext-secret-denied` | `Send a credential reference instead of sensitive plaintext` |
| `invalid-client` | `A Fetch-compatible implementation is required` |
| `invalid-input` | `<name> must be a non-empty string` and the other shape templates ([errors](errors.md#construction)) |

On the response side the same posture holds: `response-too-large` (`Weles
response exceeded the size limit`, hard 1 MiB cap), `invalid-response`
(`Weles returned a non-JSON response`), `request-rejected` (`Weles rejected
the request`), and the receipt refusals `unsupported-receipt`,
`unknown-receipt-key`, `invalid-receipt-signature`,
`invalid-receipt-payload`, `receipt-claim-mismatch`
([errors](errors.md#receipt-verification-verifyreceipt)).

## Where to go next

| Page | What it answers |
|---|---|
| [quick-start](quick-start.md) | Checkout to one verified receipt, offline |
| [verifier](verifier.md) | The complete `verifyReceipt` / `verifyFirstReceipt` contract |
| [errors](errors.md) | Every thrown code and byte-exact message |
| [skarbiec-bridges](skarbiec-bridges.md) | The two `bin/` credential bridges and their wire |
| [examples](examples/README.md) | Runnable scripts, loopback only |
