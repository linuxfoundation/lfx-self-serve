// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { computed, inject, Injectable, makeStateKey, PLATFORM_ID, Signal, signal, TransferState } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { MEETING_JOIN_STATE_KEY } from '@lfx-one/shared/constants';
import {
  ActionSlotKind,
  Meeting,
  MeetingDetailsLoadStatus,
  MeetingJoinPageState,
  MeetingLeaveRequest,
  MeetingOccurrence,
  MeetingPrivacyState,
  MeetingRosterRequest,
  MeetingRsvp,
  MeetingSectionVisibility,
  MeetingStatusKind,
  MeetingTimeState,
  MeetingViewerRole,
  PublicMeetingOccurrencesResponse,
  PublicMeetingProject,
  PublicPastMeetingResponse,
  RsvpResponse,
} from '@lfx-one/shared/interfaces';
import {
  buildOccurrenceNavTimeline,
  getActiveOccurrences,
  getCurrentOrNextOccurrence,
  getMeetingSeriesUid,
  isMeetingAttendeeListShared,
  isMeetingInviteResponsesEnabled,
  isPastMeetingCompositeId,
  resolveActionSlot,
  resolveMeetingStatus,
  resolvePrivacy,
  resolveRsvpOccurrenceId,
  resolveTimeState,
  resolveViewerRole,
  resolveVisibleSections,
  selectApplicableRsvp,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  interval,
  map,
  merge,
  Observable,
  of,
  startWith,
  Subject,
  switchMap,
  tap,
  timer,
} from 'rxjs';

import { MeetingDetailsSeedService } from '../meeting-details-gate/meeting-details-seed.service';

/**
 * Loads the meeting for the V2 details page and decides which top-level branch it shows (E1-01).
 * @description Provided by {@link MeetingDetailsPageComponent}, so every Phase 1 section injects
 * one shared instance instead of fetching again. It composes the same `MeetingService` lookups V1
 * uses and keeps V1's contracts (GH-2041, PR #2046), without importing anything from V1:
 *
 * - **Seed.** On the browser it starts from the snapshot the gate took
 *   ({@link MeetingDetailsSeedService}), including the terminal-error branch, so a seeded page
 *   never flashes the skeleton. On the server it writes the same `MeetingJoinPageState` V1 writes,
 *   for when V2 renders there (anonymous visitors from rollout stage 5, everyone once the gate is
 *   removed).
 * - **Reachability.** V2 cannot rely on V1 to reject a bad id: on an in-app navigation V1 is torn
 *   down before its lookup settles. A 400 / 403 / 404 goes to `/meetings/not-found`; any other
 *   failure is the `error` branch.
 * - **No stale content.** `matchesRoute` is false from the moment the route id changes until that
 *   id's lookup succeeds, so navigating from one meeting to another shows the skeleton, never the
 *   previous meeting (and its join links) under the new URL.
 */
@Injectable()
export class MeetingDetailsStateService {
  private readonly meetingService = inject(MeetingService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);
  private readonly seedService = inject(MeetingDetailsSeedService, { optional: true });
  private readonly userService = inject(UserService);
  private readonly stateKey = makeStateKey<MeetingJoinPageState>(MEETING_JOIN_STATE_KEY);

