// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ProjectContextService } from '@services/project-context.service';
import { describe, expect, it, vi } from 'vitest';
import { createMktgAssetTab } from './mktg-asset-tab.util';

describe('shared asset URL tabs', () => {
  it('validates deep links, pushes user changes and retains unrelated query state', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ProjectContextService, useValue: { activeContext: () => ({ slug: 'synthetic' }) } },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?project=synthetic&revision=stored&profile=edit&tab=second');
    const state = TestBed.runInInjectionContext(() => createMktgAssetTab(['first', 'second'], 'first'));
    expect(state.selected()).toBe('second');
    const push = vi.spyOn(TestBed.inject(Location), 'go');
    const navigate = vi.spyOn(router, 'navigate');
    state.select('first');
    await vi.waitFor(() => expect(state.selected()).toBe('first'));
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { tab: null, project: 'synthetic' }, queryParamsHandling: 'merge' }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/?project=synthetic&revision=stored&profile=edit');
    await router.navigateByUrl('/?tab=not-a-tab');
    expect(state.selected()).toBe('first');
  });

  it('uses the active project after a same-lens address-only switch, retaining revision and edit state', async () => {
    const activeContext = signal<{ slug: string } | null>({ slug: 'previous' });
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', children: [] }]), { provide: ProjectContextService, useValue: { activeContext } }],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?project=previous&revision=stored&profile=edit');
    const state = TestBed.runInInjectionContext(() => createMktgAssetTab(['first', 'second'], 'first'));
    activeContext.set({ slug: 'current' });
    TestBed.inject(Location).replaceState('/?project=current&revision=stored&profile=edit');
    expect(router.url).toContain('project=previous');
    await state.select('second');
    expect(router.url).toBe('/?project=current&revision=stored&profile=edit&tab=second');
    activeContext.set(null);
    await state.select('first');
    expect(router.url).toBe('/?revision=stored&profile=edit');
  });
});
