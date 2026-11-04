// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { mergeFormationRecord, validateFormationRecordBody } from './formation-record.helper';

describe('validateFormationRecordBody', () => {
  it('returns trimmed recognised keys only', () => {
    expect(validateFormationRecordBody({ stage: 'Active', legal_entity_name: '  Cascade Data LLC ' })).toEqual({
      stage: 'Active',
      legal_entity_name: 'Cascade Data LLC',
    });
  });

  it.each([null, [], 'x', 1])('rejects a non-object body (%s)', (body) => {
    expect(() => validateFormationRecordBody(body)).toThrowError(/Validation failed/);
  });

  it('rejects non-string values', () => {
    expect(() => validateFormationRecordBody({ stage: 5 })).toThrowError(/stage/);
  });

  it('rejects an impossible calendar date', () => {
    expect(() => validateFormationRecordBody({ formation_date: '2026-02-31' })).toThrowError(/formation_date/);
  });

  it('uses the archive copy when Archived has no dissolution date', () => {
    try {
      validateFormationRecordBody({ stage: 'Archived' });
      expect.unreachable();
    } catch (error) {
      expect((error as { validationErrors: { message: string }[] }).validationErrors[0].message).toBe('Archiving needs a dissolution date.');
    }
  });
});

describe('mergeFormationRecord', () => {
  const stored = { uid: 'u', slug: 's', name: 'N', description: 'D', parent_uid: 'p', stage: 'Active', funding_model: ['a'], created_at: 'x', updated_at: 'y' };

  it('changes nothing but the edited keys and strips read-only fields', () => {
    expect(mergeFormationRecord(stored, { stage: 'Archived', entity_dissolution_date: '2026-10-31' })).toEqual({
      slug: 's',
      name: 'N',
      description: 'D',
      parent_uid: 'p',
      stage: 'Archived',
      funding_model: ['a'],
      entity_dissolution_date: '2026-10-31',
    });
  });

  it('does not mutate the stored object', () => {
    const copy = structuredClone(stored);
    mergeFormationRecord(stored, { stage: 'Archived', entity_dissolution_date: '2026-10-31' });
    expect(stored).toEqual(copy);
  });
});
