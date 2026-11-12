// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, Signal, signal, TemplateRef, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MEETING_GUEST_EMPTY_FILTERS, MEETING_GUEST_ROLE_LABELS } from '@lfx-one/shared/constants';
import {
  CommitteeMember,
  MeetingGuestConfirm,
  MeetingGuestFilterChip,
  MeetingGuestFilterField,
  MeetingGuestFilters,
  MeetingGuestRoleKey,
  MeetingGuestRow,
  MeetingGuestRowActions,
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
  getMeetingGuestRowActions,
  getOfferedMeetingGuestFilters,
  isMeetingInviteResponsesEnabled,
  resortMeetingGuestRows,
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
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuSeparatorComponent } from '@shared/uikit/menu/menu-separator.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { catchError, combineLatest, debounceTime, filter, map, Observable, of, startWith, switchMap, take, tap, throwError } from 'rxjs';

import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsSource } from '../meeting-details.source';

/**
 * Guests tab of the meeting details drawer, Participants once the meeting has ended.
 * @description Loads its own list from the drawer context: registrants upcoming, through the viewer-scoped endpoint the meeting
 * page uses for everyone, and past participants when ended. Search and the Filters popover narrow one flat list client-side.
 * Organizers get Resend Invite, Make / Remove Host and Remove on each upcoming registrant row.
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
    UiMenuComponent,
    UiMenuItemComponent,
    UiMenuSeparatorComponent,
    UiModalComponent,
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
  private readonly hostRef = inject(MeetingDetailsSource).hostRef;
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly stickSentinel = viewChild<ElementRef<HTMLElement>>('stickSentinel');
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');

  protected readonly query = signal('');
  protected readonly filters = signal<MeetingGuestFilters>(MEETING_GUEST_EMPTY_FILTERS);
  protected readonly draft = signal<MeetingGuestFilters>(MEETING_GUEST_EMPTY_FILTERS);
  private readonly reload = signal(0);
  /** The toolbar is stuck under the drawer header, so the rows scroll under its fade. */
  protected readonly stuck = signal(false);
  protected readonly resending = signal<ReadonlySet<string>>(new Set());
  protected readonly hostUpdating = signal<ReadonlySet<string>>(new Set());
  protected readonly deleting = signal(false);
  /** Host changes made here, applied without a refetch until the drawer closes. */
  private readonly hostOverrides = signal<ReadonlyMap<string, boolean>>(new Map());
  private confirmRef: DialogRef<boolean> | null = null;

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
  protected readonly rows: Signal<MeetingGuestRow[]> = computed(() => this.applyChanges(this.load().rows));
  protected readonly rowActions: Signal<ReadonlyMap<string, MeetingGuestRowActions>> = this.initRowActions();
  protected readonly shown: Signal<MeetingGuestRow[]> = computed(() => filterMeetingGuestRows(this.rows(), this.searchTerm(), this.applied()));
  protected readonly filtersLabel: Signal<string> = computed(() => (this.chips().length ? `Filters, ${this.chips().length} applied` : ''));
  protected readonly draftChanged: Signal<boolean> = computed(() => !this.sameFilters(this.draft(), this.applied()));
  protected readonly showReset: Signal<boolean> = computed(() => this.chips().length > 0 || !this.sameFilters(this.draft(), MEETING_GUEST_EMPTY_FILTERS));

  public constructor() {
    this.watchToolbarStick();
    this.destroyRef.onDestroy(() => this.confirmRef?.close());
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

  /** Runs Edit Meeting's checks and scope question over the drawer and opens the editor at its Guests step. */
  protected addGuests(): void {
    this.editService.edit(this.context.shownRow(), 'guests', this.hostRef);
  }

  protected confirmResend(registrant: MeetingRegistrant): void {
    if (this.resending().has(registrant.uid)) return;
    const label = this.registrantLabel(registrant, 'this guest');
    this.confirm(
      { heading: 'Resend invitation', message: `Resend the meeting invitation to ${label}?`, confirmLabel: 'Resend', icon: 'fa-light fa-paper-plane' },
      () => this.resend(registrant, label)
    );
  }

  /** Saves the host flag straight away, no confirmation; the update echoes the stored scope and identity fields. */
  protected toggleHost(registrant: MeetingRegistrant): void {
    const uid = registrant.uid;
    if (this.hostUpdating().has(uid)) return;
    const host = !registrant.host;
    const label = this.registrantLabel(registrant, 'The guest');
    this.hostUpdating.update((uids) => this.withUid(uids, uid, true));
    this.meetingService
      .updateMeetingRegistrants(this.context.meeting().id, [{ uid, changes: this.meetingService.getChangedFields({ ...registrant, host, state: 'modified' }) }])
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          this.hostUpdating.update((uids) => this.withUid(uids, uid, false));
          if (response.summary.successful > 0) {
            this.hostOverrides.update((overrides) => new Map(overrides).set(uid, host));
            this.shareChanges();
            this.showSuccess(`${label} is ${host ? 'now' : 'no longer'} a meeting host`);
            this.context.refreshList();
          } else {
            this.showError(response.failures[0]?.error?.message || 'Failed to update host');
          }
        },
        error: () => {
          this.hostUpdating.update((uids) => this.withUid(uids, uid, false));
          this.showError('Failed to update host. Please try again.');
        },
      });
  }

  protected confirmRemove(registrant: MeetingRegistrant): void {
    if (this.deleting()) return;
    const label = this.registrantLabel(registrant, 'this guest');
    this.confirm(
      {
        heading: 'Remove guest',
        message: `Are you sure you want to remove ${label} from this meeting?`,
        confirmLabel: 'Remove',
        icon: 'fa-light fa-triangle-exclamation',
        danger: true,
      },
      () => this.remove(registrant)
    );
  }

  private initRowActions(): Signal<ReadonlyMap<string, MeetingGuestRowActions>> {
    return computed(() => {
      const organizer = this.context.organizer();
      const ended = this.ended();
      const actions = new Map<string, MeetingGuestRowActions>();
      for (const row of this.rows()) {
        const rowActions = getMeetingGuestRowActions(row, organizer, ended);
        if (rowActions) actions.set(row.uid, rowActions);
      }
      return actions;
    });
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
        return { ...parts, key, version: this.context.participantsVersion() };
      },
      { equal: (a, b) => a.key === b.key && a.version === b.version }
    );
    // A participants change reloads the same list in place, keeping the rows, count and hosts until it lands.
    let shownKey: string | null = null;

    return toSignal(
      toObservable(request).pipe(
        switchMap(({ meeting, canView, ended, pastId, occurrenceId: shownOccurrenceId, key }) => {
          const inPlace = key === shownKey;
          shownKey = key;
          if (!inPlace) {
            // The previous date's count and hosts must not linger while this load runs, after it fails, or once hidden.
            this.context.guestCount.set(null);
            this.context.hosts.set([]);
          }
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
                return removedSelf ? rows.filter((row) => !row.you) : rows;
              })
            );
          }
          return rows$.pipe(
            // The shell shows the total as the tab count, and upcoming hosts join Organized by, both after local changes.
            tap((rows) => this.shareAggregates(this.applyChanges(rows), !ended)),
            map((rows): MeetingGuestsLoad => ({ status: 'ready', rows })),
            catchError((error: unknown) => {
              console.error(`Failed to load guests of meeting ${meeting.id}:`, error);
              return of<MeetingGuestsLoad>({ status: 'error', rows: [] });
            }),
            inPlace ? (source: Observable<MeetingGuestsLoad>) => source : startWith(loading)
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

  /** After a local change, the tab count and "Organized by" follow the rows the tab shows. */
  private shareChanges(): void {
    // A response that lands after the date ended must not swap the participants' hosts for registrant ones.
    this.shareAggregates(this.rows(), !this.ended());
  }

  private shareAggregates(rows: MeetingGuestRow[], withHosts: boolean): void {
    this.context.guestCount.set(rows.length);
    if (withHosts) this.context.hosts.set(rows.flatMap((row) => (row.registrant?.host ? [row.registrant] : [])));
  }

  /** Host-flagged people join the drawer's "Organized by" line. */
  private shareHosts(people: MeetingHostCandidate[]): void {
    this.context.hosts.set(people.filter((person) => person.host));
  }

  private sameFilters(a: MeetingGuestFilters, b: MeetingGuestFilters): boolean {
    return (Object.keys(a) as (keyof MeetingGuestFilters)[]).every((key) => a[key] === b[key]);
  }

  private resend(registrant: MeetingRegistrant, label: string): void {
    const uid = registrant.uid;
    if (!this.rowActions().get(uid)?.resend) return;
    this.resending.update((uids) => this.withUid(uids, uid, true));
    this.meetingService
      .resendMeetingInvitation(this.context.meeting().id, uid)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.resending.update((uids) => this.withUid(uids, uid, false));
          this.showSuccess(`Meeting invitation resent to ${label}`);
        },
        error: (error: unknown) => {
          this.resending.update((uids) => this.withUid(uids, uid, false));
          // The BFF error envelope is `{ error: string, code }`.
          const reason: unknown = error instanceof HttpErrorResponse ? error.error?.error : null;
          this.showError(typeof reason === 'string' && reason.trim() ? reason : 'Failed to resend invitation. Please try again.');
        },
      });
  }

  private remove(registrant: MeetingRegistrant): void {
    const uid = registrant.uid;
    // The date can end, or the row go away, while the confirmation is open.
    if (this.deleting() || !this.rowActions().get(uid)?.remove) return;
    this.deleting.set(true);
    this.meetingService
      .deleteMeetingRegistrants(this.context.meeting().id, [uid])
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          this.deleting.set(false);
          if (response.summary.successful > 0) {
            this.context.removedRegistrantUids.update((uids) => this.withUid(uids, uid, true));
            this.shareChanges();
            this.showSuccess(`${this.registrantLabel(registrant, 'The guest')} removed from the meeting`);
            this.context.refreshList();
          } else {
            this.showError(response.failures[0]?.error?.message || 'Failed to remove guest');
          }
        },
        error: () => {
          this.deleting.set(false);
          this.showError('Failed to remove guest. Please try again.');
        },
      });
  }

  private confirm(data: MeetingGuestConfirm, accept: () => void): void {
    this.confirmRef = this.modal.open<boolean, MeetingGuestConfirm>(this.confirmDialog(), { data, role: 'alertdialog', describedBy: true });
    this.confirmRef.closed.pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef)).subscribe(accept);
  }

  /** Removed rows drop out and host changes re-label and re-sort the rows, all without a refetch. */
  private applyChanges(rows: MeetingGuestRow[]): MeetingGuestRow[] {
    const removed = this.context.removedRegistrantUids();
    const overrides = this.hostOverrides();
    if (!removed.size && !overrides.size) return rows;
    let relabeled = false;
    const changed: MeetingGuestRow[] = rows
      .filter((row) => !removed.has(row.uid))
      .map((row) => {
        const host = overrides.get(row.uid);
        if (host === undefined || !row.registrant) return row;
        // Organizer rows never take a host change, so the override only switches host and guest.
        const role: MeetingGuestRoleKey = host ? 'host' : 'guest';
        relabeled = true;
        return { ...row, role, roleLabel: MEETING_GUEST_ROLE_LABELS[role], registrant: { ...row.registrant, host } };
      });
    // Only registrant rows take overrides; participant rows keep their own order.
    return relabeled ? resortMeetingGuestRows(changed) : changed;
  }

  private registrantLabel(registrant: MeetingRegistrant, fallback: string): string {
    return [registrant.first_name, registrant.last_name].filter(Boolean).join(' ') || registrant.email || fallback;
  }

  private showSuccess(message: string): void {
    this.toast.show({ variant: 'dark', message });
  }

  private withUid(uids: ReadonlySet<string>, uid: string, add: boolean): ReadonlySet<string> {
    const next = new Set(uids);
    if (add) next.add(uid);
    else next.delete(uid);
    return next;
  }

  private showError(description: string): void {
    this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Error', description });
  }
}
