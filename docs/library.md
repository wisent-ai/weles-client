# Library usage

Companion to the [README](../README.md): the interfaces this package exports,
how a receipt is verified, and what errors and redaction guarantee.

## Library usage

```js
import { randomBytes } from 'node:crypto';
import { WelesClient } from '@wisent-ai/weles-client';

const requestId = randomBytes(32).toString('hex');
const client = new WelesClient({
  endpoint: process.env.WELES_API_BASE,
  bearer: process.env.WELES_TOKEN,
  organizationId: process.env.WISENT_ORGANIZATION_ID,
  allowedOrigins: ['https://www.semanticscholar.org'],
  allowedActions: ['skarbiec_credential_acquire'],
});

const accepted = await client.submit({
  origin: 'https://www.semanticscholar.org',
  action: 'skarbiec_credential_acquire',
  input: {
    requestId,
    credentialId: 'weles-semantic-scholar-api',
    provider: 'semantic_scholar',
    consumer: 'research-agent',
    purpose: 'literature-search',
    dryRun: false,
  },
  credentialRefs: [],
  evidencePolicy: 'action-log',
  justification: 'Acquire the allowlisted API key directly into the tenant Skarbiec.',
}, { idempotencyKey: requestId });

const current = await client.get(accepted.taskId);
```

A client call either returns the service response, including a verified receipt
when one is present, or throws `WelesClientError` with a stable error code. The
library never logs on its own.

### First-use onboarding adapter

`createWelesClientOnboarding` is the product adapter for the shared Echo
onboarding runtime. Pass its `JourneyClient` constructor, durable storage,
Stado transport, stable subject hash, receipt subject, and receipt audience.
The adapter pins the bundled `weles-client` / `first-use` definition and version,
and delegates progress, sticky assignment, and the durable event queue to that
runtime.

Only `verifyFirstReceipt` can provide the
`workflow_receipt_verified` completion fact. It first calls the public
`verifyReceipt` signature verifier, then requires the signed `subject`,
`audience`, and `product` claims to match the caller context and
`weles-client`. Parsing a receipt, accepting a workflow request, provisioning,
or observing private service state cannot complete onboarding.

It is intentionally not the Weles browser executor. The package helps a caller
form and verify the safe public contract; it does not grant target authorization,
approve a workflow, run a browser, or prove that an external site permits
automation.

