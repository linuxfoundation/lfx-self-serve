// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { MEETING_ATTENDEE_PREVIEW_LIMIT, MEETING_PEOPLE_ATTENDANCE_LABELS } from '@lfx-one/shared/constants';
import { MeetingPeopleRow, MeetingPeopleTallies, MeetingRegistrant, MeetingRosterRequest, MeetingRosterState, RsvpResponse } from '@lfx-one/shared/interfaces';
import { buildMeetingPeopleRows, countMeetingPeopleTallies, reconcileOptimisticPad } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, map, Observable, of, startWith, switchMap } from 'rxjs';

import { MeetingRegistrantsDisplayComponent } from '../../../components/meeting-registrants-display/meeting-registrants-display.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 people section, in the content column after the agenda (E3-04, #3253, FR-032).
 * @description Upcoming and live meetings only: the past roster is N-02's. The page renders it only
 * when `MeetingDetailsStateService.rosterRequest` is set, which is V1's roster gate: an organizer,
 * or a registrant of a meeting whose guest list is shared. Every count here is the fetched roster's
 * own length, because the detail payloads no longer carry registrant counts (GH-1731).
 *
 * The first rows show here, organizers first, then by RSVP; RSVP chips and tallies render only when
 * the meeting tracks RSVPs (`visibleSections` `rsvpAvatarBadges` / `rsvpSummary`). "View all" opens
 * the full list in a drawer, V1's guest list (`lfx-meeting-registrants-display`) with its search and
 * filters, where an organizer can also add and remove guests, as on V1.
 */
