# Weles Client

<!-- wisent-readme-signals:start -->
[![Release](https://img.shields.io/github/v/release/wisent-ai/weles-client?display_name=tag&sort=semver)](https://github.com/wisent-ai/weles-client/releases)
[![Downloads](https://img.shields.io/github/downloads/wisent-ai/weles-client/total)](https://github.com/wisent-ai/weles-client/releases)
[![License](https://img.shields.io/github/license/wisent-ai/weles-client)](https://github.com/wisent-ai/weles-client)
[![Discord](https://img.shields.io/badge/Discord-Join%20Wisent-5865F2?logo=discord&logoColor=white)](https://discord.gg/qRjpkthq54)
<!-- wisent-readme-signals:end -->


Safe public client and receipt verifier for separately authorized Weles browser workflows.

This repository is intentionally not the Weles executor. Fingerprint spoofing, browser patches, provider rotation, anti-bot research, service-specific trajectories, worker scheduling, operational recordings, and stealth configuration remain private in the Weles service repositories.

## Guarantees

The client:

- requires an exact origin allowlist and action allowlist;
- accepts HTTPS endpoints, with HTTP allowed only on `localhost` for development;
- rejects plaintext password, secret, token, cookie, authorization, and proxy-auth fields;
- sends opaque credential references separately from workflow input;
- requires a human-readable justification for every submission and cancellation;
- sends caller-controlled idempotency keys and performs no hidden retries;
- supports cancellation through an explicit idempotent request;
- redacts sensitive response fields from surfaced errors;
- verifies signed receipts with caller-supplied trusted public keys;
- rejects a receipt when displayed claims differ from its signed payload.

The client does not prove that a target permits automation. The organization remains responsible for authorization, acceptable use, applicable terms, origin/action approval, and data handling.

## Usage

```js
import { WelesClient, verifyReceipt } from '@wisent-ai/weles-client';

const client = new WelesClient({
  endpoint: process.env.WELES_URL,
  bearer: process.env.WELES_TOKEN,
  organizationId: process.env.WISENT_ORGANIZATION_ID,
  allowedOrigins: ['https://console.example.com'],
  allowedActions: ['export-approved-report'],
  receiptKeys: {
    'current-signing-key': process.env.WELES_RECEIPT_PUBLIC_KEY,
  },
});

const accepted = await client.submit({
  origin: 'https://console.example.com',
  action: 'export-approved-report',
  input: { report: 'monthly' },
  credentialRefs: ['customer-console-account'],
  justification: 'Export the report authorized by the account owner.',
});

if (accepted.receipt) {
  verifyReceipt(accepted.receipt, client.receiptKeys);
}
```

A client call either returns the service response, including a verified receipt when one is present, or throws `WelesClientError` with a stable error code. The library never logs on its own.

## Contract

Task submissions carry:

- `organizationId`
- exact `origin`
- allowlisted `action`
- non-secret `input`
- opaque `credentialRefs`
- `evidencePolicy`
- human-readable `justification`
- caller-controlled `Idempotency-Key`

Signed receipt claims bind task, organization, origin, action, outcome, and evidence digest. Consumers choose and rotate the trusted key set; an unknown key fails closed.

## Release status

Public development source. The package manifest intentionally has no publishable version until an immutable release is approved. Source availability does not promise a hosted Weles service, target authorization, workflow approval, or SLA.

- Issues: [`wisent-ai/weles-client`](https://github.com/wisent-ai/weles-client/issues)
- Vulnerabilities: [private GitHub Security Advisory](https://github.com/wisent-ai/weles-client/security/advisories/new)
- License: Apache License 2.0; see [`LICENSE`](LICENSE)