[Quick start](#quick-start) · [Client API](#primary-interfaces) ·
[Receipt verification](#receipt-verification) ·
[Canonical repository](https://github.com/wisent-ai/weles-client)

Current release status: public development source at manifest version `0.2.0`.
No immutable package release or tag is promised until release approval. Source
availability does not promise a hosted Weles endpoint, approved trajectory,
target support, evidence retention, or SLA.

## Primary interfaces

```js
import {
  WelesClient,
  WelesClientError,
  assertNoSensitiveFields,
  redact,
  verifyReceipt,
} from "@wisent-ai/weles-client";
```

### Construct a client

```js
const client = new WelesClient({
  endpoint: process.env.WELES_API_BASE,
  bearer: process.env.WELES_TOKEN,
  organizationId: process.env.WISENT_ORGANIZATION_ID,
  allowedOrigins: ["https://console.example.com"],
  allowedActions: ["export-approved-report"],
  receiptKeys: {
    "current-signing-key": process.env.WELES_RECEIPT_PUBLIC_KEY,
  },
});
```

`organizationId` must be a hyphenated UUID. The constructor trims it and
normalizes hexadecimal letters to lowercase before sending the organization
header.

`bearer` must be a non-empty token with no ASCII whitespace or control
characters. The client sends it unchanged as exactly `Authorization: Bearer
<token>`.

Do not put the bearer or private signing key in frontend code. Trusted receipt
keys are public verification material and still require authenticated
distribution and rotation.

### Submit

```js
const accepted = await client.submit({
  origin: "https://console.example.com",
  action: "export-approved-report",
  input: { report: "monthly" },
  credentialRefs: ["customer-console-account"],
  evidencePolicy: "receipt",
  justification: "Export authorized by the account owner.",
}, {
  idempotencyKey: "caller-retained-operation-id",
  signal: abortController.signal,
});
```

Every submit, status read, and cancellation request carries exactly one
`Authorization: Bearer <token>` header and one
`X-Wisent-Organization-ID: <organization-uuid>` header. The client also controls
`Content-Type` and `Accept`; custom headers cannot replace any of these four.

The submission payload contains:

- schema `weles.task.current`;
- normalized origin, exact action, and non-secret input;
- opaque `credentialRefs` and evidence policy;
- human-readable justification.

The organization is selected only by the verified request header, never by the
task payload. The caller controls the `Idempotency-Key`.

Signed receipt claims bind task, organization, origin, action, outcome, and
evidence digest. Consumers choose and rotate the trusted key set; an unknown key
fails closed.

For receipts returned by client calls, signature verification is only the first
step. Every receipt must match the configured organization exactly; submit also
binds the submitted origin and action, while status reads and cancellation bind
the requested task ID. Any mismatch fails closed.

If no key is supplied, the client generates a UUID. Persist your own operation ID
when reconciliation across process restarts matters.

### Cancel

```js
const cancelled = await client.cancel(taskId, {
  reason: "The account owner withdrew approval.",
  idempotencyKey: "caller-retained-cancellation-id",
  signal: abortController.signal,
});
```

The cancellation payload contains only schema `weles.cancellation.current` and
the reason. Its organization context comes from the same verified header.

Transport ambiguity is returned as `transport-failed`; the library does not
retry. Reconcile with the service using an approved task-status channel before
submitting a new operation.

## Receipt verification

```js
const claims = verifyReceipt(receipt, {
  "current-signing-key": process.env.WELES_RECEIPT_PUBLIC_KEY,
});
```

The supported receipt schema is `weles.receipt.current`. Verification binds:

- `taskId`;
- `organizationId`;
- `origin`;
- `action`;
- `outcome`;
- `evidenceDigest`;
- trusted `keyId`.

Standalone `verifyReceipt` proves the signature and equality of displayed fields
with signed claims. It does not know a request context. `WelesClient` adds the
organization, origin/action, and task-ID bindings described above before
returning a response.

Store the signed payload, signature, key ID, verified claims, and key-set version
together. Obtain keys through a separately authenticated channel; never accept a
verification key from the receipt it is supposed to verify.

The complete fail-closed client, receipt-verification, credential-bridge, and
error contracts are published at [weles.wisent.com/docs](https://weles.wisent.com/docs#client-and-receipts).

## Errors and redaction

Every validation, transport, response, and receipt failure throws
`WelesClientError` with a stable `code`. Non-2xx bodies are recursively redacted
where object keys look sensitive. Redaction does not inspect free-form strings,
so callers must still treat all service errors as potentially sensitive and avoid
public logs.

The library never logs. Applications own correlation IDs, metrics, audit,
retention, and safe error presentation.

## Operational model

- **Configuration:** endpoint, bearer, organization ID, origin/action allowlists,
  trusted receipt keys, and optional Fetch implementation.
- **State:** no client database; callers retain idempotency keys, task IDs,
  receipts, trusted-key versions, and reconciliation state.
- **Credentials:** the service bearer and organization ID stay in the calling
  backend and travel in client-controlled headers; workflow input contains
  opaque references only.
- **Observability:** stable error code, HTTP status where available, redacted
  response details, service response, and verified receipt.
- **Recovery:** no hidden retry. On ambiguous transport failure, query service
  state through an approved channel using the original idempotency key.
- **Cost:** the open client is not metered. Managed browser execution, recordings,
  evidence retention, fleet operation, and support are separate service costs.

## Project status and support

- **Maturity:** manifest version `0.2.0` public development source; no immutable
  package release or tag is promised.
- **Public contract:** safe organization-authenticated task/cancellation request
  construction, local validation, redaction, and signed-receipt verification.
- **Private service:** browser execution, service-specific workflows, scheduling,
  evidence operation, stealth research, and support.
- **Issues:** [`wisent-ai/weles-client`](https://github.com/wisent-ai/weles-client/issues).
- **Security:** use [private GitHub Security Advisories](https://github.com/wisent-ai/weles-client/security/advisories/new); never attach bearers, private input, credential references, receipts containing customer metadata, target account data, or production endpoints to a public issue.
- **License:** Apache License 2.0; see [`LICENSE`](LICENSE).