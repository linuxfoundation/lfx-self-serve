// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_ORG_COMMIT_FILTERS, ORG_CODE_METRIC_OPTIONS, ORG_COMMIT_SCOPE_OPTIONS, ORG_PROJECT_SCOPE_OPTIONS } from '@lfx-one/shared/constants';
import type { OrgCommitFilters } from '@lfx-one/shared/interfaces';
import { parseOrgCodeMetric, parseOrgCommitScope, parseOrgProjectScope } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { getStringQueryParam } from './validation.helper';

/**
 * Validate the Org Lens commit filters (`projectScope`, `commitScope`, `metric`; lfx-self-serve#4164):
 * a missing param is its default, an unknown value is a 400 before any SQL is built.
 */
export function parseOrgCommitFilters(req: Request, operation: string): OrgCommitFilters {
  return {
    projectScope: parseParam(req, 'projectScope', parseOrgProjectScope, ORG_PROJECT_SCOPE_OPTIONS, DEFAULT_ORG_COMMIT_FILTERS.projectScope, operation),
    commitScope: parseParam(req, 'commitScope', parseOrgCommitScope, ORG_COMMIT_SCOPE_OPTIONS, DEFAULT_ORG_COMMIT_FILTERS.commitScope, operation),
    metric: parseParam(req, 'metric', parseOrgCodeMetric, ORG_CODE_METRIC_OPTIONS, DEFAULT_ORG_COMMIT_FILTERS.metric, operation),
  };
}

function parseParam<T extends string>(
  req: Request,
  field: keyof OrgCommitFilters,
  parse: (value: string | undefined) => T | null,
  options: readonly { value: T }[],
  fallback: T,
  operation: string
): T {
  const raw = getStringQueryParam(req, field);
  if (!raw) {
    return fallback;
  }
  const value = parse(raw);
  if (value === null) {
    throw ServiceValidationError.forField(field, `Invalid ${field} value. Allowed: ${options.map((option) => option.value).join(', ')}`, { operation });
  }
  return value;
}
