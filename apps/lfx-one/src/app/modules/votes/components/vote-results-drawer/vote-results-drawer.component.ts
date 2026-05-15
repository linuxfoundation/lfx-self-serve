// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TagComponent } from '@components/tag/tag.component';
import { PollStatus, PollType } from '@lfx-one/shared';
import {
  PollCommentResult,
  RankedQuestionView,
  Vote,
  VoteParticipationStats,
  VoteResultsOption,
  VoteResultsQuestion,
  VoteResultsResponse,
} from '@lfx-one/shared/interfaces';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { VoteService } from '@services/vote.service';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, finalize, of, shareReplay, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-vote-results-drawer',
  imports: [DrawerModule, TagComponent, DatePipe, PollStatusLabelPipe, PollStatusSeverityPipe, SkeletonModule],
  templateUrl: './vote-results-drawer.component.html',
  styleUrl: './vote-results-drawer.component.scss',
})
export class VoteResultsDrawerComponent {
  // === Services ===
  private readonly voteService = inject(VoteService);

  // === Inputs ===
  public readonly voteId = input<string | null>(null);
  public readonly listVote = input<Vote | null>(null);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Writable Signals ===
  protected readonly loadingVoteDetails = signal<boolean>(false);
  protected readonly loadingVoteResults = signal<boolean>(false);

  // === Shared Observables ===
  private readonly voteId$ = toObservable(this.voteId).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  // === Derived Signals (from API) ===
  protected readonly vote: Signal<Vote | null> = this.initVote();
  protected readonly voteResults: Signal<VoteResultsResponse | null> = this.initVoteResults();

