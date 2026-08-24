# Error reference

Every refusal in `weles-client` is a `WelesClientError` with three fields:
`code` (stable, machine-readable), `message` (one exact sentence), and
optional `details` (already passed through `redact`, so sensitive values
never appear in it). The client never logs and never retries; whatever it
cannot accept, it throws. This page lists every code thrown by
[`src/index.mjs`](../src/index.mjs), with the exact message and the condition
that triggers it, plus the two credential bridges' status vocabulary.

## Construction

| Code | Message | Condition |
|---|---|---|
| `invalid-input` | `options must be an object` | constructor called without an options object |
| `invalid-endpoint` | `endpoint must be an absolute URL` | `endpoint` does not parse as a URL |
| `insecure-endpoint` | `endpoint must use HTTPS or HTTP on a loopback host` | non-HTTPS endpoint whose host is not `127.0.0.1`, `localhost`, or `[::1]` |
| `invalid-endpoint` | `endpoint must not contain credentials, query, or fragment` | endpoint carries userinfo, `?`, or `#` |
| `invalid-input` | `bearer must be a non-empty string` | missing/blank `bearer` (same shape for `organizationId`) |
| `invalid-input` | `allowedOrigins must be a non-empty string array` | empty or missing origin allowlist (same for `allowedActions`) |
| `invalid-client` | `A Fetch-compatible implementation is required` | no global `fetch` and no `options.fetch` function |

The endpoint path is normalized to end with `/`, so request paths resolve
under it (`tasks` → `<endpoint>/tasks`).

## Submission (all thrown locally, before any request)

| Code | Message | Condition |
|---|---|---|
| `invalid-origin` | `origin must be an absolute URL origin` | origin does not parse |
| `insecure-origin` | `origin must use HTTPS or HTTP on localhost` | non-HTTPS origin whose host is not exactly `localhost` |
| `invalid-origin` | `origin must not contain a path, credentials, query, or fragment` | origin with any path (`pathname !== '/'`), userinfo, query, or fragment |
| `origin-denied` | `The workflow origin is not in the client allowlist` | normalized origin not in `allowedOrigins`; `details.origin` |
| `action-denied` | `The workflow action is not in the client allowlist` | action not in `allowedActions`; `details.action` |
| `plaintext-secret-denied` | `Send a credential reference instead of sensitive plaintext` | any `input` key (recursively) matching `/password|secret|token|cookie|authorization|proxy.?auth/i`; `details.path` names the offending key path. The single exemption is `/^resume_?token$/i` — Weles' own approval continuation handle |
| `invalid-input` | `justification must be a non-empty string` | missing justification on `submit` (same shape for `taskId` on `get`/`cancel`, `reason` on `cancel`, `idempotencyKey`, `credentialRefs` items) |

Captured live (loopback demo,
[examples](examples/submit-loopback-demo.mjs)):

```text
origin-denied: "The workflow origin is not in the client allowlist" {"origin":"https://other.example"}
action-denied: "The workflow action is not in the client allowlist" {"action":"other_action"}
plaintext-secret-denied: "Send a credential reference instead of sensitive plaintext" {"path":"input.password"}
```

## Transport and responses

| Code | Message | Condition |
|---|---|---|
| `transport-failed` | `The Weles request did not complete` | `fetch` rejected; `details` is the redacted error |
| `transport-failed` | `The Weles response body did not complete` | body read failed for a reason other than the size cap |
| `response-too-large` | `Weles response exceeded the size limit` | declared `content-length` over 1 MiB, or the streamed body crosses 1 MiB (the read is cancelled at that byte) |
| `invalid-response` | `Weles returned a non-JSON response` | body text does not parse as JSON; `details.status` |
| `request-rejected` | `Weles rejected the request` | non-2xx status; `details.status` plus the response body redacted key-by-key |
| `invalid-input` | `response must be an object` | 2xx body parsed to a non-object |

The client never retries `transport-failed` on its own; reconcile with the
service using the retained idempotency key.

## Receipt verification (`verifyReceipt`)

In check order — the first failure wins:

| Code | Message | Condition |
|---|---|---|
| `invalid-input` | `receipt must be an object` / `receipt.schema must be a non-empty string` / `receipt.keyId …` / `receipt.signature …` / `receipt.signedPayload …` | shape gates before any cryptography |
| `unsupported-receipt` | `The receipt schema is not supported` | `schema !== 'weles.receipt.current'`; `details.schema` |
| `unknown-receipt-key` | `No trusted public key matches the receipt key identifier` | `keyId` absent from the caller's key map; `details.keyId`. The receipt never supplies its own key |
| `invalid-receipt-signature` | `The receipt signature is invalid` | `crypto.verify` fails over the exact `signedPayload` bytes; `details.keyId` |
| `invalid-receipt-payload` | `The signed receipt payload is not JSON` | `signedPayload` does not parse |
| `receipt-claim-mismatch` | `A displayed receipt field differs from the signed claim` | any of `taskId`, `organizationId`, `origin`, `action`, `outcome`, `evidenceDigest` differs between the receipt document and the signed claims; `details.field` |

All six captured live against a synthetic receipt
([quick-start](quick-start.md)):

```text
unknown-receipt-key: "No trusted public key matches the receipt key identifier" {"keyId":"docs-demo-key"}
receipt-claim-mismatch: "A displayed receipt field differs from the signed claim" {"field":"outcome"}
invalid-receipt-signature: "The receipt signature is invalid" {"keyId":"docs-demo-key"}
unsupported-receipt: "The receipt schema is not supported" {"schema":"weles.receipt.v9"}
invalid-input: "receipt.signature must be a non-empty string"
```

