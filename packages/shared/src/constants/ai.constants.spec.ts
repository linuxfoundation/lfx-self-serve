// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { AI_MODEL } from './ai.constants';

/**
 * Pins the shape only, never which model is named — that is expected to roll forward as models
 * are upgraded, and pinning it would turn every upgrade into a test edit.
 *
 * This cannot catch the real failure end to end. `AI_MODEL` is only ever wrong *relative to* the
 * proxy `AI_PROXY_URL` names, and both that host and its published `model_list` live in argocd
 * rather than in this repo, so no test here can see the pairing. What it does catch is the half of
 * it this repo owns: both service specs that touch the constant mock it away
 * (`ai.service.spec.ts`, `weekly-brief.service.spec.ts`), so without this a future edit could
 * reintroduce a provider prefix with a fully green suite and reproduce #4333 — an outage whose
 * only symptom was a `429` from the proxy, the code a router returns when it publishes no
 * deployment for the model asked for.
 *
 * A `/` is the test because every provider prefix carries one (`bedrock/…`, `openai/…`), while the
 * names the proxy publishes are bare (`claude-sonnet-5-5`, `amazon-nova-pro`). Asserting the
 * absence of `bedrock/` alone would let a differently-prefixed id through with the same outcome.
 */
describe('AI_MODEL', () => {
  it('names a model the proxy publishes, with no provider prefix (#4333)', () => {
    expect(AI_MODEL).not.toContain('/');
  });

  it('is a non-empty value, so no request falls back to an unrouted empty model', () => {
    expect(AI_MODEL.trim()).toBe(AI_MODEL);
    expect(AI_MODEL.length).toBeGreaterThan(0);
  });
});
