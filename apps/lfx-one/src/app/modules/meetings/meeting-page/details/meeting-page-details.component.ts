// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Provider, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { openProjectIcalSubscribeDialog } from '@app/modules/committees/utils/ical-subscribe.util';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { MEETING_PAGE_GUEST_FORM_STATE, MEETING_PAGE_LEGACY_STATE } from '@lfx-one/shared/constants';
import { Meeting, MeetingHomeRow, MeetingOccurrence, MeetingRsvp } from '@lfx-one/shared/interfaces';
import { getActiveOccurrences, getPastMeetingResourceId, isPastMeetingCalendarRow, isSameOccurrenceId, selectApplicableRsvp } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { catchError, distinctUntilChanged, filter, of, skip, take } from 'rxjs';

import { MeetingDetailsBodyComponent } from '../../meetings-redesign/components/meeting-details-drawer/body/meeting-details-body.component';
import { MeetingDetailsContext } from '../../meetings-redesign/components/meeting-details-drawer/meeting-details.context';
import { MeetingDetailsSource } from '../../meetings-redesign/components/meeting-details-drawer/meeting-details.source';
import { MeetingDetailsArtifactsService } from '../../meetings-redesign/components/meeting-details-drawer/tools/meeting-details-artifacts.service';
import { MeetingsHomeDeleteService } from '../../meetings-redesign/services/meetings-home-delete.service';
import { MeetingsHomeEditService } from '../../meetings-redesign/services/meetings-home-edit.service';
import { MeetingPageDataService } from '../../services/meeting-page-data.service';

/** The page hosting the details: the row it shows, read once when the details are created. */
export abstract class MeetingPageRowHost {
  public abstract readonly row: Signal<MeetingHomeRow | null>;
}

/**
 * The meeting details on the standalone page, for the host's row; the page re-creates it for each row it shows.
 * @description Provides what `MeetingDetailsBodyComponent` needs, with a page source: no dialog, no list behind it,
 * another date opens at its own `/meetings/...` URL, the ⋯ menu offers the project calendar, Join may open Zoom as the page loads, and after a cancel or an edit the page shows the date as it now stands at `?occurrence=`.
 */
@Component({
  selector: 'lfx-meeting-page-details',
  imports: [MeetingDetailsBodyComponent],
  templateUrl: './meeting-page-details.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    MeetingDetailsContext,
    MeetingDetailsArtifactsService,
    MeetingsHomeEditService,
    MeetingsHomeDeleteService,
    DialogService,
    provideMeetingPageSource(),
  ],
})
export class MeetingPageDetailsComponent {
  private readonly context = inject(MeetingDetailsContext);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly pageData = inject(MeetingPageDataService);
  private readonly meetingService = inject(MeetingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly row = inject(MeetingPageRowHost).row();

  public constructor() {
    // Another past date picked in place gets its own page; the shown date ending only flips it in place.
    toObservable(this.context.pastMeetingId)
      .pipe(
        distinctUntilChanged(),
        filter((id): id is string => !!id && id !== this.row?.key && this.context.occurrence() !== this.row?.occurrence),
        takeUntilDestroyed()
      )
      .subscribe((id) => void this.router.navigateByUrl(`/meetings/${encodeURIComponent(id)}`));
    // Another coming date picked in place gets its own `?occurrence=` page, so the URL and the saved answer follow it.
    const row = this.row;
    if (row && !isPastMeetingCalendarRow(row.meeting)) {
      toObservable(this.context.occurrence)
        .pipe(
          distinctUntilChanged(),
          filter((occurrence): occurrence is MeetingOccurrence => !!occurrence && occurrence !== row.occurrence && !this.context.pastMeetingId()),
          takeUntilDestroyed()
        )
        .subscribe(
          (occurrence) => void this.router.navigateByUrl(meetingPageUrl({ ...row, occurrenceId: occurrence.occurrence_id, startTime: occurrence.start_time }))
        );
    }
    // The composer opens over this page only from its own Edit, so a save is an edit of this meeting.
    toObservable(inject(MeetingComposerService).saveCount)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.showEditedDate());
  }

