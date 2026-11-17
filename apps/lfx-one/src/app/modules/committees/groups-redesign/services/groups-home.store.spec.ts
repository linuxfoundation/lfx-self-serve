// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
});
