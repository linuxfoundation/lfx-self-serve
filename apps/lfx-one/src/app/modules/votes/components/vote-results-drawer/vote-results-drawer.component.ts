// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, effect, input, model, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import { PollStatus, PollType } from '@lfx-one/shared';
import { Vote, VoteParticipationStats, VoteResultsOption, VoteResultsQuestion } from '@lfx-one/shared/interfaces';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';

@Component({
  selector: 'lfx-vote-results-drawer',
  imports: [DrawerModule, TagComponent, ButtonComponent, DatePipe, PollStatusLabelPipe, PollStatusSeverityPipe, SkeletonModule],
  templateUrl: './vote-results-drawer.component.html',
  styleUrl: './vote-results-drawer.component.scss',
})
export class VoteResultsDrawerComponent {
  // === Inputs ===
  public readonly vote = input<Vote | null>(null);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(false);

  // === Computed Signals ===
  protected readonly isGenericPoll: Signal<boolean> = this.initIsGenericPoll();
  protected readonly pccVotingUrl: Signal<string> = this.initPccVotingUrl();
  protected readonly isVoteClosed: Signal<boolean> = this.initIsVoteClosed();
  protected readonly participationStats: Signal<VoteParticipationStats> = this.initParticipationStats();
  protected readonly questionsWithResults: Signal<VoteResultsQuestion[]> = this.initQuestionsWithResults();
  protected readonly votingMethodText: Signal<string> = this.initVotingMethodText();

  // === Constructor ===
  public constructor() {
    // Simulate loading when vote changes
    effect(() => {
      const v = this.vote();
      if (v && this.visible()) {
        this.loading.set(true);
        // Simulate API fetch delay
        setTimeout(() => this.loading.set(false), 500);
      }
    });
  }

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initIsGenericPoll(): Signal<boolean> {
    return computed(() => {
      const v = this.vote();
      return v?.poll_type === PollType.GENERIC;
    });
  }

  private initPccVotingUrl(): Signal<string> {
    return computed(() => {
      const v = this.vote();
      if (!v) return '';

      const pccBaseUrl = environment.urls.pcc;
      // Remove trailing slash if present
      const baseUrl = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
      return `${baseUrl}/project/${v.project_uid}/collaboration/voting`;
    });
  }

  private initIsVoteClosed(): Signal<boolean> {
    return computed(() => {
      const v = this.vote();
      return v?.status === PollStatus.ENDED;
    });
  }

  private initParticipationStats(): Signal<VoteParticipationStats> {
    return computed(() => {
      const v = this.vote();
      if (!v) {
        return { eligibleVoters: 0, totalResponses: 0, participationRate: 0 };
      }

      const eligibleVoters = v.total_voting_request_invitations || 0;
      const totalResponses = v.num_response_received || 0;
      const participationRate = eligibleVoters > 0 ? Math.round((totalResponses / eligibleVoters) * 100) : 0;

      return { eligibleVoters, totalResponses, participationRate };
    });
  }

  private initQuestionsWithResults(): Signal<VoteResultsQuestion[]> {
    return computed(() => {
      const v = this.vote();
      const isClosed = this.isVoteClosed();

      if (!v?.poll_questions?.length) {
        return [];
      }

      return v.poll_questions.map((question) => {
        // Get vote counts from generic_choice_votes or default to 0
        const choiceVotes = v.generic_choice_votes || {};

        // Calculate total votes for this question
        let totalVotes = 0;
        const optionsWithCounts: VoteResultsOption[] = question.choices.map((choice) => {
          const voteCount = choiceVotes[choice.choice_id] || 0;
          totalVotes += voteCount;
          return {
            choiceId: choice.choice_id,
            text: choice.choice_text,
            voteCount,
            percentage: 0, // Will calculate after we have total
            isWinner: false,
            isTied: false,
            isLeading: false, // Will calculate after we have max votes
          };
        });

        // Calculate percentages and determine winner/ties
        const maxVotes = Math.max(...optionsWithCounts.map((o) => o.voteCount), 0);
        const optionsWithMaxVotes = optionsWithCounts.filter((o) => o.voteCount === maxVotes);
        const isTied = optionsWithMaxVotes.length > 1 && maxVotes > 0;

        const processedOptions = optionsWithCounts.map((option) => ({
          ...option,
          percentage: totalVotes > 0 ? Math.round((option.voteCount / totalVotes) * 100) : 0,
          // Only show winner if vote is closed and there's no tie
          isWinner: isClosed && !isTied && option.voteCount === maxVotes && maxVotes > 0,
          // Show tied status for all options with max votes (only for closed votes)
          isTied: isClosed && isTied && option.voteCount === maxVotes,
          // Show leading status for live votes (options with max votes)
          isLeading: option.voteCount === maxVotes && maxVotes > 0,
        }));

        return {
          questionId: question.question_id,
          question: question.prompt,
          options: processedOptions,
          totalVotes,
        };
      });
    });
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
}
