// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { ImportMembersDialogComponent } from '@app/modules/committees/components/import-members-dialog/import-members-dialog.component';
import { MemberImportAccessCheck, MemberImportAccessState, MemberImportDialogData } from '@lfx-one/shared/interfaces';
import { canManageCommitteeMembers } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, defer, EMPTY, filter, finalize, ignoreElements, map, merge, Observable, of, share, Subscription, take, tap } from 'rxjs';

import { CommitteeMemberImportService } from './committee-member-import.service';
import { CommitteeService } from './committee.service';

/**
 * Opens the Members-tab CSV import dialog for a new preview or for a group's retained run (#5731).
 * It never runs imports: CommitteeMemberImportService owns every write, so closing or reopening a
 * view cannot stop, restart or resubmit a run.
 *
 * Reopening and the Groups-table status entry first confirm manager access with a fresh, side-effect-free
 * strict-writer detail read (never `getCommittee`, which replaces the page's current group). The Members-tab
 * banner relies on the page's loaded writer flag. Denial
 * (`writer: false` from a check that completed, or 403/404) discards that run's retained details and
 * closes its view; a failed check reveals nothing but keeps the results for a later attempt, because the
 * strict read fails instead of degrading to `writer: false`. Results for a replaced subject or run are ignored.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeMemberImportDialogService {
  private readonly dialogService = inject(DialogService);
  private readonly committeeService = inject(CommitteeService);
  private readonly importService = inject(CommitteeMemberImportService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);

  /** At most one dialog per group, released when it closes. */
  private readonly dialogs = new Map<string, DynamicDialogRef>();
  /** Reopen checks in flight, so a double click opens one dialog. */
  private readonly pendingOpens = new Map<string, Subscription>();
  /** In-flight access probes, shared by reopening and Groups-table rows showing the group. */
  private readonly probes = new Map<string, Observable<MemberImportAccessCheck>>();
  private readonly access = signal(new Map<string, { owner: string; runId: string; state: MemberImportAccessState }>());

  /** The latest access result per group for the observed subject; a group without one shows no details. */
  public readonly accessByUid: Signal<ReadonlyMap<string, MemberImportAccessState>> = this.initAccessByUid();

  public constructor() {
    toObservable(this.importService.viewerSubject)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.reset());
    // Leaving the page only detaches the view; an open that is still checking access is abandoned.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntilDestroyed()
      )
      .subscribe(() => this.detachAll());
  }

  /** Opens a new preview, or the group's retained run instead of starting a second import. */
  public openNew(data: MemberImportDialogData): void {
    const committeeUid = data.committee.uid;
    if (this.importService.getRun(committeeUid)) {
      this.openRun(committeeUid);
      return;
    }
    if (this.dialogs.has(committeeUid) || this.pendingOpens.has(committeeUid)) return;
    this.open({ ...data, attach: false });
  }

  /** Reattaches to the retained run after a fresh access check, without a file, snapshot or write. */
  public openRun(committeeUid: string): void {
    const owner = this.importService.viewerSubject();
    const run = this.importService.getRun(committeeUid);
    if (!owner || !run || this.dialogs.has(committeeUid) || this.pendingOpens.has(committeeUid)) return;

    const pending = new Subscription();
    this.pendingOpens.set(committeeUid, pending);
    pending.add(
      this.probe(committeeUid, owner, run.runId)
        .pipe(
          finalize(() => {
            if (this.pendingOpens.get(committeeUid) === pending) this.pendingOpens.delete(committeeUid);
          })
        )
        .subscribe((check) => {
          // A late answer for a replaced subject neither opens a view nor reports on the previous subject's group.
          if (this.importService.viewerSubject() !== owner) return;
          if (check.state === 'authorized') {
            if (check.committee && this.isCurrent(committeeUid, owner, run.runId)) {
              this.open({ committee: check.committee, existingMembers: [], existingInvites: [], attach: true });
            }
          } else if (check.state === 'denied') {
            this.messageService.add({
              severity: 'error',
              summary: 'Import Unavailable',
              detail: `You can no longer manage ${run.committeeName}, so its import details were removed. Members already added remain.`,
              life: 8000,
            });
          } else {
            this.messageService.add({
              severity: 'error',
              summary: 'Unable to Open Import',
              detail: `Could not confirm your access to ${run.committeeName}. The import results are kept; try again.`,
              life: 6000,
            });
          }
        })
    );
  }

  /** Re-checks manager access for groups with retained runs; the caller's unsubscribe abandons its probes. */
  public probeAccess(committeeUids: readonly string[]): Observable<never> {
    const owner = this.importService.viewerSubject();
    if (!owner) return EMPTY;
    const probes = committeeUids.flatMap((committeeUid) => {
      const run = this.importService.getRun(committeeUid);
      return run ? [this.probe(committeeUid, owner, run.runId)] : [];
    });
    return merge(...probes).pipe(ignoreElements());
  }

  private initAccessByUid(): Signal<ReadonlyMap<string, MemberImportAccessState>> {
    return computed(() => {
      const owner = this.importService.viewerSubject();
      const states = new Map<string, MemberImportAccessState>();
      for (const [committeeUid, entry] of this.access()) {
        if (entry.owner === owner && this.importService.getRun(committeeUid)?.runId === entry.runId) states.set(committeeUid, entry.state);
      }
      return states;
    });
  }

  private probe(committeeUid: string, owner: string, runId: string): Observable<MemberImportAccessCheck> {
    const key = JSON.stringify([committeeUid, owner, runId]);
    const inFlight = this.probes.get(key);
    if (inFlight) return inFlight;
    const probe$: Observable<MemberImportAccessCheck> = this.checkAccess(committeeUid, owner, runId).pipe(
      finalize(() => {
        if (this.probes.get(key) === probe$) this.probes.delete(key);
      }),
      share()
    );
    this.probes.set(key, probe$);
    return probe$;
  }

  /** Records the result only while the same subject still retains the same run. */
  private checkAccess(committeeUid: string, owner: string, runId: string): Observable<MemberImportAccessCheck> {
    return defer(() => {
      if (!this.isCurrent(committeeUid, owner, runId)) return EMPTY;
      this.applyAccess(committeeUid, owner, runId, 'pending');
      return this.committeeService.getCommitteeDetail(committeeUid, { strictWriter: true }).pipe(
        take(1),
        map((committee): MemberImportAccessCheck => (canManageCommitteeMembers(committee) ? { state: 'authorized', committee } : { state: 'denied' })),
        catchError((error: unknown) => {
          const status = error instanceof HttpErrorResponse ? error.status : 0;
          console.error('CSV member import access check failed', { status });
          return of<MemberImportAccessCheck>({ state: status === 403 || status === 404 ? 'denied' : 'error' });
        }),
        tap((check) => this.applyAccess(committeeUid, owner, runId, check.state))
      );
    });
  }

  private applyAccess(committeeUid: string, owner: string, runId: string, state: MemberImportAccessState): void {
    if (!this.isCurrent(committeeUid, owner, runId)) return;
    this.access.update((access) => new Map(access).set(committeeUid, { owner, runId, state }));
    if (state === 'denied') {
      this.dialogs.get(committeeUid)?.close();
      this.importService.revoke(committeeUid);
    }
  }

  private isCurrent(committeeUid: string, owner: string, runId: string): boolean {
    return this.importService.viewerSubject() === owner && this.importService.getRun(committeeUid)?.runId === runId;
  }

  private open(data: MemberImportDialogData): void {
    const committeeUid = data.committee.uid;
    const dialogRef = this.dialogService.open(ImportMembersDialogComponent, {
      header: 'Import Members from CSV',
      width: '960px',
      breakpoints: { '1024px': '95vw' },
      modal: true,
      // The dialog's own buttons and Escape handler close it (PrimeNG ignores closeOnEscape unless closable).
      // A stray backdrop click must not discard a preview.
      closable: false,
      closeOnEscape: false,
      dismissableMask: false,
      data,
    });
    if (!dialogRef) return;
    this.dialogs.set(committeeUid, dialogRef);
    merge(dialogRef.onClose, dialogRef.onDestroy)
      .pipe(take(1))
      .subscribe(() => {
        if (this.dialogs.get(committeeUid) === dialogRef) this.dialogs.delete(committeeUid);
      });
  }

  private detachAll(): void {
    for (const pending of [...this.pendingOpens.values()]) pending.unsubscribe();
    this.pendingOpens.clear();
    for (const dialogRef of [...this.dialogs.values()]) dialogRef.close();
    this.dialogs.clear();
  }

  /** Another observed subject never sees the previous subject's access results, views or pending opens. */
  private reset(): void {
    this.detachAll();
    this.probes.clear();
    this.access.set(new Map());
  }
}
