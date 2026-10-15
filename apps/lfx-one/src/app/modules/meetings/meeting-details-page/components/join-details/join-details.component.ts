// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, linkedSignal, PLATFORM_ID, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { HOST_KEY_EARLY_MINUTES, MEETING_HOST_KEY_RETRY_MS } from '@lfx-one/shared/constants';
import { MeetingHostKeyWait } from '@lfx-one/shared/interfaces';
import { getHostKeyWindowStartMs, isHostKeyVisible, isWithinHostKeyWindow } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { pairwise } from 'rxjs';

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
      if (!meeting || !this.upcoming() || !isHostKeyVisible(meeting) || !isWithinHostKeyWindow(meeting, this.state.now())) {
        return null;
      }
      return meeting.host_key ?? null;
    });
  }

  private initHostKeyWait(): Signal<MeetingHostKeyWait | null> {
    return computed(() => {
      const meeting = this.state.meeting();
      const windowStart = meeting ? getHostKeyWindowStartMs(meeting) : null;
      if (!meeting || meeting.organizer !== true || windowStart === null || this.hostKey() || !this.upcoming()) {
        return null;
      }
      const sinceOpen = this.state.now().getTime() - windowStart;
      if (sinceOpen < 0) {
        return 'closed';
      }
      if (!isWithinHostKeyWindow(meeting, this.state.now())) {
        return null;
      }
      if (sinceOpen < MEETING_HOST_KEY_RETRY_MS) {
        return 'opening';
      }
      return sinceOpen < 2 * MEETING_HOST_KEY_RETRY_MS ? 'retry' : 'settled';
    });
  }

  /** An upcoming or live occurrence of a meeting the page loaded as such, not cancelled. */
  private upcoming(): boolean {
    return this.state.timeState() !== 'ended' && !this.state.loadedViaPastMeetingId() && !this.state.cancelledOccurrence();
  }

  /**
   * In the browser only, and only as the window opens on this page (not on a page opened inside it, whose
   * read already had its answer): read the meeting when it moves from `closed` to `opening`, and again
   * as it moves on from `opening` if the key has still not come.
   */
  private readKeyWhenWindowOpens(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    toObservable(this.hostKeyWait)
      .pipe(pairwise(), takeUntilDestroyed(this.destroyRef))
      .subscribe(([previous, current]) => {
        // From before the window to anywhere in it, even past `opening` when the clock catches up late
        // (a sleeping laptop, a throttled tab); then once more from the first read's stage on.
        const opened = previous === 'closed' && (current === 'opening' || current === 'retry' || current === 'settled');
        const retried = previous === 'opening' && (current === 'retry' || current === 'settled');
        if (opened || retried) {
          this.state.reload();
        }
      });
  }
}
