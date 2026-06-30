// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import { SkeletonModule } from 'primeng/skeleton';

import type { GroupDetailTabConfig, GroupDetailTabId, OrgGroupDetail } from '@lfx-one/shared/interfaces';

import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';

import { OrgGroupsService } from '../services/org-groups.service';

const DETAIL_TABS: readonly GroupDetailTabConfig[] = [
  { id: 'overview', label: 'Overview', icon: 'fa-solid fa-circle-dot' },
  { id: 'votes', label: 'Votes', icon: 'fa-light fa-check-to-slot' },
  { id: 'meetings', label: 'Meetings', icon: 'fa-light fa-calendar' },
  { id: 'surveys', label: 'Surveys', icon: 'fa-light fa-chart-bar' },
  { id: 'documents', label: 'Documents', icon: 'fa-light fa-folder' },
] as const;

/** Group detail page shell (LFXV2-1879) — overview, meetings, votes, surveys, documents tabs. */
@Component({
  selector: 'lfx-org-group-detail',
  imports: [RouterLink, CardComponent, TagComponent, SkeletonModule],
  templateUrl: './org-group-detail.component.html',
})
export class OrgGroupDetailComponent {
  // ─── Private injections ──────────────────────────────────────────────────────

  private readonly route = inject(ActivatedRoute);
  private readonly groupsService = inject(OrgGroupsService);

  // ─── Constants exposed to template ───────────────────────────────────────────

  protected readonly tabs: readonly GroupDetailTabConfig[] = DETAIL_TABS;

  // ─── Mutable state ────────────────────────────────────────────────────────────

  protected activeTab = signal<GroupDetailTabId>('overview');

  // ─── Route param signal ───────────────────────────────────────────────────────

  private readonly groupId = toSignal(this.route.paramMap.pipe(switchMap((p) => of(p.get('groupId') ?? ''))), { initialValue: '' });

  // ─── Server data ──────────────────────────────────────────────────────────────

  protected readonly loading = signal(true);
  protected readonly detail: Signal<OrgGroupDetail | null> = this.initDetail();

  // ─── Computed helpers ─────────────────────────────────────────────────────────

  protected readonly hasNextMeeting = computed(() => (this.detail()?.nextMeetings.length ?? 0) > 0);
  protected readonly hasPastMeeting = computed(() => (this.detail()?.pastMeetings.length ?? 0) > 0);
  protected readonly nextMeeting = computed(() => this.detail()?.nextMeetings[0] ?? null);
  protected readonly pastMeeting = computed(() => this.detail()?.pastMeetings[0] ?? null);

  // ─── Public methods ───────────────────────────────────────────────────────────

  protected switchTab(id: GroupDetailTabId): void {
    this.activeTab.set(id);
  }

  protected formatCreatedAt(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ─── Private initializers ─────────────────────────────────────────────────────

  private initDetail(): Signal<OrgGroupDetail | null> {
    return toSignal(
      toObservable(this.groupId).pipe(
        switchMap((id) => {
          if (!id) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          return this.groupsService.getGroupDetail(id).pipe(
            switchMap((data) => {
              this.loading.set(false);
              return of(data);
            }),
            catchError((err) => {
              console.error('[OrgGroupDetail] failed to load group detail', err);
              this.loading.set(false);
              return of(null);
            })
          );
        })
      ),
      { initialValue: null }
    );
  }
}