  // === Computed Signals ===
  protected readonly isGenericPoll: Signal<boolean> = this.initIsGenericPoll();
  protected readonly isLoading: Signal<boolean> = computed(() => this.loadingVoteDetails() || this.loadingVoteResults());
  protected readonly participationStats: Signal<VoteParticipationStats> = this.initParticipationStats();
  protected readonly isVoteClosed: Signal<boolean> = this.initIsVoteClosed();
  protected readonly questionsWithResults: Signal<VoteResultsQuestion[]> = this.initQuestionsWithResults();
  protected readonly rankedQuestions: Signal<RankedQuestionView[]> = this.initRankedQuestions();
  protected readonly commentResults: Signal<PollCommentResult[]> = this.initCommentResults();
  protected readonly votingMethodText: Signal<string> = this.initVotingMethodText();
  protected readonly rankedMethodDescription: Signal<string> = this.initRankedMethodDescription();

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initVote(): Signal<Vote | null> {
    return toSignal(
      this.voteId$.pipe(
        switchMap((id) => {
          if (!id) {
            this.loadingVoteDetails.set(false);
            return of(null);
          }

          this.loadingVoteDetails.set(true);
          const listVote = this.listVote();

          return this.voteService.getVote(id).pipe(
            catchError(() => of(listVote)),
            finalize(() => this.loadingVoteDetails.set(false)),
            startWith(listVote)
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initVoteResults(): Signal<VoteResultsResponse | null> {
    return toSignal(
      this.voteId$.pipe(
        switchMap((id) => {
          if (!id) {
            this.loadingVoteResults.set(false);
            return of(null);
          }

          this.loadingVoteResults.set(true);
          return this.voteService.getVoteResults(id).pipe(
            catchError(() => of(null)),
            finalize(() => this.loadingVoteResults.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initIsGenericPoll(): Signal<boolean> {
    return computed(() => {
      const v = this.vote();
      if (!v) return false;
      // Missing poll_type defaults to GENERIC (matches initVotingMethodText) so the plurality branch renders.
      return (v.poll_type ?? PollType.GENERIC) === PollType.GENERIC;
    });
  }

  private initIsVoteClosed(): Signal<boolean> {
    return computed(() => {
      const v = this.vote();
      if (v?.status === PollStatus.ENDED) return true;

      // Treat 100% participation as finalized even if the vote hasn't formally ended
      const stats = this.participationStats();
      return stats.eligibleVoters > 0 && stats.participationRate >= 100;
    });
  }

  private initParticipationStats(): Signal<VoteParticipationStats> {
    return computed(() => {
      const results = this.voteResults();
      if (!results) {
        return { eligibleVoters: 0, totalResponses: 0, participationRate: 0 };
      }

      const eligibleVoters = results.num_recipients || 0;
      const totalResponses = results.num_votes_cast || 0;
      const participationRate = eligibleVoters > 0 ? Math.round((totalResponses / eligibleVoters) * 100) : 0;

      return { eligibleVoters, totalResponses, participationRate };
    });
  }

  private initQuestionsWithResults(): Signal<VoteResultsQuestion[]> {
    return computed(() => {
      const results = this.voteResults();
      const isClosed = this.isVoteClosed();

      if (!results?.poll_results?.length) {
        return [];
      }

      return results.poll_results.map((pollResult) => {
        const choiceVotes = pollResult.generic_choice_votes || [];

        // Compute total votes first for percentage calculation
        const totalVotes = choiceVotes.reduce((sum, cv) => sum + cv.vote_count, 0);

        // Build options with vote counts from the results API
        const optionsWithCounts: VoteResultsOption[] = choiceVotes.map((cv) => ({
          choiceId: cv.choice_id,
          text: pollResult.question.choices.find((c) => c.choice_id === cv.choice_id)?.choice_text || cv.choice_id,
          voteCount: cv.vote_count,
          percentage: this.computePercentage(cv.percentage, cv.vote_count, totalVotes),
          isWinner: false,
          isTied: false,
          isLeading: false,
        }));

        // Determine winner/ties based on max votes
        const maxVotes = Math.max(...optionsWithCounts.map((o) => o.voteCount), 0);
        const optionsWithMaxVotes = optionsWithCounts.filter((o) => o.voteCount === maxVotes);
        const isTied = optionsWithMaxVotes.length > 1 && maxVotes > 0;

        const processedOptions = optionsWithCounts.map((option) => ({
          ...option,
          isWinner: isClosed && !isTied && option.voteCount === maxVotes && maxVotes > 0,
          isTied: isClosed && isTied && option.voteCount === maxVotes,
          isLeading: option.voteCount === maxVotes && maxVotes > 0,
        }));

        return {
          questionId: pollResult.question.question_id,
          question: pollResult.question.prompt,
          options: processedOptions,
          totalVotes,
        };
      });
    });
  }

  /** Derives the ranked-choice per-question view model — round-summary payload is untyped upstream so detailed visualization is deferred to a placeholder banner. */
  private initRankedQuestions(): Signal<RankedQuestionView[]> {
    return computed(() => {
      const results = this.voteResults();
      if (!results?.poll_results?.length) return [];

      return results.poll_results.map((pr) => {
        // Choice text: prefer winner_info.poll_choices, fall back to question.choices.
        const choiceTextById = new Map((pr.ranked_choice_winner_info?.poll_choices ?? pr.question.choices ?? []).map((c) => [c.choice_id, c.choice_text]));

        const choiceDistributions = (pr.ranked_choice_votes ?? []).map((rcv) => {
          const totalRanked = rcv.rank_counts.reduce((sum, rc) => sum + rc.count, 0);
          const rankCounts = rcv.rank_counts.map((rc) => ({
            rank: rc.rank,
            count: rc.count,
            percentage: totalRanked > 0 ? Math.round((rc.count / totalRanked) * 100) : 0,
          }));
          return {
            choiceId: rcv.choice_id,
            choiceText: choiceTextById.get(rcv.choice_id) ?? rcv.choice_id,
            totalRanked,
            rankCounts,
          };
        });

        return {
          questionId: pr.question.question_id,
          prompt: pr.question.prompt,
          choiceDistributions,
          hasRoundSummary: !!pr.irv_round_summary || !!pr.meek_stv_round_summary,
        };
      });
    });
  }

  private initCommentResults(): Signal<PollCommentResult[]> {
    return computed(() => {
      const results = this.voteResults();
      if (!results?.comment_results?.length) {
        return [];
      }

      return results.comment_results.filter((cr) => cr.comments.length > 0);
    });
  }

  private computePercentage(apiPercentage: number, voteCount: number, totalVotes: number): number {
    if (apiPercentage > 0) return apiPercentage;
    if (totalVotes <= 0) return 0;
    return Math.round((voteCount / totalVotes) * 100);
  }

  private initVotingMethodText(): Signal<string> {
    return computed(() => {
      const v = this.vote();
      if (!v) return '';

      const methodLabels: Record<PollType, string> = {
        [PollType.GENERIC]: 'Plurality Vote',
        [PollType.CONDORCET_IRV]: 'Ranked Choice (Condorcet IRV)',
        [PollType.INSTANT_RUNOFF_VOTE]: 'Instant Runoff Vote',
        [PollType.MEEK_STV]: 'Meek STV',
      };

      const pollType = v.poll_type ?? PollType.GENERIC;
      return methodLabels[pollType] || pollType;
    });
  }

  private initRankedMethodDescription(): Signal<string> {
    return computed(() => {
      const pollType = this.vote()?.poll_type;
      switch (pollType) {
        case PollType.CONDORCET_IRV:
          return 'Voters ranked the choices in order of preference. Condorcet IRV first looks for a candidate who would beat every other candidate in head-to-head pairwise comparisons; if no such Condorcet winner exists, it falls back to instant-runoff elimination.';
        case PollType.INSTANT_RUNOFF_VOTE:
          return 'Voters ranked the choices in order of preference. Instant-runoff voting tallies first-preference votes and eliminates the lowest-ranked choice each round, reallocating those ballots until a candidate has a majority.';
        case PollType.MEEK_STV:
          return 'Voters ranked the choices in order of preference. Meek STV is a multi-winner single-transferable-vote method that elects candidates as they meet a quota and proportionally redistributes surplus and eliminated ballots.';
        default:
          return 'Voters ranked the choices in order of preference. The configured ranked-choice algorithm determines the winner (or winners).';
      }
    });
  }
}
