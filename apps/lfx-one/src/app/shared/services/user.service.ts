// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import {
  AddEmailRequest,
  ChangePasswordRequest,
  CombinedProfile,
  CreateUserPermissionRequest,
  EmailManagementData,
  EmailPreferences,
  TwoFactorSettings,
  UpdateEmailPreferencesRequest,
  UpdateProfileDetailsRequest,
  UpdateUserProfileRequest,
  User,
  UserEmail,
} from '@lfx-one/shared/interfaces';
import { Observable, take } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private readonly http = inject(HttpClient);

  public authenticated: WritableSignal<boolean> = signal<boolean>(false);
  public user: WritableSignal<User | null> = signal<User | null>(null);

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
   * Update user info fields (first_name, last_name, username)
   */
  public updateUserInfo(data: UpdateUserProfileRequest): Observable<User> {
    return this.http.patch<User>('/api/profile/user', data).pipe(take(1));
  }

  /**
   * Update profile details fields (title, organization, location, etc.)
   */
  public updateProfileDetails(data: UpdateProfileDetailsRequest): Observable<any> {
    return this.http.patch('/api/profile/details', data).pipe(take(1));
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
}
