// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MentorshipMentoringHistoryEntry,
  MentorshipMentoringHistoryGroup,
  MentorshipMentoringHistoryStatus,
  MentorshipMentorProfileDetails,
  MentorshipUpstreamMentorDetail,
  MentorshipUpstreamMentorProgramTerm,
  MentorshipUpstreamUserProfile,
} from '@lfx-one/shared/interfaces';

import { chooseMentorshipMentorTerm, mentorshipMentorTermStartMs } from './mentorship-mentor-term.helper';
import { asRecord, asString, asStringArray } from './mentorship-profile-columns.helper';

/** Latest start first; a row with no start sorts after every row with one. */
const byStartDescending = (a: number | undefined, b: number | undefined): number => {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
};

/** Maps the caller's `user_profiles` row (`profile_type = mentor`) to the profile page fields. */
export const mapMentorshipMentorProfileDetails = (profile: MentorshipUpstreamUserProfile): MentorshipMentorProfileDetails => ({
  aboutMe: asString(profile.introduction) ?? '',
  skills: asStringArray(asRecord(profile.skill_set)?.['skills']),
});

/**
 * The Mentoring History rows from the mentor's public detail: one row per distinct (program name, term
 * name) pair across the current and graduated mentees, plus the chosen term (`chooseMentorshipMentorTerm`)
 * of each program the mentor belongs to, so a term with no mentees yet is listed with a count of zero. An
 * open term that has not started is never chosen, so a cohort that has not begun is not listed as in progress.
 *
 * A mentee row names its program and term but carries neither id, so it is matched to the program's
 * terms by program name and term name. A row is in progress when a matching term is open and completed
 * when the matching terms are all closed; with no matching term it is in progress while one of its
 * mentees is still current. The id is the term's when exactly one term matches, and a generated one
 * otherwise. In-progress rows come first, then the latest term start, then the program and term names.
 *
 * Upstream lists each mentee at most once as current and once as graduated (its latest term of each),
 * so a mentee who joined more than one term is counted in one of them only.
 */
export const mapMentorshipMentoringHistory = (detail: MentorshipUpstreamMentorDetail | undefined, now: Date): MentorshipMentoringHistoryEntry[] => {
  if (!detail) return [];

  const groups = new Map<string, MentorshipMentoringHistoryGroup>();
  const group = (programName: string, term: string): MentorshipMentoringHistoryGroup => {
    const key = JSON.stringify([programName, term]);
    let entry = groups.get(key);
    if (!entry) {
      entry = { programName, term, menteeIds: new Set(), hasCurrentMentee: false };
      groups.set(key, entry);
    }
    return entry;
  };

  for (const mentee of detail.current_mentees ?? []) {
    const entry = group(mentee.program_name, mentee.term_name);
    entry.menteeIds.add(mentee.user_id);
    entry.hasCurrentMentee = true;
  }
  for (const mentee of detail.graduated_mentees ?? []) {
    group(mentee.program_name, mentee.term_name).menteeIds.add(mentee.user_id);
  }
  for (const program of detail.programs ?? []) {
    const chosen = chooseMentorshipMentorTerm(program.terms ?? [], now);
    if (chosen) group(program.name, chosen.name);
  }

  const rows = [...groups.values()].map((entry) => {
    const terms: MentorshipUpstreamMentorProgramTerm[] = (detail.programs ?? [])
      .filter((program) => program.name === entry.programName)
      .flatMap((program) => (program.terms ?? []).filter((term) => term.name === entry.term));
    const status: MentorshipMentoringHistoryStatus = (terms.length > 0 ? terms.some((term) => term.status === 'open') : entry.hasCurrentMentee)
      ? 'in-progress'
      : 'completed';
    const starts = terms.map(mentorshipMentorTermStartMs).filter((start): start is number => start !== undefined);
    return {
      termId: terms.length === 1 ? terms[0].id : undefined,
      startMs: starts.length > 0 ? Math.max(...starts) : undefined,
      entry: { programName: entry.programName, term: entry.term, menteesCount: entry.menteeIds.size, status },
    };
  });

  rows.sort(
    (a, b) =>
      Number(b.entry.status === 'in-progress') - Number(a.entry.status === 'in-progress') ||
      byStartDescending(a.startMs, b.startMs) ||
      a.entry.programName.localeCompare(b.entry.programName) ||
      a.entry.term.localeCompare(b.entry.term)
  );

  return rows.map((row, index) => ({ id: row.termId ?? `history-${index + 1}`, ...row.entry }));
};
