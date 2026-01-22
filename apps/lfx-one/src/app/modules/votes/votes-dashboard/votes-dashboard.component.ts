// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, signal, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { PollStatus, PollType, VOTE_LABEL } from '@lfx-one/shared';
import { Vote } from '@lfx-one/shared/interfaces';
import { BehaviorSubject } from 'rxjs';

import { VoteResultsDrawerComponent } from '../components/vote-results-drawer/vote-results-drawer.component';
import { VotesTableComponent } from '../components/votes-table/votes-table.component';

@Component({
  selector: 'lfx-votes-dashboard',
  imports: [LowerCasePipe, CardComponent, ButtonComponent, VotesTableComponent, VoteResultsDrawerComponent, RouterLink],
  templateUrl: './votes-dashboard.component.html',
  styleUrl: './votes-dashboard.component.scss',
})
export class VotesDashboardComponent {
  // === Constants ===
  protected readonly voteLabel = VOTE_LABEL.singular;
  protected readonly voteLabelPlural = VOTE_LABEL.plural;

  // === Refresh Subject ===
  protected readonly refresh = new BehaviorSubject<void>(undefined);

  // === Writable Signals ===
  protected readonly votes = signal<Vote[]>(this.getMockVotes());
  protected readonly hasPMOAccess = signal<boolean>(true);
  protected readonly resultsDrawerVisible = signal<boolean>(false);
  protected readonly selectedVoteId = signal<string | null>(null);

  // === Computed Signals ===
  protected readonly selectedVote: Signal<Vote | null> = this.initSelectedVote();

  protected onViewVote(voteId: string): void {
    this.selectedVoteId.set(voteId);
    this.resultsDrawerVisible.set(true);
  }

  protected onViewResults(voteId: string): void {
    this.selectedVoteId.set(voteId);
    this.resultsDrawerVisible.set(true);
  }

  protected refreshVotes(): void {
    // TODO: When votes service is implemented, this will trigger a re-fetch
    this.refresh.next();
  }

  // === Private Initializers ===
  private initSelectedVote(): Signal<Vote | null> {
    return computed(() => {
      const id = this.selectedVoteId();
      if (!id) return null;
      return this.votes().find((v) => v.uid === id) || null;
    });
  }

