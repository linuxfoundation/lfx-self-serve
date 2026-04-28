// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MessageService } from 'primeng/api';
import {
  CdpProjectAffiliation,
  ChangePasswordRequest,
  ProjectAffiliationPatchBody,
  CombinedProfile,
  CreateUserPermissionRequest,
  EmailManagementData,
  EnrichedIdentity,
  Impersonator,
  Meeting,
  PastMeeting,
  ProfileAuthStatus,
  ProfileUpdateRequest,
  SalesforceIdResponse,
  SendEmailVerificationResponse,
  User,
  VerifyAndLinkEmailResponse,
  WorkExperience,
  WorkExperienceCreateUpdateBody,
  WorkExperienceEntry,
} from '@lfx-one/shared/interfaces';
import { catchError, distinctUntilChanged, map, Observable, of, shareReplay, skip, startWith, Subject, switchMap, take, takeUntil } from 'rxjs';

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
  /** Cached Salesforce user ID from the API Gateway — null until first fetch */
  public readonly apiGatewayUserId = signal<string | null>(null);

  private readonly userMeetingsRefresh$ = new Subject<void>();
  private readonly userPastMeetingsRefresh$ = new Subject<void>();
  // Per-chain destroy signals so that on user change we can tear down the old shareReplay
  // chain (which stays alive under refCount:false) instead of leaking abandoned subscriptions
  // to the refresh subjects. A fresh Subject is created for each new chain.
  private userMeetingsDestroy$ = new Subject<void>();
  private userPastMeetingsDestroy$ = new Subject<void>();
  private userLatestPastMeetingsDestroy$ = new Subject<void>();
  private userMeetings$: Observable<Meeting[]> | null = null;
  private userPastMeetings$: Observable<PastMeeting[]> | null = null;
  private userLatestPastMeetings$: Observable<PastMeeting[]> | null = null;

  public constructor() {
    // Invalidate cached user-scoped observables when the authenticated user or
    // impersonation changes, so existing subscribers don't see stale data from
    // the previous user. Keyed on username (covers both login/logout and
    // impersonation start/stop). Skip the initial emission since the caches
    // are lazy-initialized and haven't been populated yet.
    toObservable(this.user)
      .pipe(
        map((u) => u?.username ?? null),
        distinctUntilChanged(),
        skip(1),
        takeUntilDestroyed()
      )
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
        this.userPastMeetings$ = null;
        this.userLatestPastMeetings$ = null;
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
  public getDeveloperTokenInfo(): Observable<{ token: string; type: string }> {
    return this.http.get<{ token: string; type: string }>('/api/profile/developer').pipe(take(1));
  }

  /**
   * Gets all meetings for the current authenticated user.
   * Returns a shared, cached observable. Call refreshUserMeetings() after
   * any mutation that could change the list (e.g. new registration) to
   * push fresh data to all subscribers.
   */
  public getUserMeetings(): Observable<Meeting[]> {
    if (!this.userMeetings$) {
      // Capture the current destroy$ at build time — when the user changes, we swap the field
      // to a new Subject after firing .next() on this one, so the old chain completes cleanly.
      const destroy$ = this.userMeetingsDestroy$;
      this.userMeetings$ = this.userMeetingsRefresh$.pipe(
        startWith(undefined),
        switchMap(() => this.http.get<Meeting[]>('/api/user/meetings')),
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
   * Re-fetch the user's upcoming meetings. All current subscribers receive the new data.
   */
  public refreshUserMeetings(): void {
    this.userMeetingsRefresh$.next();
  }

  /**
   * Re-fetch the user's past meetings. All current subscribers receive the new data.
   */
  public refreshUserPastMeetings(): void {
    this.userPastMeetingsRefresh$.next();
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
   * Reject an identity (mark as "not me") via CDP, and unlink from Auth0 if provider/auth0UserId provided
   */
  public rejectIdentity(identityId: string, provider?: string, auth0UserId?: string): Observable<{ success: boolean }> {
    const body: Record<string, string> = {};
    if (provider) {
      body['provider'] = provider;
    }
    if (auth0UserId) {
      body['auth0UserId'] = auth0UserId;
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
