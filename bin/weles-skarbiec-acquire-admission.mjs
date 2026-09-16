#!/usr/bin/env node
// Workload-scoped credential admission. Stado owns the endpoint; Skarbiec
// owns the bearer and the pending operation. No provider credential crosses this wire.
import { resolveWelesEndpoint, readCredentialAdmissionBearer } from '../src/stado-admission.mjs';
import { readRequest, validateRequest } from '../src/credential/input.mjs';
import { credentialResponse, credentialFailure } from '../src/credential/response.mjs';

async function emit(value) {
  await new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) => error ? reject(error) : resolve());
  });
}

const request = await readRequest();
validateRequest(request);
let endpoint;
try {
  const base = resolveWelesEndpoint();
  endpoint = new URL('/api/v1/credential-operations', base);
} catch (error) {
  await emit(credentialFailure(request, 'WELES_ENDPOINT_UNRESOLVED', error.message));
  process.exit(0);
}
let bearer;
try {
  bearer = readCredentialAdmissionBearer();
} catch (error) {
  await emit(credentialFailure(request, 'WELES_CREDENTIAL_BEARER_UNRESOLVED', error.message));
  process.exit(0);
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
  if (!response.ok) {
    if (payload.status) {
      await emit(credentialResponse(payload, request));
    } else {
      const effect = payload.providerEffect === 'none' ? 'none' : 'unknown';
      await emit(credentialFailure(
        request,
        payload.code || 'WELES_CREDENTIAL_ADMISSION_REFUSED',
        `Weles credential admission returned HTTP ${response.status}; ${String(payload.message || 'no failure detail')}`,
        effect,
      ));
    }
  } else {
    await emit(credentialResponse(payload, request));
  }
} catch (error) {
  const reason = error.cause?.code || error.code || error.message;
  await emit(credentialFailure(
    request,
    'WELES_CREDENTIAL_TRANSPORT_FAILED',
    `Weles credential admission did not return a bound response: ${reason}`,
    'unknown',
  ));
}
