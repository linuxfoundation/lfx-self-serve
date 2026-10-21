// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { LINKEDIN_ABOUT_FIELDS, LINKEDIN_CONTENT_SOURCES } from '../constants/linkedin-post.constants';
import type { LinkedinEnvelope, LinkedinSetup } from '../interfaces/linkedin-post.interface';
import { isLinkedinEnvelope, isLinkedinProfile, isLinkedinSetup } from './linkedin-post-envelope.utils';
import { linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from './linkedin-post.utils';

const setup: LinkedinSetup = { name: 'Example author', role: 'Maintainer', focus_areas: 'Open source', primary_audience: 'Developers' };
function envelope(): LinkedinEnvelope {
  const profile = linkedinProfileFromSetup(setup);
  return {
    contract: 'linkedin-post-output/v1',
    kind: 'linkedin-post',
    version: 1,
    options: [1, 2, 3].map((number) => ({
      number,
      label: `Angle ${number}`,
      text: 'A synthetic release. [LINK]',
      word_count: 5,
      hashtags: ['#Release', '#Community', '#Code'],
      tagging_suggestions: ['Example project'],
    })),
    document_markdown: 'Synthetic document',
    content_sha256: 'a'.repeat(64),
    profile_source: 'first_run_setup',
    profile,
    profile_markdown: renderLinkedinProfileMarkdown(profile),
    inputs: { content_source: 'text', feedback_provided: false },
    generated_at: '2026-10-15T10:00:00Z',
    agent: { identifier: 'linux-foundation~linkedin-post', agent_version: '1.0.0', prompt_manifest_sha256: 'b'.repeat(64) },
  };
}
describe('LinkedIn envelope validation', () => {
  it.each(['saved_profile', 'first_run_setup'])('rejects array-valued profile_source %j without string coercion', (source) => {
    expect(isLinkedinEnvelope({ ...envelope(), profile_source: [source] })).toBe(false);
  });
  it('accepts additive research provenance without weakening known render fields', () => {
    const original = envelope();
    expect(
      isLinkedinEnvelope({
        ...original,
        inputs: { ...original.inputs, research: { fetches: [], searches: [], lfx_records: [], questions: [], answers: [] }, future_provenance: true },
      })
    ).toBe(true);
    expect(isLinkedinEnvelope({ ...original, inputs: { ...original.inputs, feedback_provided: 'false', research: {} } })).toBe(false);
  });
  it('validates strict setup and every schema field and cross-field gate', () => {
    expect(isLinkedinSetup(setup)).toBe(true);
    expect(isLinkedinSetup({ ...setup, feedback: 'forbidden' })).toBe(false);
    expect(isLinkedinEnvelope(envelope())).toBe(true);
    for (const patch of [
      { kind: 'other' },
      { unexpected: true },
      { version: 2 },
      { profile_markdown: 'wrong' },
      { options: [] },
      { inputs: { content_source: 'url', feedback_provided: false } },
      { notes: ['x'.repeat(201)] },
      { profile_update_note: 'Voice change without feedback' },
    ])
      expect(isLinkedinEnvelope({ ...envelope(), ...patch })).toBe(false);
  });
  it('validates required personalization and configured sources', () => {
    for (const field of LINKEDIN_ABOUT_FIELDS.filter((field) => field.key !== 'associated_projects')) {
      expect(isLinkedinSetup({ ...setup, [field.key]: '' })).toBe(false);
    }
    for (const source of LINKEDIN_CONTENT_SOURCES) {
      expect(
        isLinkedinEnvelope({
          ...envelope(),
          inputs: {
            content_source: source.value,
            feedback_provided: false,
            ...(source.value === 'url' ? { content_url: 'https://public.example/release' } : {}),
          },
        })
      ).toBe(true);
    }
    expect(isLinkedinEnvelope({ ...envelope(), inputs: { content_source: 'unsupported', feedback_provided: false } })).toBe(false);
  });
  it('caps every About and Voice field on the full-profile path', () => {
    const profile = linkedinProfileFromSetup(setup);
    for (const section of ['about', 'voice'] as const) {
      for (const key of Object.keys(profile[section])) {
        expect(isLinkedinProfile({ ...profile, [section]: { ...profile[section], [key]: 'x'.repeat(4001) } })).toBe(false);
        expect(isLinkedinProfile({ ...profile, [section]: { ...profile[section], [key]: 'x'.repeat(4000) } })).toBe(true);
      }
    }
  });
  it('accepts a future profile-update offer and separate notes on a valid feedback envelope', () => {
    expect(
      isLinkedinEnvelope({
        ...envelope(),
        version: 2,
        inputs: { content_source: 'text', feedback_provided: true },
        profile_update_note: 'A more direct voice',
        notes: ['Verify handles before tagging.'],
      })
    ).toBe(true);
  });
});
