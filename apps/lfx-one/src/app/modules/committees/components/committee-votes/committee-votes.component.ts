// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CardComponent } from '@components/card/card.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { Committee, Vote } from '@lfx-one/shared/interfaces';
import { VotesTableComponent } from '@app/modules/votes/components/votes-table/votes-table.component';
import { VoteResultsDrawerComponent } from '@app/modules/votes/components/vote-results-drawer/vote-results-drawer.component';
import { VoteService } from '@services/vote.service';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-committee-votes',
  imports: [CardComponent, RouteLoadingComponent, VotesTableComponent, VoteResultsDrawerComponent],
  templateUrl: './committee-votes.component.html',
  styleUrl: './committee-votes.component.scss',
})
export class CommitteeVotesComponent {
  private readonly voteService = inject(VoteService);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);

  // State
  public loading = signal<boolean>(true);
  public resultsDrawerVisible = model<boolean>(false);
  public selectedVoteId = signal<string | null>(null);
  public selectedVote = signal<Vote | null>(null);

  // Data
  public votes: Signal<Vote[]> = this.initVotes();

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
        switchMap((c) =>
          this.voteService.getVotesByCommittee(c.uid, undefined, 'last_modified_time.desc').pipe(
            tap(() => this.loading.set(false)),
            catchError(() => {
              this.loading.set(false);
              return of([]);
            })
          )
        )
      ),
      { initialValue: [] }
    );
  }
}
