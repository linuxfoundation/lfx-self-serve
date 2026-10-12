// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { afterNextRender, computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MessageService } from 'primeng/api';
import {
  CdpProjectAffiliation,
  ChangePasswordRequest,
  ProjectAffiliationPatchBody,
  CombinedProfile,
  ClaimAliasRequest,
  ClaimAliasResponse,
  CreateUserPermissionRequest,
  DeveloperTokenInfo,
  EmailManagementData,
  EnrichedIdentity,
  Impersonator,
  LinuxAliasData,
  Meeting,
  MeetingInviteEmail,
  MeetingRegistrationRemovalResult,
  MeetingRsvp,
  PastMeeting,
  ProfileAuthStatus,
  ProfilePictureUploadResponse,
  ProfileUpdateRequest,
  ProfileVisibility,
  ProfileVisibilityUpdateRequest,
  SalesforceIdResponse,
  SendEmailVerificationResponse,
  User,
  VerifyAndLinkEmailResponse,
  WorkExperience,
  WorkExperienceCreateUpdateBody,
  WorkExperienceEntry,
} from '@lfx-one/shared/interfaces';
import { isRsvpSupersededBy, resolveRsvpOccurrenceId, retainConfirmedRsvp, selectApplicableRsvp } from '@lfx-one/shared/utils';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  map,
  Observable,
  of,
  shareReplay,
  skip,
  startWith,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs';

