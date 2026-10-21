// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
      providers: [provideRouter([]), { provide: ProjectContextService, useValue: { activeContext: context } }],
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
    expect(root.textContent).toContain('Missing');
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
  it('keeps Family card links current when context changes without router navigation', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?project=stale');
    const fixture = TestBed.createComponent(MktgKitComponent);
    await fixture.whenStable();
    context.set({ uid: 'next', slug: 'current' });
    await fixture.whenStable();
    expect(router.url).toContain('project=stale');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-kit-family-link-positioning-brand"]')?.getAttribute('href')).toContain('project=current');
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
