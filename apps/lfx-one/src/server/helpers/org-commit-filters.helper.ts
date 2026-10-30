// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_ORG_COMMIT_FILTERS,
  DEFAULT_ORG_TEAM_MEMBERS,
  ORG_CODE_METRIC_OPTIONS,
  ORG_COMMIT_SCOPE_OPTIONS,
  ORG_PROJECT_SCOPE_OPTIONS,
  ORG_TEAM_MEMBERS_OPTIONS,
  ORG_TEAM_MEMBERS_QUERY_PARAM,
} from '@lfx-one/shared/constants';
import type { OrgCommitFilters, OrgTeamMembersFilter } from '@lfx-one/shared/interfaces';
import { parseOrgCodeMetric, parseOrgCommitScope, parseOrgProjectScope, parseOrgTeamMembersFilter } from '@lfx-one/shared/utils';
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

/**
 * The commit filters when the request names any of them (each validated and defaulted as by {@link parseOrgCommitFilters}),
 * else `null`: a caller that sends none — the person drawer opened from a page without code filters — keeps its unfiltered read.
 */
export function parseOptionalOrgCommitFilters(req: Request, operation: string): OrgCommitFilters | null {
  const fields: (keyof OrgCommitFilters)[] = ['projectScope', 'commitScope', 'metric'];
  return fields.some((field) => getStringQueryParam(req, field)) ? parseOrgCommitFilters(req, operation) : null;
}

/** Validate the `teamMembers` query param (lfx-self-serve#4685): missing → the default (exclude); an unknown value → 400 before any SQL is built. */
export function parseOrgTeamMembers(req: Request, operation: string): OrgTeamMembersFilter {
  return parseParam(req, ORG_TEAM_MEMBERS_QUERY_PARAM, parseOrgTeamMembersFilter, ORG_TEAM_MEMBERS_OPTIONS, DEFAULT_ORG_TEAM_MEMBERS, operation);
}

function parseParam<T extends string>(
  req: Request,
  field: string,
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
