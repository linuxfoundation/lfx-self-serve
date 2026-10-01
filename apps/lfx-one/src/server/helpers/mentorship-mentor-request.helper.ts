// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MentorshipMentorOpenProgram,
  MentorshipMentorProgramRequest,
  MentorshipUpstreamProgram,
  MentorshipUpstreamProgramMembership,
} from '@lfx-one/shared/interfaces';

import { MENTORSHIP_MENTOR_REQUEST_STATUS_MAP } from '../constants/mentorship.constants';

/** Maps one upstream program row to the program the mentor picker offers: only its id and name. */
export const mapMentorshipMentorOpenProgram = (program: MentorshipUpstreamProgram): MentorshipMentorOpenProgram => ({
  id: program.id,
  name: program.name,
});

/**
 * Maps the caller's mentor `program_members` rows to request rows. The status folds through
 * `MENTORSHIP_MENTOR_REQUEST_STATUS_MAP`; a row whose status the map leaves out (an `invited` row, or
 * one with no status) is dropped, because it is not a request the mentor made.
 */
export const mapMentorshipMentorProgramRequests = (memberships: MentorshipUpstreamProgramMembership[]): MentorshipMentorProgramRequest[] =>
  memberships.flatMap((membership) => {
    const status = membership.status ? MENTORSHIP_MENTOR_REQUEST_STATUS_MAP[membership.status] : undefined;
    return status ? [{ id: membership.id, programId: membership.program_id, programName: membership.program_name, status }] : [];
  });

/** The programs the caller holds an open mentor invitation to, which upstream will not take a request for. */
export const mapMentorshipMentorInvitedProgramIds = (memberships: MentorshipUpstreamProgramMembership[]): string[] =>
  memberships.filter((membership) => membership.status === 'invited').map((membership) => membership.program_id);
