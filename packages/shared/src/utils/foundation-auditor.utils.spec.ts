// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { B2bOrgIndexedDoc, FoundationAuditorOrgEntry, OrgItem } from '../interfaces/org-selector.interface';
import { appendFoundationAuditorItems } from './foundation-auditor.utils';

/** Minimal b2b_org display doc fixture. */
function doc(name: string): B2bOrgIndexedDoc {
  return { name, logo_url: null, primary_domain: 'example.com', is_member: true };
}

/** Foundation-auditor member-org entry fixture. */
function entry(uid: string): FoundationAuditorOrgEntry {
  return { uid, doc: doc(uid) };
}

/** Grants-derived selector row fixture. */
function item(uid: string, overrides: Partial<OrgItem> = {}): OrgItem {
  return { uid, accountId: uid, name: uid, logoUrl: null, parentName: null, ...overrides };
}

describe('appendFoundationAuditorItems', () => {
  it('appends foundation-auditor rows to an empty base (the no-direct-grants auditor case)', () => {
    const result = appendFoundationAuditorItems([], [entry('a'), entry('b')], 500);

    expect(result.addedCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].roleSource).toBe('foundation-auditor');
    expect(result.items[0].accountId).toBe('a');
    expect(result.items[0].primaryDomain).toBe('example.com');
  });

  it('never overrides a grants-derived row for the same org (base wins)', () => {
    const base = [item('a', { name: 'Direct A' }), item('b', { name: 'Inherited B' })];

    const result = appendFoundationAuditorItems(base, [entry('a'), entry('b'), entry('c')], 500);

    // a and b keep their grants-derived rows (no roleSource downgrade); only c is appended.
    expect(result.items).toHaveLength(3);
    expect(result.items[0].name).toBe('Direct A');
    expect(result.items[0].roleSource).toBeUndefined();
    expect(result.items[1].roleSource).toBeUndefined();
    expect(result.items[2].uid).toBe('c');
    expect(result.items[2].roleSource).toBe('foundation-auditor');
    expect(result.addedCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('caps appended rows without dropping base rows and flags truncation', () => {
    const base = [item('x')];

    const result = appendFoundationAuditorItems(base, [entry('a'), entry('b'), entry('c')], 2);

    expect(result.items[0].uid).toBe('x'); // base row preserved
    expect(result.addedCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(3);
  });

  it('returns base unchanged when there are no foundation-auditor orgs', () => {
    const base = [item('a')];

    const result = appendFoundationAuditorItems(base, [], 500);

    expect(result.addedCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.items).toEqual(base);
  });

  it('deduplicates repeated uids (org matched via two audited foundations)', () => {
    const result = appendFoundationAuditorItems([], [entry('a'), entry('a'), entry('b')], 500);

    expect(result.addedCount).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('skips entries with an empty uid', () => {
    const result = appendFoundationAuditorItems([], [entry(''), entry('a')], 500);

    expect(result.addedCount).toBe(1);
    expect(result.items[0].uid).toBe('a');
  });

  it('does not mutate the input array', () => {
    const base = [item('a')];

    appendFoundationAuditorItems(base, [entry('b')], 500);

    expect(base).toHaveLength(1);
  });
});