  /** True when the page was reached through a past-meeting composite id (`meetingId-timestamp`). */
  public readonly loadedViaPastMeetingId = signal(false);
  /** The past endpoint's `full_access`; false for an upcoming meeting. */
  public readonly pastMeetingFullAccess = signal(false);
  /**
   * Whether `pastMeetingFullAccess` is an answer rather than a default: true only for a page the past
   * endpoint loaded. A meeting loaded as upcoming that ends while open, or a recently ended one-off
   * the upcoming endpoint still serves, has never been asked, so the slot must not call it private.
   */
  public readonly pastAccessKnown = computed(() => this.loadedViaPastMeetingId());
  /**
   * The meeting the viewer registered for from this page (E2-02): the slot moves to the registrant's
   * state at once, as V1's optimistic flip does, rather than waiting on the indexer. Keyed by meeting
   * id, so it applies to that meeting only and can never carry over to another one, however a
   * navigation interleaves with the dialog. It is ORed with the payload's `invited`, so it never needs
   * clearing when the lookup catches up. Unlike V1 (keyed on the series uid), a past occurrence of the
   * same series has its own id, so it reads the server's `invited` instead.
   */
  private readonly optimisticInvitedId = signal<string | null>(null);
  /** RSVPs saved from this page (E2-05), applied ahead of the indexer; see {@link setMyRsvp}. */
  private readonly myRsvpUpdates$ = new Subject<MeetingRsvp | null>();
  /** The viewer's last fetched answer as a record, for re-selecting one after a partial removal (V1's `currentUserRsvp`). */
  private lastFetchedRsvp: MeetingRsvp | null = null;
  /**
   * Bumped when the viewer removes themselves: the RSVP card resets its locally saved answer, so a
   * deleted registration's answer never stays on screen.
   */
  public readonly rsvpReset = signal(0);
  /**
   * What `myRsvp` is fetched for, derived synchronously from the route: `null` when it is not
   * fetched.
   */
  private readonly myRsvpRequest: Signal<{ meetingId: string; occurrenceId: string | undefined; allDatesOnly: boolean } | null> = computed(() => {
    const meeting = this.meeting();
    const eligible =
      !!meeting &&
      this.matchesRoute() &&
      this.userService.authenticated() &&
      this.isInvited(meeting) &&
      isMeetingInviteResponsesEnabled(meeting) &&
      !this.loadedViaPastMeetingId() &&
      this.timeState() !== 'ended';
    if (!eligible || !meeting) {
      return null;
    }
    const occurrenceId = resolveRsvpOccurrenceId(meeting, { occurrence: this.selectedOccurrence() });
    return {
      meetingId: meeting.id,
      occurrenceId,
      // As V1 (#3458): a recurring meeting with no resolved occurrence reads only its series-wide answer,
      // so a newer single-date or this-and-following answer is never shown as the answer for the series.
      allDatesOnly: !!meeting.recurrence && !occurrenceId,
    };
  });
  /**
   * Bumped after the viewer removes themselves, so the people section refetches its roster (V1's
   * `registrantsRefresh$`).
   */
  public readonly rosterRefresh = signal(0);
  /** The meeting the viewer's own removal (Remove Myself) is in flight for, if any. */
  public readonly leavingFor = signal<string | null>(null);
  /** True while a removal is in flight for the meeting on screen: another meeting's never spins here. */
  public readonly leaving: Signal<boolean> = computed(() => !!this.leavingFor() && this.leavingFor() === this.meeting()?.id);
  /**
   * A `?action=leave` link (invite emails, calendar events) until the page has handled it: the action
   * slot then asks the viewer to confirm, as V1 does. Removal never runs from the link. Tied to the
   * meeting the link named, and dropped when the route moves on, so it never prompts for another one.
   */
  public readonly leaveRequest = signal<MeetingLeaveRequest | null>(null);
  /**
   * The meeting whose `?action=leave` the page has handled, until the param is gone from the URL: the
   * lookup re-runs before the navigation that drops it lands, and must not ask a second time.
   */
  private consumedLeaveFor: string | null = null;
  /** Meetings this page has auto-joined, so a remounted Join control does not open them again. */
  private readonly autoJoinedMeetingIds = new Set<string>();
  /** The meeting password for lookups: `?password=`, or else the composer's navigation state. */
  public readonly password = signal<string | null>(null);
  /**
   * The password only when it is already in this page's own address bar.
   * @description Anything that writes a password into a link (an occurrence or join URL) MUST read
   * this, never `password`: the composer passes its password in navigation state precisely to keep
   * it out of URLs, the history, `Referer` headers and proxy logs.
   */
  public readonly urlPassword = signal<string | null>(null);
  /** True from a retry until that lookup settles, so the error state can show progress. */
  public readonly retrying = signal(false);
  /** Failed lookups in a row for the current route; reset by a success or a route change. */
  public readonly failureCount = signal(0);
  private readonly loadFailed = signal(false);
  // Route id the pipeline is attempting, set as soon as a route change is observed.
  private readonly routeId = signal<string | null>(null);
  // Route id the held `meeting()` value actually resolved for. Only a success moves it.
  private readonly resolvedRouteId = signal<string | null>(null);
  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  private readonly occurrencesRefresh$ = new BehaviorSubject<void>(undefined);
  /**
   * The occurrence on screen when an edit or cancel moved `?occurrence=`, held until the meeting is
   * read again: the payload still has the old start, so the new one cannot match yet, and the page
   * would otherwise jump to the series' first upcoming date meanwhile (V1 re-selects only when the
   * meeting changes).
   */
  private readonly heldOccurrence = signal<MeetingOccurrence | null>(null);
  /**
   * Emits when the series timeline must be read again (after an occurrence edit or cancel), as V1's
   * `seriesOccurrencesRefresh$`; the occurrence navigation re-fetches on it.
   */
  public readonly occurrencesRefresh: Observable<void> = this.occurrencesRefresh$.asObservable();

