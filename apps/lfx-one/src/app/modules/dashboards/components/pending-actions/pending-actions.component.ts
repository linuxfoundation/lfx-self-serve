// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PendingActionsDrawerComponent } from '@app/modules/dashboards/components/pending-actions-drawer/pending-actions-drawer.component';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_LABEL } from '@lfx-one/shared/constants';
import { MeetingService } from '@services/meeting.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { timer } from 'rxjs';

import type { DecoratedPendingAction, Meeting, MeetingRsvp, PendingActionItem, RsvpResponse } from '@lfx-one/shared/interfaces';

// Fade + collapse animation duration (must match CSS transition in pending-actions.component.scss).
const FADE_OUT_MS = 300;
// How long the skeleton placeholder sits in the completed row's slot before the next action takes over.
const SKELETON_HOLD_MS = 500;

@Component({
  selector: 'lfx-pending-actions',
  imports: [ButtonComponent, TagComponent, RsvpButtonGroupComponent, PendingActionsDrawerComponent, SkeletonModule, ToastModule],
  templateUrl: './pending-actions.component.html',
  styleUrl: './pending-actions.component.scss',
})
export class PendingActionsComponent {
  protected readonly buttonIcons = PENDING_ACTION_BUTTON_ICON;
  protected readonly typeLabels = PENDING_ACTION_LABEL;
  private readonly hiddenActionsService = inject(HiddenActionsService);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly pendingActions = input.required<PendingActionItem[]>();
  public readonly displayLimit = input<number>(2);

  public readonly actionClick = output<PendingActionItem>();
  // Emits the voteUid when a Vote pending-action is clicked, so the parent dashboard can open the cast drawer inline.
  public readonly castVoteRequested = output<string>();

  protected readonly drawerVisible = model<boolean>(false);

  // Cookie-backed dismissals live outside the signal graph; bumping forces the computed to recompute.
  private readonly hiddenActionsVersion = signal(0);
  // Rows currently in the 300ms fade-out + collapse transition.
  protected readonly completingRowKeys = signal<ReadonlySet<string>>(new Set());
  // Rows whose content is currently swapped to a skeleton placeholder while the next action takes the slot.
  protected readonly swappingRowKeys = signal<ReadonlySet<string>>(new Set());
  private readonly rsvpMeetingCache = signal<Record<string, Meeting>>({});
  private readonly loadingMeetingUids = signal<ReadonlySet<string>>(new Set());

  protected readonly visibleActionsUnlimited: Signal<PendingActionItem[]> = this.initVisibleActionsUnlimited();
  protected readonly visibleActions: Signal<PendingActionItem[]> = this.initVisibleActions();
  protected readonly totalVisible: Signal<number> = computed(() => this.visibleActionsUnlimited().length);
  protected readonly hasMore: Signal<boolean> = computed(() => this.totalVisible() > this.displayLimit());
  protected readonly decoratedActions: Signal<DecoratedPendingAction[]> = this.initDecoratedActions();

  public constructor() {
    // Eagerly load Meeting payloads for every inline RSVP row so its buttons render immediately.
    effect(() => {
      for (const row of this.decoratedActions()) {
        if (row.isRsvpInline && !row.meeting && !row.isLoading) {
          this.loadMeeting(row.meetingUid as string);
        }
      }
    });
  }

  protected handleAgendaOrOtherClick(item: DecoratedPendingAction): void {
    if (this.isVoteInline(item) && item.voteUid) {
      // Vote rows: parent opens drawer; hide-on-success is handled by the parent dashboard's vote-submitted path.
      this.castVoteRequested.emit(item.voteUid);
      return;
    }
    this.startCompletion(item, { withSkeleton: false });
    this.actionClick.emit(item);
  }

  protected handleRsvpSubmit(item: DecoratedPendingAction, rsvp: MeetingRsvp): void {
    this.messageService.add({
      key: 'pending-actions-toast',
      severity: 'success',
      summary: 'RSVP saved',
      detail: `You responded '${this.formatResponse(rsvp.response_type)}' to ${item.text}`,
      data: item.meetingUid ? { meetingHref: `/meetings/${item.meetingUid}/details`, meetingTitle: item.text } : undefined,
      life: 5000,
    });
    this.startCompletion(item, { withSkeleton: true });
  }

  protected openDrawer(): void {
    this.drawerVisible.set(true);
  }

  protected onDrawerActionCompleted(): void {
    // Drawer persists the hide cookie itself; we just need to recompute visibility so the inline list and `View all (N)` count refresh.
    this.hiddenActionsVersion.update((v) => v + 1);
  }

