// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, linkedSignal, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { HOST_KEY_EARLY_MINUTES, MEETING_HOST_KEY_CLOCK_SKEW_MS, MEETING_HOST_KEY_RETRY_MS } from '@lfx-one/shared/constants';
import { Meeting, MeetingHostKeyWait } from '@lfx-one/shared/interfaces';
import { getHostKeyWindowStartMs, isHostKeyVisible, isWithinHostKeyWindow } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The prototype's "Join details" section (E7-01, #3590; E7-02, #3591, FR-042, FR-043), holding only the
 * host key until Meeting ID, Passcode and Dial-in reach the payload (U-04 #2930, U-05 #2931): no row is
 * rendered for a field the meeting does not carry, and the section is absent when no row has one.
 * @description The host key row shows the key the BFF returned, which it does only for a signed-in host
 * inside its window (start − 70 min to end + 40 min), never on a past meeting. The client never decides
 * who may see it: it only hides a key whose window has since closed (a page left open). Masked by
 * default; a toggle with one stable name and `aria-pressed` reveals it into a polite live region, and a
 * button copies it, with V1's
 * toasts. Before that window an organizer, the one host the page can tell apart without the key, sees
 * when it becomes available; when the window opens the browser reads the meeting again, and once more
 * {@link MEETING_HOST_KEY_RETRY_MS} later if the key has still not come, so a page left open gains it
 * from the server. The window here only times those reads and hides; it grants nothing.
 */
@Component({
  selector: 'lfx-meeting-join-details',
  imports: [ButtonComponent],
  templateUrl: './join-details.component.html',
})
export class MeetingJoinDetailsComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ids = inject(_IdGenerator);

  protected readonly earlyMinutes = HOST_KEY_EARLY_MINUTES;
  protected readonly helpId = this.ids.getId('meeting-host-key-help-');
  /** A 30px round icon button, as the prototype's copy control. */
  protected readonly iconButtonClass =
    '!h-[30px] !w-[30px] !min-w-0 !rounded-full !border !border-[var(--md-border)] !bg-[var(--md-surface-card)] !p-0 !text-[var(--md-text-muted)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)]';

  /** The key the server returned for this viewer, on an upcoming or live occurrence, while its window lasts. */
  protected readonly hostKey: Signal<string | null> = this.initHostKey();
  /**
   * The windows (meeting and window start) this browser page saw closed, and the times it then read each
   * one again.
   * Only a page that waited reads: one opened inside the window already had the server's answer.
   */
  private readonly sawClosed = signal<ReadonlySet<string>>(new Set());
  private readonly reads = signal<Readonly<Record<string, number[]>>>({});
  /** An organizer's page with no key yet, against the window; `null` when it is not waiting for one. */
  private readonly hostKeyWait: Signal<MeetingHostKeyWait | null> = this.initHostKeyWait();
  /** The row says when the key becomes available: before the window, and while the page reads it. */
  protected readonly awaitingHostKey = computed(() => {
    const wait = this.hostKeyWait();
    return !!wait && wait !== 'settled';
  });
  /** Re-masked whenever another key arrives (another meeting, or a reload), as V1's panel does. */
  protected readonly revealed = linkedSignal(() => {
    this.hostKey();
    return false;
  });

  public constructor() {
    this.readKeyWhenWindowOpens();
  }

  protected toggleReveal(): void {
    this.revealed.update((current) => !current);
  }

  protected copyHostKey(): void {
    const key = this.hostKey();
    if (!key) {
      return;
    }
    if (this.clipboard.copy(key)) {
      this.messageService.add({ severity: 'success', summary: 'Host Key Copied', detail: 'The host key has been copied to your clipboard' });
    } else {
      this.messageService.add({ severity: 'error', summary: 'Copy Failed', detail: 'Unable to copy the host key. Please copy it manually.' });
    }
  }

  private initHostKey(): Signal<string | null> {
    return computed(() => {
      const meeting = this.state.meeting();
      if (!meeting || !this.upcoming() || !isHostKeyVisible(meeting) || !this.keyWindowHolds(meeting)) {
        return null;
      }
      return meeting.host_key ?? null;
    });
  }

  private initHostKeyWait(): Signal<MeetingHostKeyWait | null> {
    return computed(() => {
      const meeting = this.state.meeting();
      const timing = meeting ? this.windowTiming(meeting) : null;
      const windowStart = timing ? getHostKeyWindowStartMs(timing) : null;
      if (!meeting || !timing || meeting.organizer !== true || windowStart === null || this.hostKey() || !this.upcoming()) {
        return null;
      }
      const now = this.state.now();
      if (now.getTime() < windowStart) {
        return 'closed';
      }
      const windowKey = `${meeting.id}@${windowStart}`;
      if (!isWithinHostKeyWindow(timing, now) || !this.sawClosed().has(windowKey)) {
        return null;
      }
      const reads = this.reads()[windowKey] ?? [];
      if (reads.length === 0) {
        return 'opening';
      }
      // The second read comes 90s after the first actually ran, however late a sleeping tab woke.
      const sinceRead = now.getTime() - reads[reads.length - 1];
      if (reads.length === 1) {
        return sinceRead < MEETING_HOST_KEY_RETRY_MS ? 'opening' : 'retry';
      }
      return sinceRead < MEETING_HOST_KEY_RETRY_MS ? 'retry' : 'settled';
    });
  }

  /**
   * The occurrence the page shows, as the window's timing: its own start and duration when it has one,
   * else the meeting's next-occurrence/start chain, as V1's host-key popover reads it. Timing only; the
   * server's `can_view_host_key` stays the authority.
   */
  private windowTiming(meeting: Meeting): Pick<Meeting, 'start_time' | 'duration' | 'next_occurrence_start_time'> {
    const occurrence = this.state.selectedOccurrence();
    return occurrence?.start_time
      ? // A zero or missing duration inherits the series', as the rest of the page reads it.
        { start_time: occurrence.start_time, duration: occurrence.duration || meeting.duration }
      : { start_time: meeting.start_time, duration: meeting.duration, next_occurrence_start_time: meeting.next_occurrence_start_time };
  }

  /**
   * Whether the shown occurrence's window still holds a key the server returned: it hides one once that
   * window has closed (a page left open), or when the shown occurrence's window is still well ahead (a
   * later occurrence selected), but allows a browser clock running up to
   * {@link MEETING_HOST_KEY_CLOCK_SKEW_MS} behind the server's that authorized it.
   */
  private keyWindowHolds(meeting: Meeting): boolean {
    const timing = this.windowTiming(meeting);
    const windowStart = getHostKeyWindowStartMs(timing);
    // The key belongs to the window the server returned it for (the payload's next occurrence): a page
    // left open into a later occurrence's window needs a fresh read, as the key may have rotated.
    const servedFor = getHostKeyWindowStartMs(meeting);
    const now = this.state.now();
    if (windowStart === null || servedFor === null || Math.abs(windowStart - servedFor) > MEETING_HOST_KEY_CLOCK_SKEW_MS) {
      return false;
    }
    if (now.getTime() < windowStart - MEETING_HOST_KEY_CLOCK_SKEW_MS) {
      return false;
    }
    return now.getTime() < windowStart || isWithinHostKeyWindow(timing, now);
  }

  /** An upcoming or live occurrence of a meeting the page loaded as such. */
  private upcoming(): boolean {
    return this.state.timeState() !== 'ended' && !this.state.loadedViaPastMeetingId();
  }

  /**
   * In the browser only. A page that saw the window closed reads the meeting as it opens (or on waking
   * inside it), and once more {@link MEETING_HOST_KEY_RETRY_MS} after that read if the key has not come.
   */
  private readKeyWhenWindowOpens(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    // The wait together with the window it is about: switching between two occurrences whose windows are
    // both still closed changes the window, not the wait, and each must be recorded as seen closed.
    const watched = computed(
      () => {
        const meeting = this.state.meeting();
        const windowStart = meeting ? getHostKeyWindowStartMs(this.windowTiming(meeting)) : null;
        // Per meeting and window: each later occurrence's window gets its own read and retry.
        return meeting && windowStart !== null ? { id: `${meeting.id}@${windowStart}`, wait: this.hostKeyWait() } : null;
      },
      { equal: (a, b) => a?.id === b?.id && a?.wait === b?.wait }
    );
    toObservable(watched)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((current) => {
        if (!current) {
          return;
        }
        const { id, wait } = current;
        if (wait === 'closed' && !this.sawClosed().has(id)) {
          this.sawClosed.update((ids) => new Set([...ids, id]));
          return;
        }
        const count = (this.reads()[id] ?? []).length;
        if ((wait === 'opening' && count === 0) || (wait === 'retry' && count === 1)) {
          const at = this.state.now().getTime();
          this.reads.update((reads) => ({ ...reads, [id]: [...(reads[id] ?? []), at] }));
          this.state.reload();
        }
      });
  }
}
