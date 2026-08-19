// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { campaignToggleAction, normalizeGeoTargets } from './campaign.constants';

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

describe('normalizeGeoTargets', () => {
  it('uppercases lowercase codes', () => {
    expect(normalizeGeoTargets(['us', 'jp'])).toEqual(['US', 'JP']);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeGeoTargets([' US ', '\tJP\n'])).toEqual(['US', 'JP']);
  });

  /** The wire defect: uppercasing alone turned `["us","US"]` into `["US","US"]`. */
  it('collapses codes that differ only in case', () => {
    expect(normalizeGeoTargets(['us', 'US'])).toEqual(['US']);
  });

  it('collapses codes that differ only in whitespace', () => {
    expect(normalizeGeoTargets(['US', ' US'])).toEqual(['US']);
  });

  it('collapses exact repeats', () => {
    expect(normalizeGeoTargets(['US', 'JP', 'US'])).toEqual(['US', 'JP']);
  });

  /** First-seen order, matching campaign-service, so the chip list is stable across a re-render. */
  it('keeps first-seen order', () => {
    expect(normalizeGeoTargets(['jp', 'de', 'us', 'JP'])).toEqual(['JP', 'DE', 'US']);
  });

  it('drops codes that are not two letters', () => {
    expect(normalizeGeoTargets(['US', 'USA', 'U', '', '  ', '1', 'U1'])).toEqual(['US']);
  });

  it('drops non-string entries', () => {
    expect(normalizeGeoTargets(['US', null as unknown as string, undefined as unknown as string, 42 as unknown as string])).toEqual(['US']);
  });

  it('returns an empty list for nullish input', () => {
    expect(normalizeGeoTargets(null)).toEqual([]);
    expect(normalizeGeoTargets(undefined)).toEqual([]);
    expect(normalizeGeoTargets([])).toEqual([]);
  });

  /**
   * ASSIGNMENT is checked here; ELIGIBILITY is not. `ZZ` is well-shaped but sits in the ISO
   * user-assigned range, so no ad platform can ever target it — and the create path filters only
   * regulated markets, so it survived to `geo_locations` and Meta rejected it at AD-SET creation,
   * after the campaign POST had already created a billable resource.
   */
  it('drops a well-shaped code that is not an assigned country', () => {
    expect(normalizeGeoTargets(['zz'])).toEqual([]);
    expect(normalizeGeoTargets(['XA', 'QM', 'AA'])).toEqual([]);
  });

  /**
   * Reserved-but-not-assigned codes are the ones most likely to be typed in good faith: `UK` for
   * the United Kingdom (assigned code `GB`) and `EU` for the bloc. Both must be refused rather
   * than passed through to fail at the ad set.
   */
  it('drops reserved codes that look plausible', () => {
    expect(normalizeGeoTargets(['UK', 'EU'])).toEqual([]);
    expect(normalizeGeoTargets(['GB'])).toEqual(['GB']);
  });

  /**
   * Eligibility remains the SERVICE's call: a sanctioned or regulated market is officially
   * assigned, so it must still pass this helper and be filtered upstream where that list lives.
   * A guard that swept these out here would silently duplicate — and then drift from — that list.
   */
  it('keeps an assigned country the service may later filter', () => {
    expect(normalizeGeoTargets(['sg', 'kr', 'tw'])).toEqual(['SG', 'KR', 'TW']);
  });

  it('does not mutate its input', () => {
    const input = ['us', 'US'];
    normalizeGeoTargets(input);
    expect(input).toEqual(['us', 'US']);
  });
});
