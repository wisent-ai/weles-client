# The Skarbiec credential lifecycle

Companion to the [README](../README.md). This page is the credential half of
the client: how a hosted service is configured, how a credential is
registered, submitted, forwarded and revoked, and what each refusal means.

## Hosted service configuration

A Weles organization receives two non-interchangeable values from the hosted
service operator:

```sh
export WISENT_ORGANIZATION_ID=<organization-uuid>
export WELES_TOKEN=<organization-scoped-token>
```

Every organization-scoped request carries both values in client-controlled
headers: `Authorization: Bearer <token>` and the exact
`X-Wisent-Organization-ID: <organization-uuid>`. The organization ID is not a
tenant selector in task or cancellation payloads. The service verifies the
header against the bearer and rejects any mismatch.

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

skarbiec credential adopt weles-microsoft-lukasz-wisent-com-password \
  --provider microsoft_entra \
  --consumer weles-microsoft-lukasz-wisent-com-password-writer \
  --expect-upn lukasz@wisent.com \
  --expect-tenant 23572277-0021-42ac-b2b9-10bd86c7d2af \
  --expect-object-id 1f636f97-b07f-4e9b-952a-5d069ccc5b20 \
  --purpose adopt-the-known-current-password

skarbiec credential rotate weles-microsoft-lukasz-wisent-com-password \
  --provider microsoft_entra \
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
| `weles-microsoft-jakub-wisent-ai-password` | Microsoft Entra | `password` | adopt, rotate, reset, verify |
| `weles-microsoft-lukasz-wisent-com-password` | Microsoft Entra | `password` | adopt, rotate, reset, verify |
| `weles-microsoft-<account-alias>-password` | Microsoft consumer account | `password` | rotate, verify |

### Microsoft Entra password lifecycle

The two `microsoft_entra` items are pinned to one directory identity each. The
request's `directory` block must match the bridge contract field by field,
`directory.provider` must equal the request `provider`, and `field` must be
`password`:

| Item | UPN | Tenant | Principal object ID |
| --- | --- | --- | --- |
| `weles-microsoft-jakub-wisent-ai-password` | `jakub@wisent.ai` | `23572277-0021-42ac-b2b9-10bd86c7d2af` | `4c888895-03cf-4ab1-a11e-46942c568217` |
| `weles-microsoft-lukasz-wisent-com-password` | `lukasz@wisent.com` | `23572277-0021-42ac-b2b9-10bd86c7d2af` | `1f636f97-b07f-4e9b-952a-5d069ccc5b20` |

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
`directory` block field by field.

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

