// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { Committee, Vote } from '@lfx-one/shared/interfaces';
import { buildCommitteeCreateQueryParams } from '@lfx-one/shared/utils';
import { VotesTableComponent } from '@app/modules/votes/components/votes-table/votes-table.component';
import { VoteResultsDrawerComponent } from '@app/modules/votes/components/vote-results-drawer/vote-results-drawer.component';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { MessageService } from 'primeng/api';
import { finalize } from 'rxjs';

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
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);

  // Inputs — votes data is pre-fetched and passed from committee-view so the tab badge count is
  // available before the user first opens this tab.
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);
  public votes = input<Vote[]>([]);
  public votesLoading = input<boolean>(true);

  // Outputs
  /** Emitted when a vote is deleted so the parent can re-fetch and update the tab badge count. */
  public readonly refresh = output<void>();

  // State
  public creating = signal(false);
  public resultsDrawerVisible = model<boolean>(false);
  public selectedVoteId = signal<string | null>(null);
  public selectedVote = signal<Vote | null>(null);

  // Data
  public createVoteQueryParams: Signal<Record<string, string>> = this.initCreateVoteQueryParams();
  // Edit-link fallback: every row here belongs to this committee, so its committee_uid admits
  // committee writers through writerGuard even when the indexed row omits the field (GH-1568).
  public editVoteQueryParams: Signal<Record<string, string>> = this.createVoteQueryParams;

  public viewVoteResults(voteUid: string): void {
    const vote = this.votes().find((v) => v.uid === voteUid) || null;
    this.selectedVoteId.set(voteUid);
    this.selectedVote.set(vote);
    this.resultsDrawerVisible.set(true);
  }

  /** votes-table's refresh output, fired after a successful delete — propagates to parent. */
  public refreshVotes(): void {
    this.refresh.emit();
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
}
