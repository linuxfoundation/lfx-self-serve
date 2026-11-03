// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { MAX_ORG_TRAINING_FILTER_VALUE_LENGTH } from '@lfx-one/shared/constants';
import { trimOrgTrainingSpaces } from '@lfx-one/shared/utils/org-training-view-state.utils';

import { ServiceValidationError } from '../errors';

// eslint-disable-next-line no-control-regex -- the point is to reject control characters
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * 400 for a request value that can only be malformed: not one string, longer than the cap, or holding a control character.
 * A well-formed value the organization does not carry is not malformed (it is served as zero data), so this never looks at
 * the warehouse. `trim` is true for a filter value (the URL trims it) and false for a group key (compared verbatim).
 */
export function assertWellFormedOrgTrainingFilterValue(value: unknown, field: string, operation: string, trim: boolean): void {
  if (typeof value !== 'string') {
    throw ServiceValidationError.forField(field, `${field} must be a single string`, { operation });
  }
  const candidate = trim ? trimOrgTrainingSpaces(value) : value;
  if (candidate.length > MAX_ORG_TRAINING_FILTER_VALUE_LENGTH) {
    throw ServiceValidationError.forField(field, `${field} must be at most ${MAX_ORG_TRAINING_FILTER_VALUE_LENGTH} characters`, { operation });
  }
  if (CONTROL_CHARACTERS.test(candidate)) {
    throw ServiceValidationError.forField(field, `${field} must not contain control characters`, { operation });
  }
}
