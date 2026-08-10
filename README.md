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

A Weles organization receives two non-interchangeable values from the hosted
service operator:

```sh
export WISENT_ORGANIZATION_ID=<organization-uuid>
export WELES_TOKEN=<organization-scoped-token>
```

The token must belong to the same organization ID and carry only the required
task create, read, and cancel scopes. The hosted API rejects an organization
mismatch.

The admission endpoint is no longer an environment variable. `WELES_URL` is
removed: the `weles-skarbiec-acquire` bridge resolves the API base only from the
Stado forward directory, so a compromised or careless environment cannot point a
credential operation at another host. The bridge is invoked on the Weles host
itself, so this forward is a loopback path; the only remote hop in a credential
operation is the caller's jump to the canonical Skarbiec service.

```sh
cat ~/.stado/forwards/weles-admission.local
http://127.0.0.1:17614
```

| Element | Value |
| --- | --- |
| Directory | `STADO_FORWARDS_DIR`, default `${HOME}/.stado/forwards` |
| Service name | fixed `weles-admission` |
| File | `weles-admission.local`, exactly one line holding the API base URL |
| File mode | regular file, not a symlink, owned by the calling user, no group or world write bit |
| Scheme | `https:`, or `http:` only on loopback (`127.0.0.1`, `localhost`, `::1`), with no credentials, query, or fragment |

A missing file, a symlink, a loosened mode, a foreign owner, extra lines, or a
non-loopback plaintext URL is an explicit failure: the bridge emits
`needs_configuration` with `code: WELES_ENDPOINT_UNRESOLVED` and
`phase: admission`, and never falls back to an environment variable.

## Skarbiec credential lifecycle

Skarbiec invokes an absolute, owner-controlled regular file rather than an npm
shim. Point it at the executable inside the installed package:

```sh
export SKARBIEC_WELES_CREDENTIAL_COMMAND="$(npm root --global)/@wisent-ai/weles-client/bin/weles-skarbiec-acquire.mjs"

# adopt names the reader consumer: Skarbiec stages the candidate against it, so
# only that consumer may read the candidate back for the proof login.
skarbiec credential adopt weles-microsoft-lukasz-wisent-com-password \
  --provider microsoft \
  --account lukasz@wisent.com \
  --consumer weles-microsoft-lukasz-wisent-com-password-reader-password \
  --purpose adopt-the-known-current-password \
  --password-stdin

# rotate and verify name the writer consumer: the managed write is authorized
# only for the consumer the request record carries.
skarbiec credential rotate weles-microsoft-lukasz-wisent-com-password \
  --provider microsoft \
  --account lukasz@wisent.com \
  --consumer weles-microsoft-lukasz-wisent-com-password-writer \
  --purpose incident-remediation

skarbiec credential resume weles-microsoft-lukasz-wisent-com-password \
  --approval approval-01H9Z \
  --resume-token r_9f3c2a

skarbiec credential status weles-microsoft-lukasz-wisent-com-password
```

The directory identity is not a call argument. It is sealed once into the item as
the `directory` block, and Skarbiec puts that block into the request; the
`--expect-upn`, `--expect-tenant`, and `--expect-object-id` flags are only a
cross-check that refuses before submit on `DIRECTORY_EXPECTATION_MISMATCH`.

The bridge accepts only the fixed `skarbiec.credential-operation.v3` request;
`skarbiec.credential-operation.v1` and `skarbiec.credential-operation.v2` are
rejected with no alias. `mode: submit` binds its request ID to the Weles
idempotency key and submits the allowlisted `skarbiec_credential_acquire`
action; `mode: resume` submits the same action for an issued approval and must
carry `approval_id` (at most 64 characters of `[A-Za-z0-9._-]`) and
`resume_token` (at most 128 of the same alphabet) and must not be a dry run;
`mode: status` performs only a GET for the exact returned action-log ID.
Operations are explicit `acquire`, `adopt`, `rotate`, `reset`, `verify`, or
`remove`. A request outside `mode: resume` must leave `approval_id` and
`resume_token` null. The bridge never accepts credential material on stdin or
returns credential or task payload material on stdout.

