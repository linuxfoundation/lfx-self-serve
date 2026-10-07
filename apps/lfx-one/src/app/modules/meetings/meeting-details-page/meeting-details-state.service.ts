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
  MeetingPrivacyState,
  MeetingRsvp,
  MeetingStatusKind,
  MeetingTimeState,
  MeetingViewerRole,
  PublicMeetingProject,
  PublicPastMeetingResponse,
  RsvpResponse,
} from '@lfx-one/shared/interfaces';
import {
  getActiveOccurrences,
  getCurrentOrNextOccurrence,
  isMeetingInviteResponsesEnabled,
  isPastMeetingCompositeId,
  resolveActionSlot,
  resolveMeetingStatus,
  resolvePrivacy,
  resolveRsvpOccurrenceId,
  resolveTimeState,
  resolveViewerRole,
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
   * @description `?occurrence=<start ms>` first, among active (non-cancelled) occurrences; otherwise the
   * current or next one, re-selected on each clock tick so a series left open moves on; once a series
   * is exhausted, its last occurrence. `null` for a one-off meeting and for a past occurrence opened
   * by its composite id, where the meeting payload is the occurrence itself.
   */
  public readonly selectedOccurrence: Signal<MeetingOccurrence | null> = this.initSelectedOccurrence();
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
   */
  public setMyRsvp(rsvp: MeetingRsvp): void {
    this.myRsvpUpdates$.next(rsvp);
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

  private initJoinsInWindow(): Signal<boolean> {
    return computed(() => {
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
    // What the fetch is made of: re-selected on each clock tick, so deduplicated on its values.
    const request = toObservable(
      computed(() => {
        const meeting = this.meeting();
        const timeState = this.timeState();
        const eligible =
          !!meeting &&
          this.matchesRoute() &&
          this.userService.authenticated() &&
          this.isInvited(meeting) &&
          isMeetingInviteResponsesEnabled(meeting) &&
          !this.loadedViaPastMeetingId() &&
          timeState !== 'ended';
        if (!eligible || !meeting) {
          return null;
        }
        return { meetingId: meeting.id, occurrenceId: resolveRsvpOccurrenceId(meeting, { occurrence: this.selectedOccurrence() }) };
      })
    ).pipe(distinctUntilChanged((a, b) => a?.meetingId === b?.meetingId && a?.occurrenceId === b?.occurrenceId));

    return toSignal(
      merge(request.pipe(map((key) => ({ key }))), this.myRsvpUpdates$.pipe(map((rsvp) => ({ rsvp })))).pipe(
        switchMap((event): Observable<RsvpResponse | null | undefined> => {
          if ('rsvp' in event) {
            return of(event.rsvp.response_type);
          }
          if (!event.key) {
            return of(undefined);
          }
          return this.meetingService.getMeetingRsvpForCurrentUserOrFail(event.key.meetingId, event.key.occurrenceId).pipe(
            map((rsvp): RsvpResponse | null | undefined => rsvp?.response_type ?? null),
            // Unknown, not "not answered": the pill falls back to the time state.
            catchError(() => of<RsvpResponse | null | undefined>(undefined)),
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
