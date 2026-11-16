// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { findAiSamplingRule, getAiSamplingParams, resolveAiSamplingMode } from '../utils/ai.utils';
import { AI_MODEL, AI_PUBLISHED_MODEL_NAME_PATTERN, AI_REQUEST_CONFIG, AI_SAMPLING_COMPATIBILITY } from './ai.constants';

/**
 * The first two cases pin the default's shape only, never which model is named — that is expected
 * to roll forward as models are upgraded, and pinning it would turn every upgrade into a test edit.
 * The `AI_SAMPLING_COMPATIBILITY` cases below pin the sampling contract, which is a separate concern
 * and carries its own reasoning.
 *
 * This cannot catch the real failure end to end. `AI_MODEL` is only ever wrong *relative to* the
 * proxy `AI_PROXY_URL` names, and both that host and its published `model_list` live in argocd
 * rather than in this repo, so no test here can see the pairing. What it does catch is the half of
 * it this repo owns: both service specs that touch the model mock it away
 * (`ai.service.spec.ts`, `weekly-brief.service.spec.ts`), so without this a future edit could
 * reintroduce a Bedrock routing id with a fully green suite and reproduce #4333 — an outage whose
 * only symptom was a `429` from the proxy, the code a router returns when it publishes no
 * deployment for the model asked for.
 *
 * A Bedrock routing id (what #4333 sent) takes two forms, and the character class below rejects
 * both. A provider-prefixed id carries a `/` (`bedrock/…`, `openai/…`). A bare Bedrock
 * inference-profile id — the same destination with its prefix stripped,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` — carries no `/` at all, but does carry dots and a
 * colon. Every name the proxy publishes is lower-case letters, digits and hyphens only
 * (`claude-sonnet-4-5`, `amazon-nova-pro`). A well-formed name the proxy simply does not publish
 * (`claude-opus-4-5`, `claude-haiku-4-5-20251001`) still passes; only argocd's `model_list` can rule
 * it out. Rejecting the shape also keeps the sampling table's `^claude-` anchors sound, since they
 * match no Bedrock-id spelling however new the model.
 */
describe('AI_MODEL', () => {
  it('is not a Bedrock routing id in either spelling the proxy answers 429 to (#4333)', () => {
    expect(AI_MODEL).not.toContain('/');
    expect(AI_MODEL).toMatch(AI_PUBLISHED_MODEL_NAME_PATTERN);
  });

  it('is a non-empty value, so no request falls back to an unrouted empty model', () => {
    expect(AI_MODEL.trim()).toBe(AI_MODEL);
    expect(AI_MODEL.length).toBeGreaterThan(0);
  });

  it('keeps sending temperature by default, so shipping the guard changes nothing on the wire', () => {
    expect(resolveAiSamplingMode(AI_MODEL)).toBe('temperature');
  });
});

/**
 * Anthropic's extended-thinking doc (platform.claude.com/docs/en/build-with-claude/thinking,
 * "sampling parameters") lists Claude Opus 4.8 and Opus 4.7 alongside Sonnet 5.5, Sonnet 5 and Haiku
 * 5.5 as returning a `400` on a non-default `temperature`, `top_p` or `top_k` — on every request,
 * thinking or not. That is "Claude Opus 4.7 or later, or any 5-series Claude model", wider than the
 * `[5-9]` boundary this spec used to assert (#4460). The proxy sets no `drop_params`, so a value we
 * send is not stripped on the way through.
 *
 * The table is an allowlist: only a row can grant `temperature`, and a name no row matches gets
 * nothing. So the cases below assert both directions — every family the doc names resolves to
 * `none`, and names the table has never seen do too.
 */
describe('AI_SAMPLING_COMPATIBILITY', () => {
  it.each([
    ['claude-sonnet-4', 'temperature'],
    ['claude-sonnet-4-5', 'temperature'],
    ['claude-sonnet-4-5-20250929', 'temperature'],
    ['claude-sonnet-4-6', 'temperature'],
    ['claude-opus-4', 'temperature'],
    ['claude-opus-4-1', 'temperature'],
    ['claude-opus-4-5', 'temperature'],
    ['claude-opus-4-6', 'temperature'],
    ['claude-haiku-4-5', 'temperature'],
    ['claude-haiku-4-5-20251001', 'temperature'],
    ['claude-opus-4-7', 'none'],
    ['claude-opus-4-8', 'none'],
    ['claude-opus-4-9', 'none'],
    ['claude-sonnet-5', 'none'],
    ['claude-sonnet-5-5', 'none'],
    ['claude-opus-5', 'none'],
    ['claude-opus-5-5', 'none'],
    ['claude-haiku-5-5', 'none'],
    ['claude-sonnet-6', 'none'],
    ['claude-fable-5-1', 'none'],
    ['claude-opus-4-10', 'none'],
    ['claude-sonnet-4-7', 'none'],
    ['amazon-nova-pro', 'none'],
    ['bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'none'],
    ['', 'none'],
  ] as const)('%s → %s', (model, mode) => {
    expect(resolveAiSamplingMode(model)).toBe(mode);
  });

  it('rejects everything the #4460 boundary names, so the table is at least as wide as the doc', () => {
    const boundary = /^claude-(?:(?:sonnet|opus|haiku)-[5-9]|opus-4-[7-9])/;
    for (const model of ['claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']) {
      expect(model).toMatch(boundary);
      expect(resolveAiSamplingMode(model)).toBe('none');
    }
  });

  it('labels every row, so the startup log can name the family it matched', () => {
    for (const rule of AI_SAMPLING_COMPATIBILITY) {
      expect(rule.family.length).toBeGreaterThan(0);
    }
    expect(findAiSamplingRule('claude-opus-4-8')?.family).toBe('Claude Opus 4.7 and later');
    expect(findAiSamplingRule('amazon-nova-pro')).toBeUndefined();
  });

  it('emits temperature alone for an accepting model, never top_p', () => {
    expect(getAiSamplingParams('claude-sonnet-4-5')).toEqual({ temperature: AI_REQUEST_CONFIG.TEMPERATURE });
  });

  it('emits no sampling key at all for a rejecting or unknown model', () => {
    expect(getAiSamplingParams('claude-sonnet-5-5')).toEqual({});
    expect(Object.keys(getAiSamplingParams('some-future-model'))).toEqual([]);
  });
});
