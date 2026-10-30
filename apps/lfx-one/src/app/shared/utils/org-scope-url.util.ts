// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { FormControl } from '@angular/forms';
import type { ActivatedRoute, Router } from '@angular/router';
import { DEFAULT_ORG_SCOPE, ORG_SCOPE_QUERY_PARAM } from '@lfx-one/shared/constants';
import type { OrgScopeFilter } from '@lfx-one/shared/interfaces';
import { orgScopeUrlParam, parseOrgScopeFilter } from '@lfx-one/shared/utils';
import { distinctUntilChanged, map } from 'rxjs';

/** The organization scope a route's `?orgScope=` selects (the default, insights, when absent or unknown). */
export function readOrgScope(route: ActivatedRoute): OrgScopeFilter {
  return parseOrgScopeFilter(route.snapshot.queryParamMap.get(ORG_SCOPE_QUERY_PARAM)) ?? DEFAULT_ORG_SCOPE;
}

/**
 * Keeps an Organization scope picker and `?orgScope=` in step (lfx-self-serve-ops#1219), so the pick carries across
 * Overview, People, Code Contributions and Project Detail: a pick is written to the URL (dropped at the default), and a
 * query-only navigation sets the picker. Each side acts only when the other differs, so neither echoes the other. Call
 * from an injection context (constructor).
 */
export function syncOrgScopeWithUrl(control: FormControl<OrgScopeFilter>, route: ActivatedRoute, router: Router): void {
  control.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed()).subscribe((scope) => {
    if (scope === readOrgScope(route)) return;
    void router.navigate([], {
      relativeTo: route,
      queryParams: { [ORG_SCOPE_QUERY_PARAM]: orgScopeUrlParam(scope) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  route.queryParamMap
    .pipe(
      map((params) => parseOrgScopeFilter(params.get(ORG_SCOPE_QUERY_PARAM)) ?? DEFAULT_ORG_SCOPE),
      distinctUntilChanged(),
      takeUntilDestroyed()
    )
    .subscribe((scope) => {
      if (scope !== control.value) control.setValue(scope);
    });
}