  public readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined>;
  /**
   * The series timeline (V1's `initializeSeriesOccurrences`), for the occurrence navigation and a
   * cancel's successor alike: the unpaged `/public/api/meetings/:id/occurrences`, read in the browser
   * only, for a recurring meeting and for a past occurrence even without a rule (its payload omits
   * `recurrence`). Read again whenever `occurrencesRefresh` emits.
   */
  public readonly seriesOccurrences: Signal<PublicMeetingOccurrencesResponse>;
  /**
   * The current time, ticking every 30 seconds on the browser, so anything derived from the time state
   * (the identity bar's status, E1-05's pill) moves from upcoming to live to ended while the page is
   * open. Fixed on the server, where a timer would keep the render from ever becoming stable.
   */
  public readonly now: Signal<Date> = this.initNow();
  public readonly matchesRoute: Signal<boolean> = computed(() => this.routeId() === this.resolvedRouteId());
  /**
   * The occurrence the page is about, for every section to share (data-model.md § View-scoped state).
   * @description `?occurrence=<start ms>` first, among active (non-cancelled) occurrences; otherwise the
   * current or next one, re-selected on each clock tick so a series left open moves on; once a series
   * is exhausted, its last occurrence. `null` for a one-off meeting and for a past occurrence opened
   * by its composite id, where the meeting payload is the occurrence itself.
   */
  public readonly selectedOccurrence: Signal<MeetingOccurrence | null> = this.initSelectedOccurrence();
  /** V1's `meetingTitle`: the selected occurrence's own title (an occurrence edit can set one), else the meeting's. */
  public readonly meetingTitle: Signal<string> = computed(() => this.selectedOccurrence()?.title || this.meeting()?.title || '');
  /** The selected occurrence's time state on the clock; `null` until the meeting has loaded. */
  public readonly timeState: Signal<MeetingTimeState | null> = this.initTimeState();
  /**
   * The viewer's own answer for the selected occurrence (E2-04, FR-023): `null` when they have not
   * answered, `undefined` while unknown. It is only fetched for a signed-in viewer on the invite list
   * of an upcoming or live meeting with RSVP tracking on; everyone else stays `undefined`. As V1, a
   * failed fetch reads as not answered (`null`): the BFF and the client both answer `null` for it.
   */
  public readonly myRsvp: Signal<RsvpResponse | null | undefined> = this.initMyRsvp();
  /**
   * `myRsvp` as the `data-my-rsvp` attribute value (testid-contract.md): `none` when not answered,
   * `null` (attribute absent) while unknown.
   */
  public readonly myRsvpAttr: Signal<RsvpResponse | 'none' | null> = computed(() => {
    const myRsvp = this.myRsvp();
    if (myRsvp === undefined) {
      return null;
    }
    return myRsvp ?? 'none';
  });
  /**
   * The meeting status the pill and the identity bar both show (E1-05), so the two cannot disagree,
   * including the viewer's own RSVP once it has loaded.
   */
  public readonly meetingStatus: Signal<MeetingStatusKind | null> = this.initMeetingStatus();
  public readonly status: Signal<MeetingDetailsLoadStatus> = this.initStatus();
  /** The meeting's privacy (E1-04), for the header chip and the action slot alike. */
  public readonly privacy: Signal<MeetingPrivacyState | null> = this.initPrivacy();
  /** Who the viewer is to this meeting; `visitor` whenever there is no session (E0-02). */
  public readonly viewerRole: Signal<MeetingViewerRole | null> = this.initViewerRole();
  /**
   * The one control the rail offers this viewer (E2-01, FR-020), from `resolveActionSlot`; `null`
   * until the meeting has loaded. Inside the join window it is Join only, as in V1: whether RSVP
   * stays beside it was decided against for now (FR-029).
   */
  public readonly actionSlot: Signal<ActionSlotKind | null> = this.initActionSlot();
  /**
   * Which content sections render for this viewer (E0-02 `resolveVisibleSections`); `null` until the
   * meeting has loaded. Each section reads its flag here, so a missing section traces to one decision.
   */
  public readonly visibleSections: Signal<MeetingSectionVisibility | null> = this.initVisibleSections();
  /**
   * What the people section's roster is fetched for (E3-04, FR-032); `null` when this viewer gets no
   * roster, and the section is then absent. See {@link initRosterRequest}.
   */
  public readonly rosterRequest: Signal<MeetingRosterRequest | null> = this.initRosterRequest();
  /**
   * Whether this viewer will be offered a way in once the join window opens (`join` or
   * `guest-join`), so the slot can state the early-join rule before then.
   */
  public readonly joinsInWindow: Signal<boolean> = this.initJoinsInWindow();
  /**
   * The sign-in link: `/login` with this page's own URL, query string included, as `returnTo`
   * (FR-013). That puts `?password=` in the link only when it is already in the address bar; the
   * composer's navigation-state password never appears in a URL.
   */
  public readonly signInHref: Signal<string> = this.initSignInHref();
  /**
   * V1's `canManageOccurrence`: whether the header offers Edit / Cancel for the occurrence on screen.
   * A signed-in organizer of a recurring meeting, on a live occurrence (not a past record, not ended).
   * Upstream enforces `organizer` on both writes; this only decides whether to offer them.
   */
  public readonly canManageOccurrence: Signal<boolean> = this.initCanManageOccurrence();
  /**
   * Where V1 offers Add to calendar: a signed-in organizer or invitee, before the join window opens
   * (inside it V1's rail is Join only).
   */
  public readonly showAddToCalendar: Signal<boolean> = this.initShowAddToCalendar();
  /** V1's `canLeaveMeeting`: the viewer is on the invite list (an optimistic registration included). */
  public readonly canLeaveMeeting: Signal<boolean> = computed(() => {
    const meeting = this.meeting();
    return !!meeting && this.isInvited(meeting);
  });
  /** Where V1 shows Remove Myself: an invitee (organizer or not) before the join window. */
  public readonly showLeaveMeeting: Signal<boolean> = computed(() => this.timeState() === 'before' && this.canLeaveMeeting());

