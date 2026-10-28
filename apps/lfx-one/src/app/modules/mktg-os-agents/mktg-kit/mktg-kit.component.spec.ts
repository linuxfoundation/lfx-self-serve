// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MktgKitService } from '@services/mktg-kit.service';
import { ProjectContextService } from '@services/project-context.service';
import { resolveMktgKit, summarizeMktgKit } from '@lfx-one/shared/utils';
import { MktgKitFamilyView } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgKitComponent } from './mktg-kit.component';

describe('Marketing kit home', () => {
  const families = signal<MktgKitFamilyView[]>([]);
  const loading = signal(false);
  const error = signal('');
  const documents = signal<unknown>(null);
  const context = signal({ uid: 'synthetic', slug: 'synthetic' });
  beforeEach(() => {
    context.set({ uid: 'synthetic', slug: 'synthetic' });
    families.set(resolveMktgKit({ project: 'synthetic', groups: [] }));
    loading.set(false);
    error.set('');
    documents.set({});
    TestBed.configureTestingModule({
      imports: [MktgKitComponent],
      providers: [provideRouter([]), { provide: ProjectContextService, useValue: { activeContext: context, canWrite: signal(true) } }],
    });
    TestBed.overrideComponent(MktgKitComponent, {
      set: {
        providers: [
          {
            provide: MktgKitService,
            useValue: {
              families,
              loading,
              error,
              documents,
              projectName: signal('Synthetic Project'),
              projectQueryParams: computed(() => ({ project: context().slug })),
              summary: () => summarizeMktgKit(families()),
              retry: vi.fn(),
            },
          },
        ],
      },
    });
  });
  it('shows all nine cards, real empty states, lead and placeholder request count', async () => {
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('article')).toHaveLength(9);
    expect(root.textContent).toContain('Not run yet');
    expect(root.textContent).toContain('Coming soon');
    expect(root.textContent).toContain('Lead: HUB lifecycle');
    expect(root.textContent).toContain('Messaging Framework, Boilerplates, FAQ, Brand Kit');
    expect(root.querySelector('[data-testid="mktg-kit-asset-quarterly-plan"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-asset-icp"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-in-kit"]')?.textContent).toContain('0 assets');
    expect(root.querySelector('[data-testid="mktg-kit-core-floor"]')?.textContent).toContain('0 of 9');
    expect(root.querySelector('[data-testid="mktg-kit-level"]')?.textContent).toBe('—');
    expect(root.querySelector('[data-testid="mktg-kit-level-empty"]')?.textContent).toContain('No approved assets yet');
  });
  it('filters asset rows, retains all family cards, and supports future approved/stale fixtures', async () => {
    families.update((value) => {
      value[0].rows[0] = { ...value[0].rows[0], state: 'approved', version: 3 };
      value[0].rows[3] = { ...value[0].rows[3], state: 'needs-rebuild' };
      return [...value];
    });
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain('Approved · v3');
    expect(root.querySelector('[data-testid="mktg-kit-in-kit"]')?.textContent).toContain('1 assets');
    expect(root.querySelector('[data-testid="mktg-kit-level-empty"]')).toBeNull();
    expect(root.textContent).toContain('Needs rebuild');
    expect(root.querySelector('[data-testid="mktg-kit-family-availability-positioning-brand"]')?.textContent).toContain('Core');
    expect(root.querySelector('[data-testid="mktg-kit-family-needs-rebuild-positioning-brand"]')?.textContent).toContain('Needs rebuild');
    root.querySelector<HTMLButtonElement>('[data-testid="filter-pill-approved"]')?.click();
    await fixture.whenStable();
    expect(root.querySelectorAll('article')).toHaveLength(9);
    expect(root.querySelector('[data-testid="mktg-kit-asset-brand-kit"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-family-availability-positioning-brand"]')?.textContent).toContain('Core');
    expect(root.querySelector('[data-testid="mktg-kit-family-needs-rebuild-positioning-brand"]')?.textContent).toContain('Needs rebuild');
    expect(root.querySelector('[data-testid="mktg-kit-asset-messaging-framework"]')).not.toBeNull();
    expect(root.textContent).toContain('No assets in this state');
  });
  it('includes never-run one-offs in Not run yet, without inventing an approval state for prior runs', async () => {
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector<HTMLButtonElement>('[data-testid="filter-pill-missing"]')?.click();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-kit-asset-linkedin-post"]')?.textContent).toContain('Not run yet');
    expect(root.querySelector('[data-testid="mktg-kit-asset-member-360"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-asset-aeo-geo"]')).toBeNull();
    families.update((items) =>
      items.map((item) => ({
        ...item,
        rows: item.rows.map((row) =>
          row.asset.agentKey === 'linkedin-post'
            ? {
                ...row,
                state: null,
                monthlyCount: 1,
                document: {
                  agentKey: 'linkedin-post',
                  documentId: 'run-synthetic',
                  revisionCount: 1,
                  latestRevisionId: 'synthetic',
                  approvedCurrent: null,
                  createdAt: '2026-10-10T12:00:00Z',
                  updatedAt: null,
                },
              }
            : row
        ),
      }))
    );
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-kit-asset-linkedin-post"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="filter-pill-all"]')?.click();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-kit-asset-linkedin-post"]')?.textContent).toContain('1 this month');
  });
  it('restores URL state and pushes user filters without a redundant root breadcrumb', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?project=synthetic&state=approved');
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-kit-asset-messaging-framework"]')).toBeNull();
    const navigate = vi.spyOn(router, 'navigate');
    const push = vi.spyOn(TestBed.inject(Location), 'go');
    fixture.nativeElement.querySelector('[data-testid="filter-pill-missing"]')?.click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { project: 'synthetic', state: 'missing' }, queryParamsHandling: 'merge' })
    );
    expect(push).toHaveBeenCalledTimes(1);
    expect(router.url).toContain('state=missing');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-kit-asset-messaging-framework"]')).not.toBeNull();
    await router.navigateByUrl('/?state=unknown');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-breadcrumb"]')).toBeNull();
  });

  it('keeps Family links and state filters scoped after an address-only project switch', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?project=stale');
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    context.set({ uid: 'next', slug: 'current' });
    TestBed.inject(Location).replaceState('/?project=current');
    await fixture.whenStable();
    expect(router.url).toContain('project=stale');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-kit-family-link-positioning-brand"]')?.getAttribute('href')).toContain('project=current');
    fixture.nativeElement.querySelector('[data-testid="filter-pill-missing"]')?.click();
    await fixture.whenStable();
    expect(router.url).toContain('project=current');
    expect(router.url).toContain('state=missing');
  });
  it('defensively renders no-project while isolated from lens navigation', async () => {
    documents.set(null);
    families.set([]);
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-kit-no-project"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-kit-families"]')).toBeNull();
  });
  it('never renders guessed missing states or counts during a load or failure', async () => {
    loading.set(true);
    documents.set(null);
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-kit-loading"]')).not.toBeNull();
    expect(root.querySelectorAll('article')).toHaveLength(0);
    expect(root.querySelector('[data-testid="mktg-kit-in-kit"]')?.textContent?.trim()).toBe('—');
    loading.set(false);
    error.set('You need write access to this project.');
    await fixture.whenStable();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('write access');
    expect(root.querySelectorAll('article')).toHaveLength(0);
  });
});
