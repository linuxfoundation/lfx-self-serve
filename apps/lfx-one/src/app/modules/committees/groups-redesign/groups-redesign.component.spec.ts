// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GROUPS_VIEW_MODE_STORAGE_KEY } from '@lfx-one/shared/constants';
import { MyCommittee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { CreateArtifactDialogService } from '@services/create-artifact-dialog.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupsRedesignComponent } from './groups-redesign.component';
import { GroupsHomeStore } from './services/groups-home.store';

const group = (uid: string, category: string, extra: Partial<MyCommittee> = {}): MyCommittee =>
  ({ uid, name: `Group ${uid}`, category, public: true, enable_voting: false, total_members: 4, my_role: 'Member', ...extra }) as MyCommittee;

describe('GroupsRedesignComponent', () => {
  let groups$: Subject<MyCommittee[]>;
  let openCreateDialog: ReturnType<typeof vi.fn>;
  let observerCallback: IntersectionObserverCallback | null;

  const render = async (groups?: MyCommittee[]): Promise<ComponentFixture<GroupsRedesignComponent>> => {
    const fixture = TestBed.createComponent(GroupsRedesignComponent);
    fixture.detectChanges();
    if (groups) {
      groups$.next(groups);
      groups$.complete();
      await fixture.whenStable();
    }
    return fixture;
  };
  const all = (fixture: ComponentFixture<GroupsRedesignComponent>, testId: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));
  const one = (fixture: ComponentFixture<GroupsRedesignComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (element: Element | null): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    groups$ = new Subject();
    openCreateDialog = vi.fn();
    observerCallback = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        public observe = vi.fn();
        public disconnect = vi.fn();
        public constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
      }
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public unobserve = vi.fn();
        public disconnect = vi.fn();
      }
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: CommitteeService, useValue: { getMyCommitteesOrError: () => groups$, getGroupsEngagementStats: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: CreateArtifactDialogService, useValue: { open: openCreateDialog } },
        provideRouter([]),
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows skeleton cards and no metrics or tabs while loading', async () => {
    const fixture = await render();

    expect(one(fixture, 'groups-redesign-loading')).not.toBeNull();
    expect(one(fixture, 'groups-redesign-metrics')).toBeNull();
    expect(one(fixture, 'groups-redesign-tabs')).toBeNull();
    expect(one(fixture, 'groups-redesign-create')).toBeNull();
  });

  it('shows the empty state with Create Group, and hides the metrics, toolbar and header button, without groups', async () => {
    const fixture = await render([]);

    expect(text(one(fixture, 'groups-redesign-empty'))).toContain('No groups yet');
    expect(one(fixture, 'groups-redesign-metrics')).toBeNull();
    expect(one(fixture, 'groups-redesign-toolbar')).toBeNull();
    expect(one(fixture, 'groups-redesign-create')).toBeNull();

    one(fixture, 'groups-redesign-empty-create')?.querySelector('button')?.click();
    expect(openCreateDialog).toHaveBeenCalledWith('group');
  });

  it('shows a retry when the groups fail to load', async () => {
    const fixture = await render();
    groups$.error(new Error('offline'));
    await fixture.whenStable();

    expect(text(one(fixture, 'groups-redesign-error'))).toContain("Couldn't load your groups");
    expect(one(fixture, 'groups-redesign-empty')).toBeNull();
    expect(one(fixture, 'groups-redesign-create')).toBeNull();
  });

  it('opens the create dialog for a group from the header', async () => {
    const fixture = await render([group('a', 'Board')]);

    one(fixture, 'groups-redesign-create')?.querySelector('button')?.click();
    expect(openCreateDialog).toHaveBeenCalledWith('group');
  });

  it('shows the four metrics', async () => {
    const fixture = await render([group('a', 'Board', { enable_voting: true }), group('b', 'Working Group', { public: false })]);

    expect(all(fixture, 'groups-redesign-metric').map(text)).toEqual(['Total Groups 2', 'Public Groups 1', 'Voting Enabled Groups 1', 'Active Members —']);
  });

  it('shows All plus a tab for each type the viewer has, with counts', async () => {
    const fixture = await render([group('a', 'Board'), group('b', 'Working Group'), group('c', 'Working Group')]);
    const tabs = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[role="tab"]')).map(text);

    expect(tabs).toEqual(['All3', 'Boards1', 'Working Groups2']);
  });

  it('filters the cards by the selected tab', async () => {
    const fixture = await render([group('a', 'Board'), group('b', 'Working Group')]);

    Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[role="tab"]'))
      .find((tab) => text(tab).startsWith('Working Groups'))
      ?.click();
    await fixture.whenStable();

    expect(all(fixture, 'groups-home-card-name').map(text)).toEqual(['Group b']);
  });

  it('shows a menu on each card, and switches to the table', async () => {
    localStorage.removeItem(GROUPS_VIEW_MODE_STORAGE_KEY);
    const fixture = await render([group('a', 'Board'), group('b', 'Working Group')]);
    expect(all(fixture, 'group-actions-trigger')).toHaveLength(2);

    one(fixture, 'groups-redesign-view-list')?.querySelector('input')?.click();
    await fixture.whenStable();

    expect(all(fixture, 'groups-home-card')).toHaveLength(0);
    expect(all(fixture, 'groups-table-name').map(text)).toEqual(['Group a', 'Group b']);
    localStorage.removeItem(GROUPS_VIEW_MODE_STORAGE_KEY);
  });

  it('shows 20 cards, then the next 20 when the skeletons scroll into view, then the end label', async () => {
    const fixture = await render(Array.from({ length: 45 }, (_, i) => group(String(i).padStart(2, '0'), 'Working Group')));
    expect(all(fixture, 'groups-home-card')).toHaveLength(20);
    expect(one(fixture, 'groups-redesign-load-more')).not.toBeNull();

    for (const expected of [40, 45]) {
      observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      await fixture.whenStable();
      expect(all(fixture, 'groups-home-card')).toHaveLength(expected);
    }

    expect(one(fixture, 'groups-redesign-load-more')).toBeNull();
    expect(text(one(fixture, 'groups-redesign-all-loaded'))).toBe('All 45 groups loaded');
  });

  it('shows no results for a search, and Reset filters clears it', async () => {
    const fixture = await render([group('a', 'Board'), group('b', 'Working Group')]);
    const store = fixture.debugElement.injector.get(GroupsHomeStore);

    store.setSearch('zzz');
    await fixture.whenStable();
    expect(text(one(fixture, 'groups-redesign-no-results'))).toContain('No groups match your search');

    one(fixture, 'groups-redesign-no-results-reset')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(all(fixture, 'groups-home-card')).toHaveLength(2);
  });

  it('shows a chip per applied filter', async () => {
    const fixture = await render([group('a', 'Board', { enable_voting: true }), group('b', 'Working Group')]);
    const store = fixture.debugElement.injector.get(GroupsHomeStore);

    store.setFilters({ scope: null, voting: 'enabled' });
    await fixture.whenStable();

    expect(all(fixture, 'groups-redesign-chip').map(text)).toEqual([expect.stringContaining('Voting: Enabled')]);
    expect(all(fixture, 'groups-home-card-name').map(text)).toEqual(['Group a']);
  });
});
