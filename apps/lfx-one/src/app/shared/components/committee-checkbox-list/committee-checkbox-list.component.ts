// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { Committee, CommitteeReference, CommitteeSelectorOption, VOTING_STATUSES } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, combineLatest, filter, map, of, startWith, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-committee-checkbox-list',
  imports: [ReactiveFormsModule, MultiSelectComponent],
  templateUrl: './committee-checkbox-list.component.html',
})
export class CommitteeCheckboxListComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);

  // Form inputs
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();

  // Configuration
  public readonly label = input<string>('Select Groups');
  public readonly description = input<string>('');
  public readonly required = input<boolean>(false);
  public readonly searchPlaceholder = input<string>('Search groups...');
  public readonly maxHeight = input<string>('280px');
  public readonly testIdPrefix = input<string>('committee-checkbox-list');

  // Events
  public readonly selectionChange = output<CommitteeSelectorOption[]>();

  // The dropdown works on group UIDs; the parent control holds CommitteeReference[]. This form bridges the two.
  public readonly selectionForm = new FormGroup({
    committeeIds: new FormControl<string[]>([], { nonNullable: true }),
  });

  // Loading state
  public readonly committeesLoading = signal<boolean>(true);

  // Committee options loaded from API
  public readonly committeeOptions: Signal<CommitteeSelectorOption[]> = this.initCommitteeOptions();

  // Selected items derived from form control
  public readonly selectedItems: Signal<CommitteeSelectorOption[]> = this.initSelectedItems();

  // Total participants count
  public readonly totalParticipants: Signal<number> = this.initTotalParticipants();

  // Selected group names for summary
  public readonly selectedGroupNames: Signal<string> = this.initSelectedGroupNames();

  public constructor() {
    // Parent control -> dropdown (initial value, edit mode, programmatic changes)
    toObservable(this.selectedItems)
      .pipe(
        map((items) => items.map((item) => item.id)),
        takeUntilDestroyed()
      )
      .subscribe((ids) => {
        const control = this.selectionForm.controls.committeeIds;
        if (!this.sameIds(control.value ?? [], ids)) {
          control.setValue(ids, { emitEvent: false });
        }
      });

    // Dropdown -> parent control
    this.selectionForm.controls.committeeIds.valueChanges.pipe(takeUntilDestroyed()).subscribe((ids) => this.onSelectionChange(ids));
  }

  // Private initializer functions
  private initCommitteeOptions(): Signal<CommitteeSelectorOption[]> {
    const projectUid = computed(() => this.projectContextService.activeContextUid());

    return toSignal(
      toObservable(projectUid).pipe(
        tap(() => this.committeesLoading.set(true)),
        filter((uid) => !!uid),
        switchMap((uid) =>
          this.committeeService.getCommitteesByProject(uid).pipe(
            map((committees) => this.mapCommitteesToOptions(committees)),
            tap(() => this.committeesLoading.set(false)),
            catchError(() => {
              console.error('Failed to load committees for project', uid);
              this.committeesLoading.set(false);
              return of([]);
            })
          )
        )
      ),
      { initialValue: [] }
    );
  }

  private initSelectedItems(): Signal<CommitteeSelectorOption[]> {
    const formControl$ = toObservable(computed(() => this.form().get(this.control())));
    const options$ = toObservable(this.committeeOptions);

    return toSignal(
      combineLatest([formControl$, options$]).pipe(
        switchMap(([formControl, options]) => {
          if (!formControl) {
            return of([]);
          }

          return formControl.valueChanges.pipe(
            startWith(formControl.value as CommitteeReference[] | null),
            map((value: CommitteeReference[] | null) => this.mapFormValueToSelectedItems(value, options))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initTotalParticipants(): Signal<number> {
    return computed(() => {
      return this.selectedItems().reduce((total, item) => total + (item.memberCount || 0), 0);
    });
  }

  private initSelectedGroupNames(): Signal<string> {
    return computed(() => {
      const items = this.selectedItems();
      if (items.length === 0) {
        return '';
      }
      if (items.length === 1) {
        return items[0].name;
      }
      if (items.length === 2) {
        return `${items[0].name} and ${items[1].name}`;
      }
      return `${items[0].name}, ${items[1].name}, and ${items.length - 2} more`;
    });
  }

  private onSelectionChange(value: string[] | null): void {
    const options = this.committeeOptions();
    const current = this.selectedItems();
    // PrimeNG writes null when its clear action runs; treat that as an empty selection.
    const ids = (value ?? []).filter((id): id is string => !!id);

    // A group already on the form but missing from the loaded options (e.g. edit mode) keeps its stored name.
    const updated: CommitteeSelectorOption[] = ids.map((id) => {
      const option = options.find((o) => o.id === id) ?? current.find((o) => o.id === id);
      return { id, name: option?.name ?? '', memberCount: option?.memberCount };
    });

    this.updateFormControl(updated);
    this.selectionChange.emit(updated);
  }

  private sameIds(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
  }

  private mapFormValueToSelectedItems(value: CommitteeReference[] | null, options: CommitteeSelectorOption[]): CommitteeSelectorOption[] {
    if (!value || !Array.isArray(value)) {
      return [];
    }

    return value.map((item) => {
      const option = options.find((o) => o.id === item.uid);
      return {
        id: item.uid,
        name: item.name || option?.name || '',
        memberCount: option?.memberCount,
      };
    });
  }

  private mapCommitteesToOptions(committees: Committee[]): CommitteeSelectorOption[] {
    return committees.map((committee) => ({
      id: committee.uid,
      name: committee.name,
      memberCount: committee.total_members,
    }));
  }

  private updateFormControl(selectedOptions: CommitteeSelectorOption[]): void {
    const formControl = this.form().get(this.control());
    if (!formControl) {
      return;
    }

    const formValue: CommitteeReference[] = selectedOptions.map((option) => ({
      uid: option.id,
      name: option.name,
      allowed_voting_statuses: VOTING_STATUSES.map((status) => status.value),
    }));

    formControl.setValue(formValue);
    formControl.markAsDirty();
    formControl.markAsTouched();
  }
}
