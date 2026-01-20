// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { PollStatus, PollType, VOTE_LABEL } from '@lfx-one/shared';
import { Vote } from '@lfx-one/shared/interfaces';

import { VotesTableComponent } from '../components/votes-table/votes-table.component';

@Component({
  selector: 'lfx-votes-dashboard',
  imports: [LowerCasePipe, CardComponent, ButtonComponent, VotesTableComponent],
  templateUrl: './votes-dashboard.component.html',
  styleUrl: './votes-dashboard.component.scss',
})
export class VotesDashboardComponent {
  // === Constants ===
  protected readonly voteLabel = VOTE_LABEL.singular;
  protected readonly voteLabelPlural = VOTE_LABEL.plural;

  // === Writable Signals ===
  protected readonly votes = signal<Vote[]>(this.getMockVotes());
  protected readonly hasPMOAccess = signal<boolean>(true);

  // === Protected Methods ===
  protected onCreateVote(): void {
    // TODO: Navigate to create vote page
  }

  protected onManageVote(voteId: string): void {
    // TODO: Navigate to manage vote page
    void voteId;
  }

  protected onViewVote(voteId: string): void {
    // TODO: Open vote drawer for viewing/voting
    void voteId;
  }

  protected onViewResults(voteId: string): void {
    // TODO: Open vote results drawer
    void voteId;
  }

  // === Private Helpers ===
  private getMockVotes(): Vote[] {
    return [
      {
        uid: 'vote-001',
        poll_id: 'vote-001',
        name: 'Q4 2024 Budget Allocation',
        description: 'Vote on the proposed Q4 2024 budget allocation for project initiatives.',
        committee_filers: ['voting_rep'],
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
        poll_questions: [],
        poll_type: PollType.GENERIC,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.ACTIVE,
        total_voting_request_invitations: 25,
      },
      {
        uid: 'vote-002',
        poll_id: 'vote-002',
        name: 'New Maintainer Election',
        description: 'Election to select a new maintainer for the core repository.',
        committee_filers: ['voting_rep'],
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
        poll_questions: [],
        poll_type: PollType.CONDORCET_IRV,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.ENDED,
        total_voting_request_invitations: 20,
      },
      {
        uid: 'vote-003',
        poll_id: 'vote-003',
        name: 'Annual Meeting Location',
        description: 'Vote to determine the location for our upcoming annual meeting.',
        committee_filers: ['voting_rep'],
        committee_id: 'comm-001',
        committee_uid: 'comm-001',
        committee_name: 'Technical Steering Committee',
        committee_type: 'technical',
        committee_voting_status: true,
        creation_time: '2024-01-20T10:00:00Z',
        end_time: '2024-03-01T23:59:59Z',
        last_modified_time: '2024-01-20T10:00:00Z',
        num_response_received: 5,
        num_winners: 1,
        poll_questions: [],
        poll_type: PollType.GENERIC,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.ACTIVE,
        total_voting_request_invitations: 30,
      },
      {
        uid: 'vote-004',
        poll_id: 'vote-004',
        name: 'Code of Conduct Updates',
        description: 'Vote on the proposed updates to our community Code of Conduct.',
        committee_filers: ['voting_rep'],
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
        poll_questions: [],
        poll_type: PollType.GENERIC,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.ENDED,
        total_voting_request_invitations: 25,
      },
      {
        uid: 'vote-005',
        poll_id: 'vote-005',
        name: 'Security Policy Amendment',
        description: 'Vote on the proposed Security Policy Amendment.',
        committee_filers: ['voting_rep'],
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
        poll_questions: [],
        poll_type: PollType.GENERIC,
        project_uid: 'proj-001',
        project_id: 'proj-001',
        project_name: 'LFX Platform',
        pseudo_anonymity: false,
        status: PollStatus.DISABLED,
        total_voting_request_invitations: 0,
      },
    ];
  }
}