import { isBrowserInviteLandingPath } from '../utils/invite-landing.util';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly messageService = inject(MessageService);

  public authenticated: WritableSignal<boolean> = signal<boolean>(false);
  public user: WritableSignal<User | null> = signal<User | null>(null);
  public impersonating: WritableSignal<boolean> = signal<boolean>(false);
  public impersonator: WritableSignal<Impersonator | null> = signal<Impersonator | null>(null);
  public canImpersonate: WritableSignal<boolean> = signal<boolean>(false);
  public readonly userInitials: Signal<string> = this.initUserInitials();
  /**
   * The current user's uploaded avatar (Auth0 user_metadata.picture), null until either the
   * one-time post-hydration profile fetch resolves or the profile-edit upload flow sets it
   * directly. It never arrives via `user` — that field is absent from the OIDC claims `user` is
   * seeded from (LFXV2-2628).
   */
  public readonly uploadedAvatarUrl: WritableSignal<string | null> = signal<string | null>(null);
  /**
   * Single source of truth for "which avatar to show" everywhere in the app for the logged-in
   * user: the uploaded avatar when set, else the always-present Auth0 OIDC `picture` claim.
   */
  public readonly effectiveAvatarUrl: Signal<string> = computed(() => this.uploadedAvatarUrl() || this.user()?.picture || '');
  /**
   * The viewer's LFID as it appears on meeting `created_by` / host records — null when unresolved.
   * Single source for viewer-identity comparisons (e.g. the "Organized by you" chip and the
   * "Organized by me" meetings filter), so those surfaces can never resolve identity differently.
   */
  public readonly viewerUsername: Signal<string | null> = this.initViewerUsername();
  /**
   * Identity the personal meeting feeds belong to: the subject plus the canonical-first LFID, so a
   * subject swap without LFID claims and late LFID resolution both change it. Consumers holding a
   * personal feed reconnect when it changes.
   */
  public readonly meetingFeedIdentity: Signal<string> = computed(() => `${this.user()?.sub ?? ''}\0${this.viewerUsername() ?? ''}`);
  /** Cached Salesforce user ID from the API Gateway — null until first fetch */
  public readonly apiGatewayUserId = signal<string | null>(null);

  private readonly userMeetingsRefresh$ = new Subject<void>();
  private readonly confirmedMeetingRsvps$ = new BehaviorSubject(new Map<string, MeetingRsvp[]>());
  private readonly confirmedMeetingRsvpMap = toSignal(this.confirmedMeetingRsvps$, { requireSync: true });
  private readonly endedMeetingRegistrantIds = signal(new Map<string, ReadonlySet<string>>());
  private readonly indexedMeetingRegistrantIds = new Map<string, Set<string>>();
  // Bumped on every successful removal, so a write submitted before it cannot outlive it.
  private readonly meetingRegistrationGenerations = new Map<string, number>();
  private readonly userPastMeetingsRefresh$ = new Subject<void>();
  // Shared identities refresh trigger — tab and shell each run their own getIdentities() fetch off
  // this so the shell's GitHub handle / dots update after a link/verify/add/remove (LFXV2-2767).
  private readonly userIdentitiesRefresh$ = new Subject<void>();
  public readonly identitiesRefresh$: Observable<void> = this.userIdentitiesRefresh$.asObservable();
  // Per-chain destroy signals so that on user change we can tear down the old shareReplay
  // chain (which stays alive under refCount:false) instead of leaking abandoned subscriptions
  // to the refresh subjects. A fresh Subject is created for each new chain.
  private userMeetingsDestroy$ = new Subject<void>();
  private userPastMeetingsDestroy$ = new Subject<void>();
  private userLatestPastMeetingsDestroy$ = new Subject<void>();
  private userMeetings$: Observable<Meeting[]> | null = null;
  private userMeetingsDirty = false;
  private userMeetingsSubject: string | null = null;
  private userPastMeetings$: Observable<PastMeeting[]> | null = null;
  private userLatestPastMeetings$: Observable<PastMeeting[]> | null = null;

  public constructor() {
    // A late LFID claim changes meeting identity, not the effective subject's uploaded avatar.
    // Still reset on login/logout and impersonation swaps, including unchanged LFID claims.
    toObservable(computed(() => this.user()?.sub || this.viewerUsername()))
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed())
      .subscribe(() => this.uploadedAvatarUrl.set(null));

    // Invalidate cached user-scoped observables when the authenticated user or
    // impersonation changes, so existing subscribers don't see stale data from
    // the previous user. Keyed on `meetingFeedIdentity`, so subject swaps without LFID
    // claims and late LFID resolution both invalidate every personal feed. Skip the
    // initial emission since the caches are lazy-initialized and haven't been populated yet.
    toObservable(this.meetingFeedIdentity)
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed())
      .subscribe(() => {
        // Tear down the old chains first — their shareReplay keeps the source alive under
        // refCount:false, so nulling the field alone would leave them subscribed to refresh$.
        this.userMeetingsDestroy$.next();
        this.userMeetingsDestroy$ = new Subject<void>();
        this.userPastMeetingsDestroy$.next();
        this.userPastMeetingsDestroy$ = new Subject<void>();
        this.userLatestPastMeetingsDestroy$.next();
        this.userLatestPastMeetingsDestroy$ = new Subject<void>();
        this.userMeetings$ = null;
        this.userMeetingsDirty = false;
        this.userPastMeetings$ = null;
        this.userLatestPastMeetings$ = null;
      });

    // Client-only, one-time: user_metadata.picture isn't part of the OIDC claims transferred from
    // SSR (see server.ts's AuthContext), so the only way to learn it is a follow-up fetch of the
    // existing /api/profile endpoint. afterNextRender never runs during SSR, so this never adds
    // latency to a server-rendered response — it fires once, after the first client render.
    afterNextRender(() => {
      if (!this.user() || isBrowserInviteLandingPath()) {
        return;
      }
      this.getCurrentUserProfile()
        .pipe(
          take(1),
          // Best-effort: on failure leave uploadedAvatarUrl null so effectiveAvatarUrl falls back
          // to the Auth0 picture claim, which is already showing.
          catchError((error) => {
            console.error('Failed to seed avatar from profile; falling back to the Auth0 picture claim:', error);
            return EMPTY;
          })
        )
        .subscribe((profile) => {
          // Only seed from this fetch if nothing has set the signal since it was kicked off —
          // an in-session upload (onProfileSaved) that completes first must win, not get
          // clobbered by this slower, now-stale fetch resolving afterward.
          if (profile.profile?.picture && this.uploadedAvatarUrl() === null) {
            this.uploadedAvatarUrl.set(profile.profile.picture);
          }
        });
    });
  }

  // Create a new user with permissions
  public createUserWithPermissions(userData: CreateUserPermissionRequest): Observable<any> {
    return this.http.post(`/api/projects/${userData.project_uid}/permissions`, userData);
  }

  // Profile management methods

  /**
   * Get current user's combined profile data
   */
  public getCurrentUserProfile(): Observable<CombinedProfile> {
    return this.http.get<CombinedProfile>('/api/profile');
  }

  /**
   * Update user profile metadata via unified NATS endpoint
   * Only sends user_metadata - username and email are extracted from OIDC claim on backend
   */
  public updateUserProfile(data: ProfileUpdateRequest): Observable<any> {
    return this.http.patch('/api/profile', data).pipe(take(1));
  }

  /**
   * Upload a new profile picture. Sent as raw bytes with the file's MIME type as
   * Content-Type (the backend parses this with express.raw, not multipart/form-data).
   */
  public uploadProfilePicture(file: File): Observable<ProfilePictureUploadResponse> {
    return this.http.post<ProfilePictureUploadResponse>('/api/profile/picture-upload', file, { headers: { 'Content-Type': file.type } }).pipe(take(1));
  }

  // Public-profile visibility methods (LFXV2-2629)

  /**
   * Resolve the current user's public-profile visibility: the master IsPublic flag and the
   * section-level `visibility` preference map.
   */
  public getProfileVisibility(): Observable<ProfileVisibility> {
    return this.http.get<ProfileVisibility>('/api/profile/visibility');
  }

  /**
   * Update the current user's public-profile visibility (master flag + section map).
   */
  public updateProfileVisibility(data: ProfileVisibilityUpdateRequest): Observable<ProfileVisibility> {
    return this.http.patch<ProfileVisibility>('/api/profile/visibility', data).pipe(take(1));
  }

  // Email management methods

  /**
   * Get current user's email management data from auth-service via NATS
   */
  public getUserEmails(): Observable<EmailManagementData> {
    return this.http.get<EmailManagementData>('/api/profile/emails');
  }

  /**
   * Set an email as the primary email
   * @param email - The email address to make primary
   */
  public setPrimaryEmail(email: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`/api/profile/emails/${encodeURIComponent(email)}/primary`, {}).pipe(take(1));
  }

  /**
   * Get the user's preferred meeting-invitation email from meeting-service via NATS.
   * Null fields mean no override (invitations fall back to the primary email). Lets a request
   * failure propagate as an error rather than swallowing it into the same shape as "no override" —
   * callers that gate delete/remove actions on this value must be able to tell "confirmed none"
   * from "unknown" and fail closed on the latter.
   */
  public getMeetingInviteEmail(): Observable<MeetingInviteEmail> {
    return this.http.get<MeetingInviteEmail>('/api/profile/emails/meeting-invite');
  }

  /**
   * Set the user's preferred meeting-invitation email.
   * @param email - The verified email address to receive meeting invitations
   */
  public setMeetingInviteEmail(email: string): Observable<MeetingInviteEmail> {
    return this.http.put<MeetingInviteEmail>('/api/profile/emails/meeting-invite', { email }).pipe(take(1));
  }

  // Linux.com email alias methods

  /**
   * Resolve the user's Linux.com alias state (purchase + claim + forward).
   */
  public getLinuxAlias(): Observable<LinuxAliasData> {
    return this.http.get<LinuxAliasData>('/api/profile/linux-email').pipe(take(1));
  }

  /**
   * Claim a Linux.com alias and set its forwarding target.
   */
  public claimLinuxAlias(body: ClaimAliasRequest): Observable<ClaimAliasResponse> {
    return this.http.post<ClaimAliasResponse>('/api/profile/linux-email/claim', body).pipe(take(1));
  }

  /**
   * Update the forwarding target for an already-claimed alias.
   */
  public updateLinuxForward(forwardTo: string): Observable<{ forwardTo: string }> {
    return this.http.put<{ forwardTo: string }>('/api/profile/linux-email/forward', { forwardTo }).pipe(take(1));
  }

  // Password management methods

  /**
   * Change user password
   */
  public changePassword(data: ChangePasswordRequest): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/profile/change-password', data).pipe(take(1));
  }

  /**
   * Send password reset email for current authenticated user
   */
  public sendPasswordResetEmail(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/profile/reset-password', {}).pipe(take(1));
  }

  /**
   * Get developer token information
   */
  public getDeveloperTokenInfo(): Observable<DeveloperTokenInfo> {
    return this.http.get<DeveloperTokenInfo>('/api/profile/developer').pipe(take(1));
  }

  /** Capture before submitting a write; a removal that succeeds in the meantime makes that write's acknowledgement stale. */
  public meetingRegistrationGeneration(meetingId: string, subject = this.user()?.sub || this.viewerUsername() || this.user()?.email || ''): number {
    return this.meetingRegistrationGenerations.get(`${subject}\0${meetingId}`) ?? 0;
  }

  /**
   * Retain a successful write beyond the route that submitted it, under its captured effective subject.
   * Pass the generation captured at submit time: an acknowledgement that arrives after a removal ends its registration instead.
   * Returns the retained copy, stamped to sort after earlier confirmations, or null when the write was not retained.
   */
  public recordConfirmedMeetingRsvp(
    rsvp: MeetingRsvp,
    subject = this.user()?.sub || this.viewerUsername() || this.user()?.email || '',
    generation?: number
  ): MeetingRsvp | null {
    if (!subject || !rsvp.registrant_id) return null;
    const key = `${subject}\0${rsvp.meeting_id}`;
    if (generation !== undefined && generation !== this.meetingRegistrationGeneration(rsvp.meeting_id, subject)) {
      this.endMeetingRegistrants(key, [rsvp.registrant_id]);
      return null;
    }
    const ended = this.endedMeetingRegistrantIds().get(key);
    if (ended?.has(rsvp.registrant_id)) return null;
    const current = this.confirmedMeetingRsvps$.value;
    const retained = retainConfirmedRsvp(
      (current.get(key) ?? []).filter((saved) => !ended?.has(saved.registrant_id)),
      rsvp
    );
    const next = new Map(current);
    next.set(key, retained);
    this.confirmedMeetingRsvps$.next(next);
    return retained[0];
  }

  /**
   * Reactive read of retained answers for one subject and meeting, including recovered survivor history.
   * Lets surfaces outside the personal feed (recreated cards and controls in Foundation/Project) keep a
   * successful write while the query index catches up. Callers still filter by registration and date.
   */
  public confirmedMeetingRsvps(meetingId: string, subject = this.user()?.sub || this.viewerUsername() || this.user()?.email || ''): MeetingRsvp[] {
    return (subject && this.confirmedMeetingRsvpMap().get(`${subject}\0${meetingId}`)) || [];
  }

  /** End confirmed deletions only; a partial removal leaves surviving registrations and their in-flight writes live. */
  public clearConfirmedMeetingRsvps(meetingId: string, subject: string, result: MeetingRegistrationRemovalResult): void {
    if (!subject) return;
    const key = `${subject}\0${meetingId}`;
    const current = this.confirmedMeetingRsvps$.value;
    const complete = result.remaining_registrant_ids.length === 0;
    if (complete) this.meetingRegistrationGenerations.set(key, (this.meetingRegistrationGenerations.get(key) ?? 0) + 1);
    this.endMeetingRegistrants(key, result.removed_registrant_ids);
    const surviving = complete ? [] : (current.get(key) ?? []).filter((rsvp) => !result.removed_registrant_ids.includes(rsvp.registrant_id));
    const recovered = complete
      ? []
      : (result.remaining_rsvps ?? []).filter(
          (rsvp) =>
            rsvp.meeting_id === meetingId &&
            result.remaining_registrant_ids.includes(rsvp.registrant_id) &&
            !this.endedMeetingRegistrantIds().get(key)?.has(rsvp.registrant_id)
        );
    // History is not a new write: keep its timestamps and prefer a newer local copy of the same row.
    const retained = [
      ...surviving.filter((saved) => !recovered.some((indexed) => indexed.id === saved.id && isRsvpSupersededBy(saved, indexed))),
      ...recovered.filter((indexed) => !surviving.some((saved) => saved.id === indexed.id && !isRsvpSupersededBy(saved, indexed))),
    ];
    const next = new Map(current);
    if (retained.length > 0) next.set(key, retained);
    else next.delete(key);
    this.confirmedMeetingRsvps$.next(next);
  }

  /** Reject responses from ended registrations; missing enrichment does not invalidate a confirmation. */
  public isMeetingRsvpCurrent(rsvp: MeetingRsvp, meeting: Meeting, subject = this.user()?.sub || this.viewerUsername() || this.user()?.email || ''): boolean {
    const key = `${subject}\0${meeting.id}`;
    if (this.endedMeetingRegistrantIds().get(key)?.has(rsvp.registrant_id)) return false;
    if (meeting.my_registrant_ids === undefined || meeting.my_registrant_ids.includes(rsvp.registrant_id)) return true;
    // A successful write can precede this registration's first indexed appearance.
    return (
      !this.indexedMeetingRegistrantIds.get(key)?.has(rsvp.registrant_id) &&
      this.confirmedMeetingRsvps$.value.get(key)?.some((saved) => saved.registrant_id === rsvp.registrant_id) === true
    );
  }

  /**
   * Gets all meetings for the current authenticated user.
   * Returns a shared, cached observable. Call refreshUserMeetings() after
   * mutations to push fresh data to subscribers, or pass false outside the Me
   * lens to invalidate the replay and fetch when a personal consumer returns.
   */
  public getUserMeetings(): Observable<Meeting[]> {
    const subject = this.user()?.sub || this.viewerUsername() || this.user()?.email || '';
    if (this.userMeetingsDirty || (this.userMeetings$ && this.userMeetingsSubject !== subject)) {
      this.userMeetingsDestroy$.next();
      this.userMeetingsDestroy$ = new Subject<void>();
      this.userMeetings$ = null;
      this.userMeetingsDirty = false;
    }
    if (!this.userMeetings$) {
      // Capture the current destroy$ at build time — when the user changes, we swap the field
      // to a new Subject after firing .next() on this one, so the old chain completes cleanly.
      const destroy$ = this.userMeetingsDestroy$;
      this.userMeetingsSubject = subject;
      this.userMeetings$ = combineLatest([
        this.userMeetingsRefresh$.pipe(
          startWith(undefined),
          switchMap(() => this.http.get<Meeting[]>('/api/user/meetings').pipe(tap((meetings) => this.reconcileMeetingRegistrations(meetings, subject))))
        ),
        this.confirmedMeetingRsvps$,
      ]).pipe(
        map(([meetings, confirmed]) => this.applyConfirmedMeetingRsvps(meetings, subject, confirmed)),
        takeUntil(destroy$),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.userMeetings$;
  }

  /**
   * Gets past meetings for the current authenticated user.
   * Call refreshUserPastMeetings() to re-fetch.
   */
  public getUserPastMeetings(): Observable<PastMeeting[]> {
    if (!this.userPastMeetings$) {
      const destroy$ = this.userPastMeetingsDestroy$;
      this.userPastMeetings$ = this.userPastMeetingsRefresh$.pipe(
        startWith(undefined),
        switchMap(() => this.http.get<PastMeeting[]>('/api/user/past-meetings')),
        takeUntil(destroy$),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.userPastMeetings$;
  }

  /**
   * Gets up to 5 of the user's most recent past meetings via the fast-path endpoint.
   * The backend uses `sort=name_desc` and over-fetches (page_size=10) so it can drop ongoing
   * meetings from the top of the sort and still return up to 5 truly-past rows in a single
   * request. Returns an empty array when the user has no truly past meetings, or fewer than 5
   * rows when many concurrently-ongoing meetings sit at the head of the sort.
   */
  public getUserLatestPastMeetings(): Observable<PastMeeting[]> {
    if (!this.userLatestPastMeetings$) {
      const destroy$ = this.userLatestPastMeetingsDestroy$;
      // Shares `userPastMeetingsRefresh$` with `getUserPastMeetings()` on purpose — the two
      // caches represent different slices of the same underlying data, so `refreshUserPastMeetings()`
      // invalidates both together and they re-fetch in lockstep.
      this.userLatestPastMeetings$ = this.userPastMeetingsRefresh$.pipe(
        startWith(undefined),
        switchMap(() => this.http.get<PastMeeting[]>('/api/user/latest-past-meetings')),
        takeUntil(destroy$),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.userLatestPastMeetings$;
  }

  /**
   * Re-fetch the user's upcoming meetings, or invalidate them for the next personal consumer.
   */
  public refreshUserMeetings(fetchImmediately = true): void {
    if (!fetchImmediately) {
      this.userMeetingsDirty = true;
      return;
    }
    this.userMeetingsDirty = false;
    this.userMeetingsRefresh$.next();
  }

  /**
   * Re-fetch the user's past meetings. All current subscribers receive the new data.
   */
  public refreshUserPastMeetings(): void {
    this.userPastMeetingsRefresh$.next();
  }

  /**
   * Signal that the user's connected identities changed (link / verify / add / remove). Consumers
   * subscribed to {@link identitiesRefresh$} re-fetch, keeping the profile shell and the Identities
   * tab in sync (LFXV2-2767).
   */
  public refreshUserIdentities(): void {
    this.userIdentitiesRefresh$.next();
  }

  /**
   * Get user's work experience
   */
  public getWorkExperience(): Observable<WorkExperience[]> {
    return this.http.get<WorkExperience[]>('/api/profile/work-experience').pipe(catchError(() => of([])));
  }

  /**
   * Get user's work experiences from CDP
   */
  public getWorkExperiences(): Observable<WorkExperienceEntry[]> {
    return this.http.get<WorkExperienceEntry[]>('/api/profile/work-experiences').pipe(
      catchError(() => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load work experiences.' });
        return of([]);
      })
    );
  }

  /**
   * Get user's CDP project affiliations (projects with org affiliations and roles)
   */
  public getCdpProjectAffiliations(): Observable<CdpProjectAffiliation[]> {
    return this.http.get<CdpProjectAffiliation[]>('/api/profile/project-affiliations').pipe(
      catchError(() => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load project affiliations.' });
        return of([]);
      })
    );
  }

  /**
   * Check if the user has a valid Flow C management token for Auth0 identity operations
   */
  public getProfileAuthStatus(): Observable<ProfileAuthStatus> {
    return this.http.get<ProfileAuthStatus>('/api/profile/auth/status').pipe(catchError(() => of({ authorized: false, configured: false })));
  }

  /**
   * Get user's enriched identities (CDP cross-referenced with Auth0)
   */
  public getIdentities(): Observable<EnrichedIdentity[]> {
    return this.http.get<EnrichedIdentity[]>('/api/profile/identities');
  }

  /**
   * Reject an identity (mark as "not me") via CDP, and unlink from Auth0 if provider/auth0UserId provided.
   * Pass `email` when removing an email identity — the server uses it to block removal of the
   * address currently pinned as the meeting-invitation email (the client-side guard is UX only).
   */
  public rejectIdentity(identityId: string, provider?: string, auth0UserId?: string, email?: string): Observable<{ success: boolean }> {
    const body: Record<string, string> = {};
    if (provider) {
      body['provider'] = provider;
    }
    if (auth0UserId) {
      body['auth0UserId'] = auth0UserId;
    }
    if (email) {
      body['email'] = email;
    }
    // Auth0 identity IDs contain URL-reserved characters (e.g. `|` in `auth0|abc123`);
    // encode before interpolating so the PATCH route resolves reliably.
    return this.http.patch<{ success: boolean }>(`/api/profile/identities/${encodeURIComponent(identityId)}`, body);
  }

  /**
   * Delete a work experience via CDP
   */
  public deleteWorkExperience(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`/api/profile/work-experiences/${id}`);
  }

  /**
   * Update an existing work experience via CDP
   */
  public updateWorkExperience(id: string, body: WorkExperienceCreateUpdateBody): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(`/api/profile/work-experiences/${id}`, body);
  }

  /**
   * Create a new work experience via CDP
   */
  public createWorkExperience(body: WorkExperienceCreateUpdateBody): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>('/api/profile/work-experiences', body);
  }

  /**
   * PATCH a project's affiliations via CDP
   */
  public patchProjectAffiliation(projectId: string, body: ProjectAffiliationPatchBody): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`/api/profile/project-affiliations/${projectId}`, body);
  }

  /**
   * Send email verification code for identity linking
   */
  public sendEmailVerificationCode(email: string): Observable<SendEmailVerificationResponse> {
    return this.http.post<SendEmailVerificationResponse>('/api/profile/identities/email/send-code', { email }).pipe(take(1));
  }

  /**
   * Verify email OTP and link identity
   */
  public verifyAndLinkEmail(email: string, otp: string): Observable<VerifyAndLinkEmailResponse> {
    return this.http.post<VerifyAndLinkEmailResponse>('/api/profile/identities/email/verify', { email, otp }).pipe(take(1));
  }

  /**
   * Fetches the current user's API Gateway profile (includes Salesforce ID).
   */
  public getSalesforceId(): Observable<SalesforceIdResponse> {
    return this.http.get<SalesforceIdResponse>('/api/user/salesforce-id').pipe(take(1));
  }

  private applyConfirmedMeetingRsvps(meetings: Meeting[], subject: string, saved: Map<string, MeetingRsvp[]>): Meeting[] {
    if (saved.size === 0 && this.endedMeetingRegistrantIds().size === 0 && meetings.every((meeting) => meeting.my_registrant_ids === undefined))
      return meetings;
    return meetings.map((meeting) => {
      const confirmed = saved.get(`${subject}\0${meeting.id}`) ?? [];
      const candidates = (meeting.my_rsvp ? [...confirmed, meeting.my_rsvp] : confirmed).filter((rsvp) => this.isMeetingRsvpCurrent(rsvp, meeting, subject));
      const occurrenceId = resolveRsvpOccurrenceId(meeting);
      const applicable = meeting.recurrence && !occurrenceId ? candidates.filter((rsvp) => rsvp.scope === 'all') : candidates;
      const myRsvp =
        selectApplicableRsvp(occurrenceId, applicable) ?? selectApplicableRsvp(undefined, applicable) ?? (meeting.my_rsvp === undefined ? undefined : null);
      return myRsvp === meeting.my_rsvp ? meeting : { ...meeting, my_rsvp: myRsvp };
    });
  }

  private reconcileMeetingRegistrations(meetings: Meeting[], subject: string): void {
    const current = this.confirmedMeetingRsvps$.value;
    let next: Map<string, MeetingRsvp[]> | undefined;
    for (const meeting of meetings) {
      const registrantIds = meeting.my_registrant_ids;
      if (registrantIds === undefined) continue;
      const key = `${subject}\0${meeting.id}`;
      if (registrantIds.length > 0) {
        let indexedIds = this.indexedMeetingRegistrantIds.get(key);
        if (!indexedIds) {
          indexedIds = new Set<string>();
          this.indexedMeetingRegistrantIds.set(key, indexedIds);
        }
        for (const id of registrantIds) indexedIds.add(id);
      }
      const confirmed = current.get(key) ?? [];
      const candidates = meeting.my_rsvp ? [...confirmed, meeting.my_rsvp] : confirmed;
      const endedIds = candidates.filter((rsvp) => !this.isMeetingRsvpCurrent(rsvp, meeting, subject)).map((rsvp) => rsvp.registrant_id);
      if (endedIds.length > 0) this.endMeetingRegistrants(key, endedIds);
      // A newer indexed answer from an indexed registration retires the retained answers it covers,
      // so a later enrichment outage (`my_rsvp: undefined`) cannot resurface them.
      const indexed = meeting.my_rsvp && registrantIds.includes(meeting.my_rsvp.registrant_id) ? meeting.my_rsvp : null;
      const retained = confirmed.filter((rsvp) => !endedIds.includes(rsvp.registrant_id) && !(indexed && isRsvpSupersededBy(rsvp, indexed)));
      if (retained.length === confirmed.length) continue;
      next ??= new Map(current);
      if (retained.length > 0) next.set(key, retained);
      else next.delete(key);
    }
    if (next) this.confirmedMeetingRsvps$.next(next);
  }

  private endMeetingRegistrants(key: string, registrantIds: string[]): void {
    if (registrantIds.length === 0 || registrantIds.every((id) => this.endedMeetingRegistrantIds().get(key)?.has(id))) return;
    this.endedMeetingRegistrantIds.update((current) => {
      const next = new Map(current);
      next.set(key, new Set([...(current.get(key) ?? []), ...registrantIds]));
      return next;
    });
  }

  private initViewerUsername(): Signal<string | null> {
    return computed(() => {
      const user = this.user();
      // Meeting owner/creator records use the canonical LFID; keep the alias-only fallback for
      // sessions without the namespaced claim.
      return user?.['https://sso.linuxfoundation.org/claims/username'] || user?.username || null;
    });
  }

  private initUserInitials(): Signal<string> {
    return computed(() => {
      const name = this.user()?.name ?? '';
      const parts = name.trim().split(/\s+/);
      if (parts.length === 0 || !parts[0]) {
        return '';
      }
      const first = parts[0][0] ?? '';
      const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
      return (first + last).toUpperCase();
    });
  }
}
