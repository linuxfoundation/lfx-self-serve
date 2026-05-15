// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { stableKeyParity } from '@lfx-one/shared/utils';
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
  // Emits the voteUid when a Vote pending-action is clicked, so the parent dashboard can open the cast drawer inline instead of navigating to /votes.
  public readonly castVoteRequested = output<string>();

  // Cookie-backed dismissals live outside the signal graph; bumping forces the computed to recompute.
  private readonly hiddenActionsVersion = signal(0);
  protected readonly expandedRsvpKey = signal<string | null>(null);
  protected readonly dismissingRowKeys = signal<ReadonlySet<string>>(new Set());
  private readonly loadingMeetingUid = signal<string | null>(null);
  private readonly rsvpMeetingCache = signal<Record<string, Meeting>>({});
  // Pinned through the 1.5s post-RSVP cue window so a parent re-emit can't filter the row out
  // before the confirmation tint renders.
  private readonly frozenDismissingKeys = signal<ReadonlySet<string>>(new Set());

  private readonly visibleActions: Signal<PendingActionItem[]> = computed(() => {
    this.hiddenActionsVersion();
    const frozen = this.frozenDismissingKeys();
    const unhidden = this.pendingActions().filter((item) => frozen.has(this.getRowKey(item)) || !this.hiddenActionsService.isActionHidden(item));
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

    if (this.isVoteInline(item) && item.voteUid) {
      // Vote rows: just open the drawer; hide-on-success happens via the parent dashboard's handleVoteSubmitted path, so cancel/error leaves the row in place.
      this.castVoteRequested.emit(item.voteUid);
      return;
    }

    this.hiddenActionsService.hideAction(item);
    this.hiddenActionsVersion.update((v) => v + 1);
    this.actionClick.emit(item);
  }

  protected handleRsvpChanged(item: DecoratedPendingAction): void {
    // Skip `actionClick` so the parent dashboard doesn't refresh and skeleton-flash siblings.
    // Persist SYNCHRONOUSLY (before the timer) so an unmount inside the 1.5s window can't
    // cancel the cookie write via `takeUntilDestroyed` and resurrect the row on next visit.
    this.hiddenActionsService.hideAction(item);

    // Per-row sets let concurrent RSVPs each keep their emerald tint until their own timer fires.
    const rowKey = this.getRowKey(item);
    this.dismissingRowKeys.update((keys) => new Set(keys).add(rowKey));
    this.frozenDismissingKeys.update((keys) => new Set(keys).add(rowKey));
    timer(1500)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.expandedRsvpKey() === rowKey) {
          this.expandedRsvpKey.set(null);
        }
        this.frozenDismissingKeys.update((keys) => {
          if (!keys.has(rowKey)) return keys;
          const next = new Set(keys);
          next.delete(rowKey);
          return next;
        });
        const wasDismissing = this.dismissingRowKeys().has(rowKey);
        this.dismissingRowKeys.update((keys) => {
          if (!keys.has(rowKey)) return keys;
          const next = new Set(keys);
          next.delete(rowKey);
          return next;
        });
        if (wasDismissing) {
          this.hiddenActionsVersion.update((v) => v + 1);
        }
      });
  }

  private isRsvpInline(item: PendingActionItem): boolean {
    return item.type === 'RSVP' && !!item.meetingUid;
  }

  private isVoteInline(item: PendingActionItem): boolean {
    return item.type === 'Vote' && !!item.voteUid;
  }

  // Intrinsic IDs first (meetingUid for RSVP/Agenda, voteUid for Vote); composite fallback for action types without one. Distinct intrinsic IDs prevent two same-titled votes from colliding on the hidden-actions cookie.
  private getRowKey(item: PendingActionItem): string {
    if (item.meetingUid) {
      return `${item.type}-${item.meetingUid}-${item.occurrenceId ?? ''}`;
    }
    if (item.voteUid) {
      return `${item.type}-${item.voteUid}`;
    }
    return `${item.type}-${item.text}-${item.buttonLink ?? ''}`;
  }

  private initDecoratedActions(): Signal<DecoratedPendingAction[]> {
    return computed(() => {
      const expandedKey = this.expandedRsvpKey();
      const loadingUid = this.loadingMeetingUid();
      const cache = this.rsvpMeetingCache();
      const dismissing = this.dismissingRowKeys();

      return this.visibleActions().map((item) => {
        const rowKey = this.getRowKey(item);
        const isRsvpInline = this.isRsvpInline(item);
        const isVoteInline = this.isVoteInline(item);
        const meeting = item.meetingUid ? (cache[item.meetingUid] ?? null) : null;
        let rowClass: string;
        if (dismissing.has(rowKey)) {
          rowClass = 'bg-emerald-50/60';
        } else if (item.type === 'RSVP') {
          rowClass = 'bg-amber-50/60';
        } else {
          rowClass = stableKeyParity(rowKey) === 0 ? 'bg-white' : 'bg-gray-50/60';
        }
        return {
          ...item,
          rowKey,
          isRsvpInline,
          isVoteInline,
          isRsvpInlineLink: isRsvpInline && !!item.buttonLink,
          isExpanded: expandedKey === rowKey,
          isLoading: !!item.meetingUid && loadingUid === item.meetingUid,
          meeting,
          rowClass,
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
