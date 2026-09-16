// The first-use journey this client ships, and the check that a bundle is
// the canonical one.
//
// Split out of a 604-line index.mjs. The definition is data a person reads,
// which is why it is not mixed in with the client that talks HTTPS.

import { createHash } from "node:crypto";

import { WelesClientError } from "./error.mjs";
import {
  WELES_CLIENT_FIRST_SUCCESS_FACT,
  WELES_CLIENT_FIRST_USE_JOURNEY_ID,
  WELES_CLIENT_FIRST_USE_JOURNEY_VERSION,
  WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID,
  WELES_CLIENT_FIRST_USE_PRODUCT_ID,
  WELES_CLIENT_FIRST_USE_SOURCE_REVISION,
} from "./identity.mjs";
import { requireObject, requireText } from "./input/validate.mjs";

const WELES_CLIENT_FIRST_USE_DEFINITION = {
  analytics_contract: {
    completion_event: 'onboarding_completed',
    contract_version: '1',
    exposure_event: 'onboarding_step_viewed',
    first_success_event: 'onboarding_first_success_observed',
    primary_action_event: 'onboarding_step_completed',
    surface: 'sdk_first_use',
  },
  entry_screen_id: 'receipt-contract',
  experiment_contract: null,
  first_success_fact: WELES_CLIENT_FIRST_SUCCESS_FACT,
  journey_id: WELES_CLIENT_FIRST_USE_JOURNEY_ID,
  journey_version: WELES_CLIENT_FIRST_USE_JOURNEY_VERSION,
  product_id: WELES_CLIENT_FIRST_USE_PRODUCT_ID,
  published_at: '2026-08-04T00:00:00Z',
  schema_version: 1,
  screens: [
    {
      actions: ['continue'],
      body_key: 'weles-client.onboarding.receipt-contract.body',
      completion_evidence: null,
      entry_conditions: null,
      fallback_screen_id: null,
      presentation: {
        body: 'Use caller-owned trusted public keys and the public receipt contract; provisioning and private Weles state remain outside onboarding.',
        renderer: 'explanation',
        title: 'Trust receipts, not private service state',
      },
      required: true,
      screen_id: 'receipt-contract',
      screen_kind: 'explanation',
      title_key: 'weles-client.onboarding.receipt-contract.title',
      transitions: [
        {
          next_screen_id: 'verify-receipt',
          priority: 10,
          reason_code: 'canonical_progression',
        },
      ],
    },
    {
      actions: ['verify_receipt'],
      body_key: 'weles-client.onboarding.verify-receipt.body',
      completion_evidence: {
        fact: WELES_CLIENT_FIRST_SUCCESS_FACT,
        kind: 'fact',
        operator: 'eq',
        value: true,
      },
      entry_conditions: null,
      fallback_screen_id: null,
      presentation: {
        body: 'Call verifyReceipt with a real signed Weles receipt and trusted keys. Completion requires valid cryptography and claim-matching returned claims.',
        renderer: 'machine_result',
        title: 'Verify one real workflow receipt',
      },
      required: true,
      screen_id: 'verify-receipt',
      screen_kind: 'machine_result',
      title_key: 'weles-client.onboarding.verify-receipt.title',
      transitions: [],
    },
  ],
  source_revision: WELES_CLIENT_FIRST_USE_SOURCE_REVISION,
};

function canonicalizeOnboardingValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeOnboardingValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeOnboardingValue(entry)]));
  }
  return value;
}

const WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION = JSON.stringify(
  canonicalizeOnboardingValue(WELES_CLIENT_FIRST_USE_DEFINITION),
);

export const WELES_CLIENT_FIRST_USE_FALLBACK = Object.freeze({
  journey_version_id: WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID,
  definition: WELES_CLIENT_FIRST_USE_DEFINITION,
  canonical_definition: WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION,
  content_sha256: createHash('sha256').update(WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION).digest('hex'),
  source_revision: WELES_CLIENT_FIRST_USE_SOURCE_REVISION,
});

