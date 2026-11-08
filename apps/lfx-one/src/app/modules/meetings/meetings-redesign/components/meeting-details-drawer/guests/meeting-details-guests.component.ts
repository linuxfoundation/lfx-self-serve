// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterRenderEffect, Component, computed, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MEETING_GUEST_EMPTY_FILTERS } from '@lfx-one/shared/constants';
import {
  CommitteeMember,
  MeetingGuestFilterChip,
  MeetingGuestFilterField,
  MeetingGuestFilters,
  MeetingGuestRow,
  MeetingGuestSummary,
  MeetingGuestsLoad,
  MeetingHostCandidate,
  MeetingRegistrant,
  MeetingRsvp,
  PastMeetingParticipant,
} from '@lfx-one/shared/interfaces';
import {
  buildParticipantGuestRows,
  buildRegistrantGuestRows,
  filterMeetingGuestRows,
  getMeetingGuestFilterChips,
  getMeetingGuestFilterFields,
  getMeetingGuestSummary,
  getOfferedMeetingGuestFilters,
  isMeetingInviteResponsesEnabled,
  selectApplicableRsvp,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiChipGroupComponent } from '@shared/uikit/chip/chip-group.component';
import { UiChipComponent } from '@shared/uikit/chip/chip.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { catchError, combineLatest, debounceTime, map, Observable, of, startWith, switchMap, take, tap, throwError } from 'rxjs';

import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingDetailsContext } from '../meeting-details.context';

/**
 * Guests tab of the meeting details drawer, Participants once the meeting has ended.
 * @description Loads its own list from the drawer context: registrants upcoming, through the viewer-scoped endpoint the meeting
 * page uses for everyone, and past participants when ended. Search and the Filters popover narrow one flat list client-side.
 */
@Component({
  selector: 'lfx-meeting-details-guests',
  imports: [
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiChipComponent,
    UiChipGroupComponent,
    UiEmptyStateComponent,
    UiInputComponent,
    UiOptionComponent,
    UiSelectComponent,
    UiSkeletonComponent,
    UiTooltipDirective,
  ],
  templateUrl: './meeting-details-guests.component.html',
  host: { class: 'flex flex-col gap-1' },
})
export class MeetingDetailsGuestsComponent {
  protected readonly context = inject(MeetingDetailsContext);
  private readonly meetingService = inject(MeetingService);
  private readonly committeeService = inject(CommitteeService);
  private readonly userService = inject(UserService);
  private readonly editService = inject(MeetingsHomeEditService);
  private readonly dialogRef = inject(DialogRef, { optional: true });
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly stickSentinel = viewChild<ElementRef<HTMLElement>>('stickSentinel');

  protected readonly query = signal('');
  protected readonly filters = signal<MeetingGuestFilters>(MEETING_GUEST_EMPTY_FILTERS);
  protected readonly draft = signal<MeetingGuestFilters>(MEETING_GUEST_EMPTY_FILTERS);
  private readonly reload = signal(0);
  /** The toolbar is stuck under the drawer header, so the rows scroll under its fade. */
  protected readonly stuck = signal(false);

  protected readonly ended: Signal<boolean> = computed(() => this.context.state() === 'ended');
  protected readonly canAddGuests: Signal<boolean> = computed(() => this.context.organizer() && !this.ended());
  protected readonly searchLabel: Signal<string> = computed(() => (this.ended() ? 'Search participants' : 'Search guests'));
  /** RSVPs the viewer saved in the drawer, which can be newer than the registrants endpoint. */
  private readonly confirmedRsvps$: Observable<MeetingRsvp[]> = toObservable(computed(() => this.userService.confirmedMeetingRsvps(this.context.meeting().id)));
  /** The viewer removed themselves here, which the registrants endpoint can still miss while it indexes. */
  private readonly removedSelf$: Observable<boolean> = toObservable(
    computed(() => this.meetingService.removedRegistrationMeetingIds().has(this.context.meeting().id))
  );
  protected readonly load: Signal<MeetingGuestsLoad> = this.initLoad();
  /** The search box, applied 300ms after typing stops as on the meeting page. */
  private readonly searchTerm: Signal<string> = toSignal(toObservable(this.query).pipe(debounceTime(300)), { initialValue: '' });
  protected readonly fields: Signal<MeetingGuestFilterField[]> = computed(() =>
    getMeetingGuestFilterFields(this.ended(), isMeetingInviteResponsesEnabled(this.context.meeting()), this.context.meeting().committees)
  );
  /** Applied filters the popover still offers; a status picked upcoming no longer applies once the meeting ends. */
  private readonly applied: Signal<MeetingGuestFilters> = computed(() => getOfferedMeetingGuestFilters(this.filters(), this.fields()));
  protected readonly chips: Signal<MeetingGuestFilterChip[]> = computed(() => getMeetingGuestFilterChips(this.applied(), this.fields()));
  protected readonly shown: Signal<MeetingGuestRow[]> = computed(() => filterMeetingGuestRows(this.load().rows, this.searchTerm(), this.applied()));
  protected readonly summary: Signal<MeetingGuestSummary> = computed(() =>
    getMeetingGuestSummary(this.load().rows, this.ended(), (this.context.meeting().committees?.length ?? 0) > 0)
  );
  protected readonly filtersLabel: Signal<string> = computed(() => (this.chips().length ? `Filters, ${this.chips().length} applied` : ''));
  protected readonly draftChanged: Signal<boolean> = computed(() => !this.sameFilters(this.draft(), this.applied()));
  protected readonly showReset: Signal<boolean> = computed(() => this.chips().length > 0 || !this.sameFilters(this.draft(), MEETING_GUEST_EMPTY_FILTERS));

