// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { Committee, Vote } from '@lfx-one/shared/interfaces';
import { buildCommitteeCreateQueryParams } from '@lfx-one/shared/utils';
import { DashboardCastDrawerHostComponent } from '@app/modules/dashboards/components/dashboard-cast-drawer-host/dashboard-cast-drawer-host.component';
import { VotesTableComponent } from '@app/modules/votes/components/votes-table/votes-table.component';
import { VoteResultsDrawerComponent } from '@app/modules/votes/components/vote-results-drawer/vote-results-drawer.component';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { catchError, filter, finalize, map, merge, of, Subject, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-committee-votes',
  imports: [ButtonComponent, CardComponent, VotesTableComponent, VoteResultsDrawerComponent, DashboardCastDrawerHostComponent],
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
  public creating = signal(false);
  public resultsDrawerVisible = model<boolean>(false);
  public selectedVoteId = signal<string | null>(null);
  public selectedVote = signal<Vote | null>(null);
  // Refresh trigger for initVotes(), separate from the committee-change source it merges with below
  // so a post-cast refresh can't double-emit against it (no startWith). The payload marks a cast-drawer
  // refresh silent (no row-level resolution exists on this tab like committee-overview's castVoteUids,
  // but the row's CTA doesn't change either — response_status never comes back from this raw endpoint
  // — so a full table skeleton for that fetch isn't earning its keep) vs. loud for a real delete, which
  // does need to visibly remove a row.
  private readonly votesRefresh$ = new Subject<boolean>();

  // Data
  public votes: Signal<Vote[]> = this.initVotes();
  public createVoteQueryParams: Signal<Record<string, string>> = this.initCreateVoteQueryParams();
  public editVoteQueryParams: Signal<Record<string, string>> = this.createVoteQueryParams;

  public viewVoteResults(voteUid: string): void {
    const vote = this.votes().find((v) => v.uid === voteUid) || null;
    this.selectedVoteId.set(voteUid);
    this.selectedVote.set(vote);
    this.resultsDrawerVisible.set(true);
  }

  /** Shared refresh source: DashboardCastDrawerHost's voteSubmitted (silent — a since-closed poll
   *  auto-ends once every eligible voter has responded) and votes-table's own refresh (loud — fired
   *  after a delete, which does need the table to visibly drop the row). */
  public refreshVotes(silent = false): void {
    this.votesRefresh$.next(silent);
  }

  protected onCreateVote(): void {
    const committee = this.committee();
    const overviewPath = this.lensService.activeLens() === 'foundation' ? '/foundation/overview' : '/project/overview';
    const denyParams: Record<string, string> = { _notice: 'votes' };
    if (committee.project_slug) denyParams['project'] = committee.project_slug;
    const deny = () => void this.router.navigate([overviewPath], { queryParams: denyParams });

    this.creating.set(true);
    this.committeeService
      .fetchCommittee(committee.uid)
      .pipe(finalize(() => this.creating.set(false)))
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

  // Private initializer functions
  private initCreateVoteQueryParams(): Signal<Record<string, string>> {
    return computed(() => buildCommitteeCreateQueryParams(this.committee()));
  }

  private initVotes(): Signal<Vote[]> {
    return toSignal(
      // Cleared via tap (fires only on emission), not finalize (also fires on switchMap-driven
      // cancellation) — a silent refresh cancelling an in-flight loud fetch must not clear `loading`
      // out from under it before the silent replacement has actually resolved.
      merge(
        toObservable(this.committee).pipe(map((c) => ({ c, silent: false }))),
        this.votesRefresh$.pipe(map((silent) => ({ c: this.committee(), silent })))
      ).pipe(
        filter(({ c }) => !!c?.uid),
        switchMap(({ c, silent }) => {
          if (!silent) this.loading.set(true);
          return this.voteService.getVotesByCommittee(c.uid, 'updated_at.desc').pipe(
            catchError(() => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load votes. Please try again.' });
              return of([]);
            }),
            tap(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
