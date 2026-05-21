// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_LABEL } from '@lfx-one/shared/constants';
import { MeetingService } from '@services/meeting.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { timer } from 'rxjs';

import type { Meeting, MeetingRsvp, PendingActionItem, RsvpResponse } from '@lfx-one/shared/interfaces';

// Fade + collapse animation duration (must match CSS transition in pending-actions-drawer.component.scss).
const FADE_OUT_MS = 300;

interface DrawerActionRow extends PendingActionItem {
  rowKey: string;
  isRsvpInline: boolean;
  isVoteInline: boolean;
  meeting: Meeting | null;
  isMeetingLoading: boolean;
}

@Component({
  selector: 'lfx-pending-actions-drawer',
  imports: [DrawerModule, SkeletonModule, ButtonComponent, TagComponent, EmptyStateComponent, RsvpButtonGroupComponent],
  templateUrl: './pending-actions-drawer.component.html',
  styleUrl: './pending-actions-drawer.component.scss',
})
export class PendingActionsDrawerComponent {
  protected readonly buttonIcons = PENDING_ACTION_BUTTON_ICON;
  protected readonly typeLabels = PENDING_ACTION_LABEL;
  private readonly hiddenActionsService = inject(HiddenActionsService);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly pendingActions = input.required<PendingActionItem[]>();
  public readonly visible = model<boolean>(false);

  public readonly actionCompleted = output<PendingActionItem>();
  // Emits voteUid when a Vote row's CTA is clicked so the parent dashboard can open the cast drawer inline.
  public readonly castVoteRequested = output<string>();

  private readonly hiddenActionsVersion = signal(0);
  // Rows currently in the fade-out + collapse transition; keeps them rendered through the animation.
  protected readonly completingRowKeys = signal<ReadonlySet<string>>(new Set());
  private readonly meetingCache = signal<Record<string, Meeting>>({});
  private readonly loadingMeetingUids = signal<ReadonlySet<string>>(new Set());

  protected readonly visibleRows: Signal<DrawerActionRow[]> = this.initVisibleRows();
  protected readonly uncompletedCount: Signal<number> = computed(() => this.visibleRows().length);

  public constructor() {
    // When the drawer becomes visible, eagerly load Meeting payloads for every RSVP row so the inline RSVP buttons render immediately.
    effect(() => {
      if (!this.visible()) return;
      for (const row of this.visibleRows()) {
        if (row.isRsvpInline && !row.meeting && !row.isMeetingLoading) {
          this.loadMeeting(row.meetingUid as string);
        }
      }
    });
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  protected handleAgendaOrOtherClick(item: DrawerActionRow): void {
    if (item.isVoteInline && item.voteUid) {
      this.visible.set(false);
      this.castVoteRequested.emit(item.voteUid);
      return;
    }
    this.startCompletion(item);
  }

  protected handleRsvpSubmit(item: DrawerActionRow, rsvp: MeetingRsvp): void {
    this.messageService.add({
      key: 'pending-actions-toast',
      severity: 'success',
      summary: 'RSVP saved',
      detail: `You responded '${this.formatResponse(rsvp.response_type)}' to ${item.text}`,
      data: item.meetingUid ? { meetingHref: `/meetings/${item.meetingUid}/details`, meetingTitle: item.text } : undefined,
      life: 5000,
    });
    this.startCompletion(item);
  }

  private loadMeeting(meetingUid: string): void {
    if (this.meetingCache()[meetingUid]) return;
    if (this.loadingMeetingUids().has(meetingUid)) return;

    this.loadingMeetingUids.update((set) => new Set(set).add(meetingUid));
    this.meetingService
      .getMeeting(meetingUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (meeting) => {
          this.meetingCache.update((cache) => ({ ...cache, [meetingUid]: meeting }));
          this.loadingMeetingUids.update((set) => this.removeFromSet(set, meetingUid));
        },
        error: () => {
          this.loadingMeetingUids.update((set) => this.removeFromSet(set, meetingUid));
        },
      });
  }

  // Persist the hide synchronously, then drive the fade animation through a single timer.
  private startCompletion(item: PendingActionItem): void {
    const rowKey = this.getRowKey(item);
    this.hiddenActionsService.hideAction(item);

    this.completingRowKeys.update((keys) => new Set(keys).add(rowKey));
    timer(FADE_OUT_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.completingRowKeys.update((keys) => this.removeFromSet(keys, rowKey));
        this.hiddenActionsVersion.update((v) => v + 1);
        this.actionCompleted.emit(item);
      });
  }

  private removeFromSet(keys: ReadonlySet<string>, rowKey: string): ReadonlySet<string> {
    if (!keys.has(rowKey)) return keys;
    const next = new Set(keys);
    next.delete(rowKey);
    return next;
  }

  // Intrinsic IDs first (meetingUid for RSVP/Agenda, voteUid for Vote); composite fallback otherwise.
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

  private initVisibleRows(): Signal<DrawerActionRow[]> {
    return computed(() => {
      this.hiddenActionsVersion();
      const completing = this.completingRowKeys();
      const cache = this.meetingCache();
      const loading = this.loadingMeetingUids();
      return this.pendingActions()
        .filter((item) => completing.has(this.getRowKey(item)) || !this.hiddenActionsService.isActionHidden(item))
        .map((item) => {
          const rowKey = this.getRowKey(item);
          const isRsvpInline = item.type === 'RSVP' && !!item.meetingUid;
          const isVoteInline = item.type === 'Vote' && !!item.voteUid;
          return {
            ...item,
            rowKey,
            isRsvpInline,
            isVoteInline,
            meeting: item.meetingUid ? (cache[item.meetingUid] ?? null) : null,
            isMeetingLoading: !!item.meetingUid && loading.has(item.meetingUid),
          };
        });
    });
  }
}
