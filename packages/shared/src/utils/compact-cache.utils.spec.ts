// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { dedupeByKey, fromColumnar, isColumnarTable, toColumnar } from './compact-cache.utils';

interface Row {
  id: string;
  name: string | null;
  count: number;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', count: 1 },
  { id: 'b', name: null, count: 2 },
];
const KEYS = ['id', 'name', 'count'] as const;

describe('toColumnar / fromColumnar', () => {
  // The invariant every compacted cache rests on: what the service returns after a cache hit must
  // equal what it returned on the miss that populated it. Serializing in between is the point —
  // the encoded value only ever reaches a decoder via JSON.
  it('round-trips rows unchanged through JSON', () => {
    const encoded = JSON.parse(JSON.stringify(toColumnar(ROWS, KEYS)));

    expect(fromColumnar<Row>(encoded)).toEqual(ROWS);
  });

  // An absent field must decode as an explicit null, not a missing key: the cache shape guards read
  // fields off the decoded row, and `undefined` would make a stored row and a re-fetched row
  // disagree about whether the field exists.
  it('normalizes a missing field to null rather than dropping the key', () => {
    const [decoded] = fromColumnar<Row>(toColumnar([{ id: 'a', count: 1 } as Row], KEYS));

    expect(decoded).toEqual({ id: 'a', name: null, count: 1 });
    expect('name' in decoded).toBe(true);
  });

  // A truncated entry (another writer, a partial value) must degrade to the same shape as a row of
  // nulls instead of producing undefined fields the guards would then have to special-case.
  it('fills a short row with nulls', () => {
    expect(fromColumnar<Row>({ k: [...KEYS], r: [['a']] })).toEqual([{ id: 'a', name: null, count: null }]);
  });

  // Decoding is driven by the stored key list, so an entry written before the key order changed
  // still rebuilds correctly — the version bump guards shape changes, not ordering.
  it('decodes by the stored key order, not the caller declaration order', () => {
    expect(fromColumnar<Row>({ k: ['count', 'name', 'id'], r: [[7, 'Alpha', 'a']] })).toEqual([{ id: 'a', name: 'Alpha', count: 7 }]);
  });
});

describe('isColumnarTable', () => {
  it('accepts an encoded table', () => {
    expect(isColumnarTable(toColumnar(ROWS, KEYS))).toBe(true);
  });

  // A pre-compaction entry is a plain row array. It has to miss so the caller re-fetches, rather
  // than reaching fromColumnar and decoding into rows of undefined.
  it.each([[[{ id: 'a' }]], [null], [{ k: 'id', r: [] }], [{ k: ['id'], r: [{ id: 'a' }] }], [{ k: [1], r: [] }]])('rejects %p', (value) => {
    expect(isColumnarTable(value)).toBe(false);
  });
});

describe('dedupeByKey', () => {
  // Dictionary encoding is only correct if every index reference resolves back to the value the row
  // originally carried; that resolution is what replaces the repeated copies in the cached payload.
  it('stores each distinct value once and resolves references back to it', () => {
    const people = [
      { id: 'p1', name: 'Ada' },
      { id: 'p2', name: 'Grace' },
      { id: 'p1', name: 'Ada' },
    ];

    const { values, indexOf } = dedupeByKey(people, (person) => person.id);

    expect(values).toHaveLength(2);
    expect(people.map((person) => values[indexOf.get(person.id)!])).toEqual(people);
  });

  // First occurrence wins, so the retained value matches the order the caller already sorted by.
  it('keeps the first occurrence of a duplicate key', () => {
    const { values } = dedupeByKey(
      [
        { id: 'p1', name: 'first' },
        { id: 'p1', name: 'second' },
      ],
      (person) => person.id
    );

    expect(values).toEqual([{ id: 'p1', name: 'first' }]);
  });
});