  public constructor() {
    const routeId = this.activatedRoute.snapshot.paramMap.get('id');
    const seed = isPlatformBrowser(this.platformId) ? (this.seedService?.take(routeId) ?? null) : null;

    if (seed) {
      this.loadedViaPastMeetingId.set(seed.loadedViaPastMeetingId);
      this.pastMeetingFullAccess.set(seed.pastMeetingFullAccess);
      this.routeId.set(routeId);
      if (seed.meetingLoadFailed) {
        this.loadFailed.set(true);
      } else if (seed.meeting) {
        this.resolvedRouteId.set(routeId);
      }
    }

    this.applyPassword(this.activatedRoute.snapshot.queryParamMap);
    this.meeting = this.initMeeting(seed);
    this.seriesOccurrences = this.initSeriesOccurrences();

    // V1's `initializeLeaveFromLink`: V2 renders for signed-in viewers only, so it needs no login
    // round trip. The param is read from the gate's snapshot (V1 has dropped it by now) or, on an
    // in-app navigation, from the route. A new Zoom tab would bury the confirmation, so auto-join
    // stays off for the visit.
    if (isPlatformBrowser(this.platformId) && routeId) {
      const fromRoute = this.activatedRoute.snapshot.queryParamMap.get('action') === 'leave' ? { meetingId: routeId, handledByV1: false } : null;
      const request = this.seedService?.takeLeaveRequest(routeId) ?? fromRoute;
      if (request) {
        this.leaveRequest.set(request);
        this.autoJoinedMeetingIds.add(routeId);
      }
    }
  }

