// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { POLL_STATUS_LABELS, PollStatus, VOTE_LABEL } from '@lfx-one/shared';
import { Vote, VoteFilterState } from '@lfx-one/shared/interfaces';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { RelativeDueDatePipe } from '@pipes/relative-due-date.pipe';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';

@Component({
  selector: 'lfx-votes-table',
  imports: [
    CardComponent,
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
    RelativeDueDatePipe,
    TooltipModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './votes-table.component.html',
})
export class VotesTableComponent implements OnInit {
  // === Injections ===
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly voteService = inject(VoteService);
  private readonly destroyRef = inject(DestroyRef);

  // === Constants ===
  protected readonly voteLabel = VOTE_LABEL;
  protected readonly PollStatus = PollStatus;

  // === Inputs ===
  public readonly votes = input.required<Vote[]>();
  public readonly hasPMOAccess = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly totalRecords = input<number>(0);
  public readonly rowsPerPage = input<number>(10);
  public readonly first = input<number>(0);
  public readonly lazy = input<boolean>(false);
  public readonly groupOptions = input<{ label: string; value: string | null }[]>([{ label: 'All Groups', value: null }]);

  // === Outputs ===
  public readonly viewVote = output<string>();
  public readonly viewResults = output<string>();
  public readonly refresh = output<void>();
  public readonly pageChange = output<{ first: number; rows: number }>();
  public readonly filtersChange = output<VoteFilterState>();

  // === Writable Signals ===
  protected readonly isDeleting = signal(false);

  // === Forms ===
  public searchForm = new FormGroup({
    search: new FormControl<string>(''),
    status: new FormControl<PollStatus | null>(null),
    group: new FormControl<string | null>(null),
  });

  // === Computed Signals ===
  protected readonly statusOptions: Signal<{ label: string; value: PollStatus | null }[]> = this.initStatusOptions();

  // === Lifecycle ===
  public ngOnInit(): void {
    this.initFormSubscriptions();
  }

  // === Protected Methods ===
  protected onViewVote(voteId: string): void {
    this.viewVote.emit(voteId);
  }

  protected onViewResults(voteId: string): void {
    this.viewResults.emit(voteId);
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
        this.voteService.deleteVote(vote.uid).subscribe({
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
    this.searchForm.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        map((value) => ({
          search: value.search ?? '',
          status: value.status ?? null,
          group: value.group ?? null,
        })),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((filters) => this.filtersChange.emit(filters));
  }

  private initStatusOptions(): Signal<{ label: string; value: PollStatus | null }[]> {
    return computed(() => {
      const options: { label: string; value: PollStatus | null }[] = [{ label: 'All Statuses', value: null }];

      const statusOrder: PollStatus[] = [PollStatus.ACTIVE, PollStatus.DISABLED, PollStatus.ENDED];
      for (const status of statusOrder) {
        const shouldShowStatus = status !== PollStatus.DISABLED || this.hasPMOAccess();
        if (shouldShowStatus) {
          options.push({
            label: POLL_STATUS_LABELS[status],
            value: status,
          });
        }
      }

      return options;
    });
  }
}
