// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MentorshipInvitableUser,
  MentorshipProgramLists,
  MentorshipProgramMentee,
  MentorshipProgramMentor,
  MentorshipProgramTermRow,
} from '../interfaces/mentorship.interface';

export const EMPTY_MENTORSHIP_PROGRAM_LISTS: MentorshipProgramLists = {
  mentees: [],
  applicants: [],
  mentors: [],
  terms: [],
};

const gridflowMentees: MentorshipProgramMentee[] = [
  {
    id: 'mnt_alex_rivera',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    status: 'accepted',
    termName: 'Fall 2026',
    appliedOn: '2026-07-18',
  },
  {
    id: 'mnt_priya_shah',
    name: 'Priya Shah',
    email: 'priya.shah@example.com',
    status: 'accepted',
    termName: 'Fall 2026',
    appliedOn: '2026-07-21',
  },
];

const gridflowApplicants: MentorshipProgramMentee[] = [
  {
    id: 'app_jordan_hale',
    name: 'Jordan Hale',
    email: 'jordan.hale@example.com',
    status: 'pending',
    termName: 'Fall 2026',
    appliedOn: '2026-08-02',
  },
  {
    id: 'app_sam_okonkwo',
    name: 'Sam Okonkwo',
    email: 'sam.okonkwo@example.com',
    status: 'pending',
    termName: 'Fall 2026',
    appliedOn: '2026-08-04',
  },
  {
    id: 'app_mei_chen',
    name: 'Mei Chen',
    email: 'mei.chen@example.com',
    status: 'pending',
    termName: 'Fall 2026',
    appliedOn: '2026-08-05',
  },
  {
    id: 'app_luca_rossi',
    name: 'Luca Rossi',
    email: 'luca.rossi@example.com',
    status: 'pending',
    termName: 'Fall 2026',
    appliedOn: '2026-08-06',
  },
  {
    id: 'app_aisha_rahman',
    name: 'Aisha Rahman',
    email: 'aisha.rahman@example.com',
    status: 'pending',
    termName: 'Fall 2026',
    appliedOn: '2026-08-07',
  },
  {
    id: 'app_noah_berg',
    name: 'Noah Berg',
    email: 'noah.berg@example.com',
    status: 'declined',
    termName: 'Fall 2026',
    appliedOn: '2026-07-28',
  },
  {
    id: 'app_elena_popov',
    name: 'Elena Popov',
    email: 'elena.popov@example.com',
    status: 'pending',
    termName: 'Fall 2026',
    appliedOn: '2026-08-09',
  },
  {
    id: 'app_chris_nguyen',
    name: 'Chris Nguyen',
    email: 'chris.nguyen@example.com',
    status: 'pending',
    termName: 'Fall 2026',
    appliedOn: '2026-08-10',
  },
  {
    id: 'app_fatima_alsayed',
    name: 'Fatima Al-Sayed',
    email: 'fatima.alsayed@example.com',
    status: 'declined',
    termName: 'Fall 2026',
    appliedOn: '2026-07-30',
  },
];

const gridflowMentors: MentorshipProgramMentor[] = [
  {
    id: 'mtr_dana_kovacs',
    name: 'Dana Kovacs',
    email: 'dana.kovacs@example.com',
    status: 'accepted',
    invitedOn: '2026-06-12',
    profileCreated: true,
  },
  {
    id: 'mtr_marcus_wei',
    name: 'Marcus Wei',
    email: 'marcus.wei@example.com',
    status: 'accepted',
    invitedOn: '2026-06-14',
    profileCreated: true,
  },
  {
    id: 'mtr_sofia_alvarez',
    name: 'Sofia Alvarez',
    email: 'sofia.alvarez@example.com',
    status: 'pending',
    invitedOn: '2026-08-01',
    profileCreated: false,
  },
  {
    id: 'mtr_ben_hartley',
    name: 'Ben Hartley',
    email: 'ben.hartley@example.com',
    status: 'accepted',
    invitedOn: '2026-05-20',
    profileCreated: true,
  },
];

