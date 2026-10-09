// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipUpstreamMentorProgramTerm } from '@lfx-one/shared/interfaces';

/** A term's start as epoch milliseconds, or `undefined` when it has none or it does not parse. */
export const mentorshipMentorTermStartMs = (term: Pick<MentorshipUpstreamMentorProgramTerm, 'start_date_time'>): number | undefined => {
  const ms = term.start_date_time ? Date.parse(term.start_date_time) : Number.NaN;
  return Number.isFinite(ms) ? ms : undefined;
};

/** Whether a term is open and has started by `now`. An open term with no start has not started. */
export const isMentorshipMentorTermUnderway = (term: MentorshipUpstreamMentorProgramTerm, now: Date): boolean => {
  const start = mentorshipMentorTermStartMs(term);
  return term.status === 'open' && start !== undefined && start <= now.getTime();
};

/** The term that starts last; a term with no start loses to any term with one. Ties keep the first. */
const latestStartingMentorshipMentorTerm = (terms: readonly MentorshipUpstreamMentorProgramTerm[]): MentorshipUpstreamMentorProgramTerm =>
  terms.reduce((best, term) => ((mentorshipMentorTermStartMs(term) ?? -Infinity) > (mentorshipMentorTermStartMs(best) ?? -Infinity) ? term : best));

/**
 * The one term a mentor's program is shown by in the Mentoring History:
 *
 * - an open term that has started: the one that started most recently;
 * - otherwise a closed term: the one that started most recently;
 * - otherwise nothing.
 *
 * An open term that starts later, or has no start yet, is never chosen, so a cohort that has not begun is
 * not listed as in progress. Deleted terms are never chosen. `now` is passed in so the choice can be tested.
 */
export const chooseMentorshipMentorTerm = (
  terms: readonly MentorshipUpstreamMentorProgramTerm[],
  now: Date
): MentorshipUpstreamMentorProgramTerm | undefined => {
  const started = terms.filter((term) => isMentorshipMentorTermUnderway(term, now));
  if (started.length > 0) return latestStartingMentorshipMentorTerm(started);

  const closed = terms.filter((term) => term.status === 'closed');
  return closed.length > 0 ? latestStartingMentorshipMentorTerm(closed) : undefined;
};
