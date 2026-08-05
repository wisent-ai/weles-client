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

It is intentionally not the Weles browser executor. The package helps a caller
form and verify the safe public contract; it does not grant target authorization,
approve a workflow, run a browser, or prove that an external site permits
automation.

[Quick start](#quick-start) · [Client API](#primary-interfaces) ·
[Receipt verification](#receipt-verification) ·
[Canonical repository](https://github.com/wisent-ai/weles-client)

Current source version: `0.2.0`. A `v0.2.0` tag publishes the immutable package to
npm with GitHub Actions OIDC provenance and attaches the same tarball plus SHA-256
to GitHub Releases. Source availability does not promise a hosted Weles endpoint,
approved trajectory, target support, evidence retention, or SLA.

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
- explicit submit, task-status, cancel, and service-version operations with no hidden retry;
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
- Evidence download, key discovery, authentication enrollment, and policy
  administration are not included.
- Fingerprint behavior, browser patches, provider rotation, anti-bot research,
  service trajectories, scheduling, recordings, and stealth configuration remain
  private executor implementation and are not promised by this package.

### Supported environment and current capability

| Surface | Requirement | Current state |
|---|---|---|
| Client import | Node.js ESM with global Fetch and `node:crypto` | Versioned `0.2.0` source export |
| Submit/status/cancel | authorized compatible Weles endpoint | Implemented with v1 schemas |
| Service compatibility | `GET /api/v1/version` | Supports client generations 0.2 and 0.1 |
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
- **Outcome:** the client sends `weles.task.v1` with an idempotency key and
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

- schema `weles.task.v1`;
- `organizationId`, normalized origin, exact action, and non-secret input;
- opaque `credentialRefs` and evidence policy;
- justification;
- `Idempotency-Key` and bearer headers.

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

### Status and compatibility

```js
const task = await client.get(taskId, { signal: abortController.signal });
const service = await client.version({ signal: abortController.signal });
```

`get` requires a `weles.task-status.v1` response and verifies an included receipt.
`version` requires `weles.version.v1`; its compatibility block identifies the
current client generation, minimum accepted generation, and retained generation
count. Version `0.2.0` and `0.1.x` use the same v1 wire schemas.


## Receipt verification

```js
const claims = verifyReceipt(receipt, {
  "current-signing-key": process.env.WELES_RECEIPT_PUBLIC_KEY,
});
```
The current receipt schema is `weles.receipt.v1`. For one N-1 compatibility
generation, verification also accepts signed `weles.receipt.current` receipts;
all signature and displayed-claim checks are identical. Receipt signatures are
Ed25519 over the exact UTF-8 bytes in `signedPayload`; `signature` is canonical
padded base64. Keys from any other algorithm fail closed. Verification binds:

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

## Release authorization

Only a `v<package-version>` tag pushed by an actor named in the comma-separated
`WELES_RELEASE_APPROVERS` repository variable may publish. The workflow fails
before package setup when the variable is empty or the actor is absent. npm
trusted publishing binds the public package to that GitHub Actions workflow;
the workflow also publishes the exact packed archive, checksum, and provenance
through an immutable GitHub Release.

## Project status and support

- **Maturity:** versioned `0.2.0` source with an npm trusted-publishing workflow.
- **Public contract:** v1 task submission, status, cancellation and service-version
  schemas, local validation, redaction, and signed-receipt verification.
- **Private service:** browser execution, service-specific workflows, scheduling,
  evidence operation, stealth research, and support.
- **Issues:** [`wisent-ai/weles-client`](https://github.com/wisent-ai/weles-client/issues).
- **Security:** use [private GitHub Security Advisories](https://github.com/wisent-ai/weles-client/security/advisories/new); never attach bearers, private input, credential references, receipts containing customer metadata, target account data, or production endpoints to a public issue.
- **License:** Apache License 2.0; see [`LICENSE`](LICENSE).