  private loadMeeting(meetingUid: string): void {
    if (this.rsvpMeetingCache()[meetingUid]) return;
    if (this.loadingMeetingUids().has(meetingUid)) return;

    this.loadingMeetingUids.update((set) => new Set(set).add(meetingUid));
    this.meetingService
      .getMeeting(meetingUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (meeting) => {
          this.rsvpMeetingCache.update((cache) => ({ ...cache, [meetingUid]: meeting }));
          this.loadingMeetingUids.update((set) => this.removeFromSet(set, meetingUid));
        },
        error: () => {
          this.loadingMeetingUids.update((set) => this.removeFromSet(set, meetingUid));
        },
      });
  }

  // Persist the hide synchronously (so an unmount within the animation window can't cancel the cookie write), then drive the fade → skeleton → next-action animation through two timers.
  private startCompletion(item: PendingActionItem, options: { withSkeleton: boolean }): void {
    const rowKey = this.getRowKey(item);
    this.hiddenActionsService.hideAction(item);

    this.completingRowKeys.update((keys) => new Set(keys).add(rowKey));
    timer(FADE_OUT_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.completingRowKeys.update((keys) => this.removeFromSet(keys, rowKey));
        const hasQueuedNext = this.visibleActionsUnlimited().length > this.displayLimit();
        if (options.withSkeleton && hasQueuedNext) {
          this.swappingRowKeys.update((keys) => new Set(keys).add(rowKey));
          timer(SKELETON_HOLD_MS)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
              this.swappingRowKeys.update((keys) => this.removeFromSet(keys, rowKey));
              this.hiddenActionsVersion.update((v) => v + 1);
            });
        } else {
          this.hiddenActionsVersion.update((v) => v + 1);
        }
      });
  }

  private removeFromSet(keys: ReadonlySet<string>, rowKey: string): ReadonlySet<string> {
    if (!keys.has(rowKey)) return keys;
    const next = new Set(keys);
    next.delete(rowKey);
    return next;
  }

  private isRsvpInline(item: PendingActionItem): boolean {
    return item.type === 'RSVP' && !!item.meetingUid;
  }

  private isVoteInline(item: PendingActionItem): boolean {
    return item.type === 'Vote' && !!item.voteUid;
  }

  // Intrinsic IDs first (meetingUid for RSVP/Agenda, voteUid for Vote); composite fallback for action types without one.
  private getRowKey(item: PendingActionItem): string {
    if (item.meetingUid) {
      return `${item.type}-${item.meetingUid}-${item.occurrenceId ?? ''}`;
    }
    if (item.voteUid) {
      return `${item.type}-${item.voteUid}`;
    }
    return `${item.type}-${item.text}-${item.buttonLink ?? ''}`;
  }

  private formatResponse(response: RsvpResponse): string {
    switch (response) {
      case 'accepted':
        return 'Yes';
      case 'declined':
        return 'No';
      case 'maybe':
        return 'Maybe';
      default:
        return response;
    }
  }

  private initVisibleActionsUnlimited(): Signal<PendingActionItem[]> {
    return computed(() => {
      this.hiddenActionsVersion();
      const pinned = new Set<string>();
      this.completingRowKeys().forEach((k) => pinned.add(k));
      this.swappingRowKeys().forEach((k) => pinned.add(k));
      return this.pendingActions().filter((item) => pinned.has(this.getRowKey(item)) || !this.hiddenActionsService.isActionHidden(item));
    });
  }

  private initVisibleActions(): Signal<PendingActionItem[]> {
    return computed(() => {
      const limit = this.displayLimit();
      const safeLimit = Number.isFinite(limit) ? Math.max(0, limit) : 2;
      return this.visibleActionsUnlimited().slice(0, safeLimit);
    });
  }

  private initDecoratedActions(): Signal<DecoratedPendingAction[]> {
    return computed(() => {
      const cache = this.rsvpMeetingCache();
      const loading = this.loadingMeetingUids();
      return this.visibleActions().map((item) => {
        const rowKey = this.getRowKey(item);
        const isRsvpInline = this.isRsvpInline(item);
        const isVoteInline = this.isVoteInline(item);
        const meeting = item.meetingUid ? (cache[item.meetingUid] ?? null) : null;
        return {
          ...item,
          rowKey,
          isRsvpInline,
          isVoteInline,
          isRsvpInlineLink: isRsvpInline && !!item.buttonLink,
          isExpanded: false,
          isLoading: !!item.meetingUid && loading.has(item.meetingUid),
          meeting,
          rowClass: 'bg-white',
        };
      });
    });
  }
}