  public constructor() {
    this.watchToolbarStick();
  }

  /** Every open of the popover starts from the applied filters, so a closed draft is discarded. */
  protected resetDraft(): void {
    this.draft.set(this.applied());
  }

  protected setDraft(key: keyof MeetingGuestFilters, value: string | null): void {
    this.draft.update((draft) => ({ ...draft, [key]: value || null }));
  }

  protected apply(close: () => void): void {
    this.filters.set(this.draft());
    close();
  }

  protected resetFilters(close?: () => void): void {
    this.filters.set(MEETING_GUEST_EMPTY_FILTERS);
    close?.();
  }

  /** The no-match state's reset clears the search too. */
  protected resetAll(): void {
    this.query.set('');
    this.resetFilters();
  }

  protected clearFilter(key: keyof MeetingGuestFilters): void {
    this.filters.set({ ...this.applied(), [key]: null });
  }

  protected retry(): void {
    this.reload.update((count) => count + 1);
  }

  /** Closes the drawer, then runs Edit Meeting's checks and scope question and opens the editor at its Guests step. */
  protected addGuests(): void {
    // An explicit leave, as Edit Meeting: close without the close guard, then open the editor once focus is handed back.
    const row = this.context.shownRow();
    if (!this.dialogRef) {
      this.editService.edit(row, 'guests');
      return;
    }
    this.dialogRef.closed.pipe(take(1)).subscribe(() => this.editService.edit(row, 'guests'));
    this.dialogRef.close();
  }

  private initLoad(): Signal<MeetingGuestsLoad> {
    const loading: MeetingGuestsLoad = { status: 'loading', rows: [] };
    // Keyed on what the load reads, so the fresh detail replacing the row's meeting does not refetch an unchanged list.
    const request = computed(
      () => {
        const meeting = this.context.meeting();
        const parts = {
          meeting,
          canView: this.context.canViewGuests(),
          ended: this.ended(),
          pastId: this.context.pastMeetingId(),
          occurrenceId: this.context.shownRow().occurrenceId,
        };
        const key = [
          meeting.id,
          (meeting.organizers ?? []).join(','),
          (meeting.committees ?? []).map((committee) => `${committee.uid}:${committee.name ?? ''}`).join(','),
          isMeetingInviteResponsesEnabled(meeting),
          !!meeting.recurrence,
          parts.canView,
          parts.ended,
          parts.pastId,
          parts.occurrenceId,
          this.reload(),
        ].join('|');
        return { ...parts, key };
      },
      { equal: (a, b) => a.key === b.key }
    );

    return toSignal(
      toObservable(request).pipe(
        switchMap(({ meeting, canView, ended, pastId, occurrenceId: shownOccurrenceId }) => {
          // The previous date's count and hosts must not linger while this load runs, after it fails, or once hidden.
          this.context.guestCount.set(null);
          this.context.hosts.set([]);
          if (!canView) return of<MeetingGuestsLoad>({ status: 'ready', rows: [] });
          const viewer = { username: this.userService.viewerUsername(), email: this.userService.user()?.email ?? null };
          let rows$: Observable<MeetingGuestRow[]>;
          if (ended) {
            rows$ = pastId
              ? combineLatest([this.pastParticipants(pastId), this.committeeMembers(meeting.committees)]).pipe(
                  tap(([participants]) => this.shareHosts(participants)),
                  map(([participants, members]) => buildParticipantGuestRows(participants, meeting, viewer, members))
                )
              : of([]);
          } else {
            const rsvpEnabled = isMeetingInviteResponsesEnabled(meeting);
            // The shown date, as the drawer's RSVP section reads it; a series row without one shows answers for all dates.
            const occurrenceId = shownOccurrenceId ?? undefined;
            const allDatesOnly = rsvpEnabled && !!meeting.recurrence && !occurrenceId;
            const registrants$ = this.meetingService.getMyMeetingRegistrants(meeting.id, rsvpEnabled, occurrenceId, false, allDatesOnly);
            rows$ = combineLatest([registrants$, this.confirmedRsvps$, this.removedSelf$]).pipe(
              map(([registrants, confirmed, removedSelf]) => {
                const rows = buildRegistrantGuestRows(
                  this.withConfirmedRsvps(registrants, confirmed, occurrenceId, allDatesOnly),
                  meeting,
                  viewer,
                  rsvpEnabled
                );
                if (!removedSelf) {
                  this.shareHosts(registrants);
                  return rows;
                }
                const own = new Set(rows.filter((row) => row.you).map((row) => row.uid));
                this.shareHosts(registrants.filter((registrant) => !own.has(registrant.uid)));
                return rows.filter((row) => !row.you);
              })
            );
          }
          return rows$.pipe(
            // The shell shows the total as the tab count.
            tap((rows) => this.context.guestCount.set(rows.length)),
            map((rows): MeetingGuestsLoad => ({ status: 'ready', rows })),
            catchError((error: unknown) => {
              console.error(`Failed to load guests of meeting ${meeting.id}:`, error);
              return of<MeetingGuestsLoad>({ status: 'error', rows: [] });
            }),
            startWith(loading)
          );
        })
      ),
      { initialValue: loading }
    );
  }

