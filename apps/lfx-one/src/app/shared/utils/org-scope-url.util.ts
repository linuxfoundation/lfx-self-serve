// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { FormControl } from '@angular/forms';
import type { ActivatedRoute, ParamMap, Params, Router } from '@angular/router';
import { DEFAULT_ORG_SCOPE, ORG_SCOPE_QUERY_PARAM } from '@lfx-one/shared/constants';
import type { OrgScopeFilter } from '@lfx-one/shared/interfaces';
import { orgScopeUrlParam, parseOrgScopeFilter } from '@lfx-one/shared/utils';
import { distinctUntilChanged, map } from 'rxjs';

/** The organization scope a route's `?orgScope=` selects (the default, insights, when absent or unknown). */
export function readOrgScope(route: ActivatedRoute): OrgScopeFilter {
  return parseOrgScopeFilter(route.snapshot.queryParamMap.get(ORG_SCOPE_QUERY_PARAM)) ?? DEFAULT_ORG_SCOPE;
}

/**
 * The `?orgScope=` a link to another scoped page carries from the current address (lfx-self-serve-ops#1219): the pick
 * when it is a valid non-default value, else nothing, so the default stays out of the URL and a typo never spreads.
 */
export function orgScopeQueryParams(params: ParamMap): Params {
  const scope = parseOrgScopeFilter(params.get(ORG_SCOPE_QUERY_PARAM));
  const value = scope === null ? null : orgScopeUrlParam(scope);
  return value === null ? {} : { [ORG_SCOPE_QUERY_PARAM]: value };
}

/**
 * Keeps an Organization scope picker and `?orgScope=` in step (lfx-self-serve-ops#1219), so the pick carries across
 * Overview, People, Code Contributions and Project Detail: a pick is written to the URL (dropped at the default), and a
 * query-only navigation sets the picker. Each side acts only when the other differs, so neither echoes the other.
 * `onPick` is merged into the URL with a pick, for a page whose other params the pick invalidates (the Projects list's
 * `page`). Call from an injection context (constructor).
 */
export function syncOrgScopeWithUrl(control: FormControl<OrgScopeFilter>, route: ActivatedRoute, router: Router, onPick: Params = {}): void {
  control.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed()).subscribe((scope) => {
    if (scope === readOrgScope(route)) return;
    void router.navigate([], {
      relativeTo: route,
      queryParams: { ...onPick, [ORG_SCOPE_QUERY_PARAM]: orgScopeUrlParam(scope) },
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
