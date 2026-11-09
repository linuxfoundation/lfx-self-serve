// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MailingListSyncMode, SyncApplyOutcome } from '@lfx-one/shared/enums';
import {
  FilterPillOption,
  MailingListSyncPreviewDialogData,
  SyncApplyAddResult,
  SyncApplyRemoveResult,
  SyncApplyResult,
  SyncDiff,
  SyncDiffAdd,
  SyncDiffRemove,
} from '@lfx-one/shared/interfaces';
import { MailingListService } from '@services/mailing-list.service';
import { UserService } from '@services/user.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, finalize, interval, of, Subscription, take } from 'rxjs';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';

type PreviewTab = 'adds' | 'removes' | 'conflicts';

@Component({
  selector: 'lfx-mailing-list-sync-preview-dialog',
  imports: [ButtonComponent, CheckboxComponent, FilterPillsComponent, ReactiveFormsModule],
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

  public applying = signal(false);
  public applyError = signal<string | null>(null);
  public applyResult = signal<SyncApplyResult | null>(null);
  public elapsedSeconds = signal(0);

  // Tracks that an apply request was sent, independent of whether a SyncApplyResult came back —
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
  public addedWithOutcome: Signal<(SyncApplyAddResult & { outcomeText: string })[]> = this.initAddedWithOutcome();
  public removedWithOutcome: Signal<(SyncApplyRemoveResult & { outcomeText: string })[]> = this.initRemovedWithOutcome();

  // Excludes failed rows so the results-view headings don't count a row as "added"/"removed" when
  // it actually failed (docs/reviews/frontend-checklist.md § 4, #4911 review).
  public addedSucceededCount: Signal<number> = this.initAddedSucceededCount();
  public removedSucceededCount: Signal<number> = this.initRemovedSucceededCount();

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
    const ticker = this.startElapsedTicker();

    this.mailingListService
      .applySyncDiff(this.mailingListUid, {
        committee_uid: diff.committee_uid,
        adds: this.selectedAdds(),
        removes: this.selectedRemoves(),
      })
      .pipe(
        finalize(() => {
          ticker.unsubscribe();
          this.applying.set(false);
        }),
        catchError((error) => {
          this.applyError.set(error?.error?.error ?? 'Could not apply the sync changes. Please try again.');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (result) {
          this.applyResult.set(result);
        }
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

  private initAddedWithOutcome(): Signal<(SyncApplyAddResult & { outcomeText: string })[]> {
    return computed(() => {
      const reverse = this.isReverseSync();
      return (this.applyResult()?.added ?? []).map((row) => ({ ...row, outcomeText: this.friendlyAddOutcome(row, reverse) }));
    });
  }

  private initRemovedWithOutcome(): Signal<(SyncApplyRemoveResult & { outcomeText: string })[]> {
    return computed(() => {
      const reverse = this.isReverseSync();
      return (this.applyResult()?.removed ?? []).map((row) => ({ ...row, outcomeText: this.friendlyRemoveOutcome(row, reverse) }));
    });
  }

  // Counts only ADDED/INVITED — excluding FAILED alone isn't enough, since SKIPPED_CROSS_LIST is
  // neither a failure nor an actual add, and was inflating the "succeeded" heading (greptile P2, #4911 review).
  private initAddedSucceededCount(): Signal<number> {
    return computed(() => this.addedWithOutcome().filter((row) => row.outcome === SyncApplyOutcome.ADDED || row.outcome === SyncApplyOutcome.INVITED).length);
  }

  private initRemovedSucceededCount(): Signal<number> {
    return computed(() => this.removedWithOutcome().filter((row) => row.outcome !== SyncApplyOutcome.FAILED).length);
  }

  private loadDiff(): void {
    this.loadingDiff.set(true);
    this.loadError.set(null);
    const ticker = this.startElapsedTicker();

    this.mailingListService
      .getSyncDiff(this.mailingListUid)
      .pipe(
        take(1),
        finalize(() => {
          ticker.unsubscribe();
          this.loadingDiff.set(false);
        }),
        catchError((error) => {
          this.loadError.set(error?.error?.error ?? 'Could not load the sync preview. Please try again.');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((diff) => {
        if (!diff) return;

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
      });
  }

  /**
   * Human-readable outcome for one applied add. Scoped to the fields the backend actually
   * returns today (outcome, error, name_hint as a plain display name) — NOT a fuzzy name-match
   * suggestion against the other roster. That PCC-1604 parity gap is tracked separately and
   * blocked on ITX; extend this once linuxfoundation/lfx-self-serve#4364 resolves it.
   */
  private friendlyAddOutcome(result: SyncApplyAddResult, isReverseSync: boolean): string {
    const destination = isReverseSync ? 'the committee' : 'the mailing list';
    switch (result.outcome) {
      case SyncApplyOutcome.ADDED:
        return `Added to ${destination}.`;
      case SyncApplyOutcome.INVITED:
        return `No LFX account found for ${result.email}${result.name_hint ? ` (${result.name_hint})` : ''} — an invite was sent.`;
      case SyncApplyOutcome.FAILED:
        return result.error || 'Could not complete this change.';
      case SyncApplyOutcome.SKIPPED_CROSS_LIST:
        return 'Skipped — this member belongs to a different mailing list.';
      default:
        return result.outcome;
    }
  }

  private friendlyRemoveOutcome(result: SyncApplyRemoveResult, isReverseSync: boolean): string {
    const destination = isReverseSync ? 'the committee' : 'the mailing list';
    switch (result.outcome) {
      case SyncApplyOutcome.REMOVED:
        return `Removed from ${destination}.`;
      case SyncApplyOutcome.FAILED:
        return result.error || 'Could not complete this change.';
      default:
        return result.outcome;
    }
  }

  private startElapsedTicker(): Subscription {
    this.elapsedSeconds.set(0);
    return interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.elapsedSeconds.update((s) => s + 1));
  }
}
