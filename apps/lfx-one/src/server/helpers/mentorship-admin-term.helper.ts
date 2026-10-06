// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_TERM_NAME_MAX } from '@lfx-one/shared/constants';
import { MentorshipAdminTermInput } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Reads a real calendar date written `YYYY-MM-DD`; `2026-02-30` is not one. */
const parseIsoDate = (value: unknown, field: string, operation: string): string => {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw ServiceValidationError.forField(field, `${field} must be a date written YYYY-MM-DD.`, { operation });
  }
  return value;
};

/**
 * Validates the body of a term create or edit: a name of 1 to `MENTORSHIP_TERM_NAME_MAX` characters once trimmed and four
 * ISO dates in upstream's strict order (application start < application end < start < end). Upstream checks the same
 * order; failing here keeps the bad request off the wire. The name is never logged.
 */
export const parseMentorshipAdminTermInput = (body: unknown, operation: string): MentorshipAdminTermInput => {
  const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
  if (!name || name.length > MENTORSHIP_TERM_NAME_MAX) {
    throw ServiceValidationError.forField('name', `name is required and must be at most ${MENTORSHIP_TERM_NAME_MAX} characters.`, { operation });
  }

  const applicationStartDate = parseIsoDate(raw['applicationStartDate'], 'applicationStartDate', operation);
  const applicationEndDate = parseIsoDate(raw['applicationEndDate'], 'applicationEndDate', operation);
  const startDate = parseIsoDate(raw['startDate'], 'startDate', operation);
  const endDate = parseIsoDate(raw['endDate'], 'endDate', operation);

  // ISO dates compare as text.
  if (applicationEndDate <= applicationStartDate) {
    throw ServiceValidationError.forField('applicationEndDate', 'applicationEndDate must be after applicationStartDate.', { operation });
  }
  if (startDate <= applicationEndDate) {
    throw ServiceValidationError.forField('startDate', 'startDate must be after applicationEndDate.', { operation });
  }
  if (endDate <= startDate) {
    throw ServiceValidationError.forField('endDate', 'endDate must be after startDate.', { operation });
  }

  return { name, startDate, endDate, applicationStartDate, applicationEndDate };
};