function assertFirstUseIdentity(productId, journeyId) {
  if (productId !== WELES_CLIENT_FIRST_USE_PRODUCT_ID || journeyId !== WELES_CLIENT_FIRST_USE_JOURNEY_ID) {
    throw new WelesClientError('onboarding-identity-mismatch', 'The onboarding request does not belong to Weles Client first use');
  }
}

function assertCanonicalFirstUseBundle(bundle) {
  requireObject(bundle, 'onboarding bundle');
  if (bundle.journey_version_id !== WELES_CLIENT_FIRST_USE_JOURNEY_VERSION_ID
    || bundle.source_revision !== WELES_CLIENT_FIRST_USE_SOURCE_REVISION
    || bundle.canonical_definition !== WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION
    || bundle.content_sha256 !== WELES_CLIENT_FIRST_USE_FALLBACK.content_sha256) {
    throw new WelesClientError('onboarding-bundle-mismatch', 'The Weles Client onboarding bundle is not the pinned canonical journey');
  }
  return bundle;
}

class VersionPinnedWelesClientOnboardingTransport {
  constructor(transport) {
    requireObject(transport, 'transport');
    for (const operation of ['readBundle', 'readState', 'collectEvent', 'assignExperiment']) {
      if (typeof transport[operation] !== 'function') {
        throw new WelesClientError('invalid-onboarding-transport', `transport.${operation} must be a function`);
      }
    }
    this.transport = transport;
  }

  async readBundle(productId, journeyId) {
    assertFirstUseIdentity(productId, journeyId);
    return assertCanonicalFirstUseBundle(await this.transport.readBundle(
      productId,
      journeyId,
      WELES_CLIENT_FIRST_USE_JOURNEY_VERSION,
    ));
  }

  readState(productId, attemptId, subjectHash) {
    assertFirstUseIdentity(productId, WELES_CLIENT_FIRST_USE_JOURNEY_ID);
    return this.transport.readState(productId, attemptId, subjectHash);
  }

  collectEvent(event) {
    requireObject(event, 'onboarding event');
    assertFirstUseIdentity(event.product_id, WELES_CLIENT_FIRST_USE_JOURNEY_ID);
    return this.transport.collectEvent(event);
  }

  assignExperiment(input) {
    requireObject(input, 'experiment assignment');
    assertFirstUseIdentity(input.product_id, WELES_CLIENT_FIRST_USE_JOURNEY_ID);
    return this.transport.assignExperiment(input);
  }
}

function createWelesClientOnboarding(options) {
  requireObject(options, 'options');
  if (typeof options.JourneyClient !== 'function') {
    throw new WelesClientError('invalid-onboarding-runtime', 'The shared Echo JourneyClient constructor is required');
  }
  const subject = requireText(options.subject, 'subject');
  const audience = requireText(options.audience, 'audience');
  const client = new options.JourneyClient({
    productId: WELES_CLIENT_FIRST_USE_PRODUCT_ID,
    journeyId: WELES_CLIENT_FIRST_USE_JOURNEY_ID,
    subjectHash: requireText(options.subjectHash, 'subjectHash'),
    scopeKind: options.scopeKind ?? 'workload',
    transport: new VersionPinnedWelesClientOnboardingTransport(options.transport),
    storage: options.storage,
    canonicalFallback: WELES_CLIENT_FIRST_USE_FALLBACK,
  });
  return Object.freeze({
    client,
    subject,
    audience,
    start: evidenceRevision => client.start(evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    expose: evidenceRevision => client.expose(evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    advance: evidenceRevision => client.advance({}, evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    skip: evidenceRevision => client.skip(evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    reset: evidenceRevision => client.reset(evidenceRevision ?? WELES_CLIENT_FIRST_USE_SOURCE_REVISION),
    flush: () => client.flush(),
    verifyFirstReceipt: (receipt, keys) => verifyFirstReceipt({
      client,
      receipt,
      keys,
      subject,
      audience,
    }),
  });
}


export {
  WELES_CLIENT_FIRST_USE_CANONICAL_DEFINITION,
  WELES_CLIENT_FIRST_USE_DEFINITION,
  assertCanonicalFirstUseBundle,
  assertFirstUseIdentity,
  canonicalizeOnboardingValue,
  createWelesClientOnboarding,
};