  /** Registrants with the viewer's newer saved answers applied, as the drawer's RSVP section does. */
  private withConfirmedRsvps(
    registrants: MeetingRegistrant[],
    confirmed: MeetingRsvp[],
    occurrenceId: string | undefined,
    allDatesOnly: boolean
  ): MeetingRegistrant[] {
    const applicable = confirmed.filter((rsvp) => !allDatesOnly || rsvp.scope === 'all');
    if (!applicable.length) return registrants;
    return registrants.map((registrant) => {
      const own = applicable.filter((rsvp) => rsvp.registrant_id === registrant.uid);
      return own.length ? { ...registrant, rsvp: selectApplicableRsvp(occurrenceId, registrant.rsvp ? [...own, registrant.rsvp] : own) } : registrant;
    });
  }

  /** Participants of an ended date; a past meeting record that doesn't exist yet counts as nobody, as on the meeting page. */
  private pastParticipants(pastId: string): Observable<PastMeetingParticipant[]> {
    return this.meetingService
      .getPastMeetingParticipants(pastId)
      .pipe(catchError((error: unknown) => (error instanceof HttpErrorResponse && error.status === 404 ? of([]) : throwError(() => error))));
  }

  /** Members of the meeting's committees, to group past participants; a failed committee counts as empty. */
  private committeeMembers(committees: { uid: string }[] | undefined): Observable<CommitteeMember[]> {
    const uids = (committees ?? []).map((committee) => committee.uid).filter(Boolean);
    if (!uids.length) return of([]);
    return combineLatest(
      uids.map((uid) =>
        this.committeeService.getCommitteeMembers(uid).pipe(
          catchError((error: unknown) => {
            console.error(`Failed to load members of committee ${uid}:`, error);
            return of<CommitteeMember[]>([]);
          })
        )
      )
    ).pipe(map((lists) => lists.flat()));
  }

  /** Watches a sentinel above the toolbar: once it scrolls above the toolbar's stuck position, the toolbar is stuck. */
  private watchToolbarStick(): void {
    afterRenderEffect((onCleanup) => {
      const sentinel = this.stickSentinel()?.nativeElement;
      if (!sentinel || !this.isBrowser || typeof IntersectionObserver === 'undefined') return;
      // The toolbar sticks 50px under the drawer header (8px gap plus the 42px tabs bar).
      const offset = (parseFloat(getComputedStyle(this.host.nativeElement).getPropertyValue('--md-head')) || 0) + 50;
      const observer = new IntersectionObserver(
        // A hidden tab reports an empty rect, which must not count as stuck.
        ([entry]) =>
          this.stuck.set(!entry.isIntersecting && entry.boundingClientRect.width > 0 && entry.boundingClientRect.top < (entry.rootBounds?.top ?? offset)),
        { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 }
      );
      observer.observe(sentinel);
      onCleanup(() => observer.disconnect());
    });
  }

  /** Host-flagged people join the drawer's "Organized by" line. */
  private shareHosts(people: MeetingHostCandidate[]): void {
    this.context.hosts.set(people.filter((person) => person.host));
  }

  private sameFilters(a: MeetingGuestFilters, b: MeetingGuestFilters): boolean {
    return (Object.keys(a) as (keyof MeetingGuestFilters)[]).every((key) => a[key] === b[key]);
  }
}