const gridflowTerms: MentorshipProgramTermRow[] = [
  {
    id: 'trm_gridflow_fall26',
    name: 'Fall 2026',
    status: 'open',
    pending: 3,
    declined: 1,
    accepted: 2,
    graduated: 0,
    startDate: '2026-09-01',
    endDate: '2026-11-01',
    applicationStartDate: '2026-05-01',
    applicationEndDate: '2026-07-15',
  },
  {
    id: 'trm_gridflow_summer26',
    name: 'Summer 2026',
    status: 'closed',
    pending: 0,
    declined: 4,
    accepted: 3,
    graduated: 3,
    startDate: '2026-06-01',
    endDate: '2026-08-01',
    applicationStartDate: '2026-04-01',
    applicationEndDate: '2026-05-15',
  },
  {
    id: 'trm_gridflow_spring26',
    name: 'Spring 2026',
    status: 'closed',
    pending: 0,
    declined: 0,
    accepted: 0,
    graduated: 3,
    startDate: '2026-03-01',
    endDate: '2026-05-01',
    applicationStartDate: '2026-01-06',
    applicationEndDate: '2026-02-15',
  },
  {
    id: 'trm_gridflow_spring27',
    name: 'Spring 2027',
    status: 'open',
    pending: 0,
    declined: 0,
    accepted: 0,
    graduated: 0,
    startDate: '2027-03-01',
    endDate: '2027-05-01',
    applicationStartDate: '2027-01-06',
    applicationEndDate: '2027-02-15',
  },
];

/**
 * Deterministic tab lists keyed by program slug. Server-only import path
 * (`@lfx-one/shared/constants`) until the upstream mentorship-service is wired.
 */
export const MOCK_MENTORSHIP_PROGRAM_LISTS: Record<string, MentorshipProgramLists> = {
  'gridflow-time-series-ingestion-pipeline': {
    mentees: gridflowMentees,
    applicants: gridflowApplicants,
    mentors: gridflowMentors,
    terms: gridflowTerms,
  },
  'apicurio-registry-prompt-template-playground': {
    mentees: [],
    applicants: [
      {
        id: 'app_apicurio_1',
        name: 'Riley Thompson',
        email: 'riley.thompson@example.com',
        status: 'pending',
        termName: 'Winter 2026',
        appliedOn: '2026-08-12',
      },
      {
        id: 'app_apicurio_2',
        name: 'Kai Nakamura',
        email: 'kai.nakamura@example.com',
        status: 'pending',
        termName: 'Winter 2026',
        appliedOn: '2026-08-15',
      },
    ],
    mentors: [
      {
        id: 'mtr_apicurio_1',
        name: 'Helen Cho',
        email: 'helen.cho@example.com',
        status: 'pending',
        invitedOn: '2026-07-20',
        profileCreated: false,
      },
      {
        id: 'mtr_apicurio_2',
        name: 'Omar Farouk',
        email: 'omar.farouk@example.com',
        status: 'pending',
        invitedOn: '2026-07-22',
        profileCreated: true,
      },
    ],
    terms: [
      {
        id: 'trm_apicurio_winter26',
        name: 'Winter 2026',
        status: 'open',
        pending: 2,
        declined: 0,
        accepted: 0,
        graduated: 0,
        startDate: '2026-12-01',
        endDate: '2027-02-01',
        applicationStartDate: '2026-08-01',
        applicationEndDate: '2026-10-15',
      },
    ],
  },
  'janusgraph-adjacency-cache-instrumentation': {
    mentees: [
      {
        id: 'mnt_janus_1',
        name: 'Taylor Brooks',
        email: 'taylor.brooks@example.com',
        status: 'accepted',
        termName: 'Fall 2026',
        appliedOn: '2026-07-10',
      },
    ],
    applicants: [
      {
        id: 'app_janus_1',
        name: 'Ivy Moreau',
        email: 'ivy.moreau@example.com',
        status: 'pending',
        termName: 'Fall 2026',
        appliedOn: '2026-08-03',
      },
      {
        id: 'app_janus_2',
        name: 'Diego Santos',
        email: 'diego.santos@example.com',
        status: 'declined',
        termName: 'Fall 2026',
        appliedOn: '2026-07-25',
      },
    ],
    mentors: [
      {
        id: 'mtr_janus_1',
        name: 'Nina Patel',
        email: 'nina.patel@example.com',
        status: 'accepted',
        invitedOn: '2026-05-18',
        profileCreated: true,
      },
    ],
    terms: [
      {
        id: 'trm_janus_fall26',
        name: 'Fall 2026',
        status: 'open',
        pending: 1,
        declined: 1,
        accepted: 1,
        graduated: 0,
        startDate: '2026-09-01',
        endDate: '2026-12-01',
        applicationStartDate: '2026-07-01',
        applicationEndDate: '2026-08-15',
      },
      {
        id: 'trm_janus_summer26',
        name: 'Summer 2026',
        status: 'closed',
        pending: 0,
        declined: 0,
        accepted: 0,
        graduated: 2,
        startDate: '2026-06-01',
        endDate: '2026-08-01',
        applicationStartDate: '2026-04-01',
        applicationEndDate: '2026-05-01',
      },
    ],
  },
  'thanos-fan-out-query-observability': {
    mentees: [],
    applicants: [],
    mentors: [
      {
        id: 'mtr_thanos_1',
        name: 'Grace Lin',
        email: 'grace.lin@example.com',
        status: 'accepted',
        invitedOn: '2026-03-10',
        profileCreated: true,
      },
      {
        id: 'mtr_thanos_2',
        name: 'Peter Novak',
        email: 'peter.novak@example.com',
        status: 'accepted',
        invitedOn: '2026-03-12',
        profileCreated: true,
      },
    ],
    terms: [
      {
        id: 'trm_thanos_summer26',
        name: 'Summer 2026',
        status: 'closed',
        pending: 0,
        declined: 0,
        accepted: 0,
        graduated: 3,
        startDate: '2026-06-01',
        endDate: '2026-08-01',
        applicationStartDate: '2026-03-15',
        applicationEndDate: '2026-04-30',
      },
      {
        id: 'trm_thanos_spring26',
        name: 'Spring 2026',
        status: 'closed',
        pending: 0,
        declined: 1,
        accepted: 0,
        graduated: 0,
        startDate: '2026-03-01',
        endDate: '2026-05-01',
        applicationStartDate: '2026-01-08',
        applicationEndDate: '2026-02-15',
      },
    ],
  },
};

