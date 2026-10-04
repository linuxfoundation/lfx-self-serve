// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH } from '@lfx-one/shared/constants';
import {
  MentorshipMentorOpenProgram,
  MentorshipMentorOpenProgramsQuery,
  MentorshipMentorProgramRequest,
  MentorshipUpstreamProgram,
  MentorshipUpstreamProgramMembership,
} from '@lfx-one/shared/interfaces';

import { MENTORSHIP_MENTOR_REQUEST_STATUS_MAP } from '../constants/mentorship.constants';
import { ServiceValidationError } from '../errors';
import { parseTrimmedString } from './mentorship-params.helper';

const OPERATION = 'get_mentorship_mentor_open_programs';

/**
 * Reads the picker's `search` and `offset` query values. A missing or blank value is left out;
 * an offset that is not a non-negative integer, or a search over the length limit, is a 400.
 */
export const parseMentorshipMentorOpenProgramsQuery = (query: Record<string, unknown>): MentorshipMentorOpenProgramsQuery => {
  const result: MentorshipMentorOpenProgramsQuery = {};

  const search = parseTrimmedString(query['search']);
  if (search !== undefined) {
    if (search.length > MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH) {
      throw ServiceValidationError.forField('search', `search must be at most ${MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH} characters`, {
        operation: OPERATION,
      });
    }
    result.search = search;
  }

  const offset = parseTrimmedString(query['offset']);
  if (offset !== undefined) {
    if (!/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset))) {
      throw ServiceValidationError.forField('offset', 'offset must be a non-negative integer', { operation: OPERATION });
    }
    result.offset = Number(offset);
  }

  return result;
};

/**
 * Upstream matches `search` with `ILIKE '%' || search || '%'`, so `%` and `_` would act as
 * wildcards. Escaping them, and the backslash that is ILIKE's default escape, makes the search literal.
 */
export const escapeMentorshipIlikeSearch = (search: string): string => search.replace(/[\\%_]/g, (match) => `\\${match}`);

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