@Component({
  selector: 'lfx-meeting-people',
  imports: [NgClass, DrawerModule, SkeletonModule, PersonAvatarComponent, MeetingRegistrantsDisplayComponent],
  templateUrl: './people.component.html',
})
export class MeetingPeopleComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly platformId = inject(PLATFORM_ID);
  /** The drawer's title: its `aria-labelledby` target and where focus lands when it opens. */
  private readonly drawerTitle = viewChild<ElementRef<HTMLHeadingElement>>('drawerTitle');
  /** What opened the drawer, so closing it hands focus back (docs/architecture/frontend/drawer-pattern.md). */
  private drawerTrigger: HTMLElement | null = null;

  protected readonly attendanceLabels = MEETING_PEOPLE_ATTENDANCE_LABELS;
  /** Each RSVP chip's colours, in the prototype's good / warn / neutral pills. */
  protected readonly attendanceChipClasses: Record<RsvpResponse | 'pending', string> = {
    accepted: 'bg-[var(--md-status-good-bg)] text-[var(--md-status-good)]',
    maybe: 'bg-[var(--md-status-warn-bg)] text-[var(--md-status-warn)]',
    declined: 'bg-[var(--md-surface-hover)] text-[var(--md-text-muted)]',
    pending: 'border border-[var(--md-border)] text-[var(--md-text-muted)]',
  };
  /** `p-drawer` announces as an unnamed `complementary` landmark otherwise, even with its mask. */
  protected readonly drawerPt = { root: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'people-drawer-title' } };
  protected readonly meeting = this.state.meeting;
  protected readonly occurrence = this.state.selectedOccurrence;

  protected readonly drawerVisible = signal(false);
  /** Whether the drawer was opened from Add guest, so it opens on the add form. */
  protected readonly drawerOpensAddForm = signal(false);
  /** Bumped to refetch the roster for the same meeting and occurrence, e.g. after guests are added. */
  private readonly refreshCount = signal(0);
  /**
   * Guests the organizer added that the roster does not show yet: the query service indexes them
   * after the add returns, so the refetch right after it usually misses them. V1's join page pads its
   * count the same way (`reconcileOptimisticPad`); the pad drains as fetches catch up.
   */
  private readonly addedPad = signal(0);
  /** The confirmed roster length the pad is measured from; `null` without one. */
  private readonly addedPadBaseline = signal<number | null>(null);
  /** The last roster fetched, and what for. */
  private lastFetched: { key: MeetingRosterRequest; registrants: MeetingRegistrant[] } | null = null;

  protected readonly organizer = computed(() => this.state.viewerRole() === 'organizer');
  protected readonly roster: Signal<MeetingRosterState> = this.initRoster();
  protected readonly rows: Signal<MeetingPeopleRow[]> = this.initRows();
  protected readonly previewRows = computed(() => this.rows().slice(0, MEETING_ATTENDEE_PREVIEW_LIMIT));
  /** The faces after the listed rows, for the footer's stack. */
  protected readonly overflowRows = computed(() => this.rows().slice(MEETING_ATTENDEE_PREVIEW_LIMIT, MEETING_ATTENDEE_PREVIEW_LIMIT * 2));
  protected readonly overflowCount = computed(() => Math.max(0, this.rows().length - MEETING_ATTENDEE_PREVIEW_LIMIT));
  protected readonly tallies: Signal<MeetingPeopleTallies> = computed(() => countMeetingPeopleTallies(this.rows()));
  protected readonly showTallies = computed(() => this.state.visibleSections()?.rsvpSummary === true && this.rows().length > 0);
  protected readonly showRsvpChips = computed(() => this.state.visibleSections()?.rsvpAvatarBadges === true);
  /** A committee meeting's roster is its members, as V1's drawer titles it; otherwise its guests. */
  protected readonly committeeMeeting = computed(() => !!this.meeting()?.committees?.length);
  /** Everyone invited: the roster's rows plus any added guests it has not caught up with. */
  protected readonly invitedCount = computed(() => this.rows().length + this.addedPad());

  public constructor() {
    // Hand focus back on every close path: PrimeNG emits `onHide` only for its own Escape and mask
    // closes, not for the close button's programmatic one, so this keys off the visibility itself.
    // The initial `false` finds no trigger to restore.
    toObservable(this.drawerVisible)
      .pipe(
        filter((visible) => !visible),
        takeUntilDestroyed()
      )
      .subscribe(() => this.restoreFocus());
  }

  public openDrawer(addForm: boolean): void {
    this.drawerOpensAddForm.set(addForm);
    this.drawerVisible.set(true);
  }

  public closeDrawer(): void {
    this.drawerVisible.set(false);
  }

  /** `p-drawer` never moves focus in on open: capture the trigger, then land on the title. */
  public onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.drawerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.drawerTitle()?.nativeElement.focus();
  }

  public retry(): void {
    this.refreshCount.update((count) => count + 1);
  }

  /**
   * The drawer reports guests added (a positive count) or removed (negative): refetch the roster, and
   * count added guests until the roster includes them. The baseline is only a roster confirmed for
   * this meeting and occurrence; anything else would read as guests already absorbed.
   */
  public onRosterChanged(delta: number): void {
    if (delta > 0) {
      const key = this.state.rosterRequest();
      const confirmed = !!key && this.isLastFetched(key) && this.roster().status === 'ready';
      this.addedPadBaseline.set(confirmed && this.lastFetched ? this.lastFetched.registrants.length : null);
      this.addedPad.update((pad) => pad + delta);
    }
    this.retry();
  }

  private initRoster(): Signal<MeetingRosterState> {
    const request = computed(() => ({ key: this.state.rosterRequest(), refresh: this.refreshCount() }));

    return toSignal(
      toObservable(request).pipe(
        switchMap(({ key }): Observable<MeetingRosterState> => {
          // A refresh or a failed refetch of the same meeting and occurrence keeps showing the last
          // roster rather than flashing a skeleton or an error over the rows; another view starts over.
          const kept = key && this.isLastFetched(key) && this.lastFetched ? this.lastFetched.registrants : null;
          if (!kept) {
            this.lastFetched = null;
            this.addedPad.set(0);
            this.addedPadBaseline.set(null);
          }
          if (!key) {
            return of({ status: 'ready', registrants: [] });
          }
          return this.meetingService.getMyMeetingRegistrants(key.meetingId, true, key.occurrenceId).pipe(
            map((registrants): MeetingRosterState => {
              this.lastFetched = { key, registrants };
              const next = reconcileOptimisticPad({ pad: this.addedPad(), before: this.addedPadBaseline(), current: registrants.length });
              this.addedPad.set(next.pad);
              this.addedPadBaseline.set(next.before);
              return { status: 'ready', registrants };
            }),
            catchError((error: unknown) => {
              console.error('Failed to load the meeting roster', error);
              // With nothing to fall back on, the section shows its error state, with Try again.
              return of<MeetingRosterState>(kept ? { status: 'ready', registrants: kept } : { status: 'error', registrants: [] });
            }),
            startWith<MeetingRosterState>(kept ? { status: 'ready', registrants: kept } : { status: 'loading', registrants: [] })
          );
        })
      ),
      { initialValue: { status: 'loading', registrants: [] } }
    );
  }

  private initRows(): Signal<MeetingPeopleRow[]> {
    return computed(() =>
      buildMeetingPeopleRows(this.roster().registrants, {
        inviteResponsesEnabled: this.showRsvpChips(),
        viewer: { username: this.userService.viewerUsername(), email: this.userService.user()?.email },
        // The viewer's answer for the same occurrence the roster is for, ahead of the index.
        viewerRsvp: this.state.myRsvp() ?? null,
      })
    );
  }

  private restoreFocus(): void {
    const trigger = this.drawerTrigger;
    this.drawerTrigger = null;
    if (trigger?.isConnected) {
      trigger.focus();
    }
  }

  private isLastFetched(key: MeetingRosterRequest): boolean {
    return !!this.lastFetched && this.lastFetched.key.meetingId === key.meetingId && this.lastFetched.key.occurrenceId === key.occurrenceId;
  }
}
