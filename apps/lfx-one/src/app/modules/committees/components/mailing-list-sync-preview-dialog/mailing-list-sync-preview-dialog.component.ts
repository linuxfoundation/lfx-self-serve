// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TagComponent } from '@components/tag/tag.component';
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
import { catchError, finalize, interval, of, take } from 'rxjs';

type PreviewTab = 'adds' | 'removes' | 'conflicts';

@Component({
  selector: 'lfx-mailing-list-sync-preview-dialog',
  imports: [ButtonComponent, CheckboxComponent, FilterPillsComponent, ReactiveFormsModule, TagComponent],
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

  public tabOptions: Signal<FilterPillOption[]> = this.initTabOptions();
  public selectedAdds: Signal<SyncDiffAdd[]> = this.initSelectedAdds();
  public selectedRemoves: Signal<SyncDiffRemove[]> = this.initSelectedRemoves();

  public constructor() {
    this.loadDiff();
  }

  public onTabChange(tab: string): void {
    this.activeTab.set(tab as PreviewTab);
  }

  public rowKey(email: string, memberId: string): string {
    return `${memberId}:${email}`;
  }

  public apply(): void {
    const diff = this.diff();
    if (!diff || this.applying()) return;

    this.applying.set(true);
    this.applyError.set(null);
    this.elapsedSeconds.set(0);
    const ticker = interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.elapsedSeconds.update((s) => s + 1));

    this.mailingListService
      .applySyncDiff(this.mailingListUid, {
        committee_uid: diff.committee_uid,
        adds: this.selectedAdds(),
        removes: this.selectedRemoves(),
      })
      .pipe(
        take(1),
        finalize(() => {
          ticker.unsubscribe();
          this.applying.set(false);
        }),
        catchError((error) => {
          this.applyError.set(error?.error?.message ?? 'Could not apply the sync changes. Please try again.');
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
  public friendlyAddOutcome(result: SyncApplyAddResult): string {
    switch (result.outcome) {
      case SyncApplyOutcome.ADDED:
        return 'Added to the mailing list.';
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

  public friendlyRemoveOutcome(result: SyncApplyRemoveResult): string {
    switch (result.outcome) {
      case SyncApplyOutcome.REMOVED:
        return 'Removed from the mailing list.';
      case SyncApplyOutcome.FAILED:
        return result.error || 'Could not complete this change.';
      default:
        return result.outcome;
    }
  }

  private loadDiff(): void {
    this.loadingDiff.set(true);
    this.loadError.set(null);

    this.mailingListService
      .getSyncDiff(this.mailingListUid)
      .pipe(
        take(1),
        finalize(() => this.loadingDiff.set(false)),
        catchError((error) => {
          this.loadError.set(error?.error?.message ?? 'Could not load the sync preview. Please try again.');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((diff) => {
        if (!diff) return;
        this.diff.set(diff);

        const addControls: Record<string, FormControl<boolean>> = {};
        diff.adds.forEach((add) => {
          addControls[this.rowKey(add.email, add.member_id)] = new FormControl(true, { nonNullable: true });
        });
        this.addCheckboxForm = new FormGroup(addControls);

        const removeControls: Record<string, FormControl<boolean>> = {};
        diff.removes.forEach((remove) => {
          removeControls[this.rowKey(remove.email, remove.member_id)] = new FormControl(true, { nonNullable: true });
        });
        this.removeCheckboxForm = new FormGroup(removeControls);
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
      if (!diff) return [];
      return diff.adds.filter((add) => this.addCheckboxForm.get(this.rowKey(add.email, add.member_id))?.value !== false);
    });
  }

  private initSelectedRemoves(): Signal<SyncDiffRemove[]> {
    return computed(() => {
      const diff = this.diff();
      if (!diff) return [];
      return diff.removes.filter((remove) => this.removeCheckboxForm.get(this.rowKey(remove.email, remove.member_id))?.value !== false);
    });
  }
}
