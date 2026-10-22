// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { AI_MODEL } from './ai.constants';

/**
 * Pins the provider prefix only, never the inference profile id behind it — that is expected to
 * roll forward as models are upgraded, and pinning it would turn every upgrade into a test edit.
 *
 * This cannot catch the real failure end to end. `AI_MODEL` is only ever wrong *relative to* the
 * host `AI_PROXY_URL` names, and that value lives in argocd rather than in this repo, so no test
 * here can see the pairing. What it does catch is the half of it this repo owns: both service
 * specs that touch the constant mock it away (`ai.service.spec.ts`, `weekly-brief.service.spec.ts`),
 * so without this a future edit could strip the prefix with a fully green suite and reproduce
 * #4087 — an outage whose only symptom was a `400` from the proxy.
 */
describe('AI_MODEL', () => {
  it('carries the bedrock/ provider prefix that the v2 LiteLLM instances route on (#4087)', () => {
    expect(AI_MODEL.startsWith('bedrock/')).toBe(true);
  });
});