  /** An edit can move the shown date, so the URL follows it to its new start (MD-097); anything else reloads. */
  private showEditedDate(): void {
    const shown = this.context.shownRow();
    const occurrenceId = shown.occurrenceId;
    if (!shown.meeting.recurrence || !occurrenceId || isPastMeetingCalendarRow(shown.meeting)) {
      this.pageData.refresh();
      return;
    }
    this.meetingService
      .getMeetingDetail(shown.meeting.id, { skipCache: true })
      .pipe(
        take(1),
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((fresh) => {
        const moved = fresh?.occurrences?.find((occurrence) => isSameOccurrenceId(occurrence.occurrence_id, occurrenceId));
        showOccurrence(this.router, this.route, this.pageData, shown.meeting.id, moved ? Date.parse(moved.start_time) : Date.parse(shown.startTime));
      });
  }
}

/** The page's source: its row, clock and saved answer, navigation to another date's page, and the page's join and cancel flows. */
function provideMeetingPageSource(): Provider {
  return {
    provide: MeetingDetailsSource,
    useFactory: (): MeetingDetailsSource => {
      const row = inject(MeetingPageRowHost).row();
      if (!row) throw new Error('MeetingPageDetailsComponent needs a row');
      const pageData = inject(MeetingPageDataService);
      const router = inject(Router);
      const route = inject(ActivatedRoute);
      const dialogService = inject(DialogService);
      return {
        row,
        tab: 'agenda',
        now: computed(() => new Date(pageData.clock())),
        upcomingRows: initAnsweredRows(row),
        hostRef: null,
        open: (row) => void router.navigateByUrl(meetingPageUrl(row)),
        applySummaryChange: () => undefined,
        subscribeToCalendar: (meeting) => openProjectCalendar(dialogService, meeting),
        occurrenceCancelled: (meeting, occurrence) => showOccurrence(router, route, pageData, meeting.id, nextOccurrenceStart(meeting, occurrence)),
        claimJoinOnLoad: () => pageData.claimJoinOnLoad(),
        // The legacy page holds the guest form that joins with another email address.
        joinWithOtherEmail: () =>
          void router.navigateByUrl(router.url, {
            skipLocationChange: true,
            onSameUrlNavigation: 'reload',
            state: { [MEETING_PAGE_LEGACY_STATE]: true, [MEETING_PAGE_GUEST_FORM_STATE]: true },
          }),
      };
    },
  };
}

/**
 * The page's own row with the viewer's saved answer, which the public payload lacks; empty until it loads.
 * @description The schedule reads the answer from these rows, as from the meetings home list; answers saved here overlay it.
 */
function initAnsweredRows(row: MeetingHomeRow): Signal<MeetingHomeRow[]> {
  if (isPastMeetingCalendarRow(row.meeting)) return signal<MeetingHomeRow[]>([]).asReadonly();
  const userService = inject(UserService);
  // A viewer who is not invited has no saved answer, but can register here and then answer.
  const saved: Signal<MeetingRsvp | null | undefined> = row.meeting.invited
    ? toSignal(inject(MeetingService).getMeetingRsvpForCurrentUser(row.meeting.id, row.occurrenceId ?? undefined))
    : signal(null);
  return computed(() => {
    const answer = saved();
    if (answer === undefined) return [];
    const answers: MeetingRsvp[] = [...(answer ? [answer] : []), ...userService.confirmedMeetingRsvps(row.meeting.id)];
    return [{ ...row, myRsvp: selectApplicableRsvp(row.occurrenceId, answers) }];
  });
}

/** The series' next active date after a cancelled one, or null when none follows. */
function nextOccurrenceStart(meeting: Meeting, cancelled: MeetingOccurrence): number | null {
  const cancelledStart = Date.parse(cancelled.start_time);
  const later = getActiveOccurrences(meeting.occurrences ?? [], meeting.cancelled_occurrences)
    .map((occurrence) => Date.parse(occurrence.start_time))
    .filter((start) => start > cancelledStart);
  return later.length ? Math.min(...later) : null;
}

/** Shows the series at `?occurrence=` (null drops it) without a new history entry; the same URL reloads the meeting instead. */
function showOccurrence(router: Router, route: ActivatedRoute, pageData: MeetingPageDataService, meetingId: string, startMs: number | null): void {
  const occurrence = startMs === null ? null : String(startMs);
  if (route.snapshot.paramMap.get('id') === meetingId && route.snapshot.queryParamMap.get('occurrence') === occurrence) {
    pageData.refresh();
    return;
  }
  pageData.reloadOnNextLoad();
  void router.navigate(['/meetings', meetingId], { queryParams: { occurrence }, queryParamsHandling: 'merge', replaceUrl: true });
}

/** A past row opens its `{id}-{ms}` record; an upcoming date opens the series at `?occurrence=` (its start ms). */
function meetingPageUrl(row: MeetingHomeRow): string {
  if (isPastMeetingCalendarRow(row.meeting)) {
    return `/meetings/${encodeURIComponent(getPastMeetingResourceId(row.meeting))}`;
  }
  const path = `/meetings/${encodeURIComponent(row.meeting.id)}`;
  return row.occurrenceId ? `${path}?occurrence=${Date.parse(row.startTime)}` : path;
}

/** The project's calendar feed in the dialog the legacy page and the meetings dashboard use. */
function openProjectCalendar(dialogService: DialogService, meeting: Meeting): void {
  if (!meeting.project_uid) return;
  openProjectIcalSubscribeDialog(dialogService, meeting.project_uid, meeting.project_name || 'Project');
}
