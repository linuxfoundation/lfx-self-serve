// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { normalizeGeoTargets } from './campaign.constants';

/**
 * `normalizeGeoTargets` is the single owner of Meta geo normalisation, shared by the campaign
 * form's chip add path, its brief-seed path, and the server's `validateGeoTargets`. It exists
 * because those three used to disagree: the add path uppercased and de-duped, the seed path did
 * neither, and the server uppercased WITHOUT de-duping — so a brief carrying `us` plus a typed
 * `US` produced two chips and shipped `["US","US"]` to Meta.
 *
 * De-duping is asserted here rather than in either consumer because it is the property that has
 * to hold identically on both layers; a consumer-only test would let one side regress silently.
 */
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
