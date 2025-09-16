// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { CombinedProfile, CreateUserPermissionRequest, UpdateProfileDetailsRequest, UpdateUserProfileRequest, User } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

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
    return this.http.patch<User>('/api/profile/user', data);
  }

  /**
   * Update profile details fields (title, organization, location, etc.)
   */
  public updateProfileDetails(data: UpdateProfileDetailsRequest): Observable<any> {
    return this.http.patch('/api/profile/details', data);
  }
}
