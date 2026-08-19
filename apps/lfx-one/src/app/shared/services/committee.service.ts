// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import {
  ActivityEvent,
  Committee,
  CommitteeDocument,
  CommitteeDocumentType,
  CommitteeEngagementResponse,
  CommitteeEngagementWindow,
  CommitteeInvite,
  CommitteeJoinApplication,
  CommitteeMember,
  CommitteeOrganizationReference,
  CommitteeSettingsData,
  CommitteeUpdateData,
  CommitteeUser,
  CreateCommitteeDocumentRequest,
  CreateCommitteeInviteRequest,
  CreateCommitteeJoinApplicationRequest,
  ApproveCommitteeJoinApplicationRequest,
  RejectCommitteeJoinApplicationRequest,
  CreateCommitteeMemberOptions,
  CreateCommitteeMemberRequest,
  GroupsEngagementStats,
  MyCommittee,
  PaginatedResponse,
  QueryServiceCountResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, take, tap, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CommitteeService {
  public committee: WritableSignal<Committee | null> = signal(null);

  private readonly http = inject(HttpClient);

  public getCommittees(params?: HttpParams): Observable<Committee[]> {
    return this.http.get<Committee[]>('/api/committees', { params }).pipe(catchError(() => of([])));
  }

  /**
   * Groups dashboard engagement rollup (Active Members, Meetings This Month) for the caller's
   * visible set. `active_members` reads live from the LFXV2-1705 dbt model; `meetings_this_month`
   * stays `null` pending a calendar-month data source. Resolves to `null` on error — logged here
   * (the single error-handling site, matching `getMyCommittees` below) — so the caller can degrade
   * gracefully (see `buildEngagementStatCards`) rather than let a failure block the groups list.
   */
  public getGroupsEngagementStats(): Observable<GroupsEngagementStats | null> {
    return this.http.get<GroupsEngagementStats>('/api/committees/engagement-stats').pipe(
      catchError((error: HttpErrorResponse) => {
        // Narrow status/message only — the full HttpErrorResponse can carry response headers/body
        // content, and this reaches Datadog RUM error tracking (dealako review, LFXV2-1705).
        console.error('Failed to load groups engagement stats:', error.status, error.message);
        return of(null);
      })
    );
  }

  /**
   * Per-member meeting-attendance rollup for one committee + window (LFXV2-1705). Resolves to
   * `null` on any error — logged here, the single error-handling site (matching
   * `getGroupsEngagementStats`) — so callers degrade to an "attendance unavailable" state without
   * affecting the roster. A 403 is expected for non-auditor callers (the endpoint is
   * `committee#auditor`-gated, stricter than roster visibility) and degrades the same way.
   */
  public getCommitteeEngagement(committeeUid: string, window: CommitteeEngagementWindow): Observable<CommitteeEngagementResponse | null> {
    const params = new HttpParams().set('window', window);
    return this.http.get<CommitteeEngagementResponse>(`/api/committees/${encodeURIComponent(committeeUid)}/engagement`, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        // 403 is the expected outcome for every non-auditor caller — logging it as an error would
        // spam the console (and Datadog RUM error tracking) once per window switch for most users.
        // Narrow status/message only (not the full HttpErrorResponse) when it does log — the full
        // object can carry response headers/body content (dealako review, LFXV2-1705).
        if (error.status !== 403) {
          console.error('Failed to load committee engagement:', error.status, error.message);
        }
        return of(null);
      })
    );
  }

  public getCommitteesByProject(uid: string): Observable<Committee[]> {
    const params = new HttpParams().set('tags', `project_uid:${uid}`);

    return this.getCommittees(params);
  }

  /**
   * Same request as `getCommitteesByProject`, but propagates HTTP errors instead of
   * swallowing them to `[]`. Use when the caller needs to distinguish a fetch failure
   * from a genuinely empty result.
   */
  public getCommitteesByProjectOrThrow(uid: string): Observable<Committee[]> {
    const params = new HttpParams().set('tags', `project_uid:${uid}`);

    return this.http.get<Committee[]>('/api/committees', { params });
  }

  public getCommitteesCountByProject(uid: string): Observable<number> {
    const params = new HttpParams().set('tags', `project_uid:${uid}`);
    return this.http
      .get<QueryServiceCountResponse>('/api/committees/count', { params })
      .pipe(catchError(() => of({ count: 0 })))
      .pipe(map((response) => response.count));
  }

  public getCommittee(id: string): Observable<Committee> {
    return this.http.get<Committee>(`/api/committees/${id}`).pipe(
      catchError((error) => {
        return throwError(() => error);
      }),
      tap((committee) => this.committee.set(committee ?? null))
    );
  }

  public deleteCommittee(id: string): Observable<void> {
    return this.http.delete<void>(`/api/committees/${id}`).pipe(take(1));
  }

  public createCommittee(committee: Partial<Committee>): Observable<Committee> {
    return this.http.post<Committee>('/api/committees', committee).pipe(take(1));
  }

  // chat_webhook_url lives on CommitteeSettingsData, not CommitteeUpdateData (LFXV2-3094) — this
  // one PUT still accepts it alongside base fields in a single merged payload; the BFF routes it
  // to the settings sub-resource internally (committee.service.ts's updateCommittee).
  public updateCommittee(id: string, committee: CommitteeUpdateData & Pick<CommitteeSettingsData, 'chat_webhook_url'>): Observable<Committee> {
    return this.http.put<Committee>(`/api/committees/${id}`, committee).pipe(take(1));
  }

  /** Updates the writers and auditors permission lists for a committee. */
  public updateCommitteePermissions(committeeId: string, writers: CommitteeUser[], auditors: CommitteeUser[]): Observable<Committee> {
    return this.http.put<Committee>(`/api/committees/${committeeId}`, { writers, auditors }).pipe(take(1));
  }

  /** Fetches a committee by ID without updating shared service state. */
  public fetchCommittee(id: string): Observable<Committee> {
    return this.http.get<Committee>(`/api/committees/${id}`).pipe(take(1));
  }

  // ── Sub-groups (children) ─────────────────────────────────────────────────

  /** Fetches child committees (sub-groups) of a parent committee */
  public getChildCommittees(parentUid: string): Observable<Committee[]> {
    return this.http.get<Committee[]>(`/api/committees/${parentUid}/children`).pipe(catchError(() => of([])));
  }

  // Committee Members methods
  public getCommitteeMembers(committeeId: string, params?: HttpParams): Observable<CommitteeMember[]> {
    return this.http.get<CommitteeMember[]>(`/api/committees/${committeeId}/members`, { params });
  }

  public getCommitteeMember(committeeId: string, memberId: string): Observable<CommitteeMember | null> {
    return this.http.get<CommitteeMember>(`/api/committees/${committeeId}/members/${memberId}`);
  }

  /**
   * Creates a committee member. By default the new member receives a
   * notification email; pass `options.skipNotification` to suppress it
   * (the BFF forwards it upstream as the X-Skip-Notification header).
   */
  public createCommitteeMember(
    committeeId: string,
    memberData: CreateCommitteeMemberRequest,
    options?: CreateCommitteeMemberOptions
  ): Observable<CommitteeMember> {
    const params = options?.skipNotification ? new HttpParams().set('skip_notification', 'true') : undefined;

    return this.http.post<CommitteeMember>(`/api/committees/${committeeId}/members`, memberData, { params }).pipe(take(1));
  }

  public updateCommitteeMember(committeeId: string, memberId: string, memberData: Partial<CreateCommitteeMemberRequest>): Observable<CommitteeMember> {
    return this.http.put<CommitteeMember>(`/api/committees/${committeeId}/members/${memberId}`, memberData).pipe(take(1));
  }

  public deleteCommitteeMember(committeeId: string, memberId: string): Observable<void> {
    return this.http.delete<void>(`/api/committees/${committeeId}/members/${memberId}`).pipe(take(1));
  }

  // ── Committee Invites ───────────────────────────────────────────────────────
  // Invite-by-email add-member: lightweight invites for people who may not yet
  // have an LF account. Pending invites surface in the roster; on accept they
  // become committee members with their LFID reconciled.

  /** Fetches all invites for a committee (caller filters to pending and handles errors). */
  public getCommitteeInvites(committeeId: string, params?: HttpParams): Observable<CommitteeInvite[]> {
    return this.http.get<CommitteeInvite[]>(`/api/committees/${committeeId}/invites`, { params }).pipe(take(1));
  }

  /** Creates a single committee invite. Bulk invite fans this out one call per email. */
  public createCommitteeInvite(committeeId: string, data: CreateCommitteeInviteRequest): Observable<CommitteeInvite> {
    return this.http.post<CommitteeInvite>(`/api/committees/${committeeId}/invites`, data).pipe(take(1));
  }

  /** Revokes a pending committee invite. */
  public revokeCommitteeInvite(committeeId: string, inviteId: string): Observable<void> {
    return this.http.delete<void>(`/api/committees/${committeeId}/invites/${inviteId}`).pipe(take(1));
  }

  // ── Join / Leave Methods ──────────────────────────────────────────────────

  /** Self-join an open group */
  public joinCommittee(committeeId: string, organization?: CommitteeOrganizationReference): Observable<CommitteeMember> {
    const body = organization ? { organization } : {};
    return this.http.post<CommitteeMember>(`/api/committees/${committeeId}/join`, body).pipe(take(1));
  }

  /** Leave a group */
  public leaveCommittee(committeeId: string): Observable<void> {
    return this.http.delete<void>(`/api/committees/${committeeId}/leave`).pipe(take(1));
  }

  /** Submit a join application for a group with join_mode 'application' */
  public submitApplication(committeeId: string, message?: string, organization?: CommitteeOrganizationReference): Observable<CommitteeJoinApplication> {
    const body: CreateCommitteeJoinApplicationRequest = { message: message || '', ...(organization ? { organization } : {}) };
    return this.http.post<CommitteeJoinApplication>(`/api/committees/${committeeId}/applications`, body).pipe(take(1));
  }

  /** Lists join applications for a committee (from query index). */
  public getCommitteeApplications(committeeId: string): Observable<CommitteeJoinApplication[]> {
    return this.http.get<CommitteeJoinApplication[]>(`/api/committees/${committeeId}/applications`).pipe(take(1));
  }

  /** Approves a pending join application and adds the applicant as a member. */
  public approveApplication(committeeId: string, applicationId: string, body?: ApproveCommitteeJoinApplicationRequest): Observable<CommitteeMember> {
    return this.http.post<CommitteeMember>(`/api/committees/${committeeId}/applications/${applicationId}/approve`, { notify: true, ...body }).pipe(take(1));
  }

  /** Rejects a pending join application. */
  public rejectApplication(
    committeeId: string,
    applicationId: string,
    reviewerNotes?: string,
    body?: RejectCommitteeJoinApplicationRequest
  ): Observable<CommitteeJoinApplication> {
    return this.http
      .post<CommitteeJoinApplication>(`/api/committees/${committeeId}/applications/${applicationId}/reject`, {
        notify: true,
        reviewer_notes: reviewerNotes,
        ...body,
      })
      .pipe(take(1));
  }

  // ── Activity Feed (LFXV2-1707) ──────────────────────────────────────────

  /**
   * Server-merged "Recent Activity" feed for the committee Overview widget (past meetings, votes,
   * surveys, documents). Resolves to `[]` on error, matching every other Overview data source on
   * this service — a feed failure must not break the rest of the page.
   */
  public getCommitteeActivity(committeeId: string): Observable<ActivityEvent[]> {
    return this.http.get<PaginatedResponse<ActivityEvent>>(`/api/committees/${encodeURIComponent(committeeId)}/activity`).pipe(
      map((response) => response.data),
      catchError((error: HttpErrorResponse) => {
        console.error('Failed to load committee activity feed:', { status: error.status, message: error.message });
        return of([]);
      })
    );
  }

  // ── Committee Documents ─────────────────────────────────────────────────

  public getCommitteeDocuments(committeeId: string): Observable<CommitteeDocument[]> {
    return this.http.get<CommitteeDocument[]>(`/api/committees/${committeeId}/documents`).pipe(catchError(() => of([])));
  }

  public createCommitteeDocument(committeeId: string, data: CreateCommitteeDocumentRequest): Observable<CommitteeDocument> {
    return this.http.post<CommitteeDocument>(`/api/committees/${committeeId}/documents`, data).pipe(take(1));
  }

  /**
   * Uploads a file document to a committee. Sends the raw file as the request body
   * with metadata as query params. The BFF forwards as multipart/form-data to the
   * upstream committee service.
   */
  public uploadCommitteeDocument(
    committeeId: string,
    file: File,
    metadata: { name: string; description?: string; folder_uid?: string }
  ): Observable<CommitteeDocument> {
    let params = new HttpParams()
      .set('name', metadata.name)
      .set('file_name', file.name)
      .set('content_type', file.type || 'application/octet-stream')
      .set('file_size', file.size.toString());

    if (metadata.description) {
      params = params.set('description', metadata.description);
    }
    if (metadata.folder_uid) {
      params = params.set('folder_uid', metadata.folder_uid);
    }

    return this.http
      .post<CommitteeDocument>(`/api/committees/${committeeId}/documents/upload`, file, {
        headers: new HttpHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
        params,
      })
      .pipe(take(1));
  }

  public deleteCommitteeDocument(committeeId: string, documentId: string, documentType: CommitteeDocumentType): Observable<void> {
    const params = new HttpParams().set('type', documentType);
    return this.http.delete<void>(`/api/committees/${committeeId}/documents/${documentId}`, { params }).pipe(take(1));
  }

  // ── My Committees ─────────────────────────────────────────────────────────

  /**
   * Get committees for the current user, optionally scoped to a project or foundation.
   *
   * - `projectUid` scopes to memberships under a single project.
   * - `foundationUid` scopes to memberships under a foundation (and its sub-projects).
   *
   * Pass neither to fetch the full cross-project set (used by cross-project pages).
   * If both are provided, `projectUid` takes precedence and `foundationUid` is ignored.
   */
  public getMyCommittees(projectUid?: string, foundationUid?: string): Observable<MyCommittee[]> {
    let params = new HttpParams();
    if (projectUid) {
      params = params.set('project_uid', projectUid);
    } else if (foundationUid) {
      params = params.set('foundation_uid', foundationUid);
    }
    return this.http.get<MyCommittee[]>('/api/committees/my-committees', { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        // Narrow status/message only — see getCommitteeEngagement above (dealako review, LFXV2-1705).
        console.error('Failed to load my committees:', error.status, error.message);
        return of([]);
      })
    );
  }

  /** Lightweight alternative to {@link getMyCommittees} — returns only UIDs. Use when only set-membership checks (e.g. member badges) are needed. */
  public getMyCommitteeUids(projectUid?: string): Observable<string[]> {
    let params = new HttpParams();
    if (projectUid) {
      params = params.set('project_uid', projectUid);
    }
    return this.http.get<string[]>('/api/committees/my-committee-uids', { params }).pipe(catchError(() => of([])));
  }
}