The request carries the directory identity only as the nested `directory` block
with exactly `provider`, `tenant_id`, `principal_object_id`, and `account_upn`
(lowercase UUIDs, one email UPN). Any extra or missing key inside the block, or
a flat `account_upn`, `tenant_id`, or `principal_object_id` at the top level, is
an invalid request. Providers other than `microsoft_entra` must send
`directory: null`.

Before a real operation is queued, the Weles operator binds the organization to
the customer's HTTPS Skarbiec endpoint and installs only the exact writer grant
for each allowed item. The worker writes the credential directly to that tenant
binding. Skarbiec completes an operation only when the encrypted item carries
the matching request ID and operation—not merely because an item exists.
Microsoft bindings also require the tenant's
`acquisition-scopes.conf` to contain the exact row
`<item>-reader-password|<item>|password`; wildcards are rejected. The request's
item, provider, and field must match the fixed bridge contract, and the
consumer must be the exact writer consumer — or, for a Microsoft `adopt`, the
exact reader consumer the candidate was staged against.
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
| `weles-microsoft-jakub-wisent-ai-password` | Microsoft Entra | `password` | adopt, rotate, reset, verify |
| `weles-microsoft-lukasz-wisent-com-password` | Microsoft consumer account | `password` | adopt, rotate, verify |
| `weles-microsoft-<account-alias>-password` | Microsoft consumer account | `password` | adopt, rotate, verify |

### Microsoft Entra password lifecycle

The `microsoft_entra` item is pinned to one directory identity. The
request's `directory` block must match the bridge contract field by field,
`directory.provider` must equal the request `provider`, and `field` must be
`password`:

| Item | UPN | Tenant | Principal object ID |
| --- | --- | --- | --- |
| `weles-microsoft-jakub-wisent-ai-password` | `jakub@wisent.ai` | `23572277-0021-42ac-b2b9-10bd86c7d2af` | `4c888895-03cf-4ab1-a11e-46942c568217` |

`weles-microsoft-lukasz-wisent-com-password` is a personal Microsoft account
that only guests in that tenant, so the directory does not hold its password:
its lifecycle is provider `microsoft` with `--account lukasz@wisent.com`, never
`microsoft_entra`.

Any other combination returns `needs_configuration` with
`code: ENTRA_IDENTITY_CONTRACT_MISMATCH` before Weles is contacted, and so does
a missing `directory` block for `microsoft_entra` or any `directory` block sent
under another provider. Entra sign-in uses
`https://login.microsoftonline.com`; the consumer `https://account.live.com`
origin applies only to provider `microsoft`, which still keeps its
`weles-microsoft-<account-alias>-password` pattern and `--account <email>`.

The four Entra operations are separate and non-substitutable:

- `adopt` — the current password is known but not yet managed. The value is
  staged, Microsoft is authenticated freshly with it, and only a confirmed sign-in
  commits it. After `adopt` the item is `managed` and `rotate` is available.
- `rotate` — the current password is known and managed. The worker authenticates
  it, changes it at Microsoft, freshly authenticates the generated replacement,
  and commits it to Skarbiec. A failed commit or fresh authentication attempts a
  provider-side rollback and verifies the previous password.
- `reset` — the current password is unknown. Interactive identity verification
  stops as `needs_human_approval`; it is never run under the `rotate` name and
  there is no "allow unknown current password" flag.
- `verify` — freshly authenticates the stored password and rewrites the same
  value.

Each operation maps to exactly one Weles task action, and a status read of any
other action is an identity mismatch: `adopt` to
`microsoft_entra_adopt_password`, `verify` to `microsoft_entra_verify_password`,
`rotate` and `reset` to `microsoft_entra_reset_password`. A status read also
requires the task's `params.constraints.directory` to match the request's
`directory` block field by field. For provider `microsoft` the mapping is
`adopt` to `microsoft_adopt_password`, `verify` to `microsoft_verify_password`,
and `rotate` to `microsoft_reset_password`, and the status read requires the
task's `params.constraints.account_email` to equal the request's
`account_email`.

Before any password change, and again after the fresh login, the worker confirms
that the signed-in identity carries exactly the expected tenant `tid`, principal
`oid`, and UPN. A mismatch stops before the change with `operation_failed`,
`code: ENTRA_IDENTITY_MISMATCH`, and `phase: identity_verification`. MFA or
passkey challenges stop as `needs_human_approval`; no local write is made.

