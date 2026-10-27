// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { AI_MODEL, AI_REQUEST_CONFIG } from './ai.constants';

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
 * names the proxy publishes are bare (`claude-sonnet-4`, `amazon-nova-pro`). Asserting the
 * absence of `bedrock/` alone would let a differently-prefixed id through with the same outcome.
 */
describe('AI_MODEL', () => {
  it('carries no provider prefix, which the proxy never publishes (#4333)', () => {
    expect(AI_MODEL).not.toContain('/');
  });

  it('is a non-empty value, so no request falls back to an unrouted empty model', () => {
    expect(AI_MODEL.trim()).toBe(AI_MODEL);
    expect(AI_MODEL.length).toBeGreaterThan(0);
  });

  /**
   * The sibling half of the same defect. Every send site spreads `TEMPERATURE` into the request
   * body, and Anthropic's model reference says of Claude Sonnet 5 and later: "Setting
   * `temperature`, `top_p`, or `top_k` returns a 400 error." The proxy sets no `drop_params`, so
   * the value is not stripped on the way through. Naming a 5-series model while still sending
   * `temperature` therefore swaps #4333's `429` for a `400` on every AI feature — which is why the
   * two constants are pinned together rather than separately. Upgrading is still allowed; it just
   * has to drop `temperature` from the six send sites in the same change, which turns this
   * assertion red first.
   *
   * The early return is what makes that upgrade path legal, and it is only honest because every
   * send site reads the constant rather than its own literal. Deleting `TEMPERATURE` is then a
   * compile error at all six — the four in `ai.service.ts` and both campaign request builders in
   * `campaign-proxy.service.ts` — so the key cannot go away while any site still sends the
   * parameter. Those two campaign builders previously inlined `temperature: 0.7`, which left this
   * check skippable while campaign brief generation (the scrape and ad-copy path) kept sending the
   * forbidden field to a 5-series model.
   */
  it('names a model whose sampling contract accepts the temperature we send', () => {
    if (!('TEMPERATURE' in AI_REQUEST_CONFIG)) return;
    expect(AI_MODEL).not.toMatch(/^claude-(sonnet|opus|haiku)-[5-9]/);
  });
});
