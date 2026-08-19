// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { campaignToggleAction } from './campaign.constants';

/**
 * `campaignToggleAction` decides whether a campaign row offers Pause, Resume, or nothing. It runs
 * inside the `campaignRows` computed, once per row, over documents that arrive straight from the
 * Query Service index — the BFF spreads them through untouched.
 *
 * These live in `packages/shared` rather than beside the component on purpose: the function is the
 * shared owner of that decision, and a component-only test would leave the predicate itself
 * unguarded for every other consumer.
 */
describe('campaignToggleAction', () => {
  it('offers pause for the statuses that are running upstream', () => {
    expect(campaignToggleAction('created', 'google-ads')).toBe('pause');
    expect(campaignToggleAction('active', 'google-ads')).toBe('pause');
  });

  /** Spending but refused a resume with 409 — pauseable, never resumable. */
  it('keeps created_degraded pauseable', () => {
    expect(campaignToggleAction('created_degraded', 'google-ads')).toBe('pause');
  });

  it('offers resume for a paused campaign', () => {
    expect(campaignToggleAction('paused', 'google-ads')).toBe('resume');
  });

  it('compares status case-insensitively', () => {
    expect(campaignToggleAction('CREATED', 'google-ads')).toBe('pause');
    expect(campaignToggleAction('Paused', 'google-ads')).toBe('resume');
  });

  /**
   * `enabled` is a Google Ads platform word, not a campaign-service status — it appears nowhere in
   * `internal/domain/model`. Mapping it onto Pause would be the fail-OPEN direction.
   */
  it('treats a status the service never writes as unknown', () => {
    expect(campaignToggleAction('enabled', 'google-ads')).toBe('unavailable');
  });

  it('refuses a platform this app does not offer, at any status', () => {
    expect(campaignToggleAction('created', 'microsoft-ads')).toBe('unavailable');
    expect(campaignToggleAction('paused', 'twitter-ads')).toBe('unavailable');
  });

  /** Optional so the status-only question stays askable; absence is not "unsupported". */
  it('does not read an absent platform as unsupported', () => {
    expect(campaignToggleAction('created')).toBe('pause');
  });

  /**
   * The wire is not typed at runtime. `CampaignIndexDoc.status` is declared `string`, but nothing
   * between the index and this call validates it, so a missing or non-string status arrives
   * intact. `.toLowerCase()` on it threw a TypeError — and because the call is inside a computed
   * that maps EVERY row, one malformed document blanked the entire campaigns section rather than
   * one row, re-throwing on each change-detection pass.
   *
   * The binding assertion is that each of these RETURNS `unavailable`. Asserting merely that the
   * call does not throw would pass on a guard that returned `pause`, which is the fail-open answer
   * this function exists to avoid.
   */
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 123],
    ['an object', {}],
    ['an empty string', ''],
  ])('falls closed to unavailable for %s rather than throwing', (_label, status) => {
    expect(campaignToggleAction(status as unknown as string, 'google-ads')).toBe('unavailable');
  });
});
