// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { DocumentUpdatePatch } from '../interfaces/project.interface';
import { applyDocumentUpdates, mergeDocumentUpdate } from './document-update.utils';

interface Doc {
  uid: string;
  name: string;
  parent_uid?: string;
  updated_at?: string;
}

const OLD = '2026-11-01T10:00:00Z';
const NEW = '2026-11-02T10:00:00Z';
const LATER = '2026-11-03T10:00:00Z';

const fetched = (overrides: Partial<Doc> = {}): Doc[] => [
  { uid: 'd-1', name: 'Minutes', parent_uid: 'f-1', updated_at: OLD, ...overrides },
  { uid: 'd-2', name: 'Agenda' },
];
const patches = (entries: [string, DocumentUpdatePatch][]): Map<string, DocumentUpdatePatch> => new Map(entries);

describe('applyDocumentUpdates', () => {
  it('returns the fetched list as it is when nothing was updated', () => {
    const list = fetched();

    expect(applyDocumentUpdates(list, patches([]))).toBe(list);
  });

  it('applies a rename while the fetched copy is older', () => {
    const [renamed, other] = applyDocumentUpdates(fetched(), patches([['d-1', { name: 'Minutes 2026', updated_at: NEW }]]));

    expect(renamed).toEqual({ uid: 'd-1', name: 'Minutes 2026', parent_uid: 'f-1', updated_at: NEW });
    expect(other).toEqual({ uid: 'd-2', name: 'Agenda' });
  });

  it('applies a move into another folder, and leaves the name alone', () => {
    const [moved] = applyDocumentUpdates(fetched(), patches([['d-1', { parent_uid: 'f-2', updated_at: NEW }]]));

    expect(moved).toMatchObject({ name: 'Minutes', parent_uid: 'f-2' });
  });

  it('applies a move to the root as an absent folder, though the fetched copy still has one', () => {
    const [moved] = applyDocumentUpdates(fetched(), patches([['d-1', { parent_uid: null, updated_at: NEW }]]));

    expect(moved.parent_uid).toBeUndefined();
    expect(moved.name).toBe('Minutes');
  });

  it('lets a later change by someone else show through: a fetched copy stamped after the patch wins', () => {
    const list = fetched({ name: 'Renamed by someone else', updated_at: LATER });

    expect(applyDocumentUpdates(list, patches([['d-1', { name: 'Mine', updated_at: NEW }]]))[0].name).toBe('Renamed by someone else');
  });

  it('applies a patch stamped in the same second as the fetched copy, which whole-second timestamps cannot order', () => {
    const list = fetched({ name: 'Stale copy of the first write', updated_at: NEW });

    expect(applyDocumentUpdates(list, patches([['d-1', { name: 'Second write', updated_at: NEW }]]))[0].name).toBe('Second write');
  });

  it('is done with a patch once the fetched copy has caught up to it', () => {
    const list = fetched({ name: 'Minutes 2026', parent_uid: 'f-2', updated_at: NEW });

    expect(applyDocumentUpdates(list, patches([['d-1', { name: 'Minutes 2026', parent_uid: 'f-2', updated_at: NEW }]]))[0]).toEqual(list[0]);
  });

  it('applies a patch to a fetched copy that has no readable updated_at', () => {
    const list: Doc[] = [{ uid: 'd-1', name: 'Minutes' }];

    expect(applyDocumentUpdates(list, patches([['d-1', { name: 'Minutes 2026', updated_at: NEW }]]))[0].name).toBe('Minutes 2026');
  });

  it('does not apply a patch that has no updated_at over a fetched copy that has one', () => {
    expect(applyDocumentUpdates(fetched(), patches([['d-1', { name: 'Minutes 2026' }]]))[0].name).toBe('Minutes');
  });

  it('ignores a patch for a document that is no longer in the list, and does not change the list it was given', () => {
    const list = fetched();
    const result = applyDocumentUpdates(list, patches([['gone', { name: 'X', updated_at: NEW }]]));

    expect(result).toEqual(list);
    expect(list[0].name).toBe('Minutes');
  });
});

describe('mergeDocumentUpdate', () => {
  it('keeps an earlier rename when the same document is moved afterwards', () => {
    const first = mergeDocumentUpdate(new Map(), 'd-1', { name: 'Minutes 2026', updated_at: NEW });
    const second = mergeDocumentUpdate(first, 'd-1', { parent_uid: 'f-2', updated_at: LATER });

    expect(second.get('d-1')).toEqual({ name: 'Minutes 2026', parent_uid: 'f-2', updated_at: LATER });
  });

  it('does not change the map it was given', () => {
    const before = new Map<string, DocumentUpdatePatch>([['d-1', { name: 'A' }]]);

    mergeDocumentUpdate(before, 'd-2', { name: 'B' });

    expect([...before.keys()]).toEqual(['d-1']);
  });
});