/**
 * Deterministic mock pool of LFX users the admin can invite as mentors on the
 * program-detail Mentors tab. Client-only import path (`@lfx-one/shared/constants`)
 * until the upstream user-search endpoint is wired.
 */
export const MOCK_MENTORSHIP_INVITABLE_USERS: MentorshipInvitableUser[] = [
  { id: 'usr_ada_lovelace', name: 'Ada Lovelace', email: 'ada.lovelace@example.com' },
  { id: 'usr_grace_hopper', name: 'Grace Hopper', email: 'grace.hopper@example.com' },
  { id: 'usr_linus_torvalds', name: 'Linus Torvalds', email: 'linus.torvalds@example.com' },
  { id: 'usr_margaret_hamilton', name: 'Margaret Hamilton', email: 'margaret.hamilton@example.com' },
  { id: 'usr_barbara_liskov', name: 'Barbara Liskov', email: 'barbara.liskov@example.com' },
  { id: 'usr_donald_knuth', name: 'Donald Knuth', email: 'donald.knuth@example.com' },
  { id: 'usr_katherine_johnson', name: 'Katherine Johnson', email: 'katherine.johnson@example.com' },
  { id: 'usr_alan_kay', name: 'Alan Kay', email: 'alan.kay@example.com' },
  { id: 'usr_radia_perlman', name: 'Radia Perlman', email: 'radia.perlman@example.com' },
  { id: 'usr_tim_berners_lee', name: 'Tim Berners-Lee', email: 'tim.berners-lee@example.com' },
  { id: 'usr_leslie_lamport', name: 'Leslie Lamport', email: 'leslie.lamport@example.com' },
  { id: 'usr_shafi_goldwasser', name: 'Shafi Goldwasser', email: 'shafi.goldwasser@example.com' },
];
