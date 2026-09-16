// The client itself: one HTTPS conversation with a Weles endpoint.
//
// Split out of a 604-line index.mjs, where it sat among the redaction rules,
// the input checks, the receipt verification and the first-use journey.

import { randomUUID } from "node:crypto";

import { WelesClientError } from "./error.mjs";
import {
  CONTROLLED_HEADERS,
  MAX_RESPONSE_BYTES,
  RESUMPTION_KEY,
  assertNoSensitiveFields,
  boundedResponseText,
  redact,
} from "./input/safety.mjs";
import {
  normalizeOrigin,
  requireBearer,
  requireObject,
  requireOptionalTextArray,
  requireText,
  requireTextArray,
  requireUuid,
  secureBaseUrl,
} from "./input/validate.mjs";

class WelesClient {
  constructor(options) {
    requireObject(options, 'options');
    this.endpoint = secureBaseUrl(options.endpoint);
    this.bearer = requireBearer(options.bearer);
    this.organizationId = requireUuid(options.organizationId, 'organizationId');
    this.allowedOrigins = new Set(requireTextArray(options.allowedOrigins, 'allowedOrigins').map(normalizeOrigin));
    this.allowedActions = new Set(requireTextArray(options.allowedActions, 'allowedActions'));
    this.receiptKeys = new Map(Object.entries(options.receiptKeys ?? {}));
    this.fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.fetch !== 'function') {
      throw new WelesClientError('invalid-client', 'A Fetch-compatible implementation is required');
    }
  }

  async submit(request, options = {}) {
    requireObject(request, 'request');
    const origin = normalizeOrigin(request.origin);
    const action = requireText(request.action, 'action');
    if (!this.allowedOrigins.has(origin)) {
      throw new WelesClientError('origin-denied', 'The workflow origin is not in the client allowlist', { origin });
    }
    if (!this.allowedActions.has(action)) {
      throw new WelesClientError('action-denied', 'The workflow action is not in the client allowlist', { action });
    }
    assertNoSensitiveFields(request.input ?? {}, 'input');
    const idempotencyKey = requireText(options.idempotencyKey ?? randomUUID(), 'idempotencyKey');
    const body = {
      schema: 'weles.task.current',
      origin,
      action,
      input: request.input ?? {},
      credentialRefs: requireOptionalTextArray(request.credentialRefs, 'credentialRefs'),
      evidencePolicy: request.evidencePolicy ?? 'receipt',
      justification: requireText(request.justification, 'justification'),
    };
    const response = await this.request('tasks', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
      signal: options.signal,
    });
    if (response.receipt) {
      this.#verifyReceipt(response.receipt, { origin, action });
    }
    return response;
  }

  async cancel(taskId, options = {}) {
    const id = requireText(taskId, 'taskId');
    const idempotencyKey = requireText(options.idempotencyKey ?? randomUUID(), 'idempotencyKey');
    const response = await this.request(`tasks/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        schema: 'weles.cancellation.current',
        reason: requireText(options.reason, 'reason'),
      },
      signal: options.signal,
    });
    if (response.receipt) {
      this.#verifyReceipt(response.receipt, { taskId: id });
    }
    return response;
  }

  async get(taskId, options = {}) {
    const id = requireText(taskId, 'taskId');
    const response = await this.request(`tasks/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal: options.signal,
    });
    if (response.receipt) {
      this.#verifyReceipt(response.receipt, { taskId: id });
    }
    return response;
  }

  #verifyReceipt(receipt, expected = {}) {
    const claims = verifyReceipt(receipt, this.receiptKeys);
    if (claims.organizationId !== this.organizationId) {
      throw new WelesClientError(
        'receipt-organization-mismatch',
        'The signed receipt organization does not match the client organization',
      );
    }
    if (expected.origin !== undefined && claims.origin !== expected.origin) {
      throw new WelesClientError(
        'receipt-origin-mismatch',
        'The signed receipt origin does not match the submitted origin',
      );
    }
    if (expected.action !== undefined && claims.action !== expected.action) {
      throw new WelesClientError(
        'receipt-action-mismatch',
        'The signed receipt action does not match the submitted action',
      );
    }
    if (expected.taskId !== undefined && claims.taskId !== expected.taskId) {
      throw new WelesClientError(
        'receipt-task-mismatch',
        'The signed receipt task does not match the requested task',
      );
    }
  }

  async request(path, options) {
    const customHeaders = options.headers ?? {};
    requireObject(customHeaders, 'headers');
    const controlledHeader = Object.keys(customHeaders)
      .find((name) => CONTROLLED_HEADERS.has(name.toLowerCase()));
    if (controlledHeader) {
      throw new WelesClientError(
        'invalid-input',
        `The Weles client controls the ${controlledHeader} header`,
        { header: controlledHeader },
      );
    }

    let response;
    try {
      response = await this.fetch(new URL(path, this.endpoint), {
        method: options.method,
        headers: {
          ...customHeaders,
          Authorization: `Bearer ${this.bearer}`,
          'X-Wisent-Organization-ID': this.organizationId,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      throw new WelesClientError('transport-failed', 'The Weles request did not complete', redact(error));
    }
    let text;
    try {
      text = await boundedResponseText(response);
    } catch (error) {
      if (error instanceof WelesClientError) throw error;
      throw new WelesClientError('transport-failed', 'The Weles response body did not complete', redact(error));
    }
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new WelesClientError('invalid-response', 'Weles returned a non-JSON response', { status: response.status });
    }
    if (!response.ok) {
      throw new WelesClientError('request-rejected', 'Weles rejected the request', {
        status: response.status,
        response: redact(payload),
      });
    }
    requireObject(payload, 'response');
    return payload;
  }
}


export { WelesClient };
