// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AddUserToProjectRequest, ProjectPermissionUser, ProjectSettings, UpdateUserRoleRequest } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, shareReplay, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PermissionsService {
  private readonly http = inject(HttpClient);
  // Per-UID cache so repeat mounts of the staff card don't re-hit the endpoint. Mirrors the
  // getProject / getProjects pattern in ProjectService. On error the cache entry is evicted so
  // the next subscription retries with a fresh request instead of replaying the stuck error.
  private readonly projectSettingsCache = new Map<string, Observable<ProjectSettings>>();

  // Add user to project with specified role
  public addUserToProject(project: string, request: AddUserToProjectRequest): Observable<void> {
    return this.http.post<void>(`/api/projects/${project}/permissions`, request);
  }

  // Update user role in project — identifier may be a username or email address
  public updateUserRole(project: string, identifier: string, request: UpdateUserRoleRequest): Observable<void> {
    return this.http.put<void>(`/api/projects/${project}/permissions/${encodeURIComponent(identifier)}`, request);
  }

  // Remove user from project — identifier may be a username or email address
  public removeUserFromProject(project: string, identifier: string): Observable<void> {
    return this.http.delete<void>(`/api/projects/${project}/permissions/${encodeURIComponent(identifier)}`);
  }

  // Evict the cached settings for a project so the next getProjectSettings call re-fetches.
  // Call this after any mutation (add, update, remove) to ensure the table reflects the latest state.
  public invalidateProjectSettings(uid: string): void {
    this.projectSettingsCache.delete(uid);
  }

  // Fetch the raw project settings document. Errors are NOT swallowed — callers track their own
  // loading/error state so they can distinguish "fetch failed" from "settings loaded with no staff".
  // The cache entry is evicted on error so a transient failure (network blip, 5xx) doesn't poison
  // the cache and block retries for other consumers (e.g., getProjectPermissions below) on the same UID.
  public getProjectSettings(uid: string): Observable<ProjectSettings> {
    if (!this.projectSettingsCache.has(uid)) {
      const settings$ = this.http.get<ProjectSettings>(`/api/projects/${uid}/permissions`).pipe(
        catchError((error) => {
          this.projectSettingsCache.delete(uid);
          return throwError(() => error);
        }),
        shareReplay(1)
      );
      this.projectSettingsCache.set(uid, settings$);
    }
    return this.projectSettingsCache.get(uid)!;
  }

  // Fetch all user permissions for a project and transform to display format
  public getProjectPermissions(project: string): Observable<ProjectPermissionUser[]> {
    return this.getProjectSettings(project).pipe(
      map((settings: ProjectSettings) => {
        const users: ProjectPermissionUser[] = [];

        // Add auditors (view permissions)
        if (settings.auditors) {
          users.push(
            ...settings.auditors.map((userInfo) => ({
              name: userInfo.name,
              email: userInfo.email,
              // Normalize: callers use username as the URL identifier; fall back to email
              // so no-username users can still be edited/removed without empty path segments.
              username: userInfo.username || userInfo.email,
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
              username: userInfo.username || userInfo.email,
              avatar: userInfo.avatar,
              role: 'manage' as const,
            }))
          );
        }

        return users.sort((a, b) => {
          const aKey = (a.username || a.email || '').toLowerCase();
          const bKey = (b.username || b.email || '').toLowerCase();
          return aKey.localeCompare(bKey);
        });
      })
    );
  }
}
