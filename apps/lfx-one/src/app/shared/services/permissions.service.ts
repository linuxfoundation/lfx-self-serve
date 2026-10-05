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

  // Update user role in project — identifier may be a username or email address.
  // `duplicateIdentifiers` is set when this row was collapsed from two or more backend
  // entries whose own identifiers differ (#3218/#3245/#3244) — those entries no longer
  // match the new role, so the backend clears them in the same ETag-guarded write instead
  // of a second client-issued call, which was non-atomic and could misresolve a stale
  // identifier (Copilot + Cursor Bugbot #3244 review, GH-3276).
  public updateUserRole(project: string, identifier: string, request: UpdateUserRoleRequest, duplicateIdentifiers?: string[]): Observable<void> {
    return this.http.put<void>(`/api/projects/${project}/permissions/${encodeURIComponent(identifier)}`, { ...request, duplicateIdentifiers });
  }

  // Remove user from project — identifier may be a username or email address.
  // `duplicateIdentifiers` clears the other backend entries too, in the same request, so a
  // collapsed dual-role user (#3218) doesn't reappear with a stale role after a refresh
  // (#3245/#3244/GH-3276).
  public removeUserFromProject(project: string, identifier: string, duplicateIdentifiers?: string[]): Observable<void> {
    return this.http.delete<void>(`/api/projects/${project}/permissions/${encodeURIComponent(identifier)}`, { body: { duplicateIdentifiers } });
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
  // e.g. one has a real username and the other only an email — every leftover identifier is
  // carried as `duplicateIdentifiers` so the backend can also clear them on remove/role-change,
  // in the same request, instead of them silently surviving and reappearing after a refresh
  // (#3245/#3244/GH-3276). A group of 3+ entries (dealako #3244 review) is fully covered: every
  // non-matching entry's identifier is collected, not just the first one found.
  private mergeGroup(group: ProjectPermissionUser[]): ProjectPermissionUser {
    if (group.length === 1) return group[0];

    const hasRealUsername = (user: ProjectPermissionUser): boolean => !!user.username && user.username !== user.email;
    // The raw identifier is what's actually sent to the backend as a `duplicateIdentifiers`
    // entry, so it must keep its original case — the backend's username match is
    // case-sensitive, and lowercasing it here caused a correctly-cased username to silently
    // fail to match on cleanup (@dealako #3244 review). `normalizedIdentifier` is only for
    // deciding whether two entries are the same backend record: email compares
    // case-insensitively (the backend lowercases it too), username does not.
    const ownIdentifier = (user: ProjectPermissionUser): string => (hasRealUsername(user) ? user.username! : user.email);
    const normalizedIdentifier = (user: ProjectPermissionUser): string => (hasRealUsername(user) ? user.username! : user.email.toLowerCase());

    const winner = group.reduce((best, user) => (best.role === 'view' && user.role === 'manage' ? user : best));
    const withRealUsername = group.find(hasRealUsername);
    const merged: ProjectPermissionUser = !hasRealUsername(winner) && withRealUsername ? { ...winner, username: withRealUsername.username } : { ...winner };

    const mergedId = normalizedIdentifier(merged);
    const duplicates = group.filter((user) => normalizedIdentifier(user) !== mergedId).map(ownIdentifier);

    return duplicates.length > 0 ? { ...merged, duplicateIdentifiers: duplicates } : merged;
  }
}