## First-use verification (`verifyFirstReceipt`, `createWelesClientOnboarding`)

| Code | Message | Condition |
|---|---|---|
| `invalid-onboarding-runtime` | `The shared Echo JourneyClient constructor is required` / `A started shared Echo JourneyClient is required` | missing runtime pieces |
| `invalid-onboarding-transport` | `transport.<operation> must be a function` | transport lacks `readBundle`, `readState`, `collectEvent`, or `assignExperiment` |
| `onboarding-identity-mismatch` | `The onboarding request does not belong to Weles Client first use` | product/journey other than `weles-client` / `first-use` |
| `onboarding-bundle-mismatch` | `The Weles Client onboarding bundle is not the pinned canonical journey` | served bundle differs from the pinned version ID, source revision, canonical definition, or content SHA-256 |
| `invalid-receipt-payload` | `The signed receipt <field> claim is required` | a required signed claim (`subject`, `audience`, `product`, `evidenceDigest`, `taskId`, `outcome`, `keyId`) is missing or blank; `details.field` |
| `receipt-subject-mismatch` | `The signed receipt subject does not match the onboarding subject` | signed `subject` ≠ caller subject |
| `receipt-audience-mismatch` | `The signed receipt audience does not match the SDK audience` | signed `audience` ≠ caller audience |
| `receipt-product-mismatch` | `The signed receipt product is not Weles Client` | signed `product` ≠ `weles-client` |
| `onboarding-not-completed` | `The verified receipt did not satisfy the canonical first-success step` | the journey runtime did not accept the `workflow_receipt_verified` completion fact |

## Credential bridges (`bin/`)

The bridges do not use `WelesClientError`. They settle every request to one
line of JSON on stdout with a closed `status` set — `operation_plan`,
`operation_queued`, `operation_completed`, `needs_configuration`,
`needs_human_approval`, `unsupported_operation`, `unsupported_secret`,
`operation_failed` — and exit 0; a malformed request or a broken environment
is a thrown `Error` and exit 1. Highlights:

- **Unresolved endpoint** (`weles-skarbiec-acquire.mjs`): the admission
  endpoint resolves only from the Stado forward file
  `~/.stado/forwards/weles-admission.local` (directory override:
  `STADO_FORWARDS_DIR`). A missing, symlinked, group/world-writable,
  foreign-owned, multi-line, or non-loopback-plaintext forward settles as
  `needs_configuration` with `code: "WELES_ENDPOINT_UNRESOLVED"`, `phase:
  "admission"` — never an environment-variable fallback. Captured live with
  an empty forwards directory:

  ```json
  {"status":"needs_configuration","operation":"acquire","provider":"semantic_scholar","vaultItemId":"weles-semantic-scholar-api","message":"Weles admission endpoint is unresolved: <dir>/weles-admission.local does not exist","code":"WELES_ENDPOINT_UNRESOLVED","phase":"admission"}
  ```

- **Unknown contract**: a `credential_id`/`provider`/`consumer` triple with
  no exact bridge contract settles as `needs_configuration` with
  `No exact Weles credential contract for <credential_id>/<provider>/<consumer>`;
  an operation outside the contract's allowed set settles as
  `unsupported_operation`.
- **Request validation** (thrown, exit 1): `unsupported credential request
  version`, `invalid credential request id` (must be 64 hex), `invalid
  credential operation`, `invalid credential baseline revision`, `invalid
  credential request state` (`status` must be `pending`, `dry_run` boolean),
  `only resume mode may carry an approval`, `submit mode must not carry an
  action log id`, `status mode requires an exact action log id`, `resume mode
  requires an exact approval id and resume token`, `credential request
  contains unknown fields`, `credential request exceeded size limit` (64 KiB).
- **Response discipline**: `Weles credential-operation response identity
  mismatch`, `Weles task status response identity mismatch`, `Weles task
  status response provenance mismatch`, `Weles credential-operation receipt
  identity mismatch`, `Weles returned an unsupported task status` — a
  response that does not prove it is about this exact request is an error,
  not a result. An `operation_failed` without a well-formed provider effect
  reports `providerEffect: "unknown"`, which is never retried automatically.
- **Admission variant** (`weles-skarbiec-acquire-admission.mjs`): posts the
  same wire to `POST /v1/echo/secrets/acquire` on `WELES_ADMISSION_ORIGIN`
  (default `http://127.0.0.1:8794`; HTTPS anywhere, HTTP only on loopback);
  `WELES_TOKEN` is the optional bearer, `WELES_ADMISSION_TIMEOUT_MS` the
  request timeout (default 30000). `mode: "status"` settles immediately as
  `operation_queued` with `status settles through the Skarbiec vault
  lifecycle record` — the vault, not admission, is the status authority. A
  non-2xx admission answer settles as `needs_configuration` with `admission
  rejected the operation (HTTP <status>)`; an unknown settled status is the
  thrown `admission returned an unsupported credential-operation status`.

Both bridges accept no credential material on stdin and return none on
stdout; request buffers are zeroed after parsing (`bytes.fill(0)`).

Environment read by the bridges: `WELES_TOKEN` and `WISENT_ORGANIZATION_ID`
(required by `weles-skarbiec-acquire.mjs` before submitting), `HOME` /
`STADO_FORWARDS_DIR` (forward resolution), `WELES_ADMISSION_ORIGIN` /
`WELES_ADMISSION_TIMEOUT_MS` (admission variant only).
