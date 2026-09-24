// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { dedupeByKey, fromColumnar, isColumnarAbsent, isColumnarTable, toColumnar } from './compact-cache.utils';

interface Row {
  id: string;
  name: string | null;
  count: number;
  /** Optional on purpose: the absent-vs-null distinction below is what these tests exist to pin. */
  badge?: string;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', count: 1, badge: 'writer' },
  { id: 'b', name: null, count: 2 },
];
const KEYS = ['id', 'name', 'count', 'badge'] as const;

const roundTrip = (rows: readonly Row[]): Row[] => fromColumnar<Row>(JSON.parse(JSON.stringify(toColumnar(rows, KEYS))));

describe('toColumnar / fromColumnar', () => {
  // The invariant every compacted cache rests on: what a service returns on a cache HIT must equal
  // what it returned on the MISS that populated it. Serializing in between is the point — the
  // encoded value only ever reaches a decoder via JSON.
  it('round-trips rows unchanged through JSON', () => {
    expect(roundTrip(ROWS)).toEqual(ROWS);
  });

  // The regression this sentinel exists for. `JSON.stringify` drops an undefined-valued key, so an
  // optional field the source left unset never reaches the client on a miss. Collapsing absent to
  // null at encode time would make the very same response carry `"badge": null` on a hit —
  // a warm-vs-cold-cache wire difference, which is the worst class of bug to trace.
  it('serializes a cache hit identically to the miss that populated it', () => {
    const miss: Row[] = [{ id: 'b', name: null, count: 2 }];

    expect(JSON.stringify(roundTrip(miss))).toBe(JSON.stringify(miss));
    expect('badge' in roundTrip(miss)[0]).toBe(false);
  });

  // The other half of the same distinction: a field that genuinely held null must come back null,
  // not vanish. Dropping every falsy field would silently change what the client renders.
  it('preserves an explicit null instead of treating it as absent', () => {
    const [decoded] = roundTrip([{ id: 'a', name: null, count: 1, badge: 'writer' }]);

    expect(decoded.name).toBeNull();
    expect('name' in decoded).toBe(true);
  });

  // The absence marker is itself a legal string, so a real value equal to it — or merely starting
  // with the same NUL — must survive rather than be silently dropped. This matters on the COLD path
  // too: a caller that decodes its freshly fetched value would otherwise lose the field on a miss.
  it.each([['\u0000'], ['\u0000absent'], ['\u0000\u0000x'], ['x\u0000']])('round-trips the real string %j exactly', (name) => {
    const [decoded] = roundTrip([{ id: 'a', name, count: 1 }]);

    expect(decoded.name).toBe(name);
  });

  // A truncated entry (another writer, a partial value) must not start asserting null for a field
  // it never carried — absent is the honest answer, and it matches what a miss would serialize.
  it('treats a truncated row tail as absent', () => {
    expect(fromColumnar<Row>({ k: [...KEYS], r: [['a']] })).toEqual([{ id: 'a' }]);
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
  // than reaching fromColumnar and decoding into empty objects.
  it.each([[[{ id: 'a' }]], [null], [{ k: 'id', r: [] }], [{ k: ['id'], r: [{ id: 'a' }] }], [{ k: [1], r: [] }]])('rejects %p', (value) => {
    expect(isColumnarTable(value)).toBe(false);
  });
});

describe('isColumnarAbsent', () => {
  // Positional cache guards inspect stored cells BEFORE decode, so a required column has to be able
  // to tell "the field never arrived" from "the field holds null" and from an ordinary string —
  // otherwise a missing required value would pass as a present one.
  it('identifies only the encoded absence of a field', () => {
    const [absentCell, nullCell, stringCell] = toColumnar([{ id: 'a', name: null } as Row], ['badge', 'name', 'id']).r[0];

    expect(isColumnarAbsent(absentCell)).toBe(true);
    expect(isColumnarAbsent(nullCell)).toBe(false);
    expect(isColumnarAbsent(stringCell)).toBe(false);
    // A real string that merely looks like the marker is escaped, so it is never taken for absence.
    const [escapedCell] = toColumnar([{ id: 'a', name: '\u0000', count: 1 } as Row], ['name']).r[0];
    expect(isColumnarAbsent(escapedCell)).toBe(false);
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
