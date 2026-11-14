// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_ORG_TEAM_MEMBERS, ORG_TEAM_MEMBERS_OPTIONS } from '../constants/org-people.constants';
import type { OrgTeamMembersFilter } from '../interfaces';

/** `teamMembers` value → team members filter, or `null` when it is not one of the allowed values. */
export function parseOrgTeamMembersFilter(value: string | null | undefined): OrgTeamMembersFilter | null {
  return ORG_TEAM_MEMBERS_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** Team members filter → `?teamMembers=` URL value, `null` (dropped) at the default. */
export function orgTeamMembersUrlParam(filter: OrgTeamMembersFilter): OrgTeamMembersFilter | null {
  return filter === DEFAULT_ORG_TEAM_MEMBERS ? null : filter;
}
