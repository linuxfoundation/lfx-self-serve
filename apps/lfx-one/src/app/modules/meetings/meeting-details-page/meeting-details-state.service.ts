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
  MeetingOccurrence,
  MeetingOccurrenceStripItem,
  MeetingOccurrenceStripPages,
  MeetingPrivacyState,
  MeetingRosterRequest,
  MeetingRsvp,
  MeetingSectionVisibility,
  MeetingStatusKind,
  MeetingTimeState,
  MeetingViewerRole,
  PastMeeting,
  PublicMeetingProject,
  PublicPastMeetingResponse,
  RsvpResponse,
} from '@lfx-one/shared/interfaces';
import {
  compositeIdToStartMs,
  findCancelledOccurrence,
  getActiveOccurrences,
  getCurrentOrNextOccurrence,
  getMeetingSeriesUid,
  isMeetingAttendeeListShared,
  isMeetingInviteResponsesEnabled,
  isMeetingOccurrenceCancelled,
  isPastMeetingCompositeId,
  resolveActionSlot,
  resolveMeetingStatus,
  resolvePrivacy,
  resolveRsvpOccurrenceId,
  resolveTimeState,
  resolveViewerRole,
  resolveVisibleSections,
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
  private readonly myRsvpUpdates$ = new Subject<MeetingRsvp>();
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
      !this.cancelledOccurrence() &&
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

  public readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined>;
  /**
   * The current time, ticking every 30 seconds on the browser, so anything derived from the time state
   * (the identity bar's status, E1-05's pill) moves from upcoming to live to ended while the page is
   * open. Fixed on the server, where a timer would keep the render from ever becoming stable.
   */
  public readonly now: Signal<Date> = this.initNow();
  public readonly matchesRoute: Signal<boolean> = computed(() => this.routeId() === this.resolvedRouteId());
  /**
   * The occurrence the page is about, for every section to share (data-model.md § View-scoped state).
   * @description `?occurrence=<start ms>` first: an active occurrence, or a cancelled one, kept so the page
   * says it was cancelled (E6-05, `cancelledOccurrence`) rather than showing another date; otherwise the
   * current or next one, re-selected on each clock tick so a series left open moves on; once a series
   * is exhausted, its last occurrence. `null` for a one-off meeting and for a past occurrence opened
   * by its composite id, where the meeting payload is the occurrence itself.
   */
  public readonly selectedOccurrence: Signal<MeetingOccurrence | null> = this.initSelectedOccurrence();
  /**
   * The selected occurrence when it was cancelled (E6-05, #3588): a `?occurrence=` link to one. The page
   * then says so and offers the next active occurrence, with no join, RSVP or roster for it.
   */
  public readonly cancelledOccurrence: Signal<MeetingOccurrence | null> = computed(() => {
    const meeting = this.meeting();
    const occurrence = this.selectedOccurrence();
    return meeting && occurrence && isMeetingOccurrenceCancelled(occurrence, meeting.cancelled_occurrences) ? occurrence : null;
  });
  /** The current or next active occurrence, which a cancelled occurrence's page offers. */
  public readonly nextActiveOccurrence: Signal<MeetingOccurrence | null> = computed(() => {
    this.now();
    const meeting = this.meeting();
    return meeting && this.cancelledOccurrence() ? getCurrentOrNextOccurrence(meeting) : null;
  });
  /**
   * The series the page's meeting belongs to: the meeting itself for an upcoming one, its `meeting_id`
   * for a past occurrence opened by its composite id. `null` until the meeting has loaded.
   */
  public readonly seriesUid: Signal<string | null> = computed(() => {
    const meeting = this.meeting();
    return meeting ? getMeetingSeriesUid(meeting) : null;
  });
  /**
   * The start (Unix ms) of the occurrence the page shows, for the occurrence strip (E6-03): the selected
   * occurrence's, or on a past occurrence's page, its own start. That is the composite route id's when
   * the page was opened by one; for one opened by its plain id (the upcoming lookup's 404 fallback), the
   * record's composite id (full access), else its scheduled start, which the limited response keeps.
   */
  public readonly selectedOccurrenceStartMs: Signal<number | null> = computed(() => {
    if (this.loadedViaPastMeetingId()) {
      const fromRoute = compositeIdToStartMs(this.routeId() ?? '');
      if (fromRoute !== null) {
        return fromRoute;
      }
      const record = this.meeting() as Partial<PastMeeting> | undefined;
      const fromRecord = record?.meeting_and_occurrence_id ? compositeIdToStartMs(record.meeting_and_occurrence_id) : null;
      if (fromRecord !== null) {
        return fromRecord;
      }
      const scheduled = record?.scheduled_start_time ? Date.parse(record.scheduled_start_time) : NaN;
      return Number.isFinite(scheduled) ? scheduled : null;
    }
    const occurrence = this.selectedOccurrence();
    return occurrence ? new Date(occurrence.start_time).getTime() : null;
  });
  /**
   * The occurrence strip's loaded pages (E6-03), held here because the strip does not outlive a move
   * that changes the route id (a past occurrence's composite id): the page shows its skeleton until
   * that lookup settles, and the strip is created again. Keyed on series and password, so the new one
   * resumes without reading the series again.
   */
  public readonly occurrenceStripPages = signal<MeetingOccurrenceStripPages | null>(null);
  /**
   * The start (Unix ms) of the occurrence the strip last moved the page to, until the strip has shown
   * it: a strip created again by that move puts focus back on its chip when the move left none.
   */
  public readonly occurrenceStripFocusMs = signal<number | null>(null);
  /** The selected occurrence's time state on the clock; `null` until the meeting has loaded. */
  public readonly timeState: Signal<MeetingTimeState | null> = this.initTimeState();
  /**
   * The viewer's own answer for the selected occurrence (E2-04, FR-023): `null` when they have not
   * answered, `undefined` while unknown. It is only fetched for a signed-in viewer on the invite list
   * of an upcoming or live meeting with RSVP tracking on; everyone else stays `undefined`, and so
   * does a failed fetch, which the pill reads as the time state rather than "Awaiting your RSVP".
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
   * Moves the page to another occurrence of its series (E6-03), on the URL contract: a past record as
   * its composite id, anything else as `/meetings/{seriesUid}?occurrence={start ms}`, including an
   * occurrence that has ended on the clock but has no past record yet, whose composite id would not
   * resolve (the upcoming page resolves an ended occurrence itself). Only a password
   * already in the address bar goes into the URL; one the composer handed over in navigation state is
   * handed on the same way, so a private meeting's next lookup still has it and it never reaches a URL.
   */
  public navigateToOccurrence(item: MeetingOccurrenceStripItem): void {
    const seriesUid = this.seriesUid();
    if (!seriesUid || item.cancelled) {
      return;
    }
    this.occurrenceStripFocusMs.set(item.startMs);
    const urlPassword = this.urlPassword();
    const statePassword = urlPassword ? null : this.password();
    const queryParams: Record<string, string> = urlPassword ? { password: urlPassword } : {};
    const extras = { queryParams, ...(statePassword && { state: { password: statePassword } }) };
    if (item.pastResourceId) {
      void this.router.navigate(['/meetings', item.pastResourceId], extras);
      return;
    }
    void this.router.navigate(['/meetings', seriesUid], { ...extras, queryParams: { ...queryParams, occurrence: String(item.startMs) } });
  }

  /** Opens an active occurrence of this series by its start, as a strip chip does (the cancelled state's offer). */
  public openOccurrence(occurrence: MeetingOccurrence): void {
    const startMs = new Date(occurrence.start_time).getTime();
    this.navigateToOccurrence({
      startMs,
      startTime: occurrence.start_time,
      duration: occurrence.duration,
      endKnown: occurrence.duration > 0,
      occurrenceId: occurrence.occurrence_id,
      isPast: false,
      cancelled: false,
    });
  }

  /**
   * Re-reads the meeting in the background, the page left as it is until the answer lands (e.g. when
   * the host-key window opens, so the server can return the key): unlike `refresh`, no retry state.
   */
  public reload(): void {
    this.refresh$.next();
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
        // A link to a cancelled occurrence keeps it, so the page says it was cancelled (E6-05, FR-044)
        // rather than silently showing another date.
        const cancelled = findCancelledOccurrence(meeting, requested);
        if (cancelled) {
          return cancelled;
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
      if (!timeState) {
        return null;
      }
      // Nothing to join or answer on a cancelled occurrence: the slot offers the next one instead.
      return this.cancelledOccurrence() ? 'none' : this.resolveSlotAt(timeState);
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
      const sections = resolveVisibleSections({
        fullAccess: this.pastMeetingFullAccess(),
        inviteResponsesEnabled: isMeetingInviteResponsesEnabled(meeting),
        // A past occurrence's payload can omit `recurrence`: it is part of a series when its series
        // differs from itself, as V1 derives it (data-model.md § Field → axis, E).
        recurring: !!meeting.recurrence || getMeetingSeriesUid(meeting) !== meeting.id,
        timeState,
        viewerRole,
      });
      // A cancelled occurrence has no recording to come: no "pending" section contradicting its banner.
      return this.cancelledOccurrence() ? { ...sections, tools: false } : sections;
    });
  }

  /**
   * The upcoming roster's gate, V1's (`canViewGuests` and `!isPastMeeting`): the section's
   * `people` flag, narrowed to an organizer, or a registrant (an optimistic one included) of a
   * meeting whose organizer shares the guest list (`isMeetingAttendeeListShared`, which the BFF also
   * enforces by returning `[]`). Never on an ended meeting: the past roster is N-02's. Every other
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
          !this.cancelledOccurrence() &&
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
      if (this.cancelledOccurrence()) {
        return false;
      }
      const kind = this.resolveSlotAt('live');
      return kind === 'join' || kind === 'guest-join';
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
      // A cancelled occurrence has no phase or answer to show: the rail says it was cancelled.
      if (!meeting || !timeState || this.cancelledOccurrence()) {
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
            return of(event.rsvp.response_type);
          }
          if (!event.key) {
            return of(undefined);
          }
          // As V1: the BFF and the client both read a failed lookup as "not answered" (`null`).
          return this.meetingService.getMeetingRsvpForCurrentUser(event.key.meetingId, event.key.occurrenceId, event.key.allDatesOnly).pipe(
            map((rsvp): RsvpResponse | null | undefined => rsvp?.response_type ?? null),
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
      tap(([params]) => {
        const meetingId = params.get('id');
        if (meetingId !== this.routeId()) {
          this.loadFailed.set(false);
          this.failureCount.set(0);
        }
        this.routeId.set(meetingId);
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
      map((res: PublicPastMeetingResponse) => ({ meeting: res.meeting, project: res.project })),
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

  private lastOccurrence(occurrences: MeetingOccurrence[]): MeetingOccurrence | null {
    return occurrences.reduce<MeetingOccurrence | null>(
      (last, occurrence) => (!last || new Date(occurrence.start_time) > new Date(last.start_time) ? occurrence : last),
      null
    );
  }

  /** On the invite list, per the payload or a registration made from this page. */
  private isInvited(meeting: Meeting): boolean {
    return meeting.invited === true || this.optimisticInvitedId() === meeting.id;
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
