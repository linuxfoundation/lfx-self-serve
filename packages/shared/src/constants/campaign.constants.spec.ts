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

  /** Shape only — eligibility (sanctioned/regulated markets) is the service's call, not this helper's. */
  it('keeps a well-shaped code the service may later reject', () => {
    expect(normalizeGeoTargets(['zz'])).toEqual(['ZZ']);
  });

  it('does not mutate its input', () => {
    const input = ['us', 'US'];
    normalizeGeoTargets(input);
    expect(input).toEqual(['us', 'US']);
  });
});
