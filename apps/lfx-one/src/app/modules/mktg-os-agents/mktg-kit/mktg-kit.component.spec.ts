// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MktgKitService } from '@services/mktg-kit.service';
import { ProjectContextService } from '@services/project-context.service';
import { resolveMktgKit, summarizeMktgKit } from '@lfx-one/shared/utils';
import { MktgDocumentsResponse, MktgKitFamilyView } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgKitComponent } from './mktg-kit.component';

describe('Marketing kit home', () => {
  const families = signal<MktgKitFamilyView[]>([]);
  const loading = signal(false);
  const error = signal('');
  const documents = signal<MktgDocumentsResponse | null>(null);
  const context = signal({ uid: 'synthetic', slug: 'synthetic' });
  beforeEach(() => {
    context.set({ uid: 'synthetic', slug: 'synthetic' });
    families.set(resolveMktgKit({ project: 'synthetic', groups: [] }));
    loading.set(false);
    error.set('');
    documents.set({ project: 'synthetic', groups: [] });
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
  it('keeps ctrl/meta clicks native on the Next step link', async () => {
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const link = root.querySelector<HTMLAnchorElement>('[data-testid="mktg-kit-next-step-action"] a');
    expect(link?.getAttribute('href')).toContain('foundation-setup');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    expect(navigate).not.toHaveBeenCalled();
  });
  it.each([
    ['foundation-message', 'writing', 'Writing…', 'Open'],
    ['foundation-message', 'storing', 'Writing…', 'Open'],
    ['foundation-message', 'questions', 'Waiting for your answers', 'Answer the questions'],
    ['member-360', 'questions', 'Waiting for your answers', 'Answer the questions'],
    ['linkedin-post', 'questions', 'Waiting for your answers', 'Answer the questions'],
    ['foundation-message', 'failed', 'Not run yet', null],
  ] as const)('shows %s %s without changing Next step', async (agentKey, state, status, label) => {
    documents.set({
      project: 'synthetic',
      groups: [],
      runs: [
        {
          agentKey,
          state,
          project: 'synthetic',
          documentId: agentKey === 'foundation-message' ? 'living' : 'run-synthetic',
          runId: 'synthetic-run',
          startedAt: '2026-10-28T12:00:00Z',
        },
      ],
    });
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector(`[data-testid="mktg-kit-asset-${agentKey === 'foundation-message' ? 'messaging-framework' : agentKey}"]`);
    expect(row?.textContent).toContain(status);
    const link = row?.querySelector('[data-testid="mktg-kit-run-status-link"]');
    expect(link?.textContent ?? null).toBe(label);
    if (label) {
      expect(row?.querySelector('[data-testid="mktg-kit-run-status"]')?.textContent).toContain(status);
      const questions = state === 'questions';
      const documentId = agentKey === 'foundation-message' ? 'living' : 'run-synthetic';
      const runTarget = agentKey === 'foundation-message' ? 'foundation-setup' : agentKey;
      const target = questions ? runTarget : `documents/${agentKey}/${documentId}`;
      expect(link?.getAttribute('href')).toBe('/' + target + '?project=synthetic' + (questions ? '' : '&run=synthetic-run'));
    }
    expect(root.querySelector('[data-testid="mktg-kit-next-step-action"]')?.textContent).toContain('Create messaging framework');
  });
  it.each(['writing', 'storing', 'questions'] as const)('keeps approval visible for %s without changing the run destination', async (state) => {
    families.update((views) =>
      views.map((view) => ({
        ...view,
        rows: view.rows.map((row) =>
          row.asset.agentKey === 'foundation-message'
            ? {
                ...row,
                state: 'approved',
                version: 2,
                document: {
                  agentKey: 'foundation-message',
                  documentId: 'living',
                  revisionCount: 2,
                  latestRevisionId: 'approved',
                  approvedCurrent: { revisionId: 'approved', number: 2 },
                  createdAt: null,
                  updatedAt: null,
                },
              }
            : row
        ),
      }))
    );
    documents.set({
      project: 'synthetic',
      groups: [],
      runs: [{ agentKey: 'foundation-message', state, project: 'synthetic', documentId: 'living', runId: 'synthetic-run', startedAt: '2026-10-28T12:00:00Z' }],
    });
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const row: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="mktg-kit-asset-messaging-framework"]');
    expect(row?.textContent).toContain(state === 'questions' ? 'Waiting for your answers' : 'Approved · new version being written');
    expect(row?.querySelector('a')?.getAttribute('href')).toBe(
      state === 'questions' ? '/foundation-setup?project=synthetic' : '/documents/foundation-message/living?project=synthetic&run=synthetic-run'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-kit-in-kit"]')?.textContent).toContain('1 assets');
  });
  it('shows only four live cards and hides unbuilt assets, tabs and the request tile', async () => {
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('article')).toHaveLength(4);
    expect(root.textContent).toContain('Not run yet');
    expect(root.textContent).not.toContain('Coming soon');
    expect(root.textContent).not.toContain('Open requests');
    expect(root.querySelectorAll('[data-testid="mktg-kit-summary"] > div')).toHaveLength(3);
    expect(root.querySelector('[data-testid="mktg-kit-asset-pitch-deck"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-asset-one-pager"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-tab-requests"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-tab-access"]')).toBeNull();
    expect(root.textContent).toContain('Messaging Framework, Boilerplates, FAQ, Brand Kit');
    expect(root.querySelector('[data-testid="mktg-kit-asset-quarterly-plan"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-asset-icp"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-in-kit"]')?.textContent).toContain('0 assets');
    expect(root.querySelector('[data-testid="mktg-kit-core-floor"]')?.textContent).toContain('0 of 4');
    expect(root.querySelector('[data-testid="mktg-kit-level"]')?.textContent).toBe('—');
    expect(root.querySelector('[data-testid="mktg-kit-level-empty"]')?.textContent).toContain('No approved assets yet');
  });
  it('keeps every visible card neutral at rest and the selected filter quiet', async () => {
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    for (const view of families()) {
      const card = root.querySelector(`[data-testid="mktg-kit-family-${view.family.id}"]`);
      expect(card?.querySelectorAll('a')).toHaveLength(view.live ? 1 : 0);
      // Angular merges static classes, the class-map binding and individual class properties.
      for (const token of ['relative', 'flex', 'rounded-xl', 'border', 'bg-white', 'p-5']) {
        expect(card?.classList.contains(token)).toBe(true);
      }
      expect(card?.classList.contains('hover:shadow-md')).toBe(view.live);
      expect(card?.classList.contains('border-gray-200')).toBe(true);
      expect(card?.classList.contains('border-blue-600')).toBe(false);
      expect(card?.classList.contains('hover:border-blue-400')).toBe(view.live);
      expect(card?.classList.contains('has-[a:focus-visible]:ring-blue-600')).toBe(view.live);
      if (!view.live) {
        expect(card?.classList.contains('border-dashed')).toBe(true);
        expect(card?.className).not.toContain('hover:');
      }
    }
    const filters = root.querySelector('lfx-filter-pills');
    expect(filters?.className).toContain('[&_button[aria-pressed=true]]:!bg-blue-100');
    expect(filters?.className).toContain('[&_button[aria-pressed=true]]:!text-blue-700');
  });
  it.each(['create', 'blocked', 'review', 'rebuild', 'export'] as const)('presents the %s family header as the one Next step', async (kind) => {
    if (kind !== 'create')
      families.update((views) =>
        views.map((view, index) =>
          index
            ? view
            : {
                ...view,
                rows: view.rows.map((row, i) => ({
                  ...row,
                  state: kind === 'rebuild' && i === 0 ? 'needs-rebuild' : 'draft',
                  document:
                    row.asset.agentKey && (kind !== 'blocked' || i === 0)
                      ? {
                          agentKey: row.asset.agentKey,
                          documentId: 'living',
                          revisionCount: 1,
                          latestRevisionId: 'synthetic',
                          approvedCurrent: null,
                          createdAt: null,
                          updatedAt: null,
                        }
                      : null,
                })),
              }
        )
      );
    if (kind === 'export') families.update((views) => views.map((view) => ({ ...view, rows: view.rows.map((row) => ({ ...row, state: 'approved' })) })));
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const step = root.querySelector('[data-testid="mktg-kit-next-step"]');
    const action = step?.querySelector('lfx-button a');
    expect(step).not.toBeNull();
    const sentence = step?.querySelector('p');
    for (const token of ['text-[15.75px]', 'font-semibold', 'leading-[1.4]', 'text-gray-900']) {
      expect(sentence?.classList.contains(token)).toBe(true);
    }
    expect(root.querySelectorAll('[data-testid="mktg-kit-next-step-action"]')).toHaveLength(1);
    if (kind === 'create') {
      expect(action?.getAttribute('href')).toContain('foundation-setup');
      expect(action?.getAttribute('href')).toContain('mode=new');
      expect(step?.textContent).toContain('Nothing in the kit yet');
    } else if (kind === 'export') {
      expect(action?.textContent).toContain('Export the kit');
      expect(step?.textContent).toContain('The kit is complete; export it.');
      expect(step?.textContent).toContain('Opens Positioning & brand, where the kit can be exported.');
      expect(action?.getAttribute('href')).toContain('families/positioning-brand');
    } else if (kind === 'rebuild') {
      expect(step?.textContent).toContain('1 asset is stale');
      expect(action?.getAttribute('href')).toContain('families/positioning-brand');
    } else {
      expect(action?.getAttribute('href')).toContain('documents/foundation-message/living');
      expect(step?.textContent).toContain('The messaging framework is drafted');
    }
    expect(action?.getAttribute('href')).toContain('project=synthetic');
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
    expect(root.querySelectorAll('article')).toHaveLength(4);
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
    expect(root.querySelector('[data-testid="mktg-kit-asset-aeo-geo"]')?.textContent).toContain('Not run yet');
    expect(root.querySelector('[data-testid="mktg-kit-asset-one-pager"]')).toBeNull();
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
    expect(root.querySelector('[data-testid="mktg-kit-next-step"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-kit-in-kit"]')?.textContent?.trim()).toBe('—');
    loading.set(false);
    error.set('You need write access to this project.');
    await fixture.whenStable();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('write access');
    expect(root.querySelectorAll('article')).toHaveLength(0);
  });
});
