// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { HOST_KEY_EARLY_MINUTES } from '@lfx-one/shared/constants';
import { LoadableState, Meeting, MeetingOccurrence, PastMeeting } from '@lfx-one/shared/interfaces';
import { isWithinHostKeyWindow } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { Popover, PopoverModule } from 'primeng/popover';
import { catchError, interval, map, of, startWith, Subject, switchMap } from 'rxjs';

import { HostKeyPanelComponent } from '../host-key-panel/host-key-panel.component';

/**
 * Lazy "Host controls" popover for the meeting card: list payloads never carry the host key,
 * so the key is fetched (skipCache — it can rotate) only when an organizer opens the popover.
 */
@Component({
  selector: 'lfx-host-key-popover',
  imports: [ButtonComponent, HostKeyPanelComponent, PopoverModule],
  templateUrl: './host-key-popover.component.html',
  // Host sits in the card's equal-width button row — collapse it when the trigger isn't eligible.
  host: { '[class.hidden]': '!triggerVisible()' },
})
export class HostKeyPopoverComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  public readonly meeting = input.required<Meeting | PastMeeting>();
  public readonly occurrence = input<MeetingOccurrence | null>(null);
  public readonly pastMeeting = input<boolean>(false);

  private readonly loadTrigger$ = new Subject<void>();
  // Minute ticker so the window gate re-evaluates as time passes — a bare `new Date()` inside the
  // computed is not reactive, so a card left open across the 70/40-minute boundaries would never flip.
  private readonly now: WritableSignal<Date> = signal(new Date());

  public readonly triggerVisible: Signal<boolean> = this.initTriggerVisible();
  public readonly state: Signal<LoadableState<Meeting | null>> = this.initState();
  protected readonly hostKeyEarlyMinutes = HOST_KEY_EARLY_MINUTES;

  public constructor() {
    this.initClock();
  }

  public onTriggerClick(event: MouseEvent, popover: Popover): void {
    popover.toggle(event);
    // Fetch on every open (not just the first): the key can rotate, and the server enforces the
    // exposure window, so a fresh skipCache read per open is both safe and never stale.
    if (popover.overlayVisible) {
      this.loadTrigger$.next();
    }
  }

  public retry(): void {
    this.loadTrigger$.next();
  }

  private initTriggerVisible(): Signal<boolean> {
    return computed(() => {
      // Organizer-only by design; the server separately authorizes Zoom co-hosts (FGA host relation) —
      // co-hosts see the key on the join page via can_view_host_key. Fails closed; the server is the real boundary.
      if (this.pastMeeting() || !this.meeting().organizer) {
        return false;
      }
      // An explicit occurrence's start wins; otherwise the meeting's own next-occurrence/start chain applies.
      const meeting = this.meeting();
      const occurrence = this.occurrence();
      const target = occurrence?.start_time
        ? { start_time: occurrence.start_time, duration: occurrence.duration }
        : { start_time: meeting.start_time, duration: meeting.duration, next_occurrence_start_time: meeting.next_occurrence_start_time };
      return isWithinHostKeyWindow(target, this.now());
    });
  }

  private initClock(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    interval(60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(new Date()));
  }

  private initState(): Signal<LoadableState<Meeting | null>> {
    return toSignal(
      this.loadTrigger$.pipe(
        switchMap(() =>
          this.meetingService.getMeetingDetail(this.meeting().id, { skipCache: true }).pipe(
            map((detail): LoadableState<Meeting | null> => ({ loading: false, error: null, data: detail })),
            catchError(() => of<LoadableState<Meeting | null>>({ loading: false, error: 'Failed to load the host key', data: null })),
            startWith({ loading: true, error: null, data: null })
          )
        )
      ),
      { initialValue: { loading: false, error: null, data: null } }
    );
  }
}
