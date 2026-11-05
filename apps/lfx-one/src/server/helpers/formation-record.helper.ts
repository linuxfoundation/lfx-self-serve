// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_RECORD_DISSOLUTION_DATE_REQUIRED_CODE,
  FORMATION_RECORD_EDITABLE_KEYS,
  FORMATION_RECORD_ERROR_MESSAGES,
  FORMATION_RECORD_MAX_LENGTHS,
  FORMATION_RECORD_READ_ONLY_KEYS,
  FORMATION_RECORD_DATE_PATTERN,
  FORMATION_RECORD_SELECTABLE_STAGES,
  PROJECT_LEGAL_ENTITY_TYPES,
} from '@lfx-one/shared/constants';
import { ProjectStage } from '@lfx-one/shared/enums';

import { ServiceValidationError } from '../errors';

import type { UpdateFormationRecordRequest } from '@lfx-one/shared/interfaces';

const INVALID = FORMATION_RECORD_ERROR_MESSAGES.invalidValue;

/**
 * Validates a formation-record body before any upstream call and returns only the recognised keys
 * with string values. Throws {@link ServiceValidationError} (400) otherwise.
 */
export function validateFormationRecordBody(body: unknown): UpdateFormationRecordRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ServiceValidationError.forField('body', INVALID);
  }

  const input = body as Record<string, unknown>;
  const editable: readonly string[] = FORMATION_RECORD_EDITABLE_KEYS;
  const unknownKey = Object.keys(input).find((key) => !editable.includes(key));
  if (unknownKey) {
    throw ServiceValidationError.forField(unknownKey, INVALID);
  }

  const result: Record<string, string> = {};
  for (const key of FORMATION_RECORD_EDITABLE_KEYS) {
    if (!(key in input)) continue;
    const value = input[key];
    // The five non-stage fields are nullable (#5134) — null clears the field, exactly like an empty string.
    // A null stage is never valid: upstream requires a stage on every stored project.
    if (value === null && key !== 'stage') {
      result[key] = '';
      continue;
    }
    if (typeof value !== 'string') {
      throw ServiceValidationError.forField(key, INVALID);
    }
    result[key] = value.trim();
  }

  for (const [key, max] of Object.entries(FORMATION_RECORD_MAX_LENGTHS)) {
    if ((result[key]?.length ?? 0) > max) {
      throw ServiceValidationError.forField(key, INVALID);
    }
  }

  if (Object.keys(result).length === 0) {
    throw ServiceValidationError.forField('body', INVALID);
  }

  if ('stage' in result && !FORMATION_RECORD_SELECTABLE_STAGES.includes(result['stage'] as ProjectStage)) {
    throw ServiceValidationError.forField('stage', INVALID);
  }

  // Archived requires a dissolution date (upstream rule). An explicitly cleared date is rejected here without an
  // upstream read; an absent one may already be stored, so that case is checked on the merged record by
  // `assertMergedRecordValid`, after the read and before the PUT.
  if (result['stage'] === ProjectStage.Archived && 'entity_dissolution_date' in result && !result['entity_dissolution_date']) {
    throw dissolutionDateRequiredError();
  }

  if (result['legal_entity_type'] && !PROJECT_LEGAL_ENTITY_TYPES.includes(result['legal_entity_type'])) {
    throw ServiceValidationError.forField('legal_entity_type', INVALID);
  }

  for (const key of ['formation_date', 'entity_dissolution_date'] as const) {
    if (result[key] && !isValidIsoDate(result[key])) {
      throw ServiceValidationError.forField(key, INVALID);
    }
  }

  if (result['entity_formation_document_url'] && !isHttpUrl(result['entity_formation_document_url'])) {
    throw ServiceValidationError.forField('entity_formation_document_url', INVALID);
  }

  return result as UpdateFormationRecordRequest;
}

/**
 * Re-checks the Archived rule against the merged record: clearing the dissolution date of an
 * already-Archived project sends no `stage`, so the body-only check cannot see it. Runs after the
 * read but before the PUT, so upstream is never asked to refuse it.
 */
export function assertMergedRecordValid(merged: Record<string, unknown>): void {
  if (merged['stage'] === ProjectStage.Archived && !merged['entity_dissolution_date']) {
    throw dissolutionDateRequiredError();
  }
}

/**
 * Builds the full-replace PUT body: the raw stored project minus read-only fields, with only the
 * keys the caller sent applied. An empty string clears the field (the key is dropped — upstream
 * rejects empty strings on formatted fields). `parent_uid` and `description` are required upstream but
 * omitted from the GET when empty, so they default to `''`; every other stored field passes through untouched.
 */
export function mergeFormationRecord(stored: Record<string, unknown>, edits: UpdateFormationRecordRequest): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const key of FORMATION_RECORD_READ_ONLY_KEYS) {
    delete merged[key];
  }

  for (const [key, value] of Object.entries(edits)) {
    if (value === '') {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  // Upstream omits empty values when serializing the GET, but the full-replace PUT requires these keys.
  if (typeof merged['parent_uid'] !== 'string') {
    merged['parent_uid'] = '';
  }
  if (typeof merged['description'] !== 'string') {
    merged['description'] = '';
  }

  return merged;
}

/** The Archived rule's 400, carrying its own `errors[].code` so clients can tell it from a malformed date on the same field. */
function dissolutionDateRequiredError(): ServiceValidationError {
  return new ServiceValidationError(
    [
      {
        field: 'entity_dissolution_date',
        message: FORMATION_RECORD_ERROR_MESSAGES.archivedNeedsDissolutionDate,
        code: FORMATION_RECORD_DISSOLUTION_DATE_REQUIRED_CODE,
      },
    ],
    'Validation failed for entity_dissolution_date'
  );
}

function isValidIsoDate(value: string): boolean {
  if (!FORMATION_RECORD_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
