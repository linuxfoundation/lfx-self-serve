// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { COMMITTEE_LABEL, MAILING_LIST_SYNC_POLL_DEADLINE_MS } from '@lfx-one/shared/constants';
import { MailingListSyncDirection, MailingListSyncMode } from '@lfx-one/shared/enums';
import {
  FilterPillOption,
  MailingListSyncPreviewDialogData,
  SyncApplyJobStatus,
  SyncDiff,
  SyncDiffAdd,
  SyncDiffJobStatus,
  SyncDiffRemove,
  SyncJobResultEntry,
} from '@lfx-one/shared/interfaces';
import { MailingListService } from '@services/mailing-list.service';
import { UserService } from '@services/user.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, EMPTY, exhaustMap, finalize, interval, of, Subscription, takeUntil, takeWhile, tap, throwError, timer } from 'rxjs';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { UiProgressComponent } from '@shared/uikit/progress/progress.component';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { extractErrorMessage, isTransientHttpError } from '@shared/utils/http-error.utils';

type PreviewTab = 'adds' | 'removes' | 'conflicts';

@Component({
  selector: 'lfx-mailing-list-sync-preview-dialog',
  imports: [ButtonComponent, CheckboxComponent, FilterPillsComponent, ReactiveFormsModule, SelectButtonComponent, UiProgressComponent],
  templateUrl: './mailing-list-sync-preview-dialog.component.html',
})
export class MailingListSyncPreviewDialogComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mailingListService = inject(MailingListService);
  private readonly userService = inject(UserService);

  // The backend's POST sync-apply route unconditionally rejects impersonated applies via
  // blockDuringImpersonation, so an impersonator could only ever see a 403 here. Gate Apply on the
  // same established impersonating() pattern (weekly-brief-card, profile-panel,
  // committee-settings-tab.component.ts) rather than letting them hit that 403 (copilot, #4911 review).
  public readonly impersonating = this.userService.impersonating;

  public readonly mailingListUid: string = (this.config.data as MailingListSyncPreviewDialogData).mailingListUid;
  public readonly mailingListName: string = (this.config.data as MailingListSyncPreviewDialogData).mailingListName;
  // The committee the admin was viewing when they opened this dialog — captured here rather than
  // re-read live, so a relink (mailing list moved from committee A to B) between open and apply is
  // caught by comparing against it, instead of trusting whatever committee_uid the diff reports
  // (copilot, #4911 review).
  private readonly committeeUid: string = (this.config.data as MailingListSyncPreviewDialogData).committeeUid;
  // A manual/unset sync_mode has no direction of its own to fall back on — the dialog must prompt
  // for one and send it on every sync-diff/sync-apply call. An auto_* list always uses its own
  // configured direction and must never be sent an override (rejected with 400 upstream).
  public readonly needsDirectionSelector: boolean =
    (this.config.data as MailingListSyncPreviewDialogData).syncMode === undefined ||
    (this.config.data as MailingListSyncPreviewDialogData).syncMode === MailingListSyncMode.MANUAL;

  protected readonly directionOptions = [
    { label: `${COMMITTEE_LABEL.singular} → Mailing List`, value: MailingListSyncDirection.COMMITTEE_TO_MAILING_LIST },
    { label: `Mailing List → ${COMMITTEE_LABEL.singular}`, value: MailingListSyncDirection.MAILING_LIST_TO_COMMITTEE },
  ];

  public addCheckboxForm = new FormGroup<Record<string, FormControl<boolean>>>({});
  public removeCheckboxForm = new FormGroup<Record<string, FormControl<boolean>>>({});
  public directionForm = new FormGroup({
    direction: new FormControl<MailingListSyncDirection>(MailingListSyncDirection.COMMITTEE_TO_MAILING_LIST, { nonNullable: true }),
  });

  public activeTab = signal<PreviewTab>('adds');
  public loadingDiff = signal(true);
  public loadError = signal<string | null>(null);
  public diff = signal<SyncDiff | null>(null);
  public diffProcessedCount = signal(0);
  public diffTotalCount = signal(0);
  // The direction the currently-loaded (or loading) diff was requested with. For a manual/unset
  // sync_mode list, diff.sync_mode stays "manual"/unset — it never reflects the user's selected
  // direction — so isReverseSync() below must read this instead of diff()?.sync_mode when
  // needsDirectionSelector is true (copilot, cursor/Bugbot, #5578 review).
  public loadedDirection = signal<MailingListSyncDirection | undefined>(undefined);

  public applying = signal(false);
  public applyError = signal<string | null>(null);
  public applyResult = signal<SyncApplyJobStatus | null>(null);
  public applyProcessedCount = signal(0);
  public applyTotalCount = signal(0);
  public elapsedSeconds = signal(0);

  // Tracks that an apply request was sent, independent of whether a SyncApplyJobStatus came back —
  // a request can partially succeed upstream before the response errors out, so close() needs to
  // know an apply was attempted even when applyResult() never got set (#4911 review).
  public applyAttempted = signal(false);

  // Bumped whenever addCheckboxForm/removeCheckboxForm emit a value change, so the selectedAdds/
  // selectedRemoves computeds below re-run — a FormGroup's own value isn't a signal, so reading
  // it inside computed() would otherwise never register as a dependency (#4911 review).
  private addFormVersion = signal(0);
  private removeFormVersion = signal(0);

  public tabOptions: Signal<FilterPillOption[]> = this.initTabOptions();
  public selectedAdds: Signal<SyncDiffAdd[]> = this.initSelectedAdds();
  public selectedRemoves: Signal<SyncDiffRemove[]> = this.initSelectedRemoves();
  public isReverseSync: Signal<boolean> = computed(() => {
    if (this.needsDirectionSelector) {
      return this.loadedDirection() === MailingListSyncDirection.MAILING_LIST_TO_COMMITTEE;
    }
    return this.diff()?.sync_mode === MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE;
  });

  // Outcome text precomputed here rather than called as a method from the template — the template
  // re-invokes a bound method on every change-detection pass, not just when applyResult() changes
  // (docs/reviews/frontend-checklist.md, #4911 review).
  public addedResults: Signal<(SyncJobResultEntry & { outcomeText: string })[]> = this.initAddedResults();
  public removedResults: Signal<(SyncJobResultEntry & { outcomeText: string })[]> = this.initRemovedResults();

  public addedSucceededCount: Signal<number> = computed(() => this.applyResult()?.added_count ?? 0);
  public removedSucceededCount: Signal<number> = computed(() => this.applyResult()?.removed_count ?? 0);
  public failedCount: Signal<number> = computed(() => this.applyResult()?.error_count ?? 0);

  public constructor() {
    // Also locks while the results view is showing — otherwise the header X / Escape stayed usable
    // right after a sync apply completed, letting the user dismiss the results without acknowledging
    // them even though the apply itself already finished (#4911 review).
    //
    // Also locks on applyError() — native dismissal (header X, Escape) calls DynamicDialogRef.close()
    // directly, bypassing this component's own close() and its applyAttempted()/committeeChanged
    // payload. Without this, a reverse-sync apply that errors after changing memberships let the user
    // dismiss via the header/Escape with no committeeChanged flag reaching the parent, skipping the
    // roster refresh (copilot, #4911 review). The template's own error-view Close button still works —
    // it calls close() directly regardless of config.closable.
    lockDynamicDialogWhile(computed(() => this.loadingDiff() || this.applying() || !!this.applyResult() || !!this.applyError()));

    if (this.needsDirectionSelector) {
      // Changing direction invalidates the loaded diff entirely (it's computed against the
      // opposite source of truth), so re-run loadDiff() rather than trying to patch the existing
      // one. valueChanges only fires on an actual user change, not on this initial subscribe.
      this.directionForm.controls.direction.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadDiff());

      // Lock direction while a diff/apply job is in flight — switching mid-poll would leave a
      // stale job running against the old direction. Also lock it permanently once any apply has
      // been attempted (success, failure, or timeout): an attempted apply may already have changed
      // committee/mailing-list membership, and re-running loadDiff() after a direction switch
      // clears applyError/applyResult, which both drops the dismiss-lock (lockDynamicDialogWhile
      // above) and overwrites loadedDirection — so a later close() can report the wrong
      // isReverseSync() for the apply that actually ran. Forcing a close+reopen to change direction
      // after an attempt avoids all of that (greptile-apps, cursor/Bugbot, copilot, #5578 review).
      // emitEvent: false so disable()/enable() don't themselves trigger the valueChanges
      // subscription above.
      effect(() => {
        if (this.loadingDiff() || this.applying() || this.applyAttempted()) {
          this.directionForm.controls.direction.disable({ emitEvent: false });
        } else {
          this.directionForm.controls.direction.enable({ emitEvent: false });
        }
      });
    }

    this.loadDiff();
  }

  public onTabChange(tab: string): void {
    if (tab === 'adds' || tab === 'removes' || tab === 'conflicts') {
      this.activeTab.set(tab);
    }
  }

  public apply(): void {
    const diff = this.diff();
    if (!diff || this.applying() || this.impersonating()) return;

    this.applying.set(true);
    this.applyAttempted.set(true);
    this.applyError.set(null);
    this.applyProcessedCount.set(0);
    this.applyTotalCount.set(0);
    const ticker = this.startElapsedTicker();

    this.mailingListService
      .startSyncApply(this.mailingListUid, {
        committee_uid: diff.committee_uid,
        adds: this.selectedAdds(),
        removes: this.selectedRemoves(),
        ...(this.needsDirectionSelector ? { direction: this.directionForm.controls.direction.value } : {}),
      })
      .pipe(
        catchError((error) => {
          this.applyError.set(error?.error?.error ?? 'Could not apply the sync changes. Please try again.');
          ticker.unsubscribe();
          this.applying.set(false);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((start) => {
        if (!start) return;
        this.pollSyncApplyStatus(start.job_id, ticker);
      });
  }

  public close(): void {
    this.dialogRef.close(this.applyAttempted() ? { applied: true, committeeChanged: this.isReverseSync() } : null);
  }

  private initTabOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      const diff = this.diff();
      return [
        { id: 'adds', label: `Add (${diff?.adds.length ?? 0})` },
        { id: 'removes', label: `Remove (${diff?.removes.length ?? 0})` },
        { id: 'conflicts', label: `Conflicts (${diff?.conflicts.length ?? 0})` },
      ];
    });
  }

  private initSelectedAdds(): Signal<SyncDiffAdd[]> {
    return computed(() => {
      const diff = this.diff();
      this.addFormVersion();
      if (!diff) return [];
      return diff.adds.filter((add) => this.addCheckboxForm.get(add.member_id)?.value !== false);
    });
  }

  private initSelectedRemoves(): Signal<SyncDiffRemove[]> {
    return computed(() => {
      const diff = this.diff();
      this.removeFormVersion();
      if (!diff) return [];
      return diff.removes.filter((remove) => this.removeCheckboxForm.get(remove.member_id)?.value !== false);
    });
  }

  private initAddedResults(): Signal<(SyncJobResultEntry & { outcomeText: string })[]> {
    return computed(() => {
      const reverse = this.isReverseSync();
      return (this.applyResult()?.results ?? [])
        .filter((row) => row.action === 'add')
        .map((row) => ({ ...row, outcomeText: this.friendlyOutcome(row, reverse) }));
    });
  }

  private initRemovedResults(): Signal<(SyncJobResultEntry & { outcomeText: string })[]> {
    return computed(() => {
      const reverse = this.isReverseSync();
      return (this.applyResult()?.results ?? [])
        .filter((row) => row.action === 'remove')
        .map((row) => ({ ...row, outcomeText: this.friendlyOutcome(row, reverse) }));
    });
  }

  private loadDiff(): void {
    this.loadingDiff.set(true);
    this.loadError.set(null);
    this.diffProcessedCount.set(0);
    this.diffTotalCount.set(0);
    // A direction change re-runs loadDiff() after a failed apply attempt — without clearing these,
    // the template's `@else if (loadError() || applyError())` branch keeps priority over the
    // `diff()` branch and hides the freshly-loaded preview behind the stale apply error
    // (greptile-apps, #5578 review).
    this.applyError.set(null);
    this.applyResult.set(null);
    const ticker = this.startElapsedTicker();
    const direction = this.needsDirectionSelector ? this.directionForm.controls.direction.value : undefined;
    this.loadedDirection.set(direction);

    this.mailingListService
      .startSyncDiff(this.mailingListUid, direction)
      .pipe(
        catchError((error) => {
          this.loadError.set(error?.error?.error ?? 'Could not load the sync preview. Please try again.');
          ticker.unsubscribe();
          this.loadingDiff.set(false);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((start) => {
        if (!start) return;
        this.pollSyncDiffStatus(start.job_id, ticker, direction);
      });
  }

  /** Polls `/sync-diff/:jobId/status` every ~2s until the job reaches a terminal state. `direction` must match what was passed to `startSyncDiff` for this job. */
  private pollSyncDiffStatus(jobId: string, ticker: Subscription, direction: MailingListSyncDirection | undefined): void {
    let reachedTerminalState = false;

    interval(2000)
      .pipe(
        // exhaustMap (not switchMap) so a slow status request isn't cancelled by the next 2s tick —
        // switchMap would abort the in-flight request and silently restart it forever, never letting
        // a slow-but-healthy job reach a terminal state (greptile-apps, cursor/Bugbot, copilot, #5489 review).
        // catchError lives inside the exhaustMap callback (not on the outer stream) so a single
        // transient failure (a dropped connection, a 502) is skipped and polling continues on the
        // next tick, instead of catchError replacing the whole subscription and ending the poll for
        // good (lfx-one, #5489 review).
        // A transient per-tick failure (isTransientHttpError — 0/408/429/5xx) is swallowed (returns
        // null, skipped below) so a stale error message can't linger once loadingDiff() goes false
        // and hide a diff that a later, successful tick did load. A permanent refusal (401 session
        // expiry, 403/404/409 conflict) is rethrown instead of swallowed, so it reaches the outer
        // catchError below and stops polling immediately rather than retrying for the full deadline
        // (greptile-apps, cursor/Bugbot, copilot, #5489 review).
        exhaustMap(() =>
          this.mailingListService
            .getSyncDiffStatus(this.mailingListUid, jobId, direction)
            .pipe(catchError((error: unknown) => (isTransientHttpError(error) ? of(null) : throwError(() => error))))
        ),
        tap((status) => {
          if (!status) return;
          this.diffProcessedCount.set(status.processed_count);
          this.diffTotalCount.set(status.total_count);
        }),
        takeWhile((status: SyncDiffJobStatus | null) => status === null || status.status === 'pending' || status.status === 'ongoing', true),
        takeUntil(timer(MAILING_LIST_SYNC_POLL_DEADLINE_MS)),
        catchError((error: unknown) => {
          reachedTerminalState = true;
          this.loadError.set(extractErrorMessage(error, 'Could not load the sync preview. Please try again.'));
          return EMPTY;
        }),
        finalize(() => {
          ticker.unsubscribe();
          this.loadingDiff.set(false);
          if (!reachedTerminalState) {
            this.loadError.set('The sync preview is taking longer than expected. Please close this dialog and try again.');
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((status) => {
        if (!status) return;

        if (status.status === 'failed') {
          reachedTerminalState = true;
          this.loadError.set(status.error_message ?? 'Could not load the sync preview. Please try again.');
          return;
        }

        if (status.status === 'completed') {
          reachedTerminalState = true;
          if (status.diff) {
            this.applyLoadedDiff(status.diff);
          } else {
            this.loadError.set('The sync preview finished without a result. Please close this dialog and try again.');
          }
        }
      });
  }

  private applyLoadedDiff(diff: SyncDiff): void {
    // The mailing list could have been relinked from this committee to another between this
    // dialog opening and the diff loading — both requests would still target the new
    // committee, so the preview-to-apply relink check alone can't catch it. Reject a mismatch
    // up front and keep Apply disabled (copilot, #4911 review).
    if (diff.committee_uid !== this.committeeUid) {
      this.loadError.set('This mailing list is now linked to a different committee. Close this dialog and reopen Sync Now to see the current preview.');
      return;
    }

    this.diff.set(diff);

    // member_id is unique within a single diff's adds/removes and used directly as the
    // FormGroup key. FormGroup.get() treats a dot as a nested-path separator, so this assumes
    // member_id never contains one — true for the UID-shaped ids the backend returns today.
    const addControls: Record<string, FormControl<boolean>> = {};
    diff.adds.forEach((add) => {
      addControls[add.member_id] = new FormControl(true, { nonNullable: true });
    });
    this.addCheckboxForm = new FormGroup(addControls);
    this.addCheckboxForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.addFormVersion.update((v) => v + 1));

    const removeControls: Record<string, FormControl<boolean>> = {};
    diff.removes.forEach((remove) => {
      removeControls[remove.member_id] = new FormControl(true, { nonNullable: true });
    });
    this.removeCheckboxForm = new FormGroup(removeControls);
    this.removeCheckboxForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.removeFormVersion.update((v) => v + 1));
  }

  /** Polls `/sync-apply/:jobId/status` every ~2s until the job reaches a terminal state. */
  private pollSyncApplyStatus(jobId: string, ticker: Subscription): void {
    let reachedTerminalState = false;

    interval(2000)
      .pipe(
        // exhaustMap (not switchMap) so a slow status request isn't cancelled by the next 2s tick —
        // switchMap would abort the in-flight request and silently restart it forever, never letting
        // a slow-but-healthy job reach a terminal state (greptile-apps, cursor/Bugbot, copilot, #5489 review).
        // catchError lives inside the exhaustMap callback (not on the outer stream) so a single
        // transient failure (a dropped connection, a 502) is skipped and polling continues on the
        // next tick, instead of catchError replacing the whole subscription and ending the poll for
        // good (lfx-one, #5489 review).
        // A transient per-tick failure (isTransientHttpError — 0/408/429/5xx) is swallowed (returns
        // null, skipped below) so a stale error message can't linger once applying() goes false and
        // hide a result that a later, successful tick did load. A permanent refusal (401 session
        // expiry, 403/404/409 conflict) is rethrown instead of swallowed, so it reaches the outer
        // catchError below and stops polling immediately rather than retrying for the full deadline
        // (greptile-apps, cursor/Bugbot, copilot, #5489 review). applyAttempted was already set to
        // true in apply() before this poll started, so closing the dialog on a permanent error still
        // triggers a membership refresh — it isn't reset here.
        exhaustMap(() =>
          this.mailingListService
            .getSyncApplyStatus(this.mailingListUid, jobId)
            .pipe(catchError((error: unknown) => (isTransientHttpError(error) ? of(null) : throwError(() => error))))
        ),
        tap((status) => {
          if (!status) return;
          this.applyProcessedCount.set(status.processed_count);
          this.applyTotalCount.set(status.total_count);
        }),
        takeWhile((status: SyncApplyJobStatus | null) => status === null || status.status === 'pending' || status.status === 'ongoing', true),
        takeUntil(timer(MAILING_LIST_SYNC_POLL_DEADLINE_MS)),
        catchError((error: unknown) => {
          reachedTerminalState = true;
          this.applyError.set(extractErrorMessage(error, 'Applying changes failed. Please try again.'));
          return EMPTY;
        }),
        finalize(() => {
          ticker.unsubscribe();
          this.applying.set(false);
          if (!reachedTerminalState) {
            this.applyError.set('Applying changes is taking longer than expected. Please close this dialog and try again.');
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((status) => {
        if (!status) return;

        if (status.status !== 'completed' && status.status !== 'failed') return;
        reachedTerminalState = true;

        // A "failed" job can still carry partial `results` (some adds/removes succeeded before the
        // job errored out) — always surface the failure via applyError regardless of whether results
        // are present, instead of silently falling into the success view (greptile-apps, cursor/Bugbot,
        // copilot, #5489 review). applyResult is still set so any partial results remain visible.
        if (status.status === 'failed') {
          this.applyError.set(status.error_message ?? 'The sync job failed partway through.');
        }
        this.applyResult.set(status);
      });
  }

  /**
   * Human-readable outcome for one applied add/remove. The async status poll only reports
   * success/error per row (no member_id/member_type/name_hint enrichment — that enrichment needs
   * the request-time approved adds/removes, which aren't available to a status poll), so this is
   * simpler than the old outcome-enum messaging it replaces.
   */
  private friendlyOutcome(result: SyncJobResultEntry, isReverseSync: boolean): string {
    if (result.status === 'error') {
      return this.friendlyError(result.error);
    }
    if (result.status === 'skipped') {
      return result.error || 'Skipped — this change was not applied.';
    }
    const destination = isReverseSync ? 'the committee' : 'the mailing list';
    return result.action === 'add' ? `Added to ${destination}.` : `Removed from ${destination}.`;
  }

  /**
   * Translates the raw error ITX reports for one failed add/remove (often a bare HTTP status
   * phrase like "Bad Request") into an actionable explanation. Mirrors the mapping PCC uses for
   * the same ITX error shapes (sync-preview-modal.component.ts), since both products sync against
   * the same Groups.io integration and see the same raw error text.
   */
  private friendlyError(error: string | undefined): string {
    if (!error) return 'Could not complete this change — unknown error. Contact support if this persists.';
    const lower = error.toLowerCase();
    if (lower.includes('invalid email address') || lower.includes('unprocessable entity') || lower.includes('422')) {
      return 'Invalid email address — likely a bounce or system-generated address. Remove this address from the mailing list.';
    }
    if (lower.includes('already') && lower.includes('member')) {
      return error;
    }
    const suggestionMatch = error.match(/possible match by name:.+?(?:;|$)/i);
    if (suggestionMatch) {
      return `No LFX account found for this email address. ${suggestionMatch[0].replace(/;$/, '').trim()}.`;
    }
    if (lower.includes('not found') || lower.includes('user not found') || lower.includes('lookup failed')) {
      return (
        'No LFX account found for this email address, and no name is on file to suggest a possible match. ' +
        'Invite the person to create an LFX account, or add them manually once they have one.'
      );
    }
    if (lower.includes('bad request') || lower === '400') {
      return 'ITX rejected this request (Bad Request) — the mailing list membership state may be out of sync. Try syncing again; contact support if it keeps failing.';
    }
    return error;
  }

  private startElapsedTicker(): Subscription {
    this.elapsedSeconds.set(0);
    return interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.elapsedSeconds.update((s) => s + 1));
  }
}
