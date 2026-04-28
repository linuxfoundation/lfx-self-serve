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

import type { Meeting, PendingActionItem } from '@lfx-one/shared/interfaces';
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

  // Version counter bumped whenever the user dismisses an action. HiddenActionsService stores hides
  // in a cookie, which is outside the signal graph — reading it inside `visibleActions` wouldn't
  // re-trigger the computed on dismiss. Bumping this signal forces a recompute so the dismissed
  // row disappears and the next waiting item slides into the slot immediately.
  private readonly hiddenActionsVersion = signal(0);

  // Tracks which row, if any, has been clicked into "RSVP mode" so the right-hand cell can swap
  // from the Set RSVP CTA to the inline Yes/No/Maybe button group. Keyed by getRowKey(item) — the
  // same expression the template's @for trackBy uses, so reordering the list preserves expansion.
  protected readonly expandedRsvpKey = signal<string | null>(null);

  // The meetingUid currently being fetched (if any). Per-meeting tracking instead of a global flag
  // so a stale response from row A's request can't clobber row B's loading state when the user
  // quickly toggles between rows.
  private readonly loadingMeetingUid = signal<string | null>(null);

  // Per-meetingUid cache so the user can collapse and re-expand the same row (or expand a sibling
  // RSVP row that points at the same meeting) without triggering a refetch each time.
  private readonly rsvpMeetingCache = signal<Record<string, Meeting>>({});

  // Windowed view of the incoming list: drop anything the user has dismissed (HiddenActionsService
  // sets a 24h cookie on click) and cap to displayLimit so the user focuses on a handful at a time.
  // When one is dismissed, it leaves the window and the next waiting item slides into the slot on
  // the next change-detection pass. The full list still lives on the parent — this just controls
  // what gets rendered.
  protected readonly visibleActions: Signal<PendingActionItem[]> = computed(() => {
    this.hiddenActionsVersion();
    const unhidden = this.pendingActions().filter((item) => !this.hiddenActionsService.isActionHidden(item));
    // Guard against negative / non-finite inputs — `slice(0, -1)` would silently drop the last
    // item instead of capping, which is surprising API behavior for a public input.
    const limit = this.displayLimit();
    const safeLimit = Number.isFinite(limit) ? Math.max(0, limit) : 5;
    return unhidden.slice(0, safeLimit);
  });

  protected handleActionClick(item: PendingActionItem): void {
    // RSVP-inline path: expand the row and lazy-load the Meeting. Don't dismiss the row or emit
    // actionClick yet — both happen once the user actually picks a response (handleRsvpChanged).
    if (this.isRsvpInline(item)) {
      this.loadMeetingForRsvp(item);
      return;
    }

    this.hiddenActionsService.hideAction(item);
    this.hiddenActionsVersion.update((v) => v + 1);
    this.actionClick.emit(item);
  }

  protected handleRsvpChanged(item: PendingActionItem): void {
    // Local, post-confirmation row removal. We deliberately do NOT emit `actionClick` here:
    //  - The button group already gives the user visual confirmation (the selected response
    //    becomes the active button + the success toast).
    //  - Emitting `actionClick` makes parent dashboards call `refresh$.next()`, which puts the
    //    pending-actions card into a loading state and briefly collapses every OTHER row into
    //    a skeleton flash / "Your desk is clear" empty state.
    //  - The cookie-based dismiss is a sufficient client-side reconciliation; the next page
    //    load reconciles authoritatively against the server.
    // Short delay before dismissing so the user can see their choice register inside the row
    // and read the toast — abrupt removal feels like the click did nothing. timer + takeUntilDestroyed
    // (instead of raw setTimeout) ensures the deferred work is cancelled if the component unmounts
    // mid-delay, so we never write to signals on a destroyed instance.
    //
    // Capture this row's key up front so the guarded clear below knows exactly which row scheduled
    // this timer. If the user RSVPs row A and opens row B before A's 1.5s timer fires, the timer
    // must not collapse B's expansion just because A's deferred dismiss is firing. hideAction and
    // the version bump still run unconditionally — those dismiss row A from the visible list,
    // which is what the user actually asked for.
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

  protected isRsvpInline(item: PendingActionItem): boolean {
    return item.type === 'RSVP' && !!item.meetingUid;
  }

  protected isExpanded(item: PendingActionItem): boolean {
    return this.expandedRsvpKey() === this.getRowKey(item);
  }

  protected isLoadingForItem(item: PendingActionItem): boolean {
    return !!item.meetingUid && this.loadingMeetingUid() === item.meetingUid;
  }

  protected getMeetingForItem(item: PendingActionItem): Meeting | null {
    return item.meetingUid ? (this.rsvpMeetingCache()[item.meetingUid] ?? null) : null;
  }

  // Stable identifier for a row. Prefers intrinsic IDs (meetingUid + occurrenceId) when present —
  // those don't drift if copy is edited or query strings shift. Falls back to a type+text+buttonLink
  // composite for action types that don't carry IDs yet (Vote/Survey/Agenda). The template's @for
  // trackBy uses this same expression so the row identity is consistent everywhere.
  protected getRowKey(item: PendingActionItem): string {
    if (item.meetingUid) {
      return `${item.type}-${item.meetingUid}-${item.occurrenceId ?? ''}`;
    }
    return `${item.type}-${item.text}-${item.buttonLink ?? ''}`;
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
          // Only clear the loading flag when this response is the one we're still waiting on. If the
          // user moved to a different row before this completed, leave the new row's loading state
          // alone — its own request owns it now.
          if (this.loadingMeetingUid() === meetingUid) {
            this.loadingMeetingUid.set(null);
          }
        },
        error: () => {
          // Surface the failure so the user knows the click did register and why the inline RSVP
          // didn't come up. Same staleness guard as the success path: a late-arriving failure for
          // row A must not collapse row B if the user has already moved on.
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
