// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, effect, input, output, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { MENTORSHIP_PROGRAM_STATUS_LABELS, MENTORSHIP_PROGRAM_STATUSES } from '@lfx-one/shared/constants';
import { MentorshipProgram, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';

import { ProgramCardComponent } from '../program-card/program-card.component';

interface StatusOption {
  label: string;
  value: MentorshipProgramStatus | null;
}

/**
 * Search + status filter + card list. Owns its own FormGroup for the search
 * input and status select so consumers don't need to reason about Angular
 * reactive forms — they see plain `searchChange` / `statusChange` outputs.
 *
 * Filtering itself is delegated to the parent (which drives the BFF call),
 * matching the crowdfunding pattern where the list child stays a pure view.
 */
@Component({
  selector: 'lfx-mentorship-programs-list',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent, CardComponent, EmptyStateComponent, ProgramCardComponent],
  templateUrl: './programs-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramsListComponent {
  // ─── Inputs / Outputs ──────────────────────────────────────────────────────
  public readonly programs = input.required<MentorshipProgram[]>();
  public readonly searchTerm = input<string>('');
  public readonly statusFilter = input<MentorshipProgramStatus | null>(null);
  public readonly searchChange = output<string>();
  public readonly statusChange = output<MentorshipProgramStatus | null>();
  public readonly programClick = output<string>();

  // ─── Form ──────────────────────────────────────────────────────────────────
  protected readonly form = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    status: new FormControl<MentorshipProgramStatus | null>(null),
  });

  // ─── Static Options ────────────────────────────────────────────────────────
  protected readonly statusOptions: StatusOption[] = [
    { label: 'All statuses', value: null },
    ...MENTORSHIP_PROGRAM_STATUSES.map((status) => ({
      label: MENTORSHIP_PROGRAM_STATUS_LABELS[status],
      value: status,
    })),
  ];

  // ─── Computed ──────────────────────────────────────────────────────────────
  protected readonly hasActiveFilter = computed(() => !!this.searchTerm().trim() || this.statusFilter() !== null);
  protected readonly emptyTitle = computed(() => (this.hasActiveFilter() ? 'No programs match your filters' : 'No programs yet'));
  protected readonly emptySubtitle = computed(() =>
    this.hasActiveFilter() ? 'Try clearing the search or picking a different status.' : 'Enroll a program to get started.'
  );

  public constructor() {
    // Sync the parent's `searchTerm` / `statusFilter` signals into the form
    // (one-way), so parent-driven resets stay reflected in the inputs.
    effect(() => {
      const nextSearch = this.searchTerm();
      const nextStatus = this.statusFilter();
      untracked(() => {
        if (this.form.controls.search.value !== nextSearch) {
          this.form.controls.search.setValue(nextSearch, { emitEvent: false });
        }
        if (this.form.controls.status.value !== nextStatus) {
          this.form.controls.status.setValue(nextStatus, { emitEvent: false });
        }
      });
    });

    // Forward form changes back to the parent as plain outputs.
    this.form.controls.search.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.searchChange.emit(value ?? ''));

    this.form.controls.status.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.statusChange.emit(value ?? null));
  }

  protected onCardClick(slug: string): void {
    this.programClick.emit(slug);
  }
}
