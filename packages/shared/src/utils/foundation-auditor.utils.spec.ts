// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { B2bOrgIndexedDoc, FoundationAuditorOrgEntry, ResolvedOrgRole } from '../interfaces/org-selector.interface';
import { mergeFoundationAuditorOrgs } from './foundation-auditor.utils';

/** Minimal b2b_org display doc fixture. */
function doc(name: string): B2bOrgIndexedDoc {
  return { name, logo_url: null, primary_domain: null, is_member: true };
}

/** Foundation-auditor member-org entry fixture. */
function entry(uid: string): FoundationAuditorOrgEntry {
  return { uid, doc: doc(uid) };
}

describe('mergeFoundationAuditorOrgs', () => {
  it('adds foundation-auditor rows to an empty base (the no-direct-grants foundation auditor case)', () => {
    const result = mergeFoundationAuditorOrgs(new Map(), new Map(), [entry('a'), entry('b')], 500);

    expect(result.addedCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.resolved.get('a')).toEqual<ResolvedOrgRole>({ roleSource: 'foundation-auditor' });
    expect(result.resolved.get('b')).toEqual<ResolvedOrgRole>({ roleSource: 'foundation-auditor' });
    expect(result.orgDocByUid.get('a')?.name).toBe('a');
  });

  it('never overrides an existing direct or inherited grant (base wins)', () => {
    const baseResolved = new Map<string, ResolvedOrgRole>([
      ['a', { roleSource: 'direct-writer' }],
      ['b', { roleSource: 'inherited-auditor', parentUid: 'p', parentName: 'Parent' }],
    ]);
    const baseDocs = new Map<string, B2bOrgIndexedDoc>([
      ['a', doc('direct-a')],
      ['b', doc('inherited-b')],
    ]);

    const result = mergeFoundationAuditorOrgs(baseResolved, baseDocs, [entry('a'), entry('b'), entry('c')], 500);

    // a and b keep their stronger role sources and original docs; only c is added.
    expect(result.resolved.get('a')).toEqual<ResolvedOrgRole>({ roleSource: 'direct-writer' });
    expect(result.resolved.get('b')?.roleSource).toBe('inherited-auditor');
    expect(result.orgDocByUid.get('a')?.name).toBe('direct-a');
    expect(result.resolved.get('c')).toEqual<ResolvedOrgRole>({ roleSource: 'foundation-auditor' });
    expect(result.addedCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('caps additive rows without dropping base rows and flags truncation', () => {
    const baseResolved = new Map<string, ResolvedOrgRole>([['x', { roleSource: 'direct-auditor' }]]);
    const baseDocs = new Map<string, B2bOrgIndexedDoc>([['x', doc('x')]]);

    // cap = 2, base already holds 1 → only one foundation-auditor row fits.
    const result = mergeFoundationAuditorOrgs(baseResolved, baseDocs, [entry('a'), entry('b'), entry('c')], 2);

    expect(result.resolved.has('x')).toBe(true); // base row preserved
    expect(result.addedCount).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.resolved.size).toBe(2);
  });

  it('returns base unchanged when there are no foundation-auditor orgs', () => {
    const baseResolved = new Map<string, ResolvedOrgRole>([['a', { roleSource: 'direct-writer' }]]);
    const baseDocs = new Map<string, B2bOrgIndexedDoc>([['a', doc('a')]]);

    const result = mergeFoundationAuditorOrgs(baseResolved, baseDocs, [], 500);

    expect(result.addedCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect([...result.resolved]).toEqual([...baseResolved]);
  });

  it('deduplicates repeated foundation-auditor uids (member org shared by two audited foundations)', () => {
    const result = mergeFoundationAuditorOrgs(new Map(), new Map(), [entry('a'), entry('a'), entry('b')], 500);

    expect(result.addedCount).toBe(2);
    expect(result.resolved.size).toBe(2);
  });

  it('skips entries with an empty uid', () => {
    const result = mergeFoundationAuditorOrgs(new Map(), new Map(), [entry(''), entry('a')], 500);

    expect(result.addedCount).toBe(1);
    expect(result.resolved.has('a')).toBe(true);
  });

  it('does not mutate the input maps', () => {
    const baseResolved = new Map<string, ResolvedOrgRole>([['a', { roleSource: 'direct-writer' }]]);
    const baseDocs = new Map<string, B2bOrgIndexedDoc>([['a', doc('a')]]);

    mergeFoundationAuditorOrgs(baseResolved, baseDocs, [entry('b')], 500);

    expect(baseResolved.size).toBe(1);
    expect(baseDocs.size).toBe(1);
  });
});
