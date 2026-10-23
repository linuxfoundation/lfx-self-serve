// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { VOTE_DETAIL_PAGE_DEFAULT, VOTE_DETAIL_PAGE_FLAG } from '@lfx-one/shared/constants';
import { Committee, Vote } from '@lfx-one/shared/interfaces';
import { buildCommitteeCreateQueryParams } from '@lfx-one/shared/utils';
import { VotesTableComponent } from '@app/modules/votes/components/votes-table/votes-table.component';
import { VoteResultsDrawerComponent } from '@app/modules/votes/components/vote-results-drawer/vote-results-drawer.component';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
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
  private readonly featureFlagService = inject(FeatureFlagService);

  // Inputs — votes data is pre-fetched and passed from committee-view so the tab badge count is
  // available before the user first opens this tab.
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);
  public votes = input<Vote[]>([]);
  public votesLoading = input<boolean>(true);

  // Outputs
  /** Emitted when a vote is deleted so the parent can re-fetch and update the tab badge count. */
  public readonly refresh = output<void>();
  /** Relays votes-table's voteExtended output to committee-view, which holds the override in
   *  parent-owned state — this component (and any local override it held) is destroyed/recreated on
   *  every tab switch, which previously dropped the confirmed deadline (per @audigregorie, GH-3823
   *  review). */
  public readonly voteExtended = output<Vote>();

  // State
  public creating = signal(false);
  public resultsDrawerVisible = model<boolean>(false);
  public selectedVoteId = signal<string | null>(null);

  // Data
  public createVoteQueryParams: Signal<Record<string, string>> = this.initCreateVoteQueryParams();
  // Edit-link fallback: every row here belongs to this committee, so its committee_uid admits
  // committee writers through writerGuard even when the indexed row omits the field (GH-1568).
  public editVoteQueryParams: Signal<Record<string, string>> = this.createVoteQueryParams;
  // Keeps the open drawer's listVote fed with the latest row data (e.g. an extended deadline) —
  // derived from id + votes() so it naturally re-evaluates on every votes() update (including
  // committee-view's extendedVoteOverrides overlay, applied synchronously on voteExtended) and falls
  // back to null once the id is cleared or the row leaves the list, instead of the one-time snapshot an
  // effect()-driven write would leave stale (per @cursor).
  public selectedVote: Signal<Vote | null> = this.initSelectedVote();
  /** Vote detail page (#3913): when on, opening a vote from this tab navigates to /votes/:id instead of opening the drawer. */
  private readonly voteDetailPageEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(VOTE_DETAIL_PAGE_FLAG, VOTE_DETAIL_PAGE_DEFAULT);

  public viewVote(voteUid: string): void {
    if (this.openVoteDetailPage(voteUid, null)) return;
    this.openResultsDrawer(voteUid);
  }

  public viewVoteResults(voteUid: string): void {
    if (this.openVoteDetailPage(voteUid, 'results')) return;
    this.openResultsDrawer(voteUid);
  }

  /** votes-table's refresh output, fired after a successful delete — propagates to parent. */
  public refreshVotes(): void {
    this.refresh.emit();
  }

  /** votes-table's voteExtended output — carries the confirmed vote so the open drawer updates immediately
   *  instead of waiting on refresh()'s eventually-consistent search-index refetch (per @greptile-apps).
   *  Relayed to committee-view rather than held locally so the override survives this component being
   *  destroyed/recreated on tab switches (per @audigregorie, GH-3823 review). */
  protected onVoteExtended(vote: Vote): void {
    this.voteExtended.emit(vote);
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
      return this.votes().find((v) => v.uid === id) || null;
    });
  }

  // Private helpers
  /** Mirrors the votes dashboard: with the vote detail page on, a vote opens on its page. Returns whether it navigated. */
  private openVoteDetailPage(voteUid: string, tab: 'results' | null): boolean {
    if (!this.voteDetailPageEnabled()) return false;
    void this.router.navigate(['/votes', voteUid], tab ? { queryParams: { tab } } : {});
    return true;
  }

  private openResultsDrawer(voteUid: string): void {
    this.selectedVoteId.set(voteUid);
    this.resultsDrawerVisible.set(true);
  }
}