### Diagnostic response fields

All three modes emit a sanitized JSON object on stdout: `status`, `operation`,
`provider`, `vaultItemId`, and the optional `actionLogId`,
`sourceActionLogId`, `url`, `buildId`, `flowName`, and `message` (at most 512
characters, no control characters). Typed diagnostics are echoed only when the
service reports them in a valid form:

| Field | Accepted values |
| --- | --- |
| `code` | `^[A-Z][A-Z0-9_]{0,63}$`, for example `ENTRA_IDENTITY_MISMATCH` or `WELES_ENDPOINT_UNRESOLVED` |
| `phase` | `admission`, `placement`, `credential_read`, `entra_sign_in`, `identity_verification`, `password_change`, `fresh_login_verification`, `skarbiec_stage`, `skarbiec_commit`, `rollback` |
| `retryable` | boolean |
| `providerEffect` | `none`, `changed`, `unknown` |
| `rollbackStatus` | `none`, `completed`, `failed`, `unknown` |
| `executionHost` | at most 128 characters of `[A-Za-z0-9._-]` |
| `tenantId`, `principalObjectId` | lowercase UUID matching the request |

`providerEffect` replaces the removed `providerPasswordChanged` boolean, because
"we did not observe a change" is not "nothing changed". An `operation_failed`
result whose reported effect is absent or malformed is reported as
`providerEffect: unknown`, never as `none`, so Skarbiec quarantines the item
instead of retrying against a password that may already have changed. Only
`none` permits an automatic retry; `changed` requires a `verify` or a confirmed
rollback first, and `unknown` is never retried automatically.

A paused operation carries an approval resource. It is forwarded only when every
field is valid, never partially:

| Field | Accepted values |
| --- | --- |
| `approval_id` | at most 64 characters of `[A-Za-z0-9._-]` |
| `phase` | one diagnostic phase |
| `provider_effect` | `none`, `changed`, `unknown` |
| `expires_at` | ISO 8601 timestamp; after it the lease is released and the approval cannot be resumed |
| `resume_token` | at most 128 characters of `[A-Za-z0-9._-]` |
| `instruction` | at most 512 characters, no control characters |

`credential resume <item> --approval <id> --resume-token <token>` is the only way
to continue such an operation; a repeated submit is not.

A terminally successful operation carries a receipt, forwarded under the same
all-or-nothing rule, so `credential status` can answer whether exactly this
principal was rotated without reading mail or worker logs:

| Field | Accepted values |
| --- | --- |
| `tenant_id`, `principal_object_id` | lowercase UUID |
| `account_upn` | email UPN |
| `operation` | one of the six operations |
| `request_id`, `evidence_digest` | 64 hex characters |
| `execution_host` | at most 128 characters of `[A-Za-z0-9._-]` |
| `changed_at` | ISO 8601 timestamp or `null` |
| `verified_at` | ISO 8601 timestamp |
| `action_log_id` | at most 200 characters of `[A-Za-z0-9._-]` |

A well-formed receipt whose `tenant_id`, `principal_object_id`, `account_upn`,
`request_id`, or `operation` disagrees with the request is a protocol violation:
the bridge rejects the whole response instead of emitting it.

In `mode: submit` and `mode: resume` the diagnostics are read from the admission
response beside `status`; in `mode: status` they are read from the action-log
row's evidence, `result.service_action.credential_operation`, and from
`result.pending_review` for a row awaiting human approval. A terminally failed
status read therefore still carries the `code` and `phase` the worker recorded.
Anything outside these shapes is dropped rather than forwarded, so provider
HTML, stack traces, and credential material never reach stdout.

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
  an explicitly controlled loopback service.

## Product boundaries

### Included

- HTTPS endpoints, with plaintext HTTP allowed only on a loopback host
  (`127.0.0.1`, `localhost`, `::1`);
- non-empty exact origin and action allowlists;
- rejection of request input keys matching password, secret, token, cookie,
  authorization, or proxy-auth patterns, with the single exception of the
  `resumeToken` / `resume_token` approval continuation handle, which is still
  redacted from every error detail;
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
