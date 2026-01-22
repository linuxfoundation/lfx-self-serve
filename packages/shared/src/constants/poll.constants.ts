// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PollStatus, VoteResponseStatus } from '../enums/poll.enum';
import { TagSeverity } from '../interfaces/components.interface';
import { PollQuestion } from '../interfaces/poll.interface';

/**
 * Configurable labels for votes displayed throughout the UI
 * @description This constant allows the user-facing labels to be changed
 * while keeping all code and file names consistent
 * @readonly
 * @example
 * // Use in templates to display the label
 * <h1>{{VOTE_LABEL.plural}}</h1> // Displays "Votes"
 * <span>{{VOTE_LABEL.singular}} Name</span> // Displays "Vote Name"
 */
export const VOTE_LABEL = {
  singular: 'Vote',
  plural: 'Votes',
} as const;

/**
 * Poll status display labels
 * @description Human-readable labels for poll statuses
 */
export const POLL_STATUS_LABELS = {
  [PollStatus.ACTIVE]: 'Active',
  [PollStatus.DISABLED]: 'Disabled',
  [PollStatus.ENDED]: 'Ended',
} as const;

/**
 * Poll status severity mappings
 * @description Maps poll statuses to tag severity levels for styling
 */
export const POLL_STATUS_SEVERITY: Record<PollStatus, TagSeverity> = {
  [PollStatus.ACTIVE]: 'info',
  [PollStatus.DISABLED]: 'warn',
  [PollStatus.ENDED]: 'secondary',
} as const;

/**
 * Vote response status display labels
 * @description Human-readable labels for vote response statuses
 */
export const VOTE_RESPONSE_STATUS_LABELS = {
  [VoteResponseStatus.RESPONDED]: 'Responded',
  [VoteResponseStatus.AWAITING_RESPONSE]: 'Awaiting Response',
} as const;

/**
 * Vote response status severity mappings
 * @description Maps vote response statuses to tag severity levels for styling
 */
export const VOTE_RESPONSE_STATUS_SEVERITY: Record<VoteResponseStatus, TagSeverity> = {
  [VoteResponseStatus.RESPONDED]: 'success',
  [VoteResponseStatus.AWAITING_RESPONSE]: 'info',
} as const;

/**
 * Combined vote status labels
 * @description Combines poll status and user response into single status
 * - Open: Active poll, user has not responded
 * - Submitted: Active poll, user has responded
 * - Closed: Poll has ended (regardless of user response)
 */
export const COMBINED_VOTE_STATUS_LABELS = {
  open: 'Open',
  submitted: 'Submitted',
  closed: 'Closed',
} as const;

/**
 * Combined vote status severity mappings
 * @description Maps combined vote statuses to tag severity levels for styling
 */
export const COMBINED_VOTE_STATUS_SEVERITY = {
  open: 'info' as TagSeverity,
  submitted: 'success' as TagSeverity,
  closed: 'secondary' as TagSeverity,
} as const;

/**
 * Mock poll questions by poll ID
 * @description Mock data for vote details drawer - will be replaced by API data
 */
export const MOCK_POLL_QUESTIONS: Map<string, PollQuestion[]> = new Map([
  [
    'poll-001',
    [
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
  ],
  [
    'poll-002',
    [
      {
        question_id: 'q1-002',
        prompt: 'Please rank your preferences for the new maintainer candidates',
        type: 'single_choice',
        choices: [
          { choice_id: 'candidate-a', choice_text: 'Alex Johnson' },
          { choice_id: 'candidate-b', choice_text: 'Sarah Chen' },
          { choice_id: 'candidate-c', choice_text: 'Michael Roberts' },
        ],
      },
    ],
  ],
  [
    'poll-003',
    [
      {
        question_id: 'q1-003',
        prompt: 'Which location do you prefer for the annual meeting?',
        type: 'single_choice',
        choices: [
          { choice_id: 'san-francisco', choice_text: 'San Francisco, CA' },
          { choice_id: 'seattle', choice_text: 'Seattle, WA' },
          { choice_id: 'austin', choice_text: 'Austin, TX' },
          { choice_id: 'virtual', choice_text: 'Virtual Only' },
        ],
      },
    ],
  ],
  [
    'poll-004',
    [
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
  ],
  [
    'poll-005',
    [
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
  ],
]);

/**
 * Mock poll descriptions by poll ID
 * @description Mock data for vote details drawer - will be replaced by API data
 */
export const MOCK_POLL_DESCRIPTIONS: Map<string, string> = new Map([
  ['poll-001', 'This vote determines the allocation of the Q4 2024 budget across different project initiatives.'],
  ['poll-002', 'Election to select a new maintainer for the core repository. Ranked choice voting will be used.'],
  ['poll-003', 'Vote to determine the location for our upcoming annual meeting.'],
  ['poll-004', 'Vote on the proposed updates to our community Code of Conduct.'],
  ['poll-005', 'Vote on the proposed Security Policy Amendment that includes enhanced security measures.'],
]);

// ============================================================================
// Vote Form Configuration Constants
// ============================================================================

/**
 * Step titles for the vote creation/edit stepper
 * @description Array of human-readable titles for each step in the vote form
 */
export const VOTE_STEP_TITLES = ['Vote Basics', 'Vote Question', 'Review & Confirm'] as const;

/**
 * Total number of steps in the vote wizard
 * @description Must match the length of VOTE_STEP_TITLES array
 */
export const VOTE_TOTAL_STEPS = VOTE_STEP_TITLES.length;

/**
 * Vote form step indices
 * @description One-based step numbers for form navigation and validation
 * @readonly
 */
export const VOTE_FORM_STEPS = {
  /** Step 1: Basic information (title, description, group, eligibility, close date) */
  BASICS: 1,
  /** Step 2: Question configuration (question text, response type, options) */
  QUESTION: 2,
  /** Step 3: Review and confirm all settings */
  REVIEW: 3,
} as const;

/**
 * Eligible participant options for vote creation
 * @description Defines who within the selected group is eligible to vote
 * Maps to the committee_filters field in the Vote interface
 * Values align with CommitteeMemberVotingStatus enum snake_case values
 */
export const VOTE_ELIGIBLE_PARTICIPANTS = [
  { label: 'Voting Reps Only', value: 'voting_rep', description: 'Only voting representatives can participate' },
  {
    label: 'Voting Reps and Alternates',
    value: 'voting_rep,alternate_voting_rep',
    description: 'Voting reps and their alternates can participate',
  },
  { label: 'All Members of the Group', value: 'all', description: 'All members of the selected group can participate' },
] as const;

/**
 * Vote response type options
 * @description Defines how participants can respond to the vote question
 */
export const VOTE_RESPONSE_TYPES = [
  { label: 'Single selection (radio buttons)', value: 'single', description: 'Each participant will select one option' },
  { label: 'Multiple selection (checkboxes)', value: 'multiple', description: 'Participants can select multiple options' },
] as const;
