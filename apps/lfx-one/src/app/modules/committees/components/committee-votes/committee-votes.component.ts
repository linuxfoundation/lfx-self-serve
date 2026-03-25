// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { Committee, PaginatedResponse, Vote } from '@lfx-one/shared/interfaces';
import { VotesTableComponent } from '@app/modules/votes/components/votes-table/votes-table.component';
import { VoteResultsDrawerComponent } from '@app/modules/votes/components/vote-results-drawer/vote-results-drawer.component';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { catchError, debounceTime, distinctUntilChanged, filter, finalize, map, of, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-committee-votes',
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, CardComponent, InputTextComponent, VotesTableComponent, VoteResultsDrawerComponent],
  templateUrl: './committee-votes.component.html',
  styleUrl: './committee-votes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeVotesComponent {
  private readonly voteService = inject(VoteService);
  private readonly messageService = inject(MessageService);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);

  // State
  public loading = signal<boolean>(true);
  public resultsDrawerVisible = model<boolean>(false);
  public selectedVoteId = signal<string | null>(null);
  public selectedVote = signal<Vote | null>(null);

  // Search
  public searchForm = new FormGroup({ search: new FormControl('') });

  // Data
  public votes: Signal<Vote[]> = this.initVotes();

  // Filtered by search
  public filteredVotes: Signal<Vote[]> = this.initFilteredVotes();

  /** Opens the vote results drawer for the selected vote. */
  public viewVoteResults(voteUid: string): void {
    const vote = this.votes().find((v) => v.uid === voteUid) || null;
    this.selectedVoteId.set(voteUid);
    this.selectedVote.set(vote);
    this.resultsDrawerVisible.set(true);
  }

  // Private initializer functions
  private initVotes(): Signal<Vote[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.loading.set(true);
          return this.voteService.getVotesByProjectPaginated(c.project_uid, 1000, undefined, undefined, [`committee_uid:${c.uid}`]).pipe(
            map((response) => response.data),
            catchError((error) => {
              console.error('Failed to load committee votes:', error);
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load votes. Please try again.' });
              return of([]);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initFilteredVotes(): Signal<Vote[]> {
    const searchTerm = toSignal(
      (this.searchForm.get('search') as FormControl).valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()),
      { initialValue: '' }
    );

    return computed(() => {
      const term = (searchTerm() || '').toLowerCase();
      const all = this.votes();
      if (!term) return all;
      return all.filter((v) => v.name?.toLowerCase().includes(term));
    });
  }
}
