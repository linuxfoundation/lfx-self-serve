// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { Component, computed, DestroyRef, inject, linkedSignal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { isHostKeyVisible, isWithinHostKeyWindow } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { distinctUntilChanged, filter } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The prototype's "Join details" section (E7-01, #3590; E7-02, #3591, FR-042, FR-043), holding only the
 * host key until Meeting ID, Passcode and Dial-in reach the payload (U-04 #2930, U-05 #2931): no row is
 * rendered for a field the meeting does not carry, and the section is absent when no row has one.
 * @description The host key row shows the key the BFF returned, which it does only for a signed-in host
 * inside its window (start − 70 min to end + 40 min), never on a past meeting: the client never derives
 * who may see it. Masked by default; a toggle (`aria-pressed`) reveals it and a button copies it, with
 * V1's toasts. Before that window an organizer, the one host the page can tell apart without the key,
 * sees when it becomes available (from the start, for display only), and the page reloads the meeting
 * once when the window opens, so a page left open gains the key from the server.
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

  /** The key the server returned for this viewer and meeting, on an upcoming or live occurrence only. */
  protected readonly hostKey: Signal<string | null> = this.initHostKey();
  /** An organizer before the host-key window: the row says when the key becomes available. */
  protected readonly awaitingHostKey: Signal<boolean> = this.initAwaitingHostKey();
  /** Re-masked whenever another key arrives (another meeting, or a reload), as V1's panel does. */
  protected readonly revealed = linkedSignal(() => {
    this.hostKey();
    return false;
  });
  protected readonly helpId = inject(_IdGenerator).getId('meeting-host-key-help-');
  /** A 30px round icon button, as the prototype's copy control. */
  protected readonly iconButtonClass =
    '!h-[30px] !w-[30px] !min-w-0 !rounded-full !border !border-[var(--md-border)] !bg-[var(--md-surface-card)] !p-0 !text-[var(--md-text-muted)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)]';

  public constructor() {
    this.reloadWhenHostKeyWindowOpens();
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
      const upcoming = this.state.timeState() !== 'ended' && !this.state.loadedViaPastMeetingId() && !this.state.cancelledOccurrence();
      return meeting && upcoming && isHostKeyVisible(meeting) ? (meeting.host_key ?? null) : null;
    });
  }

  private initAwaitingHostKey(): Signal<boolean> {
    return computed(() => {
      const meeting = this.state.meeting();
      return (
        !!meeting &&
        meeting.organizer === true &&
        !this.hostKey() &&
        this.state.timeState() === 'before' &&
        !this.state.loadedViaPastMeetingId() &&
        !this.state.cancelledOccurrence() &&
        !isWithinHostKeyWindow(meeting, this.state.now())
      );
    });
  }

  /**
   * Once, when the window opens on an organizer's page that has no key yet: reload the meeting so the
   * server, which decides, can return it. The window here only times the reload; it grants nothing.
   */
  private reloadWhenHostKeyWindowOpens(): void {
    const reloaded = new Set<string>();
    const due = computed(() => {
      const meeting = this.state.meeting();
      return !!meeting &&
        meeting.organizer === true &&
        !this.hostKey() &&
        !this.state.loadedViaPastMeetingId() &&
        isWithinHostKeyWindow(meeting, this.state.now())
        ? meeting.id
        : null;
    });
    toObservable(due)
      .pipe(
        distinctUntilChanged(),
        filter((id): id is string => !!id && !reloaded.has(id)),
        takeUntilDestroyed(inject(DestroyRef))
      )
      .subscribe((id) => {
        reloaded.add(id);
        this.state.reload();
      });
  }
}
