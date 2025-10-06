// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AddUserToProjectRequest, ProjectPermissionUser, ProjectSettings, UpdateUserRoleRequest } from '@lfx-one/shared/interfaces';
import { map, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PermissionsService {
  private readonly http = inject(HttpClient);

  // Add user to project with specified role
  public addUserToProject(project: string, request: AddUserToProjectRequest): Observable<void> {
    return this.http.post<void>(`/api/projects/${project}/permissions`, request);
  }

  // Update user role in project
  public updateUserRole(project: string, username: string, request: UpdateUserRoleRequest): Observable<void> {
    return this.http.put<void>(`/api/projects/${project}/permissions/${username}`, request);
  }

  // Remove user from project (removes from both writers and auditors)
  public removeUserFromProject(project: string, username: string): Observable<void> {
    return this.http.delete<void>(`/api/projects/${project}/permissions/${username}`);
  }

  // Fetch all user permissions for a project and transform to display format
  public getProjectPermissions(project: string): Observable<ProjectPermissionUser[]> {
    return this.http.get<ProjectSettings>(`/api/projects/${project}/permissions`).pipe(
      map((settings: ProjectSettings) => {
        const users: ProjectPermissionUser[] = [];

        // Add auditors (view permissions)
        if (settings.auditors) {
          users.push(
            ...settings.auditors.map((userInfo) => ({
              name: userInfo.name,
              email: userInfo.email,
              username: userInfo.username,
              avatar: userInfo.avatar,
              role: 'view' as const,
            }))
          );
        }

        // Add writers (manage permissions)
        if (settings.writers) {
          users.push(
            ...settings.writers.map((userInfo) => ({
              name: userInfo.name,
              email: userInfo.email,
              username: userInfo.username,
              avatar: userInfo.avatar,
              role: 'manage' as const,
            }))
          );
        }

        return users.sort((a, b) => a.username.localeCompare(b.username));
      })
    );
  }
}
