// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AddUserToProjectRequest, ProjectPermissionUser, ProjectSettings, UpdateProjectStaffRequest, UpdateUserRoleRequest } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { catchError, map, Observable, of, shareReplay, switchMap, throwError } from 'rxjs';

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

  // Update user role in project — identifier may be a username or email address.
  // `duplicateIdentifier` is set when this row was collapsed from two backend entries whose
  // own identifiers differ (#3218/#3245/#3244) — the other entry no longer matches the new
  // role, so it's deleted (tolerating a 404 if it's already gone) to avoid leaving a stray
  // duplicate at the old role.
  public updateUserRole(project: string, identifier: string, request: UpdateUserRoleRequest, duplicateIdentifier?: string): Observable<void> {
    return this.http
      .put<void>(`/api/projects/${project}/permissions/${encodeURIComponent(identifier)}`, request)
      .pipe(switchMap(() => (duplicateIdentifier ? this.deleteTolerant404(project, duplicateIdentifier) : of(undefined))));
  }

  // Remove user from project — identifier may be a username or email address.
  // `duplicateIdentifier` clears the other backend entry too, so a collapsed dual-role user
  // (#3218) doesn't reappear with the other role after a refresh (#3245/#3244).
  public removeUserFromProject(project: string, identifier: string, duplicateIdentifier?: string): Observable<void> {
    return this.http
      .delete<void>(`/api/projects/${project}/permissions/${encodeURIComponent(identifier)}`)
      .pipe(switchMap(() => (duplicateIdentifier ? this.deleteTolerant404(project, duplicateIdentifier) : of(undefined))));
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

  // Best-effort cleanup of the other half of a collapsed dual-role entry — a 404 means it was
  // already removed (e.g. a concurrent edit), which is the desired end state, not an error.
  private deleteTolerant404(project: string, identifier: string): Observable<void> {
    return this.http
      .delete<void>(`/api/projects/${project}/permissions/${encodeURIComponent(identifier)}`)
      .pipe(catchError((error: HttpErrorResponse) => (error.status === 404 ? of(undefined) : throwError(() => error))));
  }

  // A v1 permission sync can legitimately leave a user with both auditor (view) and writer
  // (manage) entries for the same project — the backend does not collapse this. Show a single
  // row per user, with 'manage' taking precedence over 'view' (see #3218).
  //
  // Two entries belong to the same person if they share EITHER identifier — email or a real
  // username — not just whichever one a naive `email || username` key happens to pick per
  // entry. Picking only one key misses the pairing when, e.g., one entry carries both email
  // and username and its counterpart shares only the username with no email (PR #3244 review,
  // Copilot). Union-find groups entries transitively by every identifier they carry; a user
  // with neither username nor email can't be identified at all and is left uncollapsed rather
  // than merged with unrelated anonymous users.
  private collapseDuplicateUsers(users: ProjectPermissionUser[]): ProjectPermissionUser[] {
    const parent = new Map<string, string>();

    const find = (key: string): string => {
      let root = key;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let cur = key;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };

    const union = (a: string, b: string): void => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootA, rootB);
    };

    // A real username (distinct from the email fallback applied above) and the email are
    // treated as separate, co-equal identifiers for the same entry — both get unioned together.
    // Email compares case-insensitively (the backend lowercases it too), but username does not:
    // LFID username case-uniqueness isn't guaranteed (see vote-response.helper.ts), so folding
    // case here could wrongly merge two different people's entries into one row (Copilot #3244).
    const identifiersOf = (user: ProjectPermissionUser): string[] => {
      const ids: string[] = [];
      if (user.email) ids.push(`email:${user.email.toLowerCase()}`);
      if (user.username && user.username !== user.email) ids.push(`username:${user.username}`);
      return ids;
    };

    const unidentified: ProjectPermissionUser[] = [];
    const usersWithIds: { user: ProjectPermissionUser; ids: string[] }[] = [];

    for (const user of users) {
      const ids = identifiersOf(user);
      if (ids.length === 0) {
        unidentified.push(user);
        continue;
      }
      for (const id of ids) {
        if (!parent.has(id)) parent.set(id, id);
      }
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
      usersWithIds.push({ user, ids });
    }

    const groups = new Map<string, ProjectPermissionUser[]>();
    for (const { user, ids } of usersWithIds) {
      const root = find(ids[0]);
      const group = groups.get(root);
      if (group) group.push(user);
      else groups.set(root, [user]);
    }

    return [...[...groups.values()].map((group) => this.mergeGroup(group)), ...unidentified];
  }

  // Merges a group of same-person entries into a single display row. The surviving row's
  // `username` is the identifier later sent to updateUserRole / removeUserFromProject, so
  // prefer whichever entry carries a real username over one that only has the email-fallback
  // value (PR #3244 review). When the group's own entries don't all share that identifier —
  // e.g. one has a real username and the other only an email — the leftover identifier is
  // carried as `duplicateIdentifier` so the UI can also clear that entry on remove/role-change
  // (#3245/#3244), instead of it silently surviving and reappearing after a refresh.
  private mergeGroup(group: ProjectPermissionUser[]): ProjectPermissionUser {
    if (group.length === 1) return group[0];

    const hasRealUsername = (user: ProjectPermissionUser): boolean => !!user.username && user.username !== user.email;
    // The raw identifier is what's actually sent to the backend as a `duplicateIdentifier`, so it
    // must keep its original case — the backend's username match is case-sensitive, and lowercasing
    // it here caused a correctly-cased username to silently fail to match on cleanup (@dealako
    // #3244 review). `normalizedIdentifier` is only for deciding whether two entries are the same
    // backend record: email compares case-insensitively (the backend lowercases it too), username
    // does not.
    const ownIdentifier = (user: ProjectPermissionUser): string => (hasRealUsername(user) ? user.username! : user.email);
    const normalizedIdentifier = (user: ProjectPermissionUser): string => (hasRealUsername(user) ? user.username! : user.email.toLowerCase());

    const winner = group.reduce((best, user) => (best.role === 'view' && user.role === 'manage' ? user : best));
    const withRealUsername = group.find(hasRealUsername);
    const merged: ProjectPermissionUser = !hasRealUsername(winner) && withRealUsername ? { ...winner, username: withRealUsername.username } : { ...winner };

    const mergedId = normalizedIdentifier(merged);
    const duplicate = group.find((user) => normalizedIdentifier(user) !== mergedId);

    return duplicate ? { ...merged, duplicateIdentifier: ownIdentifier(duplicate) } : merged;
  }
}
