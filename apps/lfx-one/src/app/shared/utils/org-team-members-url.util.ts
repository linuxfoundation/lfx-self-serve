// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { FormControl } from '@angular/forms';
import type { ActivatedRoute, Router } from '@angular/router';
import { DEFAULT_ORG_TEAM_MEMBERS, ORG_TEAM_MEMBERS_QUERY_PARAM } from '@lfx-one/shared/constants';
import type { OrgTeamMembersFilter } from '@lfx-one/shared/interfaces';
import { orgTeamMembersUrlParam, parseOrgTeamMembersFilter } from '@lfx-one/shared/utils';
import { distinctUntilChanged, map } from 'rxjs';

/** The team members filter a route's `?teamMembers=` selects (the default, exclude, when absent or unknown). */
export function readOrgTeamMembers(route: ActivatedRoute): OrgTeamMembersFilter {
  return parseOrgTeamMembersFilter(route.snapshot.queryParamMap.get(ORG_TEAM_MEMBERS_QUERY_PARAM)) ?? DEFAULT_ORG_TEAM_MEMBERS;
}

/**
 * Keeps a team members picker and `?teamMembers=` in step (lfx-self-serve#4685), so the pick carries across People tabs:
 * a pick is written to the URL (dropped at the default), and a query-only navigation sets the picker. Each side acts
 * only when the other differs, so neither echoes the other. Call from an injection context (constructor).
 */
export function syncOrgTeamMembersWithUrl(control: FormControl<OrgTeamMembersFilter>, route: ActivatedRoute, router: Router): void {
  control.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed()).subscribe((teamMembers) => {
    if (teamMembers === readOrgTeamMembers(route)) return;
    void router.navigate([], {
      relativeTo: route,
      queryParams: { [ORG_TEAM_MEMBERS_QUERY_PARAM]: orgTeamMembersUrlParam(teamMembers) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  route.queryParamMap
    .pipe(
      map((params) => parseOrgTeamMembersFilter(params.get(ORG_TEAM_MEMBERS_QUERY_PARAM)) ?? DEFAULT_ORG_TEAM_MEMBERS),
      distinctUntilChanged(),
      takeUntilDestroyed()
    )
    .subscribe((teamMembers) => {
      if (teamMembers !== control.value) control.setValue(teamMembers);
    });
}
