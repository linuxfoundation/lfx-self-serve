// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { clearDeepLinkItemParam, watchDeepLinkItemUid } from './deep-link-item-param.util';

describe('watchDeepLinkItemUid', () => {
  it('returns the param value when present', () => {
    const queryParamMap$ = new BehaviorSubject(convertToParamMap({ item: 'item-1' }));
    const route = { queryParamMap: queryParamMap$ } as unknown as ActivatedRoute;

    const uid = TestBed.runInInjectionContext(() => watchDeepLinkItemUid(route));

    expect(uid()).toBe('item-1');
  });

  it('returns null when the param is absent', () => {
    const queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
    const route = { queryParamMap: queryParamMap$ } as unknown as ActivatedRoute;

    const uid = TestBed.runInInjectionContext(() => watchDeepLinkItemUid(route));

    expect(uid()).toBeNull();
  });

  it('reads a caller-supplied param name instead of the default', () => {
    const queryParamMap$ = new BehaviorSubject(convertToParamMap({ entity: 'entity-1' }));
    const route = { queryParamMap: queryParamMap$ } as unknown as ActivatedRoute;

    const uid = TestBed.runInInjectionContext(() => watchDeepLinkItemUid(route, 'entity'));

    expect(uid()).toBe('entity-1');
  });
});

describe('clearDeepLinkItemParam', () => {
  it('nulls the param via router.navigate with merge + replaceUrl, relative to the given route', () => {
    const navigate = vi.fn();
    const router = { navigate } as unknown as Router;
    const route = {} as ActivatedRoute;

    clearDeepLinkItemParam(router, route);

    expect(navigate).toHaveBeenCalledWith([], { relativeTo: route, queryParams: { item: null }, queryParamsHandling: 'merge', replaceUrl: true });
  });

  it('uses a caller-supplied param name', () => {
    const navigate = vi.fn();
    const router = { navigate } as unknown as Router;
    const route = {} as ActivatedRoute;

    clearDeepLinkItemParam(router, route, 'entity');

    expect(navigate).toHaveBeenCalledWith([], { relativeTo: route, queryParams: { entity: null }, queryParamsHandling: 'merge', replaceUrl: true });
  });
});
