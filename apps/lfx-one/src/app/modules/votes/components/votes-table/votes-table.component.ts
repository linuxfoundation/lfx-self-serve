// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { PollStatus, VOTE_LABEL } from '@lfx-one/shared';
import { FilterPillOption, Vote, VoteFilterState } from '@lfx-one/shared/interfaces';
import { DueDateLabelPipe } from '@pipes/due-date-label.pipe';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { combineLatest, debounceTime, distinctUntilChanged, map, startWith, take } from 'rxjs';

@Component({
  selector: 'lfx-votes-table',
  imports: [
    CardComponent,
    CardTabsBarComponent,
    TableComponent,
    TagComponent,
    ButtonComponent,
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    InputTextComponent,
    SelectComponent,
    PollStatusLabelPipe,
    PollStatusSeverityPipe,
    DueDateLabelPipe,
    TooltipModule,
    ConfirmDialogModule,
    EmptyStateComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './votes-table.component.html',
})
export class VotesTableComponent {
  // === Injections ===
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly voteService = inject(VoteService);
  private readonly destroyRef = inject(DestroyRef);

  // === Constants ===
  protected readonly voteLabel = VOTE_LABEL;
  protected readonly PollStatus = PollStatus;
  protected readonly statusTabOptions: FilterPillOption[] = [
    { id: 'all', label: 'All' },
    { id: PollStatus.ACTIVE, label: 'Active' },
    { id: PollStatus.ENDED, label: 'Ended' },
  ];

  // === Inputs ===
  public readonly votes = input.required<Vote[]>();
  public readonly hasPMOAccess = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly totalRecords = input<number>(0);
  public readonly rowsPerPage = input<number>(10);
  public readonly first = input<number>(0);
  public readonly lazy = input<boolean>(false);
  public readonly groupOptions = input<{ label: string; value: string | null }[]>([{ label: 'All Groups', value: null }]);
  public readonly foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public readonly projectOptions = input<{ label: string; value: string | null }[]>([]);
  public readonly showFoundationFilter = input<boolean>(false);
  public readonly showProjectFilter = input<boolean>(false);

  // === Outputs ===
  public readonly viewVote = output<string>();
  public readonly viewResults = output<string>();
  public readonly refresh = output<void>();
  public readonly pageChange = output<{ first: number; rows: number }>();
  public readonly filtersChange = output<VoteFilterState>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();

  // === Forms ===
  public searchForm = new FormGroup({
    search: new FormControl<string>(''),
    group: new FormControl<string | null>(null),
    foundationFilter: new FormControl<string | null>(null),
    projectFilter: new FormControl<string | null>(null),
  });

  // === Writable Signals ===
  protected readonly isDeleting = signal(false);
  protected readonly statusTab = signal<string>('all');
  private readonly filterState = signal<VoteFilterState>({ search: '', status: null, group: null });

  // === Computed Signals ===
  protected readonly displayedVotes: Signal<Vote[]> = this.initDisplayedVotes();
  protected readonly isFiltered = computed(() => {
    if (this.lazy()) return false;
    const f = this.filterState();
    return this.statusTab() !== 'all' || !!f.search || !!f.group;
  });

  protected readonly rppOptions = computed<number[] | undefined>(() => {
    const count = this.lazy() ? this.totalRecords() : this.displayedVotes().length;
    return count > 10 ? [10, 25, 50] : undefined;
  });

  // === Constructor ===
  public constructor() {
    this.initFormSubscriptions();
  }

  // === Protected Methods ===
  protected onViewVote(voteId: string): void {
    this.viewVote.emit(voteId);
  }

  protected onViewResults(voteId: string): void {
    this.viewResults.emit(voteId);
  }

  protected onStatusTabChange(tab: string): void {
    this.statusTab.set(tab);
  }

  protected onFoundationFilterChange(value: string | null): void {
    this.foundationFilterChange.emit(value);
    this.searchForm.get('projectFilter')?.setValue(null, { emitEvent: false });
    this.projectFilterChange.emit(null);
  }

  protected onPageChange(event: { first: number; rows: number }): void {
    this.pageChange.emit({ first: event.first, rows: event.rows });
  }

  protected onRowSelect(event: { data: Vote }): void {
    const vote = event.data;
    if (vote.status === PollStatus.ENDED) {
      this.viewResults.emit(vote.uid);
    } else {
      this.viewVote.emit(vote.uid);
    }
  }

  protected resetFilters(): void {
    this.searchForm.reset({ search: '', group: null, foundationFilter: null, projectFilter: null });
    this.statusTab.set('all');
    this.foundationFilterChange.emit(null);
    this.projectFilterChange.emit(null);
  }

  protected onDeleteVote(vote: Vote): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the ${this.voteLabel.singular.toLowerCase()} "${vote.name}"? This action cannot be undone.`,
      header: `Delete ${this.voteLabel.singular}`,
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => {
        this.isDeleting.set(true);
        this.voteService
          .deleteVote(vote.uid)
          .pipe(take(1))
          .subscribe({
            next: () => {
              this.messageService.add({
                severity: 'success',
                summary: 'Success',
                detail: `${this.voteLabel.singular} deleted successfully`,
              });
              this.isDeleting.set(false);
              this.refresh.emit();
            },
            error: (error) => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: `Failed to delete ${this.voteLabel.singular.toLowerCase()}: ${error.message || 'Unknown error'}`,
              });
              this.isDeleting.set(false);
            },
          });
      },
    });
  }

  // === Private Initializers ===
  private initFormSubscriptions(): void {
    combineLatest([
      this.searchForm.valueChanges.pipe(
        startWith(this.searchForm.value),
        debounceTime(300),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
      ),
      toObservable(this.statusTab),
    ])
      .pipe(
        map(([formValue, statusTab]) => ({
          search: formValue.search ?? '',
          status: statusTab !== 'all' ? (statusTab as PollStatus) : null,
          group: formValue.group ?? null,
        })),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((filters) => {
        this.filterState.set(filters);
        this.filtersChange.emit(filters);
      });
  }

  private initDisplayedVotes(): Signal<Vote[]> {
    return computed(() => {
      const allVotes = this.votes();

      // For lazy (server-side paginated) mode, the server handles all filtering via filtersChange
      if (this.lazy()) return allVotes;

      // For client-side mode (Me lens), apply all filters locally
      const filters = this.filterState();
      let filtered = allVotes;

      const tab = this.statusTab();
      if (tab !== 'all') {
        filtered = filtered.filter((v) => (v.status as string).toLowerCase() === tab);
      }

      if (filters.search) {
        const term = filters.search.toLowerCase();
        filtered = filtered.filter((v) => v.name.toLowerCase().includes(term));
      }

      if (filters.group) {
        filtered = filtered.filter((v) => v.committee_name === filters.group);
      }

      return filtered;
    });
  }
}
