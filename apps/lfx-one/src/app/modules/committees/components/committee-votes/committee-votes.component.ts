// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { Committee, Vote } from '@lfx-one/shared/interfaces';
import { buildCommitteeCreateQueryParams } from '@lfx-one/shared/utils';
import { VotesTableComponent } from '@app/modules/votes/components/votes-table/votes-table.component';
import { VoteResultsDrawerComponent } from '@app/modules/votes/components/vote-results-drawer/vote-results-drawer.component';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { catchError, filter, finalize, of, switchMap, take } from 'rxjs';

@Component({
  selector: 'lfx-committee-votes',
  imports: [ButtonComponent, CardComponent, VotesTableComponent, VoteResultsDrawerComponent],
  templateUrl: './committee-votes.component.html',
  styleUrl: './committee-votes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeVotesComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly lensService = inject(LensService);
  private readonly voteService = inject(VoteService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);

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
  public createVoteQueryParams: Signal<Record<string, string>> = this.initCreateVoteQueryParams();

  /** Checks committee write permission fresh before navigating to the create-vote route.
   * Redirects to project overview with _notice=votes if permission has been revoked
   * since the page loaded — consistent with the writerGuard denial flow. */
  public onCreateVote(): void {
    const committee = this.committee();
    const overviewPath = this.lensService.activeLens() === 'foundation' ? '/foundation/overview' : '/project/overview';
    const denyParams: Record<string, string> = { _notice: 'votes' };
    if (committee.project_slug) denyParams['project'] = committee.project_slug;
    const deny = () => void this.router.navigate([overviewPath], { queryParams: denyParams });

    this.committeeService
      .getCommittee(committee.uid)
      .pipe(take(1))
      .subscribe({
        next: (fresh) => {
          if (fresh?.writer !== true) {
            deny();
            return;
          }
          void this.router.navigate(['/votes', 'create'], { queryParams: this.createVoteQueryParams() });
        },
        error: () => deny(),
      });
  }

  /** Opens the vote results drawer for the selected vote. */
  public viewVoteResults(voteUid: string): void {
    const vote = this.votes().find((v) => v.uid === voteUid) || null;
    this.selectedVoteId.set(voteUid);
    this.selectedVote.set(vote);
    this.resultsDrawerVisible.set(true);
  }

  // Private initializer functions
  private initCreateVoteQueryParams(): Signal<Record<string, string>> {
    return computed(() => buildCommitteeCreateQueryParams(this.committee()));
  }

  private initVotes(): Signal<Vote[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.loading.set(true);
          return this.voteService.getVotesByCommittee(c.uid, 'updated_at.desc').pipe(
            catchError(() => {
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
}
