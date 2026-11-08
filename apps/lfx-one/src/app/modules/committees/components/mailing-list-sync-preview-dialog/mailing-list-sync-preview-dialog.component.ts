// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { SyncApplyOutcome } from '@lfx-one/shared/enums';
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
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, finalize, interval, of, Subscription, take } from 'rxjs';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';

/** Upstream `Committee.SyncMode` values — mirrors lfx-v2-mailing-list-service's SyncMode* constants. */
const SYNC_MODE_AUTO_ML_TO_COMMITTEE = 'auto_ml_to_c';

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

  public readonly mailingListUid: string = (this.config.data as MailingListSyncPreviewDialogData).mailingListUid;
  public readonly mailingListName: string = (this.config.data as MailingListSyncPreviewDialogData).mailingListName;

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

  // Bumped whenever addCheckboxForm/removeCheckboxForm emit a value change, so the selectedAdds/
  // selectedRemoves computeds below re-run — a FormGroup's own value isn't a signal, so reading
  // it inside computed() would otherwise never register as a dependency (#4911 review).
  private addFormVersion = signal(0);
  private removeFormVersion = signal(0);

  public tabOptions: Signal<FilterPillOption[]> = this.initTabOptions();
  public selectedAdds: Signal<SyncDiffAdd[]> = this.initSelectedAdds();
  public selectedRemoves: Signal<SyncDiffRemove[]> = this.initSelectedRemoves();
  public isReverseSync: Signal<boolean> = computed(() => this.diff()?.sync_mode === SYNC_MODE_AUTO_ML_TO_COMMITTEE);

  // Outcome text precomputed here rather than called as a method from the template — the template
  // re-invokes a bound method on every change-detection pass, not just when applyResult() changes
  // (docs/reviews/frontend-checklist.md, #4911 review).
  public addedWithOutcome: Signal<(SyncApplyAddResult & { outcomeText: string })[]> = this.initAddedWithOutcome();
  public removedWithOutcome: Signal<(SyncApplyRemoveResult & { outcomeText: string })[]> = this.initRemovedWithOutcome();

  public constructor() {
    // Also locks while the results view is showing — otherwise the header X / Escape stayed usable
    // right after a sync apply completed, letting the user dismiss the results without acknowledging
    // them even though the apply itself already finished (#4911 review).
    lockDynamicDialogWhile(computed(() => this.loadingDiff() || this.applying() || !!this.applyResult()));
    this.loadDiff();
  }

  public onTabChange(tab: string): void {
    if (tab === 'adds' || tab === 'removes' || tab === 'conflicts') {
      this.activeTab.set(tab);
    }
  }

  /**
   * member_id is unique within a single diff's adds (committee member UIDs) or removes (mailing
   * list member IDs) — using it alone avoids the bug where a dot in an email address makes
   * FormGroup.get() treat the key as a nested path and return null (#4911 review).
   */
  public rowKey(memberId: string): string {
    return memberId;
  }

  public apply(): void {
    const diff = this.diff();
    if (!diff || this.applying()) return;

    this.applying.set(true);
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
    this.dialogRef.close(this.applyResult() ? { applied: true } : null);
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
        this.diff.set(diff);

        const addControls: Record<string, FormControl<boolean>> = {};
        diff.adds.forEach((add) => {
          addControls[this.rowKey(add.member_id)] = new FormControl(true, { nonNullable: true });
        });
        this.addCheckboxForm = new FormGroup(addControls);
        this.addCheckboxForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.addFormVersion.update((v) => v + 1));

        const removeControls: Record<string, FormControl<boolean>> = {};
        diff.removes.forEach((remove) => {
          removeControls[this.rowKey(remove.member_id)] = new FormControl(true, { nonNullable: true });
        });
        this.removeCheckboxForm = new FormGroup(removeControls);
        this.removeCheckboxForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.removeFormVersion.update((v) => v + 1));
      });
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
      return diff.adds.filter((add) => this.addCheckboxForm.get(this.rowKey(add.member_id))?.value !== false);
    });
  }

  private initSelectedRemoves(): Signal<SyncDiffRemove[]> {
    return computed(() => {
      const diff = this.diff();
      this.removeFormVersion();
      if (!diff) return [];
      return diff.removes.filter((remove) => this.removeCheckboxForm.get(this.rowKey(remove.member_id))?.value !== false);
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
}
