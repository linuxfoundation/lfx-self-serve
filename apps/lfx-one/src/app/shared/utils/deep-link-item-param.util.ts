// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

/**
 * Reads a `?<paramName>=<uid>` query param as a signal — the shared "land on a list with a
 * specific item's drawer open" primitive (GH-2616), built for reuse by #2573 and #1961, which need
 * the same mechanism against their own lists.
 *
 * Deliberately NOT a route guard: a guard runs before the host component's own data loads, but
 * opening an item's drawer needs the loaded list (to resolve the uid into a real row/item object),
 * so this is consumed inside the component that owns that list, not at route-resolution time. Call
 * from a component's field initializer or constructor (injection context is required for
 * `toObservable`/`toSignal`), then pair it with {@link clearDeepLinkItemParam} once the caller has
 * consumed the value — found the item and opened its drawer, or determined the uid doesn't match
 * any loaded item — so a manual close or back-navigation doesn't keep reopening it.
 */
export function watchDeepLinkItemUid(route: ActivatedRoute, paramName: string = 'item'): Signal<string | null> {
  return toSignal(route.queryParamMap.pipe(map((params) => params.get(paramName))), { initialValue: null });
}

/** Strips the deep-link param from the URL without a full navigation/reload — call once the uid from {@link watchDeepLinkItemUid} has been consumed (drawer opened, or determined not to match). */
export function clearDeepLinkItemParam(router: Router, route: ActivatedRoute, paramName: string = 'item'): void {
  void router.navigate([], { relativeTo: route, queryParams: { [paramName]: null }, queryParamsHandling: 'merge', replaceUrl: true });
}