  // === Private Helpers ===
  private getMockVotes(): Vote[] {
    return [
      {
        uid: 'vote-001',
        poll_id: 'vote-001',
        name: 'Q4 2024 Budget Allocation',
        description: 'Vote on the proposed Q4 2024 budget allocation for project initiatives.',
        committee_filters: ['voting_rep'],
        committee_id: 'comm-001',
        committee_uid: 'comm-001',
        committee_name: 'Technical Steering Committee',
        committee_type: 'technical',
        committee_voting_status: true,
        creation_time: '2024-01-15T10:00:00Z',
        end_time: '2024-02-15T23:59:59Z',
        last_modified_time: '2024-01-15T10:00:00Z',
        num_response_received: 12,
        num_winners: 1,
        poll_questions: [
          {
            question_id: 'q1-001',
            prompt: 'Do you approve the proposed Q4 2024 budget allocation?',
            type: 'single_choice',
            choices: [
              { choice_id: 'approve', choice_text: 'Approve' },
              { choice_id: 'reject', choice_text: 'Reject' },
              { choice_id: 'abstain', choice_text: 'Abstain' },
            ],
          },
        ],
        poll_type: PollType.GENERIC,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.ACTIVE,
        total_voting_request_invitations: 25,
        generic_choice_votes: {
          approve: 8,
          reject: 2,
          abstain: 2,
        },
      },
      {
        uid: 'vote-002',
        poll_id: 'vote-002',
        name: 'New Maintainer Election',
        description: 'Election to select a new maintainer for the core repository.',
        committee_filters: ['voting_rep'],
        committee_id: 'comm-002',
        committee_uid: 'comm-002',
        committee_name: 'Governing Board',
        committee_type: 'governing',
        committee_voting_status: true,
        creation_time: '2024-01-10T10:00:00Z',
        end_time: '2024-01-25T23:59:59Z',
        last_modified_time: '2024-01-10T10:00:00Z',
        num_response_received: 18,
        num_winners: 1,
        poll_questions: [
          {
            question_id: 'q1-002',
            prompt: 'Please select your preferred candidate for the new maintainer position',
            type: 'single_choice',
            choices: [
              { choice_id: 'candidate_a', choice_text: 'Alex Johnson' },
              { choice_id: 'candidate_b', choice_text: 'Sarah Chen' },
              { choice_id: 'candidate_c', choice_text: 'Michael Roberts' },
            ],
          },
        ],
        poll_type: PollType.CONDORCET_IRV,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.ENDED,
        total_voting_request_invitations: 20,
        generic_choice_votes: {
          candidate_a: 5,
          candidate_b: 8,
          candidate_c: 5,
        },
      },
      {
        uid: 'vote-003',
        poll_id: 'vote-003',
        name: 'Annual Meeting Location',
        description: 'Vote to determine the location for our upcoming annual meeting.',
        committee_filters: ['voting_rep'],
        committee_id: 'comm-001',
        committee_uid: 'comm-001',
        committee_name: 'Technical Steering Committee',
        committee_type: 'technical',
        committee_voting_status: true,
        creation_time: '2024-01-20T10:00:00Z',
        end_time: '2024-03-01T23:59:59Z',
        last_modified_time: '2024-01-20T10:00:00Z',
        num_response_received: 15,
        num_winners: 1,
        poll_questions: [
          {
            question_id: 'q1-003',
            prompt: 'Which location do you prefer for the annual meeting?',
            type: 'single_choice',
            choices: [
              { choice_id: 'san_francisco', choice_text: 'San Francisco, CA' },
              { choice_id: 'seattle', choice_text: 'Seattle, WA' },
              { choice_id: 'austin', choice_text: 'Austin, TX' },
              { choice_id: 'virtual', choice_text: 'Virtual Only' },
            ],
          },
        ],
        poll_type: PollType.GENERIC,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.ACTIVE,
        total_voting_request_invitations: 30,
        generic_choice_votes: {
          san_francisco: 4,
          seattle: 3,
          austin: 5,
          virtual: 3,
        },
      },
      {
        uid: 'vote-004',
        poll_id: 'vote-004',
        name: 'Code of Conduct Updates',
        description: 'Vote on the proposed updates to our community Code of Conduct.',
        committee_filters: ['voting_rep'],
        committee_id: 'comm-003',
        committee_uid: 'comm-003',
        committee_name: 'Advisory Board',
        committee_type: 'advisory',
        committee_voting_status: true,
        creation_time: '2024-01-05T10:00:00Z',
        end_time: '2024-01-20T23:59:59Z',
        last_modified_time: '2024-01-05T10:00:00Z',
        num_response_received: 22,
        num_winners: 1,
        poll_questions: [
          {
            question_id: 'q1-004',
            prompt: 'Do you approve the proposed Code of Conduct updates?',
            type: 'single_choice',
            choices: [
              { choice_id: 'approve', choice_text: 'Approve' },
              { choice_id: 'reject', choice_text: 'Reject' },
              { choice_id: 'abstain', choice_text: 'Abstain' },
            ],
          },
        ],
        poll_type: PollType.GENERIC,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.ENDED,
        total_voting_request_invitations: 25,
        generic_choice_votes: {
          approve: 18,
          reject: 2,
          abstain: 2,
        },
      },
      {
        uid: 'vote-005',
        poll_id: 'vote-005',
        name: 'Security Policy Amendment',
        description: 'Vote on the proposed Security Policy Amendment that includes enhanced security measures.',
        committee_filters: ['voting_rep'],
        committee_id: 'comm-001',
        committee_uid: 'comm-001',
        committee_name: 'Technical Steering Committee',
        committee_type: 'technical',
        committee_voting_status: true,
        creation_time: '2024-01-22T10:00:00Z',
        end_time: '',
        last_modified_time: '2024-01-22T10:00:00Z',
        num_response_received: 0,
        num_winners: 1,
        poll_questions: [
          {
            question_id: 'q1-005',
            prompt: 'Do you approve the Security Policy Amendment?',
            type: 'single_choice',
            choices: [
              { choice_id: 'approve', choice_text: 'Approve' },
              { choice_id: 'reject', choice_text: 'Reject' },
              { choice_id: 'abstain', choice_text: 'Abstain' },
            ],
          },
          {
            question_id: 'q2-005',
            prompt: 'Which security measures should be prioritized?',
            type: 'multiple_choice',
            choices: [
              { choice_id: 'two-factor', choice_text: 'Two-factor authentication' },
              { choice_id: 'audit-logs', choice_text: 'Enhanced audit logging' },
              { choice_id: 'encryption', choice_text: 'End-to-end encryption' },
              { choice_id: 'access-control', choice_text: 'Role-based access control' },
            ],
          },
        ],
        poll_type: PollType.GENERIC,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.DISABLED,
        total_voting_request_invitations: 0,
      },
      {
        uid: 'vote-006',
        poll_id: 'vote-006',
        name: 'License Change Proposal',
        description: 'Vote on whether to change the project license from MIT to Apache 2.0.',
        committee_filters: ['voting_rep'],
        committee_id: 'comm-002',
        committee_uid: 'comm-002',
        committee_name: 'Governing Board',
        committee_type: 'governing',
        committee_voting_status: true,
        creation_time: '2024-01-08T10:00:00Z',
        end_time: '2024-01-22T23:59:59Z',
        last_modified_time: '2024-01-08T10:00:00Z',
        num_response_received: 20,
        num_winners: 1,
        poll_questions: [
          {
            question_id: 'q1-006',
            prompt: 'Should we change the project license from MIT to Apache 2.0?',
            type: 'single_choice',
            choices: [
              { choice_id: 'yes', choice_text: 'Yes, change to Apache 2.0' },
              { choice_id: 'no', choice_text: 'No, keep MIT license' },
              { choice_id: 'abstain', choice_text: 'Abstain' },
            ],
          },
        ],
        poll_type: PollType.GENERIC,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.ENDED,
        total_voting_request_invitations: 20,
        generic_choice_votes: {
          yes: 10,
          no: 10,
          abstain: 0,
        },
      },
    ];
  }
}
