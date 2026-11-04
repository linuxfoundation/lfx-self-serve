// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { assertMergedRecordValid, mergeFormationRecord, validateFormationRecordBody } from './formation-record.helper';

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

  it('accepts null for the five nullable fields and normalizes it to the clearing empty string', () => {
    expect(
      validateFormationRecordBody({
        legal_entity_name: null,
        legal_entity_type: null,
        formation_date: null,
        entity_dissolution_date: null,
        entity_formation_document_url: null,
      })
    ).toEqual({ legal_entity_name: '', legal_entity_type: '', formation_date: '', entity_dissolution_date: '', entity_formation_document_url: '' });
  });

  it('keeps rejecting a null stage', () => {
    expect(() => validateFormationRecordBody({ stage: null })).toThrowError(/stage/);
  });

  it.each(['parent_uid', 'legal_parent_uid', 'slug', 'public', '__proto__'])('rejects the non-editable key %s (mass-assignment guard)', (key) => {
    const body = JSON.parse(`{"stage":"Active","${key}":"x"}`);
    expect(() => validateFormationRecordBody(body)).toThrowError(new RegExp(key));
  });

  it('rejects oversized free-text values', () => {
    expect(() => validateFormationRecordBody({ legal_entity_name: 'a'.repeat(256) })).toThrowError(/legal_entity_name/);
    expect(() => validateFormationRecordBody({ entity_formation_document_url: `https://x.example/${'a'.repeat(2048)}` })).toThrowError(
      /entity_formation_document_url/
    );
  });

  it('rejects an impossible calendar date', () => {
    expect(() => validateFormationRecordBody({ formation_date: '2026-02-31' })).toThrowError(/formation_date/);
  });

  it('gives a malformed dissolution date the generic field code, not the Archived-rule code', () => {
    try {
      validateFormationRecordBody({ stage: 'Archived', entity_dissolution_date: '2026-02-31' });
      expect.unreachable();
    } catch (error) {
      expect((error as { validationErrors: { field: string; code: string }[] }).validationErrors[0]).toMatchObject({
        field: 'entity_dissolution_date',
        code: 'FIELD_VALIDATION_ERROR',
      });
    }
  });

  it('defers the Archived requirement to the merged record when the body omits the date', () => {
    expect(validateFormationRecordBody({ stage: 'Archived' })).toEqual({ stage: 'Archived' });
  });

  it('uses the archive copy when Archived explicitly clears the dissolution date', () => {
    try {
      validateFormationRecordBody({ stage: 'Archived', entity_dissolution_date: null });
      expect.unreachable();
    } catch (error) {
      const entry = (error as { validationErrors: { message: string; code: string }[] }).validationErrors[0];
      expect(entry.message).toBe('Archiving needs a dissolution date.');
      expect(entry.code).toBe('DISSOLUTION_DATE_REQUIRED');
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

  it('restores an empty description the upstream GET omitted, so the full-replace PUT still carries the required key', () => {
    const omitted: Record<string, unknown> = { slug: 's', name: 'N', parent_uid: 'p', stage: 'Active' };

    expect(mergeFormationRecord(omitted, { legal_entity_name: 'Cascade Data LLC' })).toEqual({
      slug: 's',
      name: 'N',
      description: '',
      parent_uid: 'p',
      stage: 'Active',
      legal_entity_name: 'Cascade Data LLC',
    });
  });

  it('turns a null edit into a cleared (dropped) field', () => {
    const edits = validateFormationRecordBody({ legal_entity_name: null });
    expect(mergeFormationRecord({ ...stored, legal_entity_name: 'Old' }, edits)).not.toHaveProperty('legal_entity_name');
  });

  it('does not mutate the stored object', () => {
    const copy = structuredClone(stored);
    mergeFormationRecord(stored, { stage: 'Archived', entity_dissolution_date: '2026-10-31' });
    expect(stored).toEqual(copy);
  });
});

describe('assertMergedRecordValid', () => {
  it('rejects an Archived record whose dissolution date was cleared, with the Archived-rule code', () => {
    expect(() => assertMergedRecordValid({ stage: 'Archived' })).toThrowError(/entity_dissolution_date/);
    try {
      assertMergedRecordValid({ stage: 'Archived' });
    } catch (error) {
      expect((error as { validationErrors: { code: string }[] }).validationErrors[0].code).toBe('DISSOLUTION_DATE_REQUIRED');
    }
  });

  it('accepts Archived with a date and any non-Archived record', () => {
    expect(() => assertMergedRecordValid({ stage: 'Archived', entity_dissolution_date: '2026-10-31' })).not.toThrow();
    expect(() => assertMergedRecordValid({ stage: 'Active' })).not.toThrow();
  });
});
