# Skarbiec credential bridges

How does Skarbiec drive a credential operation through Weles without either
side ever handing the other a secret? Through two small executables in
[`bin/`](../bin) that speak one fixed wire — the
`skarbiec.credential-operation.v3` request on stdin, one line of JSON on
stdout — and refuse everything else. This page is grounded in the bridge
sources and in executed runs; the byte-exact thrown strings are in
[errors](errors.md#credential-bridges-bin), and
[`test/weles-skarbiec-acquire.test.mjs`](../test/weles-skarbiec-acquire.test.mjs)
exercises the contract end to end against loopback mocks.

| Bridge | Transport | Endpoint resolution |
|---|---|---|
| [`weles-skarbiec-acquire.mjs`](../bin/weles-skarbiec-acquire.mjs) | The real `WelesClient` (`submit` / `get`) against the Weles task API, action `skarbiec_credential_acquire` | Only the Stado forward file `<forwards>/weles-admission.local` (`~/.stado/forwards`, override `STADO_FORWARDS_DIR`); never an environment-variable endpoint |
| [`weles-skarbiec-acquire-admission.mjs`](../bin/weles-skarbiec-acquire-admission.mjs) | Plain `fetch` to `POST /v1/echo/secrets/acquire` on the admission server | `WELES_ADMISSION_ORIGIN` (default `http://127.0.0.1:8794`); HTTPS anywhere, HTTP only on a loopback host |

## The wire

One JSON object on stdin, capped at 64 KiB. `version` must be exactly
`skarbiec.credential-operation.v3`; `request_id` is 64 hex characters and
doubles as the idempotency key; unknown fields are refused
(`credential request contains unknown fields`). Request buffers are zeroed
immediately after parsing (`bytes.fill(0)` in both `readRequest`
implementations) — the bridges accept no credential material on stdin and
return none on stdout.

| Field | Constraint (acquire bridge) |
|---|---|
| `mode` | `submit`, `status`, or `resume` (admission bridge: `submit` or `status` only) |
| `operation` | `acquire`, `adopt`, `rotate`, `reset`, `verify`, `remove` (admission bridge: `acquire`, `rotate`, `verify`, `remove`) |
| `credential_id`, `consumer` | exact names, `[A-Za-z0-9._-]`, ≤ 200 chars |
| `provider`, `field` | exact names, ≤ 128 chars |
| `purpose` | non-empty, ≤ 200 UTF-8 bytes, no control characters; becomes the submission justification |
| `status` / `dry_run` | must be `pending` / a boolean (`invalid credential request state`) |
| `approval_id` + `resume_token` | only in `resume` mode (`only resume mode may carry an approval`); a resume must not be a dry run |
| `action_log_id` | forbidden in `submit`, required exact in `status` |
| `directory` | exactly the four fields `provider`, `tenant_id`, `principal_object_id`, `account_upn`; accepted only for provider `microsoft_entra` |

The acquire bridge additionally matches the request against a sealed,
hard-coded contract table (`CONTRACTS` plus the Microsoft credential-ID
pattern): a `credential_id`/`provider`/`consumer` triple with no exact
contract settles as `needs_configuration`, and an operation outside the
contract's allowed set settles as `unsupported_operation` — before any
network. `WELES_TOKEN` and `WISENT_ORGANIZATION_ID` are required before
submitting (`<name> is required`, exit 1).

## Settled statuses

Every settled answer is one stdout JSON line with a closed `status` set and
exit 0:

`operation_plan` · `operation_queued` · `operation_completed` ·
`needs_configuration` · `needs_human_approval` · `unsupported_operation` ·
`unsupported_secret` · `operation_failed`

A malformed request or a broken environment is a thrown `Error` and exit 1
([errors](errors.md#credential-bridges-bin)). Executed (empty forwards
directory, submit mode):

```json
{"status":"needs_configuration","operation":"acquire","provider":"semantic_scholar","vaultItemId":"weles-semantic-scholar-api","message":"Weles admission endpoint is unresolved: <dir>/weles-admission.local does not exist","code":"WELES_ENDPOINT_UNRESOLVED","phase":"admission"}
```

Settled outputs carry only sanitized, shape-checked diagnostics (`code`,
`phase`, `retryable`, `providerEffect`, `rollbackStatus`, `executionHost`,
`approval`, `receipt` — `diagnostics` in the acquire bridge): a field that
fails its shape check is dropped, a partial approval is dropped whole, and a
well-formed receipt naming a different identity, request, or operation is
the thrown `Weles credential-operation receipt identity mismatch`. A
terminal `operation_failed` without a credible provider effect reports
`providerEffect: "unknown"`, never `"none"` — Skarbiec must quarantine
instead of assuming the credential stands.

## Status mode

The two bridges settle `status` differently, on purpose:

- **Acquire bridge** reads the task record with `client.get` and refuses any
  record that does not prove it is about this exact request: task ID,
  expected action names, and the `params.constraints` echo of the request
  (`Weles task status response identity mismatch` / `… provenance
  mismatch`). Task statuses normalize to the settled set (`accepted`,
  `queued`, `pending`, `running` → `operation_queued`; `pending_review` →
  `needs_human_approval`; `completed` → `operation_completed`; `failed`,
  `cancelled`, `rejected`, `timed_out` → `operation_failed`; anything else
  is the thrown `Weles returned an unsupported task status`).
- **Admission bridge** settles locally, without any request. Executed:

  ```json
  {"status":"operation_queued","operation":"acquire","provider":"semantic_scholar","vaultItemId":"weles-semantic-scholar-api","message":"status settles through the Skarbiec vault lifecycle record"}
  ```

  The vault, not admission, is the status authority: the worker commits the
  credential through a managed write, so a separate admission poll would
  read a different authority than the one that authorizes the write
  (comment in the bin source).

## Envelope unwrapping

Admission wraps every success as `{ ok: true, data: <result> }`; the
admission bridge unwraps it so the status fields the Skarbiec wire expects
sit at the top level. Executed against a loopback listener answering
`{"ok":true,"data":{"status":"operation_queued","action_log_id":"log-42","message":"queued"}}`:

```json
{"status":"operation_queued","operation":"acquire","provider":"semantic_scholar","vaultItemId":"weles-semantic-scholar-api","actionLogId":"log-42","sourceActionLogId":null,"message":"queued","receipt":null,"approval":null,"providerEffect":null,"rollbackStatus":null,"executionHost":null}
```

A non-2xx admission answer settles (exit 0) as `needs_configuration`.
Executed against a loopback listener answering HTTP 403 with
`{"error":"no admission grant"}`:

```json
{"status":"needs_configuration","operation":"acquire","provider":"semantic_scholar","vaultItemId":"weles-semantic-scholar-api","code":null,"phase":"admission","retryable":false,"message":"admission rejected the operation (HTTP 403): no admission grant"}
```

An unrecognized settled status from either transport is the thrown
`admission returned an unsupported credential-operation status: <status>`
(admission) or `Weles returned an unsupported credential-operation status`
(acquire). Dry-run discipline is enforced on the way back too: a dry run
that comes back `operation_completed` or a plan/queued answer that
contradicts `dry_run` is an error, not a result.
