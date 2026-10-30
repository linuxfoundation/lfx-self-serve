// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { FormControl } from '@angular/forms';
import type { ActivatedRoute, Router } from '@angular/router';
import { ORG_LENS_TIME_RANGE_QUERY_PARAM } from '@lfx-one/shared/constants';
import type { OrgLensTimeRange } from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeUrlParam, parseOrgLensTimeRange } from '@lfx-one/shared/utils';
import { distinctUntilChanged, map } from 'rxjs';

/** The range a route's `?range=` selects (the default when absent or unknown). */
export function readOrgLensTimeRange(route: ActivatedRoute): OrgLensTimeRange {
  return parseOrgLensTimeRange(route.snapshot.queryParamMap.get(ORG_LENS_TIME_RANGE_QUERY_PARAM));
}

/**
 * Keeps a range picker and `?range=` in step, so the range carries across People tabs and to and from Code
 * Contributions: a pick is written to the URL (dropped at the default), and a query-only navigation (a tab switch,
 * back/forward, a nav link carrying the range) sets the picker. Each side acts only when the other differs, so neither
 * echoes the other. Call from an injection context (constructor); the subscriptions end with it.
 */
export function syncOrgLensTimeRangeWithUrl(control: FormControl<OrgLensTimeRange>, route: ActivatedRoute, router: Router): void {
  control.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed()).subscribe((range) => {
    if (range === readOrgLensTimeRange(route)) return;
    void router.navigate([], {
      relativeTo: route,
      queryParams: { [ORG_LENS_TIME_RANGE_QUERY_PARAM]: orgLensTimeRangeUrlParam(range) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  route.queryParamMap
    .pipe(
      map((params) => parseOrgLensTimeRange(params.get(ORG_LENS_TIME_RANGE_QUERY_PARAM))),
      distinctUntilChanged(),
      takeUntilDestroyed()
    )
    .subscribe((range) => {
      if (range !== control.value) control.setValue(range);
    });
}
