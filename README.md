<!-- wisent-banner:start -->
<p align="center">
  <img src="assets/readme-banner.webp" alt="weles-client by Wisent" width="100%">
</p>
<!-- wisent-banner:end -->

<!-- wisent-readme-signals:start -->
[![Source](https://img.shields.io/badge/GitHub-Source-181717?logo=github)](https://github.com/wisent-ai/weles-client) [![Issues](https://img.shields.io/badge/GitHub-Issues-181717?logo=github)](https://github.com/wisent-ai/weles-client/issues) [![Wisent](https://img.shields.io/badge/Wisent-Website-0B0B0B)](https://wisent.com) [![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/qRjpkthq54) [![LinkedIn](https://img.shields.io/badge/LinkedIn-Follow-0A66C2?logo=linkedin&logoColor=white)](https://www.linkedin.com/company/wisent-ai/) [![X](https://img.shields.io/badge/X-Follow-000000?logo=x&logoColor=white)](https://x.com/wisentai) [![Enterprise](https://img.shields.io/badge/Enterprise-Book%20a%20call-0B0B0B?logo=calendly)](https://calendly.com/lbartoszcze)
<!-- wisent-readme-signals:end -->

# Weles Client

Your AI agents deserve to explore the entire internet. AI can now write
software, reason for hours, and order your groceries, but it still fails or
takes ages when you ask it to open a website and log in to your account.

Weles is the solution. We turn the open internet into an API.

Weles is an undetectable browser that combines custom C++-patched Chromium and
Firefox forks with rotating fingerprints to stop your AI from running into
CAPTCHAs and bans. Every time you crawl a website, it gets mapped into a
trajectory, allowing future runs to use the cached traversal instead of having
to rediscover how the website works. When a run fails, Weles records videos
showing the points of failure to give you a clear understanding of what happened
and how it can be fixed.

Give your AI the keys to the internet. The browser-use experience your AI
deserves. This is the public Node.js client you call it from, and the verifier
for the signed receipt it gives back.

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
- one client-controlled `Authorization: Bearer <token>` header and one exact
  `X-Wisent-Organization-ID: <organization-uuid>` header on every request;
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
- **Outcome:** the client sends `weles.task.current` without a tenant selector,
  authenticates it with the bearer and organization headers, and verifies any
  receipt returned in the response.
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
              │ HTTPS + bearer + organization header
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


## Further reading

The Skarbiec credential lifecycle, its configuration and every refusal:
[docs/credentials.md](docs/credentials.md). The exported interfaces, receipt
verification, errors and redaction, the operational model and support:
[docs/library.md](docs/library.md).
