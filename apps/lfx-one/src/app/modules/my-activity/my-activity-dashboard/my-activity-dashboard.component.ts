// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import {
  CommitteeMemberVotingStatus,
  MY_ACTIVITY_LABEL,
  MY_ACTIVITY_TAB_OPTIONS,
  PollStatus,
  PollType,
  SurveyResponseStatus,
  SurveyStatus,
  VoteResponseStatus,
} from '@lfx-one/shared';
import { MyActivityTab, UserSurvey, UserVote } from '@lfx-one/shared/interfaces';

import { ActivityTopBarComponent } from '../components/activity-top-bar/activity-top-bar.component';
import { SurveysTableComponent } from '../components/surveys-table/surveys-table.component';
import { VotesTableComponent } from '../components/votes-table/votes-table.component';

@Component({
  selector: 'lfx-my-activity-dashboard',
  imports: [ActivityTopBarComponent, VotesTableComponent, SurveysTableComponent],
  templateUrl: './my-activity-dashboard.component.html',
})
export class MyActivityDashboardComponent {
  protected readonly activityLabel = MY_ACTIVITY_LABEL;
  protected readonly mutableTabOptions = [...MY_ACTIVITY_TAB_OPTIONS];

  public tabForm: FormGroup;

  private readonly activeTab = signal<MyActivityTab>('votes');

  protected readonly isVotesTab = computed(() => this.activeTab() === 'votes');
  protected readonly isSurveysTab = computed(() => this.activeTab() === 'surveys');

  protected readonly votes = signal<UserVote[]>(this.getMockVotes());
  protected readonly surveys = signal<UserSurvey[]>(this.getMockSurveys());

  public constructor() {
    this.tabForm = new FormGroup({
      tab: new FormControl<MyActivityTab>('votes'),
    });
  }

  protected onTabChange(tab: MyActivityTab): void {
    this.activeTab.set(tab);
  }

  private getMockVotes(): UserVote[] {
    return [
      {
        poll_id: 'poll-001',
        poll_name: 'Q4 2024 Budget Allocation',
        poll_type: PollType.GENERIC,
        poll_status: PollStatus.ACTIVE,
        committees: [
          {
            uid: 'comm-001',
            name: 'Finance Committee',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP],
          },
        ],
        end_time: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        vote_status: VoteResponseStatus.AWAITING_RESPONSE,
        vote_creation_time: null,
      },
      {
        poll_id: 'poll-002',
        poll_name: 'New Maintainer Election',
        poll_type: PollType.INSTANT_RUNOFF_VOTE,
        poll_status: PollStatus.ACTIVE,
        committees: [
          {
            uid: 'comm-002',
            name: 'Technical Steering Committee',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP],
          },
        ],
        end_time: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        vote_status: VoteResponseStatus.RESPONDED,
        vote_creation_time: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        poll_id: 'poll-003',
        poll_name: 'Annual Meeting Location Vote',
        poll_type: PollType.GENERIC,
        poll_status: PollStatus.ACTIVE,
        committees: [
          {
            uid: 'comm-003',
            name: 'Governance Board',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP],
          },
        ],
        end_time: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
        vote_status: VoteResponseStatus.AWAITING_RESPONSE,
        vote_creation_time: null,
      },
      {
        poll_id: 'poll-004',
        poll_name: 'Code of Conduct Update',
        poll_type: PollType.GENERIC,
        poll_status: PollStatus.ENDED,
        committees: [
          {
            uid: 'comm-003',
            name: 'Governance Board',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP],
          },
          {
            uid: 'comm-002',
            name: 'Technical Steering Committee',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP],
          },
        ],
        end_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        vote_status: VoteResponseStatus.RESPONDED,
        vote_creation_time: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        poll_id: 'poll-005',
        poll_name: 'Security Policy Amendment',
        poll_type: PollType.GENERIC,
        poll_status: PollStatus.ACTIVE,
        committees: [
          {
            uid: 'comm-002',
            name: 'Technical Steering Committee',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.OBSERVER],
          },
        ],
        end_time: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        vote_status: VoteResponseStatus.AWAITING_RESPONSE,
        vote_creation_time: null,
      },
    ];
  }

  private getMockSurveys(): UserSurvey[] {
    return [
      {
        survey_id: 'survey-001',
        survey_title: 'Developer Experience Survey 2024',
        survey_status: SurveyStatus.OPEN,
        committees: [
          {
            uid: 'comm-002',
            name: 'Technical Steering Committee',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP],
          },
        ],
        survey_cutoff_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        response_status: SurveyResponseStatus.NOT_RESPONDED,
        response_datetime: null,
      },
      {
        survey_id: 'survey-002',
        survey_title: 'Annual Community Feedback',
        survey_status: SurveyStatus.CLOSED,
        committees: [
          {
            uid: 'comm-003',
            name: 'Governance Board',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP],
          },
          {
            uid: 'comm-001',
            name: 'Finance Committee',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.OBSERVER],
          },
        ],
        survey_cutoff_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        response_status: SurveyResponseStatus.RESPONDED,
        response_datetime: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        survey_id: 'survey-003',
        survey_title: 'Q3 Satisfaction Survey',
        survey_status: SurveyStatus.OPEN,
        committees: [
          {
            uid: 'comm-001',
            name: 'Finance Committee',
            allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP],
          },
        ],
        survey_cutoff_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        response_status: SurveyResponseStatus.RESPONDED,
        response_datetime: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
  }
}
