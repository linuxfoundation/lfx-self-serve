// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GROUPS_VIEW_MODE_STORAGE_KEY } from '@lfx-one/shared/constants';
import { GroupsEngagementStats, MyCommittee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { Observable, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupsHomeStore } from './groups-home.store';

const group = (uid: string, category: string, extra: Partial<MyCommittee> = {}): MyCommittee =>
  ({ uid, name: `Group ${uid}`, category, public: false, enable_voting: false, total_members: 3, my_role: 'Member', ...extra }) as MyCommittee;

describe('GroupsHomeStore', () => {
  let groups$: Observable<MyCommittee[]>;
  let stats: GroupsEngagementStats | null;
  let statsFlag: ReturnType<typeof signal<boolean>>;
  let getGroupsEngagementStats: ReturnType<typeof vi.fn>;

  const create = (): GroupsHomeStore => {
    TestBed.configureTestingModule({
      providers: [
        GroupsHomeStore,
        { provide: CommitteeService, useValue: { getMyCommitteesOrError: () => groups$, getGroupsEngagementStats } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => statsFlag } },
      ],
    });
    const store = TestBed.inject(GroupsHomeStore);
    TestBed.tick();
    return store;
  };

  beforeEach(() => {
    groups$ = of([]);
    stats = null;
    statsFlag = signal(false);
    getGroupsEngagementStats = vi.fn(() => of(stats));
  });

  it('is loading until the groups arrive', () => {
    const subject = new Subject<MyCommittee[]>();
    groups$ = subject;
    const store = create();

    expect(store.loading()).toBe(true);
    subject.next([group('a', 'Board')]);
    subject.complete();

    expect(store.loading()).toBe(false);
    expect(store.groups()).toHaveLength(1);
  });

  it('refreshes without the loading state, and keeps the list when the refresh fails', () => {
    groups$ = of([group('a', 'Board')]);
    const store = create();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const subject = new Subject<MyCommittee[]>();
    groups$ = subject;
    store.refresh();
    TestBed.tick();
    expect(store.loading()).toBe(false);
    subject.error(new Error('offline'));
    expect(store.failed()).toBe(false);
    expect(store.groups()).toHaveLength(1);

    groups$ = of([group('a', 'Board'), group('b', 'Board')]);
    store.refresh();
    TestBed.tick();
    expect(store.groups()).toHaveLength(2);
  });

  it('turns a refresh during the first load into a normal load', () => {
    groups$ = new Subject<MyCommittee[]>();
    const store = create();
    const subject = new Subject<MyCommittee[]>();
    groups$ = subject;
    store.refresh();
    TestBed.tick();

    expect(store.loading()).toBe(true);
    subject.next([group('a', 'Board')]);
    subject.complete();
    expect(store.loading()).toBe(false);
    expect(store.groups()).toHaveLength(1);
  });

  it('clears a failed first load once a refresh succeeds', () => {
    const subject = new Subject<MyCommittee[]>();
    groups$ = subject;
    const store = create();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    subject.error(new Error('offline'));
    expect(store.failed()).toBe(true);

    groups$ = of([group('a', 'Board')]);
    store.refresh();
    TestBed.tick();
    expect(store.failed()).toBe(false);
    expect(store.groups()).toHaveLength(1);
  });

  it('flags a failed load, and reloads on request', () => {
    const subject = new Subject<MyCommittee[]>();
    groups$ = subject;
    const store = create();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    subject.error(new Error('offline'));
    expect(store.failed()).toBe(true);
    expect(store.loading()).toBe(false);

    groups$ = of([group('a', 'Board')]);
    store.reload();
    TestBed.tick();
    expect(store.failed()).toBe(false);
    expect(store.groups()).toHaveLength(1);
  });

  it('sorts groups A–Z and resolves their type', () => {
    groups$ = of([group('b', 'Working Group', { name: 'Zeta' }), group('a', 'Board', { name: 'alpha' })]);
    const store = create();

    expect(store.groups().map((g) => g.name)).toEqual(['alpha', 'Zeta']);
    expect(store.groups()[0]).toEqual(
      expect.objectContaining({ behavioralClass: 'governing-board', classDisplay: expect.objectContaining({ label: 'Boards' }) })
    );
  });

  it('counts groups per type over every group, whatever the tab', () => {
    groups$ = of([group('a', 'Board'), group('b', 'Working Group'), group('c', 'Working Group'), group('d', 'Unknown thing')]);
    const store = create();
    store.setTab('governing-board');

    expect(store.classCounts()).toEqual({
      'governing-board': 1,
      'oversight-committee': 0,
      'working-group': 2,
      'special-interest-group': 0,
      'ambassador-program': 0,
      other: 1,
    });
    expect(store.filteredGroups().map((g) => g.uid)).toEqual(['a']);
  });

  it('computes the metrics over every group, and shows a dash while active members are unknown', () => {
    groups$ = of([group('a', 'Board', { public: true, enable_voting: true }), group('b', 'Working Group', { public: true }), group('c', 'Working Group')]);
    const store = create();
    store.setTab('governing-board');

    expect(store.metrics().map((m) => [m.label, m.value])).toEqual([
      ['Total Groups', '3'],
      ['Public Groups', '2'],
      ['Voting Enabled Groups', '1'],
      ['Active Members', '—'],
    ]);
    expect(getGroupsEngagementStats).not.toHaveBeenCalled();
  });

  it('shows the unique active members and their freshness once the engagement flag is on', () => {
    stats = { active_members: 1204, source: 'live', computed_at: new Date().toISOString() } as GroupsEngagementStats;
    statsFlag.set(true);
    const store = create();

    expect(store.metrics()[3]).toEqual(expect.objectContaining({ value: '1,204', subLine: expect.stringMatching(/^Updated /) }));
  });

  it('marks sample data and a count that covers only some groups', () => {
    stats = { active_members: 7, source: 'mock', computed_at: new Date().toISOString(), coverage: { covered: 2, total: 3 } } as GroupsEngagementStats;
    statsFlag.set(true);
    const store = create();

    expect(store.metrics()[3].subLine).toBe('Sample data · across 2 of 3 groups');
  });

  it('shows a dash and Unavailable when the stats have no active members', () => {
    stats = { active_members: null, source: 'live', computed_at: new Date().toISOString() } as GroupsEngagementStats;
    statsFlag.set(true);
    const store = create();

    expect(store.metrics()[3]).toEqual(expect.objectContaining({ value: '—', subLine: 'Unavailable' }));
  });

  it('goes back to a dash when the engagement flag turns off', () => {
    stats = { active_members: 12, source: 'live', computed_at: new Date().toISOString() } as GroupsEngagementStats;
    statsFlag.set(true);
    const store = create();
    expect(store.metrics()[3].value).toBe('12');

    statsFlag.set(false);
    expect(store.metrics()[3]).toEqual(expect.objectContaining({ value: '—', subLine: undefined }));
  });

  it('shows 20 groups at a time and starts over on a new tab', () => {
    groups$ = of([...Array.from({ length: 45 }, (_, i) => group(`w${String(i).padStart(2, '0')}`, 'Working Group')), group('b', 'Board')]);
    const store = create();

    expect(store.visibleGroups()).toHaveLength(20);
    expect(store.hasMore()).toBe(true);
    store.loadMore();
    store.loadMore();
    expect(store.visibleGroups()).toHaveLength(46);
    expect(store.hasMore()).toBe(false);

    store.setTab('working-group');
    expect(store.visibleGroups()).toHaveLength(20);
    store.loadMore();
    store.loadMore();
    store.loadMore();
    expect(store.visibleGroups()).toHaveLength(45);
  });

  it('starts on cards, keeps the chosen view for the next visit, and starts paging over', () => {
    localStorage.removeItem(GROUPS_VIEW_MODE_STORAGE_KEY);
    groups$ = of(Array.from({ length: 25 }, (_, i) => group(`w${String(i).padStart(2, '0')}`, 'Working Group')));
    const store = create();
    expect(store.view()).toBe('card');
    store.loadMore();

    store.setView('list');
    expect(store.view()).toBe('list');
    expect(store.visibleGroups()).toHaveLength(20);
    expect(localStorage.getItem(GROUPS_VIEW_MODE_STORAGE_KEY)).toBe('list');
    localStorage.removeItem(GROUPS_VIEW_MODE_STORAGE_KEY);
  });

  it('restores the saved view after the first render', () => {
    localStorage.setItem(GROUPS_VIEW_MODE_STORAGE_KEY, 'list');
    const store = create();

    expect(store.view()).toBe('list');
    localStorage.removeItem(GROUPS_VIEW_MODE_STORAGE_KEY);
  });

  it('drops a group the viewer left from the list, tab counts and metrics', () => {
    groups$ = of([group('a', 'Board'), group('b', 'Working Group')]);
    const store = create();

    store.removeGroup('a');
    expect(store.groups().map((g) => g.uid)).toEqual(['b']);
    expect(store.classCounts()['governing-board']).toBe(0);
    expect(store.metrics()[0].value).toBe('1');
  });

  it('shows a left group again once the viewer rejoins it', () => {
    groups$ = of([group('a', 'Board'), group('b', 'Working Group')]);
    const store = create();

    store.removeGroup('a');
    store.restoreGroup('a');
    expect(store.groups().map((g) => g.uid)).toEqual(['a', 'b']);
  });

  it('falls back to every group when a leave empties the selected tab or scope', () => {
    groups$ = of([group('a', 'Board', { project_uid: 'fdn', is_foundation: true }), group('b', 'Working Group', { project_uid: 'prj' })]);
    const store = create();
    store.setTab('governing-board');
    store.setFilters({ scope: 'fdn', voting: null });

    store.removeGroup('a');
    expect(store.tab()).toBe('all');
    expect(store.filters().scope).toBeNull();
    expect(store.filteredGroups().map((g) => g.uid)).toEqual(['b']);
  });

  describe('search and filters', () => {
    const scoped = (): MyCommittee[] => [
      group('f', 'Board', { name: 'Foundation Board', project_uid: 'fdn', project_name: 'Synthetic Foundation', is_foundation: true, enable_voting: true }),
      group('p', 'Working Group', {
        name: 'Docs WG',
        project_uid: 'prj',
        project_name: 'Synthetic Project',
        parent_project_uid: 'fdn',
        description: 'Writes the docs',
      }),
      group('o', 'Working Group', {
        name: 'Other WG',
        project_uid: 'oth',
        project_name: 'Another Project',
        parent_project_uid: 'elsewhere',
        enable_voting: true,
      }),
    ];
    const uids = (store: GroupsHomeStore): string[] => store.filteredGroups().map((g) => g.uid);

    it('lists foundations A–Z, then projects A–Z', () => {
      groups$ = of(scoped());
      const store = create();

      expect(store.scopeOptions().map((o) => o.label)).toEqual(['Synthetic Foundation', 'Another Project', 'Synthetic Project']);
    });

    it("matches a foundation's own groups and its projects' groups, or one project's groups", () => {
      groups$ = of(scoped());
      const store = create();

      store.setFilters({ scope: 'fdn', voting: null });
      expect(uids(store)).toEqual(['p', 'f']);
      store.setFilters({ scope: 'prj', voting: null });
      expect(uids(store)).toEqual(['p']);
    });

    it('searches name, description and category, ignoring case', () => {
      groups$ = of(scoped());
      const store = create();

      store.setSearch('DOCS');
      expect(uids(store)).toEqual(['p']);
      store.setSearch('board');
      expect(uids(store)).toEqual(['f']);
    });

    it('counts voting options after the scope and search but before the tab, and filters voting after the tab', () => {
      groups$ = of(scoped());
      const store = create();
      store.setTab('working-group');

      expect(store.votingCounts()).toEqual({ enabled: 2, disabled: 1 });
      store.setFilters({ scope: null, voting: 'enabled' });
      expect(uids(store)).toEqual(['o']);
    });

    it('counts and filters a group without a voting flag as voting disabled', () => {
      groups$ = of([group('n', 'Board', { enable_voting: undefined })]);
      const store = create();

      expect(store.votingCounts()).toEqual({ enabled: 0, disabled: 1 });
      store.setFilters({ scope: null, voting: 'disabled' });
      expect(uids(store)).toEqual(['n']);
    });

    it('names each applied filter in a chip, and a chip removes its filter', () => {
      groups$ = of(scoped());
      const store = create();

      store.setFilters({ scope: 'fdn', voting: 'disabled' });
      expect(store.filterChips()).toEqual([
        { key: 'scope', prefix: 'Foundation:', label: 'Synthetic Foundation' },
        { key: 'voting', prefix: 'Voting:', label: 'Disabled' },
      ]);
      store.setFilters({ scope: 'prj', voting: null });
      expect(store.filterChips()).toEqual([{ key: 'scope', prefix: 'Project:', label: 'Synthetic Project' }]);

      store.clearFilter('scope');
      expect(store.filterChips()).toEqual([]);
    });

    it('resets the search, tab and filters together', () => {
      groups$ = of(scoped());
      const store = create();
      store.setSearch('nothing matches');
      store.setTab('governing-board');
      store.setFilters({ scope: 'prj', voting: 'enabled' });
      expect(uids(store)).toEqual([]);

      store.resetFilters();
      expect(store.tab()).toBe('all');
      expect(uids(store)).toHaveLength(3);
    });
  });
});
