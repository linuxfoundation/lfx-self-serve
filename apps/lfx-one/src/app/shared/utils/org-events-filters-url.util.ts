// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { FormControl } from '@angular/forms';
import type { ActivatedRoute, Router } from '@angular/router';
import {
  DEFAULT_ORG_EVENTS_PARTICIPATION,
  DEFAULT_ORG_EVENTS_SCOPE,
  ORG_EVENTS_FOUNDATION_QUERY_PARAM,
  ORG_EVENTS_PARTICIPATION_QUERY_PARAM,
  ORG_EVENTS_SCOPE_QUERY_PARAM,
} from '@lfx-one/shared/constants';
import type { OrgEventsParticipation, OrgEventsScope } from '@lfx-one/shared/interfaces';
import { orgEventsParticipationUrlParam, orgEventsScopeUrlParam, parseOrgEventsParticipation, parseOrgEventsScope } from '@lfx-one/shared/utils';
import { distinctUntilChanged, map } from 'rxjs';

/** The "Count" a route's `?participation=` selects (the default when absent or unknown). */
export function readOrgEventsParticipation(route: ActivatedRoute): OrgEventsParticipation {
  return parseOrgEventsParticipation(route.snapshot.queryParamMap.get(ORG_EVENTS_PARTICIPATION_QUERY_PARAM)) ?? DEFAULT_ORG_EVENTS_PARTICIPATION;
}

/** The "Show" a route's `?eventScope=` selects (the default when absent or unknown). */
export function readOrgEventsScope(route: ActivatedRoute): OrgEventsScope {
  return parseOrgEventsScope(route.snapshot.queryParamMap.get(ORG_EVENTS_SCOPE_QUERY_PARAM)) ?? DEFAULT_ORG_EVENTS_SCOPE;
}

/** The foundation id a route's `?foundation=` selects (`''`, All Foundations, when absent). */
export function readOrgEventsFoundation(route: ActivatedRoute): string {
  return route.snapshot.queryParamMap.get(ORG_EVENTS_FOUNDATION_QUERY_PARAM) ?? '';
}

/** Keeps a "Count" picker and `?participation=` in step (see {@link syncOrgEventsParamWithUrl}). Call from an injection context. */
export function syncOrgEventsParticipationWithUrl(control: FormControl<OrgEventsParticipation>, route: ActivatedRoute, router: Router): void {
  syncOrgEventsParamWithUrl(control, route, router, {
    param: ORG_EVENTS_PARTICIPATION_QUERY_PARAM,
    fromUrl: (value) => parseOrgEventsParticipation(value) ?? DEFAULT_ORG_EVENTS_PARTICIPATION,
    toUrl: orgEventsParticipationUrlParam,
  });
}

/** Keeps a "Show" picker and `?eventScope=` in step (see {@link syncOrgEventsParamWithUrl}). Call from an injection context. */
export function syncOrgEventsScopeWithUrl(control: FormControl<OrgEventsScope>, route: ActivatedRoute, router: Router): void {
  syncOrgEventsParamWithUrl(control, route, router, {
    param: ORG_EVENTS_SCOPE_QUERY_PARAM,
    fromUrl: (value) => parseOrgEventsScope(value) ?? DEFAULT_ORG_EVENTS_SCOPE,
    toUrl: orgEventsScopeUrlParam,
  });
}

/** Keeps a foundation picker and `?foundation=` in step (see {@link syncOrgEventsParamWithUrl}). Call from an injection context. */
export function syncOrgEventsFoundationWithUrl(control: FormControl<string>, route: ActivatedRoute, router: Router): void {
  syncOrgEventsParamWithUrl(control, route, router, {
    param: ORG_EVENTS_FOUNDATION_QUERY_PARAM,
    fromUrl: (value) => value ?? '',
    toUrl: (value) => value || null,
  });
}

/**
 * Keeps one Events picker and its query parameter in step (lfx-self-serve#4598), so the pick carries across tabs and
 * pages like `?range=`: a pick is written to the URL (dropped at the default), and a query-only navigation sets the
 * picker. Each side acts only when the other differs, so neither echoes the other.
 */
function syncOrgEventsParamWithUrl<T extends string>(
  control: FormControl<T>,
  route: ActivatedRoute,
  router: Router,
  options: { param: string; fromUrl: (value: string | null) => T; toUrl: (value: T) => string | null }
): void {
  const { param, fromUrl, toUrl } = options;

  control.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed()).subscribe((value) => {
    if (value === fromUrl(route.snapshot.queryParamMap.get(param))) return;
    void router.navigate([], {
      relativeTo: route,
      queryParams: { [param]: toUrl(value) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  route.queryParamMap
    .pipe(
      map((params) => fromUrl(params.get(param))),
      distinctUntilChanged(),
      takeUntilDestroyed()
    )
    .subscribe((value) => {
      if (value !== control.value) control.setValue(value);
    });
}
