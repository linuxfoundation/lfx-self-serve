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
  // Confirmed deadline from votes-table's voteExtended output, held until votes() reflects a deadline at
  // least as new (self-healing, mirrors votes-table's own extendedDeadlines overlay) — a stale search-index
  // refresh otherwise leaves the open results drawer showing the pre-extension deadline indefinitely (per
  // @greptile-apps, GH-3823 review).
  private readonly extendedVoteOverride = signal<Vote | null>(null);

  // Data
  public createVoteQueryParams: Signal<Record<string, string>> = this.initCreateVoteQueryParams();
  // Edit-link fallback: every row here belongs to this committee, so its committee_uid admits
  // committee writers through writerGuard even when the indexed row omits the field (GH-1568).
  public editVoteQueryParams: Signal<Record<string, string>> = this.createVoteQueryParams;
  // Keeps the open drawer's listVote fed with the latest row data (e.g. an extended deadline) once
  // the parent re-fetches after refresh.emit() — derived from id + votes() so it naturally re-evaluates
  // on every votes() update and falls back to null once the id is cleared or the row leaves the list,
  // instead of the one-time snapshot an effect()-driven write would leave stale (per @cursor).
  public selectedVote: Signal<Vote | null> = this.initSelectedVote();

  public viewVoteResults(voteUid: string): void {
    this.selectedVoteId.set(voteUid);
    this.resultsDrawerVisible.set(true);
  }

  /** votes-table's refresh output, fired after a successful delete — propagates to parent. */
  public refreshVotes(): void {
    this.refresh.emit();
  }

  /** votes-table's voteExtended output — carries the confirmed vote so the open drawer updates immediately
   *  instead of waiting on refresh()'s eventually-consistent search-index refetch (per @greptile-apps). */
  protected onVoteExtended(vote: Vote): void {
    this.extendedVoteOverride.set(vote);
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

  private initSelectedVote(): Signal<Vote | null> {
    return computed(() => {
      const id = this.selectedVoteId();
      if (!id) return null;
      const row = this.votes().find((v) => v.uid === id) || null;
      const override = this.extendedVoteOverride();
      if (override?.uid === id && (!row || new Date(row.end_time).getTime() < new Date(override.end_time).getTime())) {
        return { ...(row ?? override), ...override };
      }
      return row;
    });
  }
}
