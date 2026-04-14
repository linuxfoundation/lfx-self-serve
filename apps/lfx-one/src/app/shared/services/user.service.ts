// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { MessageService } from 'primeng/api';
import {
  AddEmailRequest,
  CdpProjectAffiliation,
  ChangePasswordRequest,
  ProjectAffiliationPatchBody,
  CombinedProfile,
  CreateUserPermissionRequest,
  EmailManagementData,
  EmailPreferences,
  EnrichedIdentity,
  Meeting,
  PastMeeting,
  ProfileAuthStatus,
  ProfileUpdateRequest,
  SendEmailVerificationResponse,
  TwoFactorSettings,
  UpdateEmailPreferencesRequest,
  User,
  UserEmail,
  VerifyAndLinkEmailResponse,
  WorkExperience,
  WorkExperienceCreateUpdateBody,
  WorkExperienceEntry,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly messageService = inject(MessageService);

  public authenticated: WritableSignal<boolean> = signal<boolean>(false);
  public user: WritableSignal<User | null> = signal<User | null>(null);
  public readonly userInitials: Signal<string> = this.initUserInitials();

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
   * Get current user's email management data (emails + preferences)
   */
  public getUserEmails(): Observable<EmailManagementData> {
    return this.http.get<EmailManagementData>('/api/profile/emails');
  }

  /**
   * Add a new email address for the current user
   */
  public addEmail(email: string): Observable<UserEmail> {
    const data: AddEmailRequest = { email };
    return this.http.post<UserEmail>('/api/profile/emails', data).pipe(take(1));
  }

  /**
   * Delete an email address
   */
  public deleteEmail(emailId: string): Observable<void> {
    return this.http.delete<void>(`/api/profile/emails/${emailId}`).pipe(take(1));
  }

  /**
   * Set an email as the primary email
   */
  public setPrimaryEmail(emailId: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`/api/profile/emails/${emailId}/primary`, {}).pipe(take(1));
  }

  /**
   * Get email preferences
   */
  public getEmailPreferences(): Observable<EmailPreferences | null> {
    return this.http.get<EmailPreferences | null>('/api/profile/email-preferences').pipe(take(1));
  }

  /**
   * Update email preferences
   */
  public updateEmailPreferences(preferences: UpdateEmailPreferencesRequest): Observable<EmailPreferences> {
    return this.http.put<EmailPreferences>('/api/profile/email-preferences', preferences).pipe(take(1));
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
   * Get two-factor authentication settings
   */
  public getTwoFactorSettings(): Observable<TwoFactorSettings> {
    return this.http.get<TwoFactorSettings>('/api/profile/2fa-settings').pipe(take(1));
  }

  /**
   * Get developer token information
   */
  public getDeveloperTokenInfo(): Observable<{ token: string; type: string }> {
    return this.http.get<{ token: string; type: string }>('/api/profile/developer').pipe(take(1));
  }

  /**
   * Gets all meetings for the current authenticated user
   * Returns meetings the user is registered for across all projects
   * @param limit - Optional limit on number of meetings to return
   */
  public getUserMeetings(limit?: number, projectUid?: string, foundationUid?: string): Observable<Meeting[]> {
    const params: Record<string, string> = {};
    if (limit !== undefined) {
      params['limit'] = limit.toString();
    }
    if (projectUid) {
      params['projectUid'] = projectUid;
    }
    if (foundationUid) {
      params['foundation_uid'] = foundationUid;
    }
    return this.http.get<Meeting[]>('/api/user/meetings', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load user meetings:', error);
        return of([]);
      })
    );
  }

  /**
   * Gets past meetings for the current authenticated user
   * @param limit - Optional limit on number of past meetings to return
   */
  public getUserPastMeetings(limit?: number, projectUid?: string, foundationUid?: string): Observable<PastMeeting[]> {
    const params: Record<string, string> = {};
    if (limit !== undefined) {
      params['limit'] = limit.toString();
    }
    if (projectUid) {
      params['projectUid'] = projectUid;
    }
    if (foundationUid) {
      params['foundation_uid'] = foundationUid;
    }
    return this.http.get<PastMeeting[]>('/api/user/past-meetings', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load user past meetings:', error);
        return of([]);
      })
    );
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
    return this.http.get<EnrichedIdentity[]>('/api/profile/identities').pipe(
      catchError(() => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load identities.' });
        return of([] as EnrichedIdentity[]);
      })
    );
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
    return this.http.patch<{ success: boolean }>(`/api/profile/identities/${identityId}`, body);
  }

  /**
   * Confirm a work experience (mark as verified) via CDP
   */
  public confirmWorkExperience(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`/api/profile/work-experiences/${id}`, {});
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
