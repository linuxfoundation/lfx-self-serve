// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BEHAVIORAL_CLASS_CONFIG, WG_ENGAGEMENT_METRICS_FLAG } from '@lfx-one/shared/constants';
import { GroupBehavioralClass, GroupsHomeMetric, GroupsHomeTab, MyCommittee, StatCardItem } from '@lfx-one/shared/interfaces';
import { buildEngagementStatCards, getGroupBehavioralClass } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { catchError, filter, finalize, map, of, switchMap, take } from 'rxjs';

/**
 * State of the Me lens groups page, provided by the page component.
 * @description Loads the viewer's groups once, sorted A–Z with their type resolved. Metrics and tab counts cover every group.
 */
@Injectable()
export class GroupsHomeStore {
  private readonly committeeService = inject(CommitteeService);
  private readonly featureFlagService = inject(FeatureFlagService);

  private readonly loadingState: WritableSignal<boolean> = signal(true);
  private readonly failedState: WritableSignal<boolean> = signal(false);
  private readonly reloadState: WritableSignal<number> = signal(0);
  private readonly tabState: WritableSignal<GroupsHomeTab> = signal<GroupsHomeTab>('all');

  public readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  /** True when the groups failed to load. */
  public readonly failed: Signal<boolean> = this.failedState.asReadonly();
  public readonly tab: Signal<GroupsHomeTab> = this.tabState.asReadonly();
  /** Every group the viewer belongs to, A–Z, with `behavioralClass` and `classDisplay` set. */
  public readonly groups: Signal<MyCommittee[]> = this.initGroups();
  /** Groups per behavioral class, over every group. */
  public readonly classCounts: Signal<Record<GroupBehavioralClass, number>> = this.initClassCounts();
  private readonly engagementEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(WG_ENGAGEMENT_METRICS_FLAG, false);
  /** Unique people active across the viewer's groups, with its freshness, sample-data or coverage note; `null` while the flag is off or the stats load. */
  private readonly activeMembers: Signal<StatCardItem | null> = this.initActiveMembers();
  public readonly metrics: Signal<GroupsHomeMetric[]> = this.initMetrics();

  public setTab(tab: GroupsHomeTab): void {
    this.tabState.set(tab);
  }

  /** Fetches the groups again, after a failure or a change to the viewer's memberships. */
  public reload(): void {
    this.reloadState.update((count) => count + 1);
  }

  private initGroups(): Signal<MyCommittee[]> {
    return toSignal(
      toObservable(this.reloadState).pipe(
        switchMap(() => {
          this.loadingState.set(true);
          this.failedState.set(false);
          return this.committeeService.getMyCommitteesOrError().pipe(
            map((groups) =>
              groups
                .map((group) => {
                  const behavioralClass = getGroupBehavioralClass(group.category);
                  return { ...group, behavioralClass, classDisplay: BEHAVIORAL_CLASS_CONFIG[behavioralClass] };
                })
                .sort((a, b) => a.name.localeCompare(b.name))
            ),
            catchError((error: HttpErrorResponse) => {
              console.error('Failed to load my groups:', error.status, error.message);
              this.failedState.set(true);
              return of([]);
            }),
            finalize(() => this.loadingState.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initClassCounts(): Signal<Record<GroupBehavioralClass, number>> {
    return computed(() => {
      const counts = Object.fromEntries(Object.keys(BEHAVIORAL_CLASS_CONFIG).map((key) => [key, 0])) as Record<GroupBehavioralClass, number>;
      for (const group of this.groups()) counts[group.behavioralClass ?? 'other']++;
      return counts;
    });
  }

  /** Fetched once the engagement metrics flag first turns on; shown only while it stays on. */
  private initActiveMembers(): Signal<StatCardItem | null> {
    const stats = toSignal(
      toObservable(this.engagementEnabled).pipe(
        filter((enabled) => enabled),
        take(1),
        switchMap(() => this.committeeService.getGroupsEngagementStats()),
        map((value) => buildEngagementStatCards(value, false)[0])
      ),
      { initialValue: null }
    );
    return computed(() => (this.engagementEnabled() ? stats() : null));
  }

  private initMetrics(): Signal<GroupsHomeMetric[]> {
    return computed(() => {
      const groups = this.groups();
      const activeMembers = this.activeMembers();
      const format = (value: number): string => value.toLocaleString('en-US');
      return [
        { label: 'Total Groups', icon: 'fa-light fa-users-rectangle', value: format(groups.length) },
        { label: 'Public Groups', icon: 'fa-light fa-globe', value: format(groups.filter((group) => group.public).length) },
        { label: 'Voting Enabled Groups', icon: 'fa-light fa-check-to-slot', value: format(groups.filter((group) => group.enable_voting === true).length) },
        {
          label: 'Active Members',
          icon: 'fa-light fa-user-group',
          value: typeof activeMembers?.value === 'number' ? format(activeMembers.value) : '—',
          subLine: activeMembers?.subLine,
        },
      ];
    });
  }
}
