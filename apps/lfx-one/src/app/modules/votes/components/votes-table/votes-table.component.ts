// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { POLL_STATUS_LABELS, PollStatus, VOTE_LABEL } from '@lfx-one/shared';
import { Vote } from '@lfx-one/shared/interfaces';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { RelativeDueDatePipe } from '@pipes/relative-due-date.pipe';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs';

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
export class VotesTableComponent {
  // === Injections ===
  private readonly confirmationService = inject(ConfirmationService);

  // === Constants ===
  protected readonly voteLabel = VOTE_LABEL;
  protected readonly PollStatus = PollStatus;

  // === Inputs ===
  public readonly votes = input.required<Vote[]>();
  public readonly hasPMOAccess = input<boolean>(false);

  // === Outputs ===
  public readonly viewVote = output<string>();
  public readonly viewResults = output<string>();
  public readonly refresh = output<void>();

  // === Writable Signals ===
  protected readonly isDeleting = signal(false);

  // === Forms ===
  public searchForm = new FormGroup({
    search: new FormControl<string>(''),
    status: new FormControl<PollStatus | null>(null),
    group: new FormControl<string | null>(null),
  });

  // === Writable Signals ===
  private readonly statusFilter = signal<PollStatus | null>(null);
  private readonly groupFilter = signal<string | null>(null);

  // === Computed Signals ===
  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  protected readonly statusOptions: Signal<{ label: string; value: PollStatus | null }[]> = this.initStatusOptions();
  protected readonly groupOptions: Signal<{ label: string; value: string | null }[]> = this.initGroupOptions();
  protected readonly filteredVotes: Signal<Vote[]> = this.initFilteredVotes();

  // === Protected Methods ===
  protected onStatusChange(value: PollStatus | null): void {
    this.statusFilter.set(value);
  }

  protected onGroupChange(value: string | null): void {
    this.groupFilter.set(value);
  }

  protected onViewVote(voteId: string): void {
    this.viewVote.emit(voteId);
  }

  protected onViewResults(voteId: string): void {
    this.viewResults.emit(voteId);
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
        // TODO: Call votes service to delete when implemented
        this.refresh.emit();
      },
    });
  }

  // === Private Initializers ===
  private initSearchTerm(): Signal<string> {
    return toSignal(
      this.searchForm.get('search')!.valueChanges.pipe(
        startWith(''),
        debounceTime(300),
        distinctUntilChanged(),
        map((value) => value ?? '')
      ),
      { initialValue: '' }
    );
  }

  private initStatusOptions(): Signal<{ label: string; value: PollStatus | null }[]> {
    return computed(() => {
      const votesData = this.votes();
      const statusCounts = new Map<PollStatus, number>();

      votesData.forEach((vote) => {
        statusCounts.set(vote.status, (statusCounts.get(vote.status) || 0) + 1);
      });

      const options: { label: string; value: PollStatus | null }[] = [{ label: 'All Statuses', value: null }];

      const statusOrder: PollStatus[] = [PollStatus.ACTIVE, PollStatus.DISABLED, PollStatus.ENDED];
      statusOrder.forEach((status) => {
        const count = statusCounts.get(status) || 0;
        // Show status if it has items, OR if it's DISABLED and user has PMO access
        const shouldShowStatus = count > 0 || (status === PollStatus.DISABLED && this.hasPMOAccess());
        if (shouldShowStatus) {
          options.push({
            label: `${POLL_STATUS_LABELS[status]} (${count})`,
            value: status,
          });
        }
      });

      return options;
    });
  }

  private initGroupOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const votesData = this.votes();
      const groupCounts = new Map<string, number>();

      votesData.forEach((vote) => {
        const name = vote.committee_name || 'Unknown';
        groupCounts.set(name, (groupCounts.get(name) || 0) + 1);
      });

      const uniqueGroups = Array.from(groupCounts.keys()).sort((a, b) => a.localeCompare(b));

      const options: { label: string; value: string | null }[] = [{ label: 'All Groups', value: null }];

      uniqueGroups.forEach((group) => {
        const count = groupCounts.get(group) || 0;
        options.push({
          label: `${group} (${count})`,
          value: group,
        });
      });

      return options;
    });
  }

  private initFilteredVotes(): Signal<Vote[]> {
    return computed(() => {
      let filtered = this.votes();

      const searchTerm = this.searchTerm()?.toLowerCase() || '';
      if (searchTerm) {
        filtered = filtered.filter((vote) => vote.name.toLowerCase().includes(searchTerm) || vote.committee_name?.toLowerCase().includes(searchTerm));
      }

      const status = this.statusFilter();
      if (status) {
        filtered = filtered.filter((vote) => vote.status === status);
      }

      const group = this.groupFilter();
      if (group) {
        filtered = filtered.filter((vote) => vote.committee_name === group);
      }

      return this.sortVotes(filtered);
    });
  }

  // === Private Helpers ===
  private sortVotes(votes: Vote[]): Vote[] {
    const statusPriority: Record<PollStatus, number> = {
      [PollStatus.ACTIVE]: 1,
      [PollStatus.DISABLED]: 2,
      [PollStatus.ENDED]: 3,
    };

    return [...votes].sort((a, b) => {
      const statusA = a.status;
      const statusB = b.status;

      if (statusA !== statusB) {
        return statusPriority[statusA] - statusPriority[statusB];
      }

      const dateA = a.end_time ? new Date(a.end_time).getTime() : Infinity;
      const dateB = b.end_time ? new Date(b.end_time).getTime() : Infinity;
      return dateA - dateB;
    });
  }
}
