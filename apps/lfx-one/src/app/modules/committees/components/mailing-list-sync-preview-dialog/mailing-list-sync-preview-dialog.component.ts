// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MailingListSyncMode } from '@lfx-one/shared/enums';
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
import { catchError, exhaustMap, finalize, interval, of, Subscription, takeUntil, takeWhile, tap, timer } from 'rxjs';
import { UiProgressComponent } from '@shared/uikit/progress/progress.component';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';

type PreviewTab = 'adds' | 'removes' | 'conflicts';

// Upper bound on how long a sync-diff/sync-apply job is polled before giving up — lockDynamicDialogWhile
// gives the user no escape hatch while a poll is active, so a stuck upstream job must not trap them
// in an unclosable dialog forever (general-code-reviewer, PR #5489 review).
const POLL_DEADLINE_MS = 10 * 60 * 1000;

@Component({
  selector: 'lfx-mailing-list-sync-preview-dialog',
  imports: [ButtonComponent, CheckboxComponent, FilterPillsComponent, ReactiveFormsModule, UiProgressComponent],
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

  public addCheckboxForm = new FormGroup<Record<string, FormControl<boolean>>>({});
  public removeCheckboxForm = new FormGroup<Record<string, FormControl<boolean>>>({});

  public activeTab = signal<PreviewTab>('adds');
  public loadingDiff = signal(true);
  public loadError = signal<string | null>(null);
  public diff = signal<SyncDiff | null>(null);
  public diffProcessedCount = signal(0);
  public diffTotalCount = signal(0);

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
  public isReverseSync: Signal<boolean> = computed(() => this.diff()?.sync_mode === MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE);

  // Outcome text precomputed here rather than called as a method from the template — the template
  // re-invokes a bound method on every change-detection pass, not just when applyResult() changes
  // (docs/reviews/frontend-checklist.md, #4911 review).
  public addedResults: Signal<(SyncJobResultEntry & { outcomeText: string })[]> = this.initAddedResults();
  public removedResults: Signal<(SyncJobResultEntry & { outcomeText: string })[]> = this.initRemovedResults();

  public addedSucceededCount: Signal<number> = computed(() => this.applyResult()?.added_count ?? 0);
  public removedSucceededCount: Signal<number> = computed(() => this.applyResult()?.removed_count ?? 0);

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
    const ticker = this.startElapsedTicker();

    this.mailingListService
      .startSyncDiff(this.mailingListUid)
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
        this.pollSyncDiffStatus(start.job_id, ticker);
      });
  }

  /** Polls `/sync-diff/:jobId/status` every ~2s until the job reaches a terminal state. */
  private pollSyncDiffStatus(jobId: string, ticker: Subscription): void {
    let reachedTerminalState = false;

    interval(2000)
      .pipe(
        // exhaustMap (not switchMap) so a slow status request isn't cancelled by the next 2s tick —
        // switchMap would abort the in-flight request and silently restart it forever, never letting
        // a slow-but-healthy job reach a terminal state (greptile-apps, cursor/Bugbot, copilot, #5489 review).
        exhaustMap(() => this.mailingListService.getSyncDiffStatus(this.mailingListUid, jobId)),
        tap((status) => {
          this.diffProcessedCount.set(status.processed_count);
          this.diffTotalCount.set(status.total_count);
        }),
        takeWhile((status: SyncDiffJobStatus) => status.status === 'pending' || status.status === 'ongoing', true),
        takeUntil(timer(POLL_DEADLINE_MS)),
        finalize(() => {
          ticker.unsubscribe();
          this.loadingDiff.set(false);
          if (!reachedTerminalState) {
            this.loadError.set('The sync preview is taking longer than expected. Please close this dialog and try again.');
          }
        }),
        catchError((error) => {
          reachedTerminalState = true;
          this.loadError.set(error?.error?.error ?? 'Could not load the sync preview. Please try again.');
          return of(null);
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

        if (status.status === 'completed' && status.diff) {
          reachedTerminalState = true;
          this.applyLoadedDiff(status.diff);
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
        exhaustMap(() => this.mailingListService.getSyncApplyStatus(this.mailingListUid, jobId)),
        tap((status) => {
          this.applyProcessedCount.set(status.processed_count);
          this.applyTotalCount.set(status.total_count);
        }),
        takeWhile((status: SyncApplyJobStatus) => status.status === 'pending' || status.status === 'ongoing', true),
        takeUntil(timer(POLL_DEADLINE_MS)),
        finalize(() => {
          ticker.unsubscribe();
          this.applying.set(false);
          if (!reachedTerminalState) {
            this.applyError.set('Applying changes is taking longer than expected. Please close this dialog and try again.');
          }
        }),
        catchError((error) => {
          reachedTerminalState = true;
          this.applyError.set(error?.error?.error ?? 'Could not apply the sync changes. Please try again.');
          return of(null);
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
      return result.error || 'Could not complete this change.';
    }
    if (result.status === 'skipped') {
      return result.error || 'Skipped — this change was not applied.';
    }
    const destination = isReverseSync ? 'the committee' : 'the mailing list';
    return result.action === 'add' ? `Added to ${destination}.` : `Removed from ${destination}.`;
  }

  private startElapsedTicker(): Subscription {
    this.elapsedSeconds.set(0);
    return interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.elapsedSeconds.update((s) => s + 1));
  }
}
