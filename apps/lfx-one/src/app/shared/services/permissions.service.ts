// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AddUserToProjectRequest, ProjectPermissionUser, ProjectSettings, UpdateProjectStaffRequest, UpdateUserRoleRequest } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { catchError, map, Observable, shareReplay, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PermissionsService {
  private readonly http = inject(HttpClient);
  private readonly formationService = inject(FormationService);
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

  // Set or clear an editable project staff role (Executive Director / Program Manager).
  // `assignee: null` clears the role; an assignee carrying `name` is a confirmed manual
  // entry, so the BFF skips the directory lookup for it.
  public updateProjectStaff(project: string, request: UpdateProjectStaffRequest): Observable<void> {
    return this.http.put<void>(`/api/projects/${project}/staff`, request);
  }

  // Evict the cached settings for a project so the next getProjectSettings call re-fetches.
  // Call this after any mutation (add, update, remove) to ensure the table reflects the latest state.
  // The formation people list (#2772) is a projection of the same settings document, memoised per
  // slug in FormationService; it is dropped here too, so a permission, staff or invite write made
  // anywhere in the app never leaves the assignee picker offering a removed person or missing an
  // added one.
  public invalidateProjectSettings(uid: string): void {
    this.projectSettingsCache.delete(uid);
    this.formationService.invalidateFormationPeople();
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

        return this.collapseDuplicateUsers(users).sort((a, b) => {
          const aKey = (a.username || a.email || '').toLowerCase();
          const bKey = (b.username || b.email || '').toLowerCase();
          return aKey.localeCompare(bKey);
        });
      })
    );
  }

  // A v1 permission sync can legitimately leave a user with both auditor (view) and writer
  // (manage) entries for the same project — the backend does not collapse this. Show a single
  // row per user, with 'manage' taking precedence over 'view' (see #3218).
  //
  // Key on email first: the auditor and writer arrays are normalized independently above
  // (username falls back to email per-array), so the same person can end up with a real
  // username on one entry and an email-as-username on the other — keying on username first
  // would miss that pairing. A user with neither username nor email can't be identified at
  // all; leave those rows uncollapsed rather than merging unrelated anonymous users together.
  //
  // The surviving row's `username` is the identifier later sent to updateUserRole /
  // removeUserFromProject, so prefer whichever of the two entries carries a real username
  // over one that only has the email-fallback value (PR #3244 review).
  private collapseDuplicateUsers(users: ProjectPermissionUser[]): ProjectPermissionUser[] {
    const byIdentifier = new Map<string, ProjectPermissionUser>();
    const unidentified: ProjectPermissionUser[] = [];

    const hasRealUsername = (user: ProjectPermissionUser): boolean => !!user.username && user.username !== user.email;

    for (const user of users) {
      const identifier = (user.email || user.username || '').toLowerCase();
      if (!identifier) {
        unidentified.push(user);
        continue;
      }
      const existing = byIdentifier.get(identifier);
      if (!existing) {
        byIdentifier.set(identifier, user);
        continue;
      }
      const winner = existing.role === 'view' && user.role === 'manage' ? user : existing;
      const loser = winner === existing ? user : existing;
      byIdentifier.set(identifier, !hasRealUsername(winner) && hasRealUsername(loser) ? { ...winner, username: loser.username } : winner);
    }

    return [...byIdentifier.values(), ...unidentified];
  }
}
