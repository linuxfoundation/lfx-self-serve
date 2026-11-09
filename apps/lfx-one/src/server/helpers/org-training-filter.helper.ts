// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { MAX_ORG_TRAINING_FILTER_VALUE_LENGTH } from '@lfx-one/shared/constants';
import { trimOrgTrainingSpaces } from '@lfx-one/shared/utils/org-training-view-state.utils';

import { ServiceValidationError } from '../errors';

// Every control character except TAB (U+0009): TAB survives the SQL space-trim and the option builders, so it is a legal part of a value.
// eslint-disable-next-line no-control-regex -- the point is to reject control characters
const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000a-\u001f\u007f]/;

/**
 * The one character policy of an organization-carried filter value (course name, level, format, foundation/project id):
 * spaces trimmed at the ends only (as the SQL pair attributes do), at most {@link MAX_ORG_TRAINING_FILTER_VALUE_LENGTH}
 * characters, and no control character other than TAB. Request validation, the option builders and the known-values set
 * all use it, so an option the dropdown offers can always be named in a request.
 */
export function isWellFormedOrgTrainingFilterValue(value: string): boolean {
  return value.length <= MAX_ORG_TRAINING_FILTER_VALUE_LENGTH && !DISALLOWED_CONTROL_CHARACTERS.test(value);
}

/**
 * 400 for a request value that can only be malformed: not one string, longer than the cap, or (for a `filter`) holding a
 * control character other than TAB. A well-formed value the organization does not carry is not malformed (it is served as
 * zero data), so this never looks at the warehouse. A `filter` value is space-trimmed first (the URL does); a `groupKey` is
 * compared verbatim and only against the keys of the cached group set, so only its type and length are checked.
 */
export function assertWellFormedOrgTrainingFilterValue(value: unknown, field: string, operation: string, kind: 'filter' | 'groupKey'): void {
  if (typeof value !== 'string') {
    throw ServiceValidationError.forField(field, `${field} must be a single string`, { operation });
  }
  const candidate = kind === 'filter' ? trimOrgTrainingSpaces(value) : value;
  if (candidate.length > MAX_ORG_TRAINING_FILTER_VALUE_LENGTH) {
    throw ServiceValidationError.forField(field, `${field} must be at most ${MAX_ORG_TRAINING_FILTER_VALUE_LENGTH} characters`, { operation });
  }
  if (kind === 'filter' && !isWellFormedOrgTrainingFilterValue(candidate)) {
    throw ServiceValidationError.forField(field, `${field} must not contain control characters other than a tab`, { operation });
  }
}
