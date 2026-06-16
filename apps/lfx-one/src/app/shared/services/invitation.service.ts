// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { PendingInvitation, AcceptCommitteeInviteRequest, CommitteeOrganizationReference } from '@lfx-one/shared/interfaces';
import { catchError, finalize, Observable, of, shareReplay, tap } from 'rxjs';

/**
 * Shared client for the current user's pending committee invitations.
 *
 * Holds a single source-of-truth signal so both surfaces that show invitations — the dashboard
 * pending-actions list and My Groups — stay in sync. Accept/decline optimistically remove a row
 * from the signal (both surfaces react instantly); `unmarkResolved` supports undo / failure
 * rollback, and `forgetResolved` drops the undo stash on terminal success.
 */
@Injectable({
  providedIn: 'root',
})
export class InvitationService {
  /** Shared cache of the user's pending invitations; both surfaces bind to this. */
  public pendingInvitations: WritableSignal<PendingInvitation[]> = signal<PendingInvitation[]>([]);

  /**
   * Invite UIDs the user has accepted/declined this session. The cross-surface sync primitive:
   * the dashboard sources its invitation rows from the `/api/user/pending-actions` aggregator (a
   * separate fetch from {@link pendingInvitations}), so removing from the cache alone wouldn't hide
   * a dashboard row. Both surfaces additionally filter out any invite whose UID is in this set, so
   * resolving an invite in one surface hides it in the other regardless of which fetch sourced it.
   * Undo clears the UID again (`unmarkResolved`), re-surfacing the row in both places.
   */
  public resolvedInviteUids: WritableSignal<Set<string>> = signal<Set<string>>(new Set());

  private readonly http = inject(HttpClient);

  /**
   * Stash of invitations removed by {@link markResolved}, keyed by UID, so undo can restore the
   * full object from a UID alone. The dashboard holds only a `PendingActionItem` (UID + committee
   * UID), not the full `PendingInvitation`, so uid-keyed restore lets either surface undo.
   */
  private readonly resolvedStash = new Map<string, PendingInvitation>();

  /** In-flight load shared across concurrent callers (dashboard Me-lens + group-page) to dedupe the GET. */
  private inFlightLoad: Observable<PendingInvitation[]> | null = null;

  /**
   * Loads the user's pending invitations and tees the result into {@link pendingInvitations}.
   * Degrades to an empty list on error so neither surface breaks. Concurrent callers (the Me-lens
   * dashboard and a direct group navigation can both trigger a load) share one in-flight request.
   */
  public loadPendingInvitations(): Observable<PendingInvitation[]> {
    if (this.inFlightLoad) {
      return this.inFlightLoad;
    }
    this.inFlightLoad = this.http.get<PendingInvitation[]>('/api/user/pending-invitations').pipe(
      tap((invitations) => this.pendingInvitations.set(invitations)),
      catchError(() => {
        // Clear the cache so a failed refresh can't leave stale invitations rendered on either
        // surface (matches the "degrades to an empty list on error" contract above).
        this.pendingInvitations.set([]);
        return of([] as PendingInvitation[]);
      }),
      finalize(() => {
        this.inFlightLoad = null;
      }),
      shareReplay(1)
    );
    return this.inFlightLoad;
  }

  /** Accepts an invitation. Upstream is invitee-authenticated; returns 204. */
  public acceptInvitation(
    committeeUid: string,
    inviteUid: string,
    organization?: CommitteeOrganizationReference
  ): Observable<void> {
    const body: AcceptCommitteeInviteRequest = organization ? { organization } : {};
    return this.http.post<void>(
      `/api/committees/${encodeURIComponent(committeeUid)}/invites/${encodeURIComponent(inviteUid)}/accept`,
      body
    );
  }

  /** Declines an invitation. Upstream is invitee-authenticated; returns 204. */
  public declineInvitation(committeeUid: string, inviteUid: string): Observable<void> {
    return this.http.post<void>(`/api/committees/${encodeURIComponent(committeeUid)}/invites/${encodeURIComponent(inviteUid)}/decline`, {});
  }

  /**
   * Marks an invite resolved (accepted/declined) — the optimistic primitive both surfaces call.
   * Adds the UID to {@link resolvedInviteUids} (hides it on the dashboard, whose rows come from the
   * aggregator) and removes it from {@link pendingInvitations} (hides it in My Groups). Idempotent.
   */
  public markResolved(inviteUid: string): void {
    const stashable = this.pendingInvitations().find((invitation) => invitation.uid === inviteUid);
    if (stashable) {
      this.resolvedStash.set(inviteUid, stashable);
    }
    this.resolvedInviteUids.update((resolved) => {
      if (resolved.has(inviteUid)) {
        return resolved;
      }
      const next = new Set(resolved);
      next.add(inviteUid);
      return next;
    });
    this.pendingInvitations.update((invitations) => invitations.filter((invitation) => invitation.uid !== inviteUid));
  }

  /**
   * Reverses {@link markResolved} for undo / failure rollback, by UID alone: clears the resolved
   * UID (re-surfaces the row on the dashboard, whose source still holds it) and restores the stashed
   * invitation to {@link pendingInvitations} (re-surfaces it in My Groups). Restoring is a no-op when
   * nothing was stashed or the entry is already present.
   */
  public unmarkResolved(inviteUid: string): void {
    this.resolvedInviteUids.update((resolved) => {
      if (!resolved.has(inviteUid)) {
        return resolved;
      }
      const next = new Set(resolved);
      next.delete(inviteUid);
      return next;
    });
    const stashed = this.resolvedStash.get(inviteUid);
    if (stashed) {
      this.resolvedStash.delete(inviteUid);
      this.pendingInvitations.update((invitations) => (invitations.some((existing) => existing.uid === stashed.uid) ? invitations : [...invitations, stashed]));
    }
  }

  /**
   * Drops the undo stash entry for an invite whose accept/decline has terminally succeeded (no undo
   * possible anymore), so the stash doesn't accumulate resolved invitations over a long session. The
   * UID stays in {@link resolvedInviteUids}, so the row remains hidden.
   */
  public forgetResolved(inviteUid: string): void {
    this.resolvedStash.delete(inviteUid);
  }
}
