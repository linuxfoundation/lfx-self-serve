// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { UpdateUserPermissionRequest, UserPermissionSummary } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PermissionsService {
  private readonly http = inject(HttpClient);

  // Fetch all user permissions for a project
  public getProjectPermissions(project: string): Observable<UserPermissionSummary[]> {
    return this.http.get<UserPermissionSummary[]>(`/api/projects/${project}/permissions`);
  }

  // Update user permissions
  public updateUserPermissions(project: string, userId: string, permissions: Omit<UpdateUserPermissionRequest, 'user_id' | 'project_uid'>): Observable<void> {
    return this.http.put<void>(`/api/projects/${project}/permissions/${userId}`, permissions);
  }

  // Remove all permissions for a user
  public removeUserPermissions(project: string, userId: string): Observable<void> {
    return this.http.delete<void>(`/api/projects/${project}/permissions/${userId}`);
  }
}
