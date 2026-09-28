// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { LoadableState, Meeting, MeetingOccurrence, PastMeeting } from '@lfx-one/shared/interfaces';
import { isWithinHostKeyWindow } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { Popover, PopoverModule } from 'primeng/popover';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';

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

  public readonly meeting = input.required<Meeting | PastMeeting>();
  public readonly occurrence = input<MeetingOccurrence | null>(null);
  public readonly pastMeeting = input<boolean>(false);

  // Fetch-once gate: only the first popover open triggers the lazy detail fetch; retry refetches.
  private fetched = false;
  private readonly loadTrigger$ = new Subject<void>();

  public readonly triggerVisible: Signal<boolean> = this.initTriggerVisible();
  public readonly state: Signal<LoadableState<Meeting | null>> = this.initState();

  public onTriggerClick(event: MouseEvent, popover: Popover): void {
    popover.toggle(event);
    if (this.fetched) {
      return;
    }
    this.fetched = true;
    this.loadTrigger$.next();
  }

  public retry(): void {
    this.loadTrigger$.next();
  }

  private initTriggerVisible(): Signal<boolean> {
    return computed(() => {
      if (this.pastMeeting() || !this.meeting().organizer) {
        return false;
      }
      // An explicit occurrence's start wins; otherwise the meeting's own next-occurrence/start chain applies.
      const meeting = this.meeting();
      const occurrence = this.occurrence();
      const target = occurrence?.start_time
        ? { start_time: occurrence.start_time, duration: occurrence.duration }
        : { start_time: meeting.start_time, duration: meeting.duration, next_occurrence_start_time: meeting.next_occurrence_start_time };
      return isWithinHostKeyWindow(target);
    });
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