  /**
   * Marks the `?action=leave` link handled and drops the param, so a refresh or a later visit does
   * not ask again.
   */
  public consumeLeaveRequest(): void {
    this.consumedLeaveFor = this.leaveRequest()?.meetingId ?? null;
    this.leaveRequest.set(null);
    void this.router.navigate([], { relativeTo: this.activatedRoute, queryParams: { action: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /**
   * Records the viewer's completed removal from `meetingId` (V1's `leaveMeeting` success): off the
   * invite list at once, through the session-wide removed set that bridges the indexer's lag, then
   * the meeting and the roster are read again. Ignored when the page has moved to another meeting.
   */
  public markLeft(meetingId: string): void {
    this.meetingService.markRegistrationRemoved(meetingId);
    // Ahead of the page guard: a registration made here and removed after the page moved on must not
    // read as invited when the viewer comes back to that meeting on the same page.
    if (this.optimisticInvitedId() === meetingId) {
      this.optimisticInvitedId.set(null);
    }
    if (!this.matchesRoute() || this.meeting()?.id !== meetingId) {
      return;
    }
    // As V1 (`rsvpUpdateTrigger$.next(null)`): the removed registrations' answer is gone.
    this.myRsvpUpdates$.next(null);
    this.rsvpReset.update((count) => count + 1);
    this.rosterRefresh.update((count) => count + 1);
    this.refresh$.next();
  }

  /**
   * Records a removal that left some of the viewer's registrations in place (V1's "Removal
   * incomplete"): they stay on the invite list, the answer shown is re-selected from the surviving
   * registrations as V1 does (the session's saved answers and the last fetched one, minus the removed
   * registrants, which `clearConfirmedMeetingRsvps` has just recorded), and the meeting and the roster
   * are read again.
   */
  public markLeaveIncomplete(meetingId: string): void {
    const meeting = this.meeting();
    if (!this.matchesRoute() || !meeting || meeting.id !== meetingId) {
      return;
    }
    this.optimisticInvitedId.set(meetingId);
    const occurrenceId = resolveRsvpOccurrenceId(meeting, { occurrence: this.selectedOccurrence() });
    const candidates = [...this.userService.confirmedMeetingRsvps(meetingId), ...(this.lastFetchedRsvp ? [this.lastFetchedRsvp] : [])].filter(
      (rsvp) => this.userService.isMeetingRsvpCurrent(rsvp, meeting) && (!meeting.recurrence || !!occurrenceId || rsvp.scope === 'all')
    );
    this.myRsvpUpdates$.next(selectApplicableRsvp(occurrenceId, candidates));
    this.rsvpReset.update((count) => count + 1);
    this.rosterRefresh.update((count) => count + 1);
    this.refresh$.next();
  }

  /**
   * Claims this page's one auto-join for a meeting (FR-027): true the first time, false after, so the
   * Join control opens a meeting once however often the slot remounts.
   */
  public claimAutoJoin(meetingId: string): boolean {
    if (this.autoJoinedMeetingIds.has(meetingId)) {
      return false;
    }
    this.autoJoinedMeetingIds.add(meetingId);
    return true;
  }

  /**
   * Records a successful self-registration (E2-02, FR-021) for the meeting the page shows: the viewer
   * is on the invite list from now on, and the lookup runs again so the page catches up with the BFF.
   * Ignored when `meetingId` is no longer the page's meeting.
   */
  public markRegistered(meetingId: string): void {
    // As V1 and the meeting card: the registration happened server-side either way, so the session's
    // removed set (`markLeft`) must stop hiding this meeting everywhere, not only on this page.
    this.meetingService.clearRemovedRegistration(meetingId);
    // A registration for a meeting the page has since left, or is leaving (the held meeting outlives
    // the route change until the next lookup resolves), says nothing about the current one.
    if (!this.matchesRoute() || this.meeting()?.id !== meetingId) {
      return;
    }
    this.optimisticInvitedId.set(meetingId);
    this.refresh$.next();
  }

  /**
   * Applies an RSVP the viewer just saved (E2-05) to `myRsvp` at once. The BFF answers before the
   * query service has indexed it, so a fetch already in flight could still return the old answer:
   * the saved one switches it out (V1's `rsvpUpdateCounter` guards the same race), and the request
   * key is deduplicated, so nothing refetches it until the occurrence or meeting changes.
   *
   * `meetingId` and `occurrenceId` are what the RSVP was saved for. A save that completes after the
   * page has moved to another occurrence or meeting is dropped: that one fetches its own answer.
   */
  public setMyRsvp(meetingId: string, occurrenceId: string | undefined, rsvp: MeetingRsvp): void {
    // Read synchronously: right after a navigation the route already points at the new view.
    const key = this.myRsvpRequest();
    if (!key || key.meetingId !== meetingId || key.occurrenceId !== occurrenceId) {
      return;
    }
    this.myRsvpUpdates$.next(rsvp);
  }

  /**
   * Re-reads the meeting in the background, the page left as it is until the answer lands (e.g. when
   * the host-key window opens, so the server can return the key): unlike `refresh`, no retry state.
   */
  public reload(): void {
    this.refresh$.next();
  }

  /**
   * V1's `showOccurrenceAfterChange`, after an occurrence edit or cancel: points `?occurrence=` at
   * `startMs` (an edit can move the occurrence, which makes its start a new one), or drops it when
   * `null`, then reads the meeting and the series timeline again. The explicit refresh covers an
   * unchanged URL, which the router treats as a no-op.
   */
  public showOccurrenceAfterChange(startMs: number | null): void {
    this.heldOccurrence.set(this.selectedOccurrence());
    void this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: { occurrence: startMs === null ? null : String(startMs) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.occurrencesRefresh$.next();
    this.refresh$.next();
  }

  /**
   * V1's `nextLiveOccurrenceStartMs`: the start (ms) of the occurrence after the selected one on the
   * merged series timeline (the payload's active occurrences and `seriesOccurrences`), or `null` when
   * there is none or it is a past record. Read before a cancel lands, so the page moves to the
   * cancelled occurrence's successor rather than back to the series' first upcoming date.
   */
  public nextLiveOccurrenceStartMs(): number | null {
    const meeting = this.meeting();
    const current = this.selectedOccurrence();
    if (!meeting || !current) {
      return null;
    }
    const live = getActiveOccurrences(meeting.occurrences ?? [], meeting.cancelled_occurrences);
    const sorted = buildOccurrenceNavTimeline(live, this.seriesOccurrences(), meeting.duration);
    const currentMs = new Date(current.start_time).getTime();
    const currentIdx = sorted.findIndex((occurrence) => new Date(occurrence.start_time).getTime() === currentMs);
    const next = currentIdx >= 0 ? sorted[currentIdx + 1] : undefined;
    if (!next || next.meeting_and_occurrence_id) {
      return null;
    }
    return new Date(next.start_time).getTime();
  }

  /** Re-runs the lookup for the current route, e.g. from the error state's retry. */
  public refresh(): void {
    this.retrying.set(true);
    this.refresh$.next();
  }

  private initSelectedOccurrence(): Signal<MeetingOccurrence | null> {
    const query = toSignal(this.activatedRoute.queryParamMap, { initialValue: this.activatedRoute.snapshot.queryParamMap });
    return computed(() => {
      // `getCurrentOrNextOccurrence` reads the wall clock; reading `now` re-selects on each tick.
      this.now();
      const meeting = this.meeting();
      if (!meeting || this.loadedViaPastMeetingId()) {
        return null;
      }

      const active = getActiveOccurrences(meeting.occurrences ?? [], meeting.cancelled_occurrences);
      const requested = Number(query().get('occurrence'));
      if (requested) {
        const match = active.find((occurrence) => new Date(occurrence.start_time).getTime() === requested);
        if (match) {
          return match;
        }
        // An edit moved it: keep showing it until the meeting is read again (see `heldOccurrence`).
        const held = this.heldOccurrence();
        if (held) {
          return held;
        }
      }
      // A series with none current or next left has ended: its last occurrence, not the series'
      // first start_time, so the page does not jump back to the first date.
      return getCurrentOrNextOccurrence(meeting) ?? this.lastOccurrence(active);
    });
  }

  private initTimeState(): Signal<MeetingTimeState | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) {
        return null;
      }
      // A past-endpoint load is a past occurrence whatever the clock says, as V1 trusts it: inside the
      // 40-minute end buffer the clock alone would still read live and offer Join for a past record.
      return this.loadedViaPastMeetingId() ? 'ended' : resolveTimeState(meeting, this.selectedOccurrence(), this.now());
    });
  }

  private initPrivacy(): Signal<MeetingPrivacyState | null> {
    return computed(() => {
      const meeting = this.meeting();
      return meeting ? resolvePrivacy(meeting.visibility, meeting.restricted) : null;
    });
  }

  private initViewerRole(): Signal<MeetingViewerRole | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) {
        return null;
      }
      return resolveViewerRole({ authenticated: this.userService.authenticated(), invited: this.isInvited(meeting), organizer: meeting.organizer === true });
    });
  }

  private initActionSlot(): Signal<ActionSlotKind | null> {
    return computed(() => {
      const timeState = this.timeState();
      return timeState ? this.resolveSlotAt(timeState) : null;
    });
  }

  private initVisibleSections(): Signal<MeetingSectionVisibility | null> {
    return computed(() => {
      const meeting = this.meeting();
      const timeState = this.timeState();
      const viewerRole = this.viewerRole();
      if (!meeting || !timeState || !viewerRole) {
        return null;
      }
      return resolveVisibleSections({
        fullAccess: this.pastMeetingFullAccess(),
        inviteResponsesEnabled: isMeetingInviteResponsesEnabled(meeting),
        // V1's occurrence-navigation rule: a recurring meeting, or a past occurrence (whose payload
        // omits `recurrence`) of a series.
        recurring: !!meeting.recurrence || getMeetingSeriesUid(meeting) !== meeting.id,
        timeState,
        viewerRole,
      });
    });
  }

  /**
   * The upcoming roster's gate, V1's (`canViewGuests` and `!isPastMeeting`): the section's
   * `people` flag, narrowed to an organizer, or a registrant (an optimistic one included) of a
   * meeting whose organizer shares the guest list (`isMeetingAttendeeListShared`, which the BFF also
   * enforces by returning `[]`). Never on an ended meeting, which shows V1's attendance figures
   * (`MeetingAttendanceComponent`) instead. Every other
   * viewer has no roster, and so no count source either (GH-1731), so the section is absent rather
   * than showing a number it cannot back.
   */
  private initRosterRequest(): Signal<MeetingRosterRequest | null> {
    return computed(
      () => {
        const meeting = this.meeting();
        const role = this.viewerRole();
        const allowed =
          !!meeting &&
          this.matchesRoute() &&
          this.visibleSections()?.people === true &&
          this.timeState() !== 'ended' &&
          !this.loadedViaPastMeetingId() &&
          (role === 'organizer' || (role === 'registrant' && isMeetingAttendeeListShared(meeting)));
        if (!allowed || !meeting) {
          return null;
        }
        return { meetingId: meeting.id, occurrenceId: resolveRsvpOccurrenceId(meeting, { occurrence: this.selectedOccurrence() }) };
      },
      { equal: (a, b) => a?.meetingId === b?.meetingId && a?.occurrenceId === b?.occurrenceId }
    );
  }

  private initJoinsInWindow(): Signal<boolean> {
    return computed(() => {
      const kind = this.resolveSlotAt('live');
      return kind === 'join' || kind === 'guest-join';
    });
  }

  private initSeriesOccurrences(): Signal<PublicMeetingOccurrencesResponse> {
    const empty: PublicMeetingOccurrencesResponse = { past: [], future: [] };
    if (!isPlatformBrowser(this.platformId)) {
      return signal(empty).asReadonly();
    }
    return toSignal(
      toObservable(this.meeting).pipe(
        map((meeting) => (meeting && (meeting.recurrence || getMeetingSeriesUid(meeting) !== meeting.id) ? getMeetingSeriesUid(meeting) : null)),
        distinctUntilChanged(),
        // Another series (or none) starts empty: the service outlives in-app navigations, so the
        // previous meeting's dates must never merge into this one's while its own read is in flight.
        // A refresh of the same series keeps the timeline it has until the new one lands.
        switchMap((seriesUid) =>
          seriesUid
            ? this.occurrencesRefresh$.pipe(
                switchMap(() => this.meetingService.getPublicMeetingOccurrences(seriesUid, this.password())),
                startWith(empty)
              )
            : of(empty)
        )
      ),
      { initialValue: empty }
    );
  }

  private initCanManageOccurrence(): Signal<boolean> {
    return computed(() => {
      const meeting = this.meeting();
      return (
        this.userService.authenticated() &&
        !!meeting?.organizer &&
        !!meeting.recurrence &&
        !this.loadedViaPastMeetingId() &&
        this.timeState() !== 'ended' &&
        !!this.selectedOccurrence()
      );
    });
  }

  private initShowAddToCalendar(): Signal<boolean> {
    return computed(() => {
      const role = this.viewerRole();
      return this.timeState() === 'before' && (role === 'organizer' || role === 'registrant');
    });
  }

  private initSignInHref(): Signal<string> {
    const params = toSignal(this.activatedRoute.paramMap, { initialValue: this.activatedRoute.snapshot.paramMap });
    const query = toSignal(this.activatedRoute.queryParamMap, { initialValue: this.activatedRoute.snapshot.queryParamMap });
    return computed(() => {
      const search = new URLSearchParams();
      const queryParams = query();
      for (const key of queryParams.keys) {
        for (const value of queryParams.getAll(key)) {
          search.append(key, value);
        }
      }
      const queryString = search.toString();
      const returnTo = `${environment.urls.home}/meetings/${encodeURIComponent(params().get('id') ?? '')}${queryString ? `?${queryString}` : ''}`;
      return `/login?returnTo=${encodeURIComponent(returnTo)}`;
    });
  }

  private initMeetingStatus(): Signal<MeetingStatusKind | null> {
    return computed(() => {
      const meeting = this.meeting();
      const timeState = this.timeState();
      if (!meeting || !timeState) {
        return null;
      }
      const start = new Date(this.selectedOccurrence()?.start_time ?? meeting.start_time).getTime();
      return resolveMeetingStatus({
        timeState,
        hasStarted: this.now().getTime() >= start,
        invited: this.isInvited(meeting),
        inviteResponsesEnabled: isMeetingInviteResponsesEnabled(meeting),
        myRsvp: this.myRsvp(),
      });
    });
  }

  private initMyRsvp(): Signal<RsvpResponse | null | undefined> {
    if (!isPlatformBrowser(this.platformId)) {
      return signal<RsvpResponse | null | undefined>(undefined).asReadonly();
    }
    // Deduplicated on its values: the occurrence is re-selected on each clock tick, and a re-lookup
    // hands out a new meeting object, neither of which should refetch over a saved answer.
    const request = toObservable(this.myRsvpRequest).pipe(
      distinctUntilChanged((a, b) => a?.meetingId === b?.meetingId && a?.occurrenceId === b?.occurrenceId && a?.allDatesOnly === b?.allDatesOnly)
    );

    return toSignal(
      merge(request.pipe(map((key) => ({ key }))), this.myRsvpUpdates$.pipe(map((rsvp) => ({ rsvp })))).pipe(
        switchMap((event): Observable<RsvpResponse | null | undefined> => {
          if ('rsvp' in event) {
            this.lastFetchedRsvp = event.rsvp;
            return of(event.rsvp?.response_type ?? null);
          }
          this.lastFetchedRsvp = null;
          if (!event.key) {
            return of(undefined);
          }
          // As V1: the BFF and the client both read a failed lookup as "not answered" (`null`).
          return this.meetingService.getMeetingRsvpForCurrentUser(event.key.meetingId, event.key.occurrenceId, event.key.allDatesOnly).pipe(
            // As V1: a fetched answer of a registration the viewer has removed (the indexer can still
            // return it) is no answer, so a later lookup never undoes a removal's correction.
            map((rsvp) => {
              const meeting = this.meeting();
              return rsvp && meeting && this.userService.isMeetingRsvpCurrent(rsvp, meeting) ? rsvp : null;
            }),
            tap((rsvp) => (this.lastFetchedRsvp = rsvp)),
            map((rsvp): RsvpResponse | null | undefined => rsvp?.response_type ?? null),
            // Defensive: the client already reads a failure as `null`; an error must never end the signal.
            catchError(() => of<RsvpResponse | null | undefined>(null)),
            startWith<RsvpResponse | null | undefined>(undefined)
          );
        })
      ),
      { initialValue: undefined }
    );
  }

  private initNow(): Signal<Date> {
    if (!isPlatformBrowser(this.platformId)) {
      return signal(new Date()).asReadonly();
    }
    return toSignal(interval(30_000).pipe(map(() => new Date())), { initialValue: new Date() });
  }

  private initStatus(): Signal<MeetingDetailsLoadStatus> {
    return computed(() => {
      const meeting = this.meeting();
      // Checked ahead of `meeting()`: `toSignal` keeps the last good meeting across a later failure,
      // so the error branch must win whenever that meeting is absent or belongs to another route.
      if (this.loadFailed() && (!meeting || !this.matchesRoute())) {
        return 'error';
      }
      return meeting && this.matchesRoute() ? 'ready' : 'loading';
    });
  }

  private initMeeting(seed: MeetingJoinPageState | null): Signal<(Meeting & { project: PublicMeetingProject }) | undefined> {
    const meeting$ = combineLatest([this.activatedRoute.paramMap, this.activatedRoute.queryParamMap, this.refresh$]).pipe(
      // Before the lookup is scheduled, so `matchesRoute` turns false the instant the route changes.
      tap(([params, queryParams]) => {
        const meetingId = params.get('id');
        if (meetingId !== this.routeId()) {
          this.loadFailed.set(false);
          this.failureCount.set(0);
          if (this.leaveRequest() && this.leaveRequest()?.meetingId !== meetingId) {
            this.leaveRequest.set(null);
          }
        }
        this.routeId.set(meetingId);
        this.captureLeaveRequest(meetingId, queryParams);
      }),
      // The one-tick timer coalesces the paramMap / queryParamMap emissions of one navigation into a
      // single lookup. It sits inside `switchMap`, not before it as a `debounceTime`, so a new
      // emission cancels the previous lookup at once: otherwise the previous meeting's request stays
      // live for that tick, and settling then would mark it as the new route's meeting or send the
      // new route to not-found.
      switchMap(([params, queryParams]) =>
        timer(0).pipe(
          switchMap(() => {
            const meetingId = params.get('id');
            this.applyPassword(queryParams);

            if (!meetingId) {
              this.retrying.set(false);
              void this.router.navigate(['/meetings/not-found']);
              return EMPTY;
            }

            return isPastMeetingCompositeId(meetingId) ? this.fetchPast(meetingId) : this.fetchUpcomingThenPast(meetingId);
          })
        )
      ),
      map((res) => ({ ...res.meeting, project: res.project })),
      tap((meeting) => {
        // For the same route only a settled success clears a terminal error (a route change resets
        // it above), so a seeded error view is not reset before its refetch has succeeded.
        this.loadFailed.set(false);
        this.failureCount.set(0);
        this.retrying.set(false);
        this.heldOccurrence.set(null);
        this.resolvedRouteId.set(this.routeId());
        if (isPlatformServer(this.platformId)) {
          this.transferState.set(this.stateKey, {
            meeting,
            loadedViaPastMeetingId: this.loadedViaPastMeetingId(),
            pastMeetingFullAccess: this.pastMeetingFullAccess(),
            meetingLoadFailed: false,
          });
        }
      })
    );

    return seed?.meeting ? toSignal(meeting$, { initialValue: seed.meeting }) : toSignal(meeting$);
  }

  private fetchPast(meetingId: string): Observable<{ meeting: Meeting; project: PublicMeetingProject }> {
    return this.meetingService.getPublicPastMeeting(meetingId).pipe(
      // Set on success, not before the request, so a background refresh of a working page cannot
      // flip it to the past-meeting view while the lookup is still in flight.
      tap((res: PublicPastMeetingResponse) => {
        this.loadedViaPastMeetingId.set(true);
        this.pastMeetingFullAccess.set(res.full_access);
      }),
      // Same view model as V1's join page (#3778): the anonymous projection is a partial PastMeeting at the HTTP boundary.
      map((res: PublicPastMeetingResponse) => ({ meeting: res.meeting as Meeting, project: res.project })),
      catchError((error) => {
        // `getPublicMeeting` logs its own failures; `getPublicPastMeeting` does not, so this path logs here.
        console.error('Failed to load past meeting details', meetingId, error);
        return this.handleLookupError(error, [400, 403, 404]);
      })
    );
  }

  private fetchUpcomingThenPast(meetingId: string): Observable<{ meeting: Meeting; project: PublicMeetingProject }> {
    return this.meetingService.getPublicMeeting(meetingId, this.password()).pipe(
      tap(() => {
        this.loadedViaPastMeetingId.set(false);
        this.pastMeetingFullAccess.set(false);
      }),
      // An id with no hyphen may still be a past meeting: the upcoming endpoint 404s, the past one answers.
      catchError((error) => (error.status === 404 ? this.fetchPast(meetingId) : this.handleLookupError(error, [400, 403])))
    );
  }

  private handleLookupError(error: { status?: number }, notFoundStatuses: number[]): Observable<never> {
    this.retrying.set(false);
    if (notFoundStatuses.includes(error.status ?? 0)) {
      void this.router.navigate(['/meetings/not-found']);
      return EMPTY;
    }

    this.loadFailed.set(true);
    this.failureCount.update((count) => count + 1);
    if (isPlatformServer(this.platformId)) {
      this.transferState.set(this.stateKey, {
        meeting: null,
        loadedViaPastMeetingId: this.loadedViaPastMeetingId(),
        pastMeetingFullAccess: this.pastMeetingFullAccess(),
        meetingLoadFailed: true,
      });
    }
    return EMPTY;
  }

  // The query param wins when present (it is the shape meeting cards and copied links use). The
  // composer's post-create link passes the password in navigation state instead, to keep it out of
  // the address bar; `history` is browser-only, so the server only ever sees the param.
  private applyPassword(queryParams: ParamMap): void {
    const fromQuery = queryParams.get('password');
    this.urlPassword.set(fromQuery);
    this.password.set(fromQuery || this.statePassword());
  }

  private statePassword(): string | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    const stated = (history.state as { password?: unknown } | null)?.password;
    return typeof stated === 'string' && stated ? stated : null;
  }

  /**
   * A `?action=leave` link reached by an in-app navigation (the service outlives it, so the
   * constructor never sees it): the same request as on a fresh load, once per link, with auto-join
   * kept off for that meeting.
   */
  private captureLeaveRequest(meetingId: string | null, queryParams: ParamMap): void {
    if (queryParams.get('action') !== 'leave') {
      this.consumedLeaveFor = null;
      return;
    }
    if (!isPlatformBrowser(this.platformId) || !meetingId || this.consumedLeaveFor === meetingId || this.leaveRequest()?.meetingId === meetingId) {
      return;
    }
    this.leaveRequest.set({ meetingId, handledByV1: false });
    this.autoJoinedMeetingIds.add(meetingId);
  }

  private lastOccurrence(occurrences: MeetingOccurrence[]): MeetingOccurrence | null {
    return occurrences.reduce<MeetingOccurrence | null>(
      (last, occurrence) => (!last || new Date(occurrence.start_time) > new Date(last.start_time) ? occurrence : last),
      null
    );
  }

  /**
   * On the invite list, per the payload or a registration made from this page, as V1's
   * `effectivelyInvited`: a removal made this session (`removedRegistrationMeetingIds`) wins over a
   * payload the indexer has not caught up on yet.
   */
  private isInvited(meeting: Meeting): boolean {
    // The session's removal wins over both sources; registering again (`markRegistered`) clears it.
    const removed = this.meetingService.removedRegistrationMeetingIds().has(meeting.id);
    return !removed && (meeting.invited === true || this.optimisticInvitedId() === meeting.id);
  }

  /** The action slot this viewer gets at the given time state, or `null` before the meeting loads. */
  private resolveSlotAt(timeState: MeetingTimeState): ActionSlotKind | null {
    const meeting = this.meeting();
    const privacy = this.privacy();
    const viewerRole = this.viewerRole();
    if (!meeting || !privacy || !viewerRole) {
      return null;
    }
    return resolveActionSlot({
      fullAccess: this.pastMeetingFullAccess(),
      inviteResponsesEnabled: isMeetingInviteResponsesEnabled(meeting),
      privacy,
      timeState,
      viewerRole,
    });
  }
}
