// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { MeetingService } from '@services/meeting.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { MessageService } from 'primeng/api';
import { timer } from 'rxjs';

import type { DecoratedPendingAction, Meeting, PendingActionItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-pending-actions',
  imports: [ButtonComponent, TagComponent, RsvpButtonGroupComponent],
  templateUrl: './pending-actions.component.html',
  styleUrl: './pending-actions.component.scss',
})
export class PendingActionsComponent {
  private readonly hiddenActionsService = inject(HiddenActionsService);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly pendingActions = input.required<PendingActionItem[]>();
  public readonly displayLimit = input<number>(5);

  public readonly actionClick = output<PendingActionItem>();

  // Cookie-backed dismissals live outside the signal graph; bumping forces the computed to recompute.
  private readonly hiddenActionsVersion = signal(0);
  protected readonly expandedRsvpKey = signal<string | null>(null);
  private readonly loadingMeetingUid = signal<string | null>(null);
  private readonly rsvpMeetingCache = signal<Record<string, Meeting>>({});

  private readonly visibleActions: Signal<PendingActionItem[]> = computed(() => {
    this.hiddenActionsVersion();
    const unhidden = this.pendingActions().filter((item) => !this.hiddenActionsService.isActionHidden(item));
    const limit = this.displayLimit();
    // `slice(0, -1)` would silently drop the last item, so clamp non-finite/negative limits.
    const safeLimit = Number.isFinite(limit) ? Math.max(0, limit) : 5;
    return unhidden.slice(0, safeLimit);
  });

  protected readonly decoratedActions: Signal<DecoratedPendingAction[]> = this.initDecoratedActions();

  protected handleActionClick(item: DecoratedPendingAction): void {
    if (this.isRsvpInline(item)) {
      this.loadMeetingForRsvp(item);
      return;
    }

    this.hiddenActionsService.hideAction(item);
    this.hiddenActionsVersion.update((v) => v + 1);
    this.actionClick.emit(item);
  }

  protected handleRsvpChanged(item: DecoratedPendingAction): void {
    // Skip `actionClick` emit so the parent dashboard doesn't refresh and skeleton-flash sibling rows.
    // Defer the dismiss so the chosen response and toast register before the row vanishes.
    // Guard the collapse on rowKey so A's timer can't collapse B if the user moved on.
    const rowKey = this.getRowKey(item);
    timer(1500)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.expandedRsvpKey() === rowKey) {
          this.expandedRsvpKey.set(null);
        }
        this.hiddenActionsService.hideAction(item);
        this.hiddenActionsVersion.update((v) => v + 1);
      });
  }

  private isRsvpInline(item: PendingActionItem): boolean {
    return item.type === 'RSVP' && !!item.meetingUid;
  }

  // Prefer intrinsic IDs; fall back to a composite for action types that don't carry IDs yet.
  private getRowKey(item: PendingActionItem): string {
    if (item.meetingUid) {
      return `${item.type}-${item.meetingUid}-${item.occurrenceId ?? ''}`;
    }
    return `${item.type}-${item.text}-${item.buttonLink ?? ''}`;
  }

  private initDecoratedActions(): Signal<DecoratedPendingAction[]> {
    return computed(() => {
      const expandedKey = this.expandedRsvpKey();
      const loadingUid = this.loadingMeetingUid();
      const cache = this.rsvpMeetingCache();

      return this.visibleActions().map((item) => {
        const rowKey = this.getRowKey(item);
        const isRsvpInline = this.isRsvpInline(item);
        const meeting = item.meetingUid ? (cache[item.meetingUid] ?? null) : null;
        return {
          ...item,
          rowKey,
          isRsvpInline,
          isRsvpInlineLink: isRsvpInline && !!item.buttonLink,
          isExpanded: expandedKey === rowKey,
          isLoading: !!item.meetingUid && loadingUid === item.meetingUid,
          meeting,
        };
      });
    });
  }

  private loadMeetingForRsvp(item: PendingActionItem): void {
    const meetingUid = item.meetingUid;
    if (!meetingUid) return;

    this.expandedRsvpKey.set(this.getRowKey(item));

    if (this.rsvpMeetingCache()[meetingUid]) return;

    this.loadingMeetingUid.set(meetingUid);
    this.meetingService
      .getMeeting(meetingUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (meeting) => {
          this.rsvpMeetingCache.update((cache) => ({ ...cache, [meetingUid]: meeting }));
          // Only clear loading if this is still the in-flight request — guards against stale row swaps.
          if (this.loadingMeetingUid() === meetingUid) {
            this.loadingMeetingUid.set(null);
          }
        },
        error: () => {
          if (this.loadingMeetingUid() === meetingUid) {
            this.loadingMeetingUid.set(null);
          }
          if (this.expandedRsvpKey() === this.getRowKey(item)) {
            this.expandedRsvpKey.set(null);
          }
          this.messageService.add({
            severity: 'error',
            summary: 'Could not load meeting',
            detail: 'Open the meeting page from the title link and try again.',
            life: 4000,
          });
        },
      });
  }
}
