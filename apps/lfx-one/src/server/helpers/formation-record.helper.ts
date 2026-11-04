// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_RECORD_ERROR_MESSAGES, FORMATION_RECORD_SELECTABLE_STAGES, PROJECT_LEGAL_ENTITY_TYPES } from '@lfx-one/shared/constants';
import { ProjectStage } from '@lfx-one/shared/enums';

import { ServiceValidationError } from '../errors';

import type { UpdateFormationRecordRequest } from '@lfx-one/shared/interfaces';

/** The only keys the formation-record route may change; anything else in the body is rejected. */
export const FORMATION_RECORD_EDITABLE_KEYS = [
  'stage',
  'legal_entity_name',
  'legal_entity_type',
  'formation_date',
  'entity_dissolution_date',
  'entity_formation_document_url',
] as const satisfies readonly (keyof UpdateFormationRecordRequest)[];

/** Read-only fields on the upstream GET that must not be sent back on the full-replace PUT. */
const READ_ONLY_PROJECT_KEYS = ['uid', 'created_at', 'updated_at', 'writer', 'auditor', 'meetingCoordinator'] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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
    if (typeof value !== 'string') {
      throw ServiceValidationError.forField(key, INVALID);
    }
    result[key] = value.trim();
  }

  if (Object.keys(result).length === 0) {
    throw ServiceValidationError.forField('body', INVALID);
  }

  if ('stage' in result && !FORMATION_RECORD_SELECTABLE_STAGES.includes(result['stage'] as ProjectStage)) {
    throw ServiceValidationError.forField('stage', INVALID);
  }

  // Archived requires a dissolution date (upstream rule, F3) — checked here so a bad request never costs an upstream read.
  if (result['stage'] === ProjectStage.Archived && !result['entity_dissolution_date']) {
    throw ServiceValidationError.forField('entity_dissolution_date', FORMATION_RECORD_ERROR_MESSAGES.archivedNeedsDissolutionDate);
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
 * Builds the full-replace PUT body: the raw stored project minus read-only fields, with only the
 * keys the caller sent applied. An empty string clears the field (the key is dropped — upstream
 * rejects empty strings on formatted fields). `parent_uid` is required upstream and may be absent
 * on a root project, so it defaults to `''`; every other stored field passes through untouched.
 */
export function mergeFormationRecord(stored: Record<string, unknown>, edits: UpdateFormationRecordRequest): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const key of READ_ONLY_PROJECT_KEYS) {
    delete merged[key];
  }

  for (const [key, value] of Object.entries(edits)) {
    if (value === '') {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  if (typeof merged['parent_uid'] !== 'string') {
    merged['parent_uid'] = '';
  }

  return merged;
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
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
