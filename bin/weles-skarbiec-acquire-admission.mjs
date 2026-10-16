#!/usr/bin/env node
// Workload-scoped credential admission. Stado owns the endpoint; Skarbiec
// owns the bearer and the pending operation. No provider credential crosses this wire.
//
// Every outcome, a refusal included, is one JSON line on stdout for Skarbiec;
// the process itself ends without an error status once that line is written.
import { resolveWelesEndpoint, readCredentialAdmissionBearer } from '../src/stado-admission.mjs';
import { admitRequest, credentialDirectoryMatches, readRequest } from '../src/credential/input.mjs';
import { credentialResponse, credentialFailure } from '../src/credential/response.mjs';

async function emit(value) {
  await new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) => error ? reject(error) : resolve());
  });
}

/** The one answer Skarbiec reads for this admission. */
async function admission(request) {
  if (!credentialDirectoryMatches(request)) {
    return credentialFailure(request, 'ENTRA_IDENTITY_CONTRACT_MISMATCH',
      `Directory identity and password field must agree with provider ${request.provider} for ${request.credential_id}`);
  }
  let endpoint;
  try {
    endpoint = new URL('/api/v1/credential-operations', resolveWelesEndpoint());
  } catch (error) {
    return credentialFailure(request, 'WELES_ENDPOINT_UNRESOLVED', error.message);
  }
  let bearer;
  try {
    bearer = readCredentialAdmissionBearer();
  } catch (error) {
    return credentialFailure(request, 'WELES_CREDENTIAL_BEARER_UNRESOLVED', error.message);
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
    });
    const payload = await readRequest(response.body);
    if (response.ok || payload.status) return credentialResponse(payload, request);
    // A refusal without an operation state: its own code and message, or its
    // whole answer when it names no message.
    const effect = payload.providerEffect === 'none' ? 'none' : 'unknown';
    const code = typeof payload.code === 'string' && payload.code ? payload.code : 'WELES_CREDENTIAL_ADMISSION_REFUSED';
    const detail = typeof payload.message === 'string' && payload.message ? payload.message : `the answer named no message: ${JSON.stringify(payload)}`;
    return credentialFailure(request, code, `Weles credential admission returned HTTP ${response.status}; ${detail}`, effect);
  } catch (error) {
    const reason = error.cause?.code || error.code || error.message;
    return credentialFailure(
      request,
      'WELES_CREDENTIAL_TRANSPORT_FAILED',
      `Weles credential admission did not return a bound response: ${reason}`,
      'unknown',
    );
  }
}

const request = await admitRequest(
  'weles-skarbiec-acquire-admission',
  'Skarbiec credential adapter: submits one workload-scoped credential operation to the Weles endpoint Stado resolves.',
);
await emit(await admission(request));
