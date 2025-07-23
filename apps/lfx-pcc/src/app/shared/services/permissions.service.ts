// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { UserPermissions } from '@lfx-pcc/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PermissionsService {
  private readonly http = inject(HttpClient);

  // Fetch all user permissions for a project
  public getProjectPermissions(project: string): Observable<UserPermissions[]> {
    return this.http.get<UserPermissions[]>(`/api/projects/${project}/permissions`);
  }

  // Add new user with permissions
  public addUserPermissions(project: string, userPermissions: UserPermissions): Observable<UserPermissions> {
    return this.http.post<UserPermissions>(`/api/projects/${project}/permissions`, userPermissions);
  }

  // Update user permissions
  public updateUserPermissions(project: string, userId: string, permissions: UserPermissions): Observable<UserPermissions> {
    return this.http.put<UserPermissions>(`/api/projects/${project}/permissions/${userId}`, permissions);
  }

  // Remove all permissions for a user
  public removeUserPermissions(project: string, userId: string): Observable<void> {
    return this.http.delete<void>(`/api/projects/${project}/permissions/${userId}`);
  }
}
