// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { PUBLIC_CALENDAR_MODAL_ACTIONS, PUBLIC_CALENDAR_MODAL_NO_DETAILS } from '@lfx-one/shared/constants';
import {
  Meeting,
  MeetingRegisterDialogData,
  PublicCalendarMeetingModalData,
  PublicCalendarModalAction,
  PublicCalendarModalDetails,
  PublicCalendarModalState,
  PublicMeetingRegistrationResponse,
} from '@lfx-one/shared/interfaces';
import {
  buildPublicMeetingIcs,
  downloadFromUrl,
  formatMeetingCalendarDay,
  formatMeetingCalendarTime,
  getLargestSessionShareUrl,
  getMeetingCalendarTypeColor,
  getMeetingRecurrenceLabel,
  getPastMeetingSummaryContent,
  isOccurrencePast,
  resolvePublicCalendarModalState,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { LinkifyPipe } from '@shared/pipes/linkify.pipe';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { catchError, forkJoin, map, Observable, of, startWith, switchMap, take } from 'rxjs';

import { MeetingDetailsRegisterModalComponent } from '../../meetings-redesign/components/meeting-details-drawer/register/meeting-details-register-modal.component';
import { MeetingsHomeDialogsService } from '../../meetings-redesign/services/meetings-home-dialogs.service';

/**
 * One meeting date of the public project calendar: its type, time in the viewer's zone, cadence, groups and agenda, and what
 * the viewer can do, signed in or not. Open it with `UiModalService` and {@link PublicCalendarMeetingModalData}.
 * @description A signed-in viewer's invitation or registration, and a past date's recording and summary, load on open, never
 * from the cacheable feed. Every date links to its meeting page.
 */
@Component({
  selector: 'lfx-public-calendar-meeting-modal',
  imports: [LinkifyPipe, UiBadgeComponent, UiButtonComponent, UiModalComponent, UiNoteComponent],
  templateUrl: './public-calendar-meeting-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicCalendarMeetingModalComponent {
  private readonly dialogRef = inject(DialogRef);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly meetingService = inject(MeetingService);
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly dialogs = inject(MeetingsHomeDialogsService);
  private readonly userService = inject(UserService);
  protected readonly data = inject<PublicCalendarMeetingModalData>(DIALOG_DATA);

  protected readonly actionStyles = PUBLIC_CALENDAR_MODAL_ACTIONS;
  protected readonly typeLabel = this.data.entry.type?.trim() || 'Other';
  protected readonly typeColor = getMeetingCalendarTypeColor(this.data.entry.type);
  /** "Wed, Oct 1 · 10:00 AM CEST · 60 min". */
  protected readonly when = this.initWhen();
  protected readonly cadence = getMeetingRecurrenceLabel(this.data.meeting);
  protected readonly groupNames = this.data.groups.join(', ');
  /** Read from the clock when it opens, not the calendar's, which may have been open a while. */
  protected readonly past = !!this.data.meeting.meeting_and_occurrence_id || isOccurrencePast(this.data.entry.startTime, this.data.entry.durationMinutes);
  protected readonly live = !this.past && Date.parse(this.data.entry.startTime) <= Date.now();
  /** The meeting page of this date: the past meeting's page once it ended, else the series at this occurrence. */
  protected readonly pageLink: { path: string[]; queryParams: Record<string, string> } = this.initPageLink();

  private readonly registered = signal(false);
  protected readonly details: Signal<PublicCalendarModalDetails> = this.initDetails();
  protected readonly state: Signal<PublicCalendarModalState> = computed(() => {
    const details = this.details();
    return resolvePublicCalendarModalState({
      signedIn: this.userService.authenticated(),
      failed: details.failed,
      past: this.past,
      live: this.live,
      restricted: this.data.meeting.restricted,
      invited: details.invited || this.registered(),
      recording: details.recording,
      summary: details.summary,
      access: details.access,
    });
  });

  protected run(action: PublicCalendarModalAction): void {
    switch (action) {
      case 'join':
      case 'view-summary':
        this.openPage();
        return;
      case 'add-to-calendar':
        this.downloadIcs();
        return;
      case 'register':
        this.register();
        return;
      case 'watch-recording':
        if (this.details().shareUrl) this.dialogs.openRecording(this.details().shareUrl as string);
        return;
      default:
        this.document.defaultView?.location.assign(this.signInUrl());
    }
  }

  /** Back to this calendar with the modal reopened: the page keeps `?meeting=` in its URL. */
  protected signInUrl(): string {
    return `/login?returnTo=${encodeURIComponent(this.router.url)}`;
  }

  protected openPage(): void {
    // True: the calendar leaves `?meeting=` alone, so its own navigation can't cancel this one.
    this.dialogRef.close(true);
    void this.router.navigate(this.pageLink.path, { queryParams: this.pageLink.queryParams });
  }

  private initWhen(): string {
    const { startTime, durationMinutes } = this.data.entry;
    // The zone as of this date, so a summer date reads EDT even when viewed in winter.
    const zone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date(startTime)).find((part) => part.type === 'timeZoneName');
    const time = [formatMeetingCalendarTime(startTime), zone?.value].filter(Boolean).join(' ');
    return `${formatMeetingCalendarDay(startTime)} · ${time} · ${durationMinutes} min`;
  }

  private initPageLink(): { path: string[]; queryParams: Record<string, string> } {
    const { meeting, entry } = this.data;
    const start = String(Date.parse(entry.startTime));
    if (this.past) return { path: ['/meetings', meeting.meeting_and_occurrence_id ?? `${meeting.id}-${start}`], queryParams: {} };
    // The meeting page picks the date by its start in ms.
    return { path: ['/meetings', meeting.id], queryParams: meeting.occurrences?.length ? { occurrence: start } : {} };
  }

  private initDetails(): Signal<PublicCalendarModalDetails> {
    const signedIn = this.userService.authenticated();
    const { meeting } = this.data;
    let details$: Observable<PublicCalendarModalDetails> = of(PUBLIC_CALENDAR_MODAL_NO_DETAILS);
    if (this.past) {
      const id = this.pageLink.path[1];
      details$ = this.meetingService.getPublicPastMeeting(id).pipe(
        switchMap((response) => {
          // Signed out, the meeting's settings say what signing in could show.
          if (!signedIn) {
            const past = response.meeting as Partial<Meeting>;
            return of({
              ...PUBLIC_CALENDAR_MODAL_NO_DETAILS,
              recording: !!past.recording_enabled,
              summary: !!past.ai_summary_enabled,
              description: past.description ?? '',
            });
          }
          if (!response.full_access) return of(PUBLIC_CALENDAR_MODAL_NO_DETAILS);
          const logged = <T>(what: string) =>
            catchError<T, Observable<null>>((error) => {
              console.error(`Failed to load the ${what} of past meeting ${id}:`, error);
              return of(null);
            });
          return forkJoin([
            this.meetingService.getPastMeetingRecording(id).pipe(logged('recording')),
            this.meetingService.getPastMeetingSummary(id).pipe(logged('summary')),
          ]).pipe(
            map(([recording, summary]) => {
              const shareUrl = getLargestSessionShareUrl(recording);
              return {
                ...PUBLIC_CALENDAR_MODAL_NO_DETAILS,
                access: true,
                recording: !!shareUrl,
                shareUrl,
                summary: !!getPastMeetingSummaryContent(response.meeting as Meeting, summary),
                description: (response.meeting as Partial<Meeting>).description ?? '',
              };
            })
          );
        })
      );
    } else if (signedIn) {
      details$ = this.meetingService.getPublicMeeting(meeting.id, null).pipe(
        map((response) => {
          const live = response.meeting as Partial<Meeting>;
          // Organizers may join a restricted meeting without a registrant record.
          const invited = !!live.invited || (meeting.restricted && !!live.organizer);
          return { ...PUBLIC_CALENDAR_MODAL_NO_DETAILS, invited, description: live.description ?? '' };
        })
      );
    }
    return toSignal(
      details$.pipe(
        catchError((error: unknown) => {
          // An ended date not archived yet has no past meeting: nothing is published for it so far.
          if (this.past && error instanceof HttpErrorResponse && error.status === 404) return of({ ...PUBLIC_CALENDAR_MODAL_NO_DETAILS, access: true });
          console.error(`Failed to load the public calendar details of meeting ${meeting.id}:`, error);
          return of({ ...PUBLIC_CALENDAR_MODAL_NO_DETAILS, failed: true });
        }),
        startWith({ ...PUBLIC_CALENDAR_MODAL_NO_DETAILS, loading: this.past || signedIn })
      ),
      { initialValue: PUBLIC_CALENDAR_MODAL_NO_DETAILS }
    );
  }

  private downloadIcs(): void {
    const view = this.document.defaultView;
    if (!view) return;
    const url = view.URL.createObjectURL(new Blob([buildPublicMeetingIcs(this.data.meeting)], { type: 'text/calendar;charset=utf-8' }));
    downloadFromUrl(url, `${this.data.meeting.title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'meeting'}.ics`);
    // Deferred: some browsers start the download asynchronously, and revoking at once can invalidate the URL first.
    setTimeout(() => view.URL.revokeObjectURL(url), 0);
    this.toast.show({ message: 'Calendar file downloaded', description: `${this.data.meeting.title} was added as an .ics file.` });
  }

  private register(): void {
    const data: MeetingRegisterDialogData = { meetingId: this.data.meeting.id, meetingTitle: this.data.meeting.title, user: this.userService.user() };
    this.modal
      .open<PublicMeetingRegistrationResponse, MeetingRegisterDialogData, MeetingDetailsRegisterModalComponent>(
        MeetingDetailsRegisterModalComponent,
        { data },
        // Not dismissible mid-request, so a registration that succeeds always reaches this modal.
        { closePredicate: (_result, _config, dialog) => !(dialog instanceof MeetingDetailsRegisterModalComponent && dialog.submitting()) }
      )
      .closed.pipe(take(1))
      // The register modal confirms with its own toast.
      .subscribe((registrant) => this.registered.update((registered) => registered || !!registrant));
  }
}
