# Weles Client

<!-- wisent-readme-signals:start -->
[![Release](https://img.shields.io/github/v/release/wisent-ai/weles-client?display_name=tag&sort=semver)](https://github.com/wisent-ai/weles-client/releases)
[![Downloads](https://img.shields.io/github/downloads/wisent-ai/weles-client/total)](https://github.com/wisent-ai/weles-client/releases)
[![License](https://img.shields.io/github/license/wisent-ai/weles-client)](https://github.com/wisent-ai/weles-client)
[![Discord](https://img.shields.io/badge/Discord-Join%20Wisent-5865F2?logo=discord&logoColor=white)](https://discord.gg/qRjpkthq54)
<!-- wisent-readme-signals:end -->

**Weles Client is a small public Node.js client and signed-receipt verifier for
submitting separately authorized browser workflows through exact origin, action,
credential-reference, justification, and idempotency boundaries.**

This repository is intentionally not the Weles executor. Fingerprint spoofing,
browser patches, provider rotation, anti-bot research, service-specific
trajectories, worker scheduling, operational recordings, and stealth
configuration remain private in the hosted Weles service.

## Install

The client is currently distributed from its public source repository:

```sh
git clone https://github.com/wisent-ai/weles-client
npm install --global ./weles-client
```

The installed package provides the JavaScript library and the
`weles-skarbiec-acquire` executable. Until an immutable package release is
published, pin the Git commit used by a deployment.

## Hosted service configuration

A Weles organization receives three non-interchangeable values from the hosted
service operator:

```sh
export WELES_URL=https://weles.wisent.com/api/v1/
export WISENT_ORGANIZATION_ID=<organization-uuid>
export WELES_TOKEN=<organization-scoped-token>
```

`WELES_URL` is the API base, not the dashboard origin. The token must belong to
the same organization ID and carry only the required task create, read, and
cancel scopes. The hosted API rejects an organization mismatch.

## Skarbiec credential lifecycle

Skarbiec invokes an absolute, owner-controlled regular file rather than an npm
shim. Point it at the executable inside the installed package:

```sh
export SKARBIEC_WELES_CREDENTIAL_COMMAND="$(npm root --global)/@wisent-ai/weles-client/bin/weles-skarbiec-acquire.mjs"

skarbiec credential rotate weles-microsoft-primary-password \
  --provider microsoft \
  --consumer weles-microsoft-primary-password-writer \
  --account owner@example.com \
  --purpose incident-remediation

skarbiec credential status weles-microsoft-primary-password
```

The bridge accepts only the fixed `skarbiec.credential-operation.v1` request.
`mode: submit` binds its request ID to the Weles idempotency key and submits the
allowlisted `skarbiec_credential_acquire` action; `mode: status` performs only a
GET for the exact returned action-log ID. Operations are explicit `acquire`,
`rotate`, `verify`, or `remove`. The bridge never accepts credential material
on stdin or returns credential or task payload material on stdout.

Before a real operation is queued, the Weles operator binds the organization to
the customer's HTTPS Skarbiec endpoint and installs only the exact writer grant
for each allowed item. The worker writes the credential directly to that tenant
binding. Skarbiec completes an operation only when the encrypted item carries
the matching request ID and operation—not merely because an item exists.
Microsoft bindings also require the tenant's
`acquisition-scopes.conf` to contain the exact row
`<item>-reader-password|<item>|password`; wildcards are rejected. The request's
item, provider, field, and writer consumer must match the fixed bridge contract.
The account metadata must bind the same `skarbiec_credential_id` and
`skarbiec_tenant_id`. Missing writer, reader, account, or tenant bindings return
`needs_configuration` before any provider action is queued.

Current contracts:

| Skarbiec item | Provider | Stored field | Operations |
| --- | --- | --- | --- |
| `weles-semantic-scholar-api` | Semantic Scholar | `api_key` | acquire |
| `weles-github-admin-org-token` | GitHub | `api_key` | acquire |
| `weles-supabase-personal-access-token` | Supabase | `api_key` | acquire |
| `weles-snapchat-snap-kit-api` | Snapchat | `api_key` | acquire |
| `weles-microsoft-<account-alias>-password` | Microsoft | `password` | rotate, verify |

Microsoft operations require `--account <email>`. Rotation authenticates the
current password, changes it at Microsoft, freshly authenticates the generated
replacement, and then commits it to Skarbiec. If the commit or fresh
authentication fails, the worker attempts a provider-side rollback and verifies
the previous password. MFA or passkey challenges stop as
`needs_human_approval`; no local write is made.

## Library usage

```js
import { randomBytes } from 'node:crypto';
import { WelesClient } from '@wisent-ai/weles-client';

const requestId = randomBytes(32).toString('hex');
const client = new WelesClient({
  endpoint: process.env.WELES_URL,
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

Current release status: public development source. The manifest has no version or
publish script until an immutable package release is approved. Source
availability does not promise a hosted Weles endpoint, approved trajectory,
target support, evidence retention, or SLA.

## Problem and intended users

A browser executor can cross high-risk trust boundaries: authenticated accounts,
personal data, terms-controlled sites, mutable pages, irreversible submissions,
and credentials. A caller needs an inspectable contract that refuses broad
origins/actions and plaintext secret-shaped fields, preserves idempotency, and
checks that displayed receipt claims match a trusted signature.

Weles Client serves:

- **application developers** submitting one organization-approved Weles action;
- **platform operators** maintaining exact origin/action allowlists, scoped
  service bearers, opaque credential references, and trusted receipt keys;
- **auditors and downstream systems** verifying the signed outcome and evidence
  digest before relying on a service response;
- **self-hosted or local developers** exercising the same client contract against
  an explicitly controlled localhost service.

## Product boundaries

### Included

- HTTPS endpoints, with plaintext HTTP allowed only for hostname `localhost`;
- non-empty exact origin and action allowlists;
- rejection of request input keys matching password, secret, token, cookie,
  authorization, or proxy-auth patterns;
- separate opaque `credentialRefs`;
- required human-readable submission justification and cancellation reason;
- caller-controlled or randomly generated idempotency keys;
- explicit submit, status-read, and cancel operations with no hidden retry;
- response-error redaction by sensitive key name;
- signature verification against a caller-owned key ID map;
- equality checks between displayed receipt fields and signed claims;
- stable `WelesClientError` codes and no library-owned logging.

### Explicit non-goals and limitations

- The client does not establish permission, ownership, acceptable use, legal
  basis, terms compliance, or provider approval for an origin or action.
- An allowlist is caller configuration, not proof that the Weles service has a
  reviewed trajectory or that the organization may run it.
- Sensitive-field rejection is based on **key names**, not semantic inspection of
  arbitrary string values. Callers must keep all credential material out of
  `input` even when a key has an innocuous name.
- `credentialRefs` are identifiers, not credentials. Their resolution and scope
  belong to the executor's secret boundary.
- Receipt verification proves that one trusted key signed the exact payload and
  displayed claims match it. It does not check key revocation, certificate
  chains, receipt freshness, evidence availability, target-side truth, or legal
  sufficiency.
- The current API exposes submit, exact task-status reads, and cancel; evidence
  download, key discovery, authentication enrollment, and policy administration
  are not included.
- Fingerprint behavior, browser patches, provider rotation, anti-bot research,
  service trajectories, scheduling, recordings, and stealth configuration remain
  private executor implementation and are not promised by this package.

### Supported environment and current capability

| Surface | Requirement | Current state |
|---|---|---|
| Client import | Node.js ESM with global Fetch and `node:crypto` | Implemented source export |
| Submit/status/cancel | authorized compatible Weles endpoint | Implemented |
| Receipt verification | trusted public key keyed by receipt `keyId` | Implemented |
| Automatic retry | — | Intentionally absent |
| Evidence retrieval | service API | Not exposed |
| Executor/browser | private operated service | Not in this repository |
| Hosted service/SLA | approved Weles subscription | Not promised by source |

## Core use cases

### Submit one approved workflow

- **Actor:** an application service with a scoped Weles bearer.
- **Initial state:** exact HTTPS endpoint, organization, origin, action, trusted
  receipt keys, non-secret input, credential references, and justification are
  explicit.
- **Outcome:** the client sends `weles.task.current` with an idempotency key and
  verifies any receipt returned in the response.
- **Boundary:** acceptance is not completion; the action still depends on
  executor policy, target state, authorization, and human approval where needed.

### Cancel an outstanding task

- **Actor:** the same authorized caller.
- **Initial state:** task ID, cancellation reason, and idempotency key are known.
- **Outcome:** the client submits one explicit cancellation request and verifies
  any returned receipt.
- **Boundary:** a cancellation request does not prove the executor stopped before
  an external side effect. Inspect the signed outcome and service evidence.

### Verify a retained receipt offline

- **Actor:** an auditor or downstream service.
- **Initial state:** receipt bytes and a trusted caller-controlled public-key map
  are available.
- **Outcome:** `verifyReceipt` rejects unsupported schema, unknown key, invalid
  signature, non-JSON payload, or a mismatch in task, organization, origin,
  action, outcome, or evidence digest.
- **Boundary:** the caller owns trusted-key distribution, rotation, revocation,
  retention, and the decision to rely on the claims.

## How Weles Client works

```text
application policy
  ├─ exact organization
  ├─ origin/action allowlists
  ├─ non-secret input + opaque credential refs
  ├─ justification
  └─ idempotency key
              │ HTTPS + bearer
              ▼
      separately operated Weles service
              │ response + optional signed receipt
              ▼
 trusted key map -> signature + displayed-claim verification -> caller decision
```

The caller owns authorization, allowlists, bearer custody, idempotency retention,
trusted keys, and reliance decisions. The Weles service owns trajectory approval,
execution, evidence generation, and service-side policy. The target site remains
a separate authority over its account, data, terms, and resulting side effects.

## Quick start

This safe path loads the public module and demonstrates a local validation
failure before any network request. It runs no browser and needs no Weles
credential.

### Prerequisites

- Git;
- a current Node.js release with ESM, global Fetch, and `node:crypto`.

```bash
git clone https://github.com/wisent-ai/weles-client.git
cd weles-client
node --input-type=module -e '
  import { assertNoSensitiveFields } from "./src/index.mjs";
  assertNoSensitiveFields({ report: "monthly" });
  console.log("non-secret input accepted");
'
```

Expected result: the process prints `non-secret input accepted` and makes no
network request. To integrate a real endpoint, obtain an organization-approved
origin/action contract, scoped bearer, and out-of-band trusted receipt key first.

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
  endpoint: process.env.WELES_URL,
  bearer: process.env.WELES_TOKEN,
  organizationId: process.env.WISENT_ORGANIZATION_ID,
  allowedOrigins: ["https://console.example.com"],
  allowedActions: ["export-approved-report"],
  receiptKeys: {
    "current-signing-key": process.env.WELES_RECEIPT_PUBLIC_KEY,
  },
});
```

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

The client sends:

- schema `weles.task.current`;
- `organizationId`, normalized origin, exact action, and non-secret input;
- opaque `credentialRefs` and evidence policy;
- human-readable justification;
- caller-controlled `Idempotency-Key` and bearer headers.

Signed receipt claims bind task, organization, origin, action, outcome, and
evidence digest. Consumers choose and rotate the trusted key set; an unknown key
fails closed.

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

Store the signed payload, signature, key ID, verified claims, and key-set version
together. Obtain keys through a separately authenticated channel; never accept a
verification key from the receipt it is supposed to verify.

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
- **Credentials:** service bearer stays in the calling backend; workflow input
  contains opaque references only.
- **Observability:** stable error code, HTTP status where available, redacted
  response details, service response, and verified receipt.
- **Recovery:** no hidden retry. On ambiguous transport failure, query service
  state through an approved channel using the original idempotency key.
- **Cost:** the open client is not metered. Managed browser execution, recordings,
  evidence retention, fleet operation, and support are separate service costs.

## Project status and support

- **Maturity:** public development source without a publishable manifest version.
- **Public contract:** safe task/cancellation request construction, local
  validation, redaction, and signed-receipt verification.
- **Private service:** browser execution, service-specific workflows, scheduling,
  evidence operation, stealth research, and support.
- **Issues:** [`wisent-ai/weles-client`](https://github.com/wisent-ai/weles-client/issues).
- **Security:** use [private GitHub Security Advisories](https://github.com/wisent-ai/weles-client/security/advisories/new); never attach bearers, private input, credential references, receipts containing customer metadata, target account data, or production endpoints to a public issue.
- **License:** Apache License 2.0; see [`LICENSE`](LICENSE).
