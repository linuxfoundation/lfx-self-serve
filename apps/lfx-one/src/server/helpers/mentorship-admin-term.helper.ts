// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_TERM_NAME_MAX } from '@lfx-one/shared/constants';
import { MentorshipAdminTermInput } from '@lfx-one/shared/interfaces';
import { isMentorshipIsoDate, lastDayOfMentorshipMonth } from '@lfx-one/shared/utils';

import { ServiceValidationError } from '../errors';

/** Reads a real calendar date written `YYYY-MM-DD`; `2026-02-30` is not one. */
const parseIsoDate = (value: unknown, field: string, operation: string): string => {
  if (typeof value !== 'string' || !isMentorshipIsoDate(value)) {
    throw ServiceValidationError.forField(field, `${field} must be a date written YYYY-MM-DD.`, { operation });
  }
  return value;
};

/**
 * Validates the body of a term create or edit: a name of 1 to `MENTORSHIP_TERM_NAME_MAX` characters once trimmed and four
 * ISO dates in order: application start <= application end, application start < start <= end, and application end no
 * later than the end month. The application window runs from the start of its first UTC day to the end of its last, so it
 * may open and close on one date, and it may run into the term but must open before it. The term runs from the start of
 * its start date to the end of its end month, so it may start and end in one month. Upstream checks the window's end on
 * the timestamps the BFF sends; failing here keeps the bad request off the wire. The name is never logged.
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
  if (applicationEndDate < applicationStartDate) {
    throw ServiceValidationError.forField('applicationEndDate', 'applicationEndDate must be on or after applicationStartDate.', { operation });
  }
  if (applicationStartDate >= startDate) {
    throw ServiceValidationError.forField('applicationStartDate', 'applicationStartDate must be before startDate.', { operation });
  }
  if (endDate < startDate) {
    throw ServiceValidationError.forField('endDate', 'endDate must be on or after startDate.', { operation });
  }
  if (applicationEndDate > lastDayOfMentorshipMonth(endDate)) {
    throw ServiceValidationError.forField('applicationEndDate', 'applicationEndDate must be on or before the last day of the endDate month.', { operation });
  }

  return { name, startDate, endDate, applicationStartDate, applicationEndDate };
};
