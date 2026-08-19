// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { COUNTRIES, getCountryByCode } from './countries.constants';

/**
 * Asserts properties of the list rather than a hand-copied duplicate of it: a copy would
 * have to be edited in lockstep with the constant and so could never fail. The named
 * codes below are ones that were MISSING while the list held only 89 entries, so a change
 * that truncates it back toward a curated subset fails here loudly.
 */
describe('COUNTRIES', () => {
  it('holds the officially assigned ISO 3166-1 alpha-2 set', () => {
    // 249 officially assigned codes; the range tolerates ISO adding or retiring a country
    // without failing, while still catching a truncation back to a curated subset.
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(245);
    expect(COUNTRIES.length).toBeLessThanOrEqual(252);
  });

  it('uses two uppercase letters for every value', () => {
    const malformed = COUNTRIES.filter((c) => !/^[A-Z]{2}$/.test(c.value));
    expect(malformed).toEqual([]);
  });

  it('has no duplicate values', () => {
    const values = COUNTRIES.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('has a non-empty label for every entry', () => {
    const unlabelled = COUNTRIES.filter((c) => c.label.trim() === '');
    expect(unlabelled).toEqual([]);
  });

  it('has no duplicate labels', () => {
    const labels = COUNTRIES.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('is sorted by label', () => {
    const labels = COUNTRIES.map((c) => c.label);
    // Codepoint ordering, matching how the file is generated; localeCompare would
    // disagree about 'Aland Islands' and give a false failure.
    const sorted = [...labels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(labels).toEqual(sorted);
  });

  it('excludes user-assigned and reserved codes', () => {
    // ZZ is the code the ticket calls out as reaching dispatch as a dead job; EU/UK/SU
    // are reserved rather than assigned and must not be selectable either.
    const values = new Set(COUNTRIES.map((c) => c.value));
    for (const code of ['AA', 'ZZ', 'QM', 'QZ', 'XA', 'XZ', 'EU', 'UK', 'SU', 'AN', 'CS']) {
      expect(values.has(code as never)).toBe(false);
    }
  });

  it('includes small states that the previous 89-entry list omitted', () => {
    const values = new Set(COUNTRIES.map((c) => c.value));
    // MC and LI are the two named in the original finding.
    for (const code of ['MC', 'LI', 'AD', 'SM', 'GL', 'FO', 'AX']) {
      expect(values.has(code as never)).toBe(true);
    }
  });

  it('keeps the codes the pre-existing dropdown already offered', () => {
    const values = new Set(COUNTRIES.map((c) => c.value));
    for (const code of ['US', 'GB', 'IN', 'DE', 'JP', 'BR', 'ZA', 'AU', 'CZ', 'TR']) {
      expect(values.has(code as never)).toBe(true);
    }
  });
});

describe('getCountryByCode', () => {
  it('resolves a known code to its label', () => {
    expect(getCountryByCode('MC')).toBe('Monaco');
  });

  it('echoes an unknown code back unchanged', () => {
    expect(getCountryByCode('ZZ')).toBe('ZZ');
  });
});
