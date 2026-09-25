// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  dedupeByKey,
  fromColumnar,
  hasExactColumns,
  isColumnarAbsent,
  isColumnarTable,
  isStoredNullableNumber,
  isStoredNullableString,
  isStoredString,
  toColumnar,
  tupleKey,
} from './compact-cache.utils';

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

describe('hasExactColumns', () => {
  it('accepts exactly what the writer emits', () => {
    expect(hasExactColumns(toColumnar(ROWS, KEYS), KEYS)).toBe(true);
  });

  // Each of these decodes "successfully" through fromColumnar into an object that is missing data
  // the writer always emits — a duplicated column lets the later value overwrite the earlier one,
  // and a short row silently drops its tail as absent — so a guard has to reject them up front.
  it.each([
    ['a duplicated column', { k: ['id', 'id'], r: [['a', 'b']] }, ['id', 'name']],
    ['a missing column', { k: ['id'], r: [['a']] }, ['id', 'name']],
    ['an extra column', { k: ['id', 'name', 'x'], r: [['a', 'b', 'c']] }, ['id', 'name']],
    ['reordered columns', { k: ['name', 'id'], r: [['b', 'a']] }, ['id', 'name']],
    ['a short row', { k: ['id', 'name'], r: [['a']] }, ['id', 'name']],
    ['a long row', { k: ['id', 'name'], r: [['a', 'b', 'c']] }, ['id', 'name']],
  ])('rejects %s', (_label, table, keys) => {
    expect(hasExactColumns(table, keys)).toBe(false);
  });
});

describe('isColumnarAbsent', () => {
  // Positional cache guards inspect stored cells BEFORE decode, so a required column has to be able
  // to tell "the field never arrived" from "the field holds null" and from an ordinary string —
  // otherwise a missing required value would pass as a present one.
  it('identifies only the encoded absence of a field', () => {
    // Typed as `Row` rather than inferred, so `badge` — the optional field whose absence is the
    // whole point — is a legal key for `toColumnar` to project.
    const unbadged: Row[] = [{ id: 'a', name: null, count: 0 }];
    const [absentCell, nullCell, stringCell] = toColumnar(unbadged, ['badge', 'name', 'id']).r[0];

    expect(isColumnarAbsent(absentCell)).toBe(true);
    expect(isColumnarAbsent(nullCell)).toBe(false);
    expect(isColumnarAbsent(stringCell)).toBe(false);
    // A real string that merely looks like the marker is escaped, so it is never taken for absence.
    const looksLikeMarker: Row[] = [{ id: 'a', name: '\u0000', count: 1 }];
    const [escapedCell] = toColumnar(looksLikeMarker, ['name']).r[0];
    expect(isColumnarAbsent(escapedCell)).toBe(false);
  });
});

describe('isStoredString / isStoredNullableString / isStoredNullableNumber', () => {
  // The value half of every positional cache guard: each has to tell a real value from the absence
  // marker, from null and from a wrong type, or a corrupt entry decodes into a row the mapper reads.
  const [[absentCell, nullCell, stringCell, escapedCell]] = toColumnar<{ a?: string; b: string | null; c: string; d: string }>(
    [{ b: null, c: 'x', d: '\u0000' }],
    ['a', 'b', 'c', 'd']
  ).r;

  it.each([
    ['the absence marker', absentCell, false, false, false],
    ['null', nullCell, false, true, true],
    ['a string', stringCell, true, true, false],
    ['an escaped real string that looks like the marker', escapedCell, true, true, false],
    ['a number', 42, false, false, true],
    ['an object', {}, false, false, false],
  ])('classifies %s', (_label, cell, storedString, storedNullableString, storedNullableNumber) => {
    expect(isStoredString(cell)).toBe(storedString);
    expect(isStoredNullableString(cell)).toBe(storedNullableString);
    expect(isStoredNullableNumber(cell)).toBe(storedNullableNumber);
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

describe('tupleKey', () => {
  // Every dictionary key in the compacted caches is built from this, so an ambiguity here silently
  // replaces one record with another — the exact defect a uid-only key would have caused.
  it('distinguishes absent from null from empty string', () => {
    expect(new Set([tupleKey([undefined]), tupleKey([null]), tupleKey([''])]).size).toBe(3);
  });

  // Any single-character separator is legal inside a display name or a URL, so a delimiter join
  // maps these two distinct people onto one key.
  it('distinguishes tuples that a delimiter join would collapse', () => {
    expect(tupleKey(['p', 'a\u0000b', 'c'])).not.toBe(tupleKey(['p', 'a', 'b\u0000c']));
  });

  // The separator must be unreachable from inside a part: JSON escapes every control character.
  it('distinguishes a value containing the separator from a tuple boundary', () => {
    expect(tupleKey(['a\u0001b'])).not.toBe(tupleKey(['a', 'b']));
  });

  it('gives equal tuples the same key, so rows that genuinely agree still collapse', () => {
    expect(tupleKey(['p', null, 1])).toBe(tupleKey(['p', null, 1]));
  });
});
