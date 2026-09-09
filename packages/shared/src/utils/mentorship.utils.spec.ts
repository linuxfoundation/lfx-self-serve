// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { createDefaultMentorshipTerm, createEmptyMentorshipEnrollForm } from '../constants/mentorship-enroll.constants';
import { MENTORSHIP_PROGRAM_AVATAR_PALETTE } from '../constants/mentorship.constants';
import type { MentorshipProgramMentee } from '../interfaces/mentorship.interface';
import {
  buildMentorshipProgramDetail,
  formatMentorshipDateRange,
  formatMentorshipMonthYear,
  formatMentorshipShortMonthYear,
  formatMentorshipTaskProgress,
  getMentorshipEnrollStepErrors,
  getMentorshipTermDateErrors,
  isMentorshipTermEnded,
  mentorshipDateOnlyFloor,
  mentorshipOpenTermCount,
  mentorshipTermHasApplications,
  isMentorshipCiiProjectId,
  isMentorshipEnrollStepValid,
  isMentorshipHttpUrl,
  isMentorshipIsoDate,
  isMentorshipLogoFileName,
  isMentorshipTermsAccepted,
  matchesMentorshipPersonSearch,
  mentorshipApplicantActionsFor,
  mentorshipApplicantDisplayStatus,
  mentorshipMenteeActionsFor,
  mentorshipMenteesForProgram,
  mentorshipMonthYearToStartDate,
  mentorshipNoteDisplay,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
  mentorshipProgramSlug,
  mentorshipRowActions,
  parseMentorshipDateOnly,
  parseMentorshipMonthYear,
  toMentorshipDateOnly,
} from './mentorship.utils';

describe('getMentorshipEnrollStepErrors', () => {
  it('requires the details fields from the Nuxt enroll wizard', () => {
    const errors = getMentorshipEnrollStepErrors('details', createEmptyMentorshipEnrollForm());

    expect(errors.name).toBe('Program name is required.');
    expect(errors.projectId).toBe('Select a Linux Foundation project.');
    expect(errors.technologies).toBe('Add at least one technology.');
    expect(errors.description).toBe('Program description is required.');
    expect(errors.repositoryUrl).toBe("A link to the program's repository is required.");
    expect(errors.logoFileName).toBe('Logo is required.');
  });

  it('gives a new enroll form a term that still passes setup date checks', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.skills = ['GO'];

    expect(getMentorshipEnrollStepErrors('setup', form).terms).toBeUndefined();
  });

  it('requires at least one skill, term, required prerequisite, and accepted terms', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.terms = [];

    expect(getMentorshipEnrollStepErrors('setup', form).skills).toBe('Add at least one skill.');
    expect(getMentorshipEnrollStepErrors('setup', form).terms).toBe('Add at least one program term.');
    expect(getMentorshipEnrollStepErrors('prerequisites', form).prerequisites).toBe('At least one prerequisite is required.');
    expect(getMentorshipEnrollStepErrors('prerequisites', form).termsAccepted).toBe('Please accept terms and conditions in order to proceed.');
  });

  it('treats a PrimeNG non-binary checkbox value as accepted terms', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.prerequisites = form.prerequisites.map((item) => (item.id === 'prereq-cover' ? { ...item, required: true } : item));
    (form as { termsAccepted: unknown }).termsAccepted = [undefined];

    expect(isMentorshipTermsAccepted(true)).toBe(true);
    expect(isMentorshipTermsAccepted(false)).toBe(false);
    expect(isMentorshipTermsAccepted([])).toBe(false);
    expect(isMentorshipTermsAccepted([undefined])).toBe(true);
    expect(getMentorshipEnrollStepErrors('prerequisites', form).termsAccepted).toBeUndefined();
  });

  it('requires custom prerequisite fields when a custom card is added', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.prerequisites = [
      {
        id: 'prereq-custom-1',
        name: '',
        description: '',
        required: true,
        custom: true,
        dueDate: '',
      },
    ];

    expect(getMentorshipEnrollStepErrors('prerequisites', form).prerequisites).toBe('Complete each custom prerequisite or delete it.');
  });

  it('rejects a custom prerequisite whose due date is not a real calendar date', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.prerequisites = [
      {
        id: 'prereq-custom-1',
        name: 'Write a design doc',
        description: 'Describe the proposed change.',
        required: true,
        custom: true,
        dueDate: 'not-a-date',
      },
    ];

    expect(getMentorshipEnrollStepErrors('prerequisites', form).prerequisites).toBe('Complete each custom prerequisite or delete it.');
  });

  it('treats a filled details step as valid', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.name = 'GridFlow Mentorship';
    form.projectId = 'proj-gridflow';
    form.technologies = ['GO'];
    form.description = '<p>Build a pipeline.</p>';
    form.repositoryUrl = 'https://github.com/lfenergy/gridflow';
    form.logoFileName = 'logo.png';

    expect(isMentorshipEnrollStepValid('details', form)).toBe(true);
  });

  it('rejects a non-numeric CII project ID', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.name = 'GridFlow Mentorship';
    form.projectId = 'proj-gridflow';
    form.technologies = ['GO'];
    form.description = '<p>Build a pipeline.</p>';
    form.repositoryUrl = 'https://github.com/lfenergy/gridflow';
    form.logoFileName = 'logo.png';
    form.ciiProjectId = 'abc';

    expect(getMentorshipEnrollStepErrors('details', form).ciiProjectId).toBe('Invalid CII Project ID');
  });

  it('rejects a short program name and an invalid repository URL', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.name = 'Go';
    form.projectId = 'proj-gridflow';
    form.technologies = ['GO'];
    form.description = '<p>Build a pipeline.</p>';
    form.repositoryUrl = 'not-a-url';
    form.logoFileName = 'logo.png';

    expect(getMentorshipEnrollStepErrors('details', form).name).toContain('between 3 and 100');
    expect(getMentorshipEnrollStepErrors('details', form).repositoryUrl).toBe('The link must be a valid URL.');
  });

  it('rejects a blank term name and non-calendar dates on the setup step', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.skills = ['GO'];
    form.terms = [
      {
        id: '',
        name: '',
        startDate: '9999-z',
        endDate: '9999-a',
        applicationStartDate: '2026-12-01',
        applicationEndDate: '2027-02-28',
      },
    ];

    expect(getMentorshipEnrollStepErrors('setup', form).terms).toBe('Each term needs a name and valid calendar dates (YYYY-MM-DD).');
  });

  it('rejects lexical date strings that are not real calendar dates', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.skills = ['GO'];
    form.terms = [
      {
        id: 'term-bad',
        name: 'Term 1 - 2027',
        startDate: '2027-03-01',
        endDate: '2027-05-01',
        applicationStartDate: '9999-a',
        applicationEndDate: '9999-z',
      },
    ];

    expect(getMentorshipEnrollStepErrors('setup', form).terms).toBe('Enter a valid date (YYYY-MM-DD).');
  });

  it('requires a coding-challenge URL when that prerequisite is required', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.prerequisites = form.prerequisites.map((item) => (item.id === 'prereq-coding' ? { ...item, required: true, challengeUrl: '' } : item));
    form.termsAccepted = true;

    expect(getMentorshipEnrollStepErrors('prerequisites', form).challengeUrl).toBe('The link is required.');
  });
});

describe('mentorship URL and logo helpers', () => {
  it('accepts http(s) URLs and image extensions from the old logo field', () => {
    expect(isMentorshipHttpUrl('https://github.com/org/repo')).toBe(true);
    expect(isMentorshipHttpUrl('google.com')).toBe(true);
    expect(isMentorshipHttpUrl('ftp://example.com')).toBe(false);
    expect(isMentorshipLogoFileName('logo.PNG')).toBe(true);
    expect(isMentorshipLogoFileName('notes.pdf')).toBe(false);
  });
});

describe('getMentorshipTermDateErrors', () => {
  it('rejects a start month before the current month', () => {
    const errors = getMentorshipTermDateErrors(
      {
        startDate: '2026-01-01',
        endDate: '2026-03-01',
        applicationStartDate: '2026-09-08',
        applicationEndDate: '2026-10-01',
      },
      new Date(2026, 8, 7)
    );

    expect(errors.startDate).toBe('Start month should be greater than or equal to current month.');
  });

  it('preserves an existing past application window when the values are unchanged', () => {
    const original = {
      startDate: '2026-09-01',
      endDate: '2026-12-01',
      applicationStartDate: '2026-07-01',
      applicationEndDate: '2026-08-31',
    };

    expect(getMentorshipTermDateErrors(original, new Date(2026, 8, 7), original)).toEqual({});
  });

  it('rejects a past application start when no original term is supplied', () => {
    const term = {
      startDate: '2027-03-01',
      endDate: '2027-05-01',
      applicationStartDate: '2026-11-30',
      applicationEndDate: '2027-02-28',
    };

    expect(getMentorshipTermDateErrors(term, new Date(2026, 11, 2)).applicationStartDate).toBe('Application start date cannot be before today.');
  });

  it('builds a default enroll term that stays valid on the given day', () => {
    const today = new Date(2026, 8, 8);
    const term = createDefaultMentorshipTerm(today);

    expect(getMentorshipTermDateErrors(term, today)).toEqual({});
    expect(term.startDate).toBe('2026-12-01');
    expect(term.endDate).toBe('2027-02-01');
    expect(term.applicationStartDate).toBe('2026-09-09');
    expect(term.applicationEndDate).toBe('2026-11-30');
  });

  it('accepts a client-local today when the host calendar is one day ahead', () => {
    const clientToday = new Date(2026, 8, 7);
    const serverToday = new Date(2026, 8, 8);
    const term = createDefaultMentorshipTerm(clientToday);

    expect(mentorshipDateOnlyFloor(serverToday)).toBe('2026-09-07');
    expect(getMentorshipTermDateErrors(term, serverToday)).toEqual({});
    expect(
      getMentorshipTermDateErrors(
        {
          startDate: '2026-12-01',
          endDate: '2027-02-01',
          applicationStartDate: '2026-09-07',
          applicationEndDate: '2026-11-30',
        },
        serverToday
      )
    ).toEqual({});
  });
});

describe('mentorship term lifecycle helpers', () => {
  it('treats the last day of the end month as the term end', () => {
    expect(isMentorshipTermEnded('2026-08-01', new Date(2026, 8, 7))).toBe(true);
    expect(isMentorshipTermEnded('2026-12-01', new Date(2026, 8, 7))).toBe(false);
  });

  it('counts only open terms toward the four-term cap', () => {
    expect(mentorshipOpenTermCount([{ status: 'open' }, { status: 'closed' }, { status: 'open' }])).toBe(2);
  });

  it('treats any application count as existing applications', () => {
    expect(mentorshipTermHasApplications({ pending: 0, declined: 0, accepted: 0, graduated: 0 })).toBe(false);
    expect(mentorshipTermHasApplications({ pending: 0, declined: 1, accepted: 0, graduated: 0 })).toBe(true);
  });

  it('formats a short month-year label', () => {
    expect(formatMentorshipShortMonthYear('2026-09-01')).toBe('Sep 2026');
  });
});

describe('isMentorshipCiiProjectId', () => {
  it('accepts positive integers only', () => {
    expect(isMentorshipCiiProjectId('1842')).toBe(true);
    expect(isMentorshipCiiProjectId('0')).toBe(false);
    expect(isMentorshipCiiProjectId('01')).toBe(false);
    expect(isMentorshipCiiProjectId('abc')).toBe(false);
    expect(isMentorshipCiiProjectId('')).toBe(false);
  });
});

describe('isMentorshipIsoDate', () => {
  it('accepts real calendar dates and rejects padded or impossible values', () => {
    expect(isMentorshipIsoDate('2027-03-01')).toBe(true);
    expect(isMentorshipIsoDate('2026-02-31')).toBe(false);
    expect(isMentorshipIsoDate('9999-z')).toBe(false);
    expect(isMentorshipIsoDate('2027-03-01T00:00:00Z')).toBe(false);
  });
});

describe('mentorship term dates', () => {
  it('parses ISO and labeled month-year values', () => {
    expect(parseMentorshipMonthYear('2026-09-01')).toEqual({ month: '09', year: '2026' });
    expect(parseMentorshipMonthYear('September 2026')).toEqual({ month: '09', year: '2026' });
  });

  it('formats a stored startDate as a full month label', () => {
    expect(formatMentorshipMonthYear('2026-09-01')).toBe('September 2026');
  });

  it('combines dialog month + year into startDate', () => {
    expect(mentorshipMonthYearToStartDate('09', '2026')).toBe('2026-09-01');
  });

  it('round-trips a local date-only value', () => {
    const parsed = parseMentorshipDateOnly('2026-06-15');
    expect(parsed).not.toBeNull();
    expect(toMentorshipDateOnly(parsed as Date)).toBe('2026-06-15');
  });
});

describe('mentorshipProgramSlug', () => {
  it('slugifies a program name', () => {
    expect(mentorshipProgramSlug('GridFlow: Time-Series Ingestion')).toBe('gridflow-time-series-ingestion');
  });

  it('falls back when the name is empty', () => {
    expect(mentorshipProgramSlug('   ')).toBe('program');
  });

  it('strips leading and trailing separators', () => {
    expect(mentorshipProgramSlug('---abc---')).toBe('abc');
    expect(mentorshipProgramSlug('!!!Hello, World!!!')).toBe('hello-world');
  });

  it('falls back when the name is only separators', () => {
    expect(mentorshipProgramSlug('---')).toBe('program');
    expect(mentorshipProgramSlug('!!!')).toBe('program');
  });

  // Regression guard for the CodeQL js/polynomial-redos alert on the previous
  // /^-+|-+$/g regex — long runs of dashes must slugify in linear time.
  it('handles adversarially long dash runs quickly', () => {
    const start = Date.now();
    const input = `${'-'.repeat(10_000)}abc${'-'.repeat(10_000)}`;
    expect(mentorshipProgramSlug(input)).toBe('abc');
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe('program detail helpers', () => {
  it('derives tab counts from list lengths', () => {
    const detail = buildMentorshipProgramDetail(
      {
        id: 'mp_test',
        slug: 'test',
        name: 'Test',
        projectName: 'LF Energy',
        term: 'Fall 2026',
        status: 'open',
        stats: { mentors: 0, mentees: 0, graduated: 0 },
        createdOn: '2026-01-01T00:00:00.000Z',
        updatedOn: '2026-01-01T00:00:00.000Z',
      },
      {
        mentees: [{ id: '1', name: 'A', email: 'a@example.com', status: 'accepted', termName: 'Fall 2026' }],
        applicants: [],
        mentors: [
          { id: '2', name: 'B', email: 'b@example.com', status: 'pending' },
          { id: '3', name: 'C', email: 'c@example.com', status: 'accepted' },
        ],
        terms: [],
      }
    );

    expect(detail.tabCounts).toEqual({ mentees: 1, applicants: 0, mentors: 2, terms: 0 });
  });

  it('scopes mentees to the tab that will render them, so the badge never over-counts', () => {
    const program = {
      id: 'mp_test',
      slug: 'test',
      name: 'Test',
      projectName: 'LF Energy',
      term: 'Fall 2026',
      stats: { mentors: 0, mentees: 0, graduated: 0 },
      createdOn: '2026-01-01T00:00:00.000Z',
      updatedOn: '2026-01-01T00:00:00.000Z',
    };
    const mentees: MentorshipProgramMentee[] = [
      { id: '1', name: 'A', email: 'a@example.com', status: 'accepted', termName: 'Fall 2026' },
      // Still an applicant, so it belongs to neither mentee tab.
      { id: '2', name: 'B', email: 'b@example.com', status: 'pending', termName: 'Fall 2026' },
      { id: '3', name: 'C', email: 'c@example.com', status: 'withdrawn', termName: 'Fall 2026' },
    ];
    const lists = { mentees, applicants: [], mentors: [], terms: [] };

    // A live program answers "who is taking part", so the withdrawal is out and the
    // accepted mentee is in. Whatever the tab renders is what the badge counts.
    const open = buildMentorshipProgramDetail({ ...program, status: 'open' as const }, lists);
    expect(open.mentees.map((person) => person.id)).toEqual(['1']);
    expect(open.tabCounts.mentees).toBe(open.mentees.length);

    // Completing the program inverts it: the withdrawal is now history worth showing,
    // and no mentee can still be `accepted` by the time a program closes.
    const completed = buildMentorshipProgramDetail({ ...program, status: 'completed' as const }, lists);
    expect(completed.mentees.map((person) => person.id)).toEqual(['3']);
    expect(completed.tabCounts.mentees).toBe(completed.mentees.length);
  });

  it('splits mentees between the live and completed tabs, keeping graduates on both', () => {
    const mentees: MentorshipProgramMentee[] = [
      { id: '1', name: 'A', email: 'a@example.com', status: 'accepted', termName: 'Fall 2026' },
      { id: '2', name: 'B', email: 'b@example.com', status: 'pending', termName: 'Fall 2026' },
      { id: '3', name: 'C', email: 'c@example.com', status: 'graduated', termName: 'Fall 2026' },
      { id: '4', name: 'D', email: 'd@example.com', status: 'declined', termName: 'Fall 2026' },
    ];

    // Live: taking part or finished early. The declined mentee waits for completion.
    expect(mentorshipMenteesForProgram(mentees, false).map((person) => person.id)).toEqual(['1', '3']);
    // Completed: how each participation ended, so the graduate carries over and the
    // decline appears. `pending` is an applicant either way.
    expect(mentorshipMenteesForProgram(mentees, true).map((person) => person.id)).toEqual(['3', '4']);
    expect(mentorshipMenteesForProgram([], false)).toEqual([]);
  });

  it('tints an avatar deterministically, and survives an empty name', () => {
    // The guard matters: without it an empty name indexes the palette by NaN and the
    // avatar renders with an undefined class.
    expect(mentorshipPersonAvatarClass('')).toBe(MENTORSHIP_PROGRAM_AVATAR_PALETTE[0]);

    expect(MENTORSHIP_PROGRAM_AVATAR_PALETTE).toContain(mentorshipPersonAvatarClass('Alex Rivera'));
    expect(MENTORSHIP_PROGRAM_AVATAR_PALETTE).toContain(mentorshipPersonAvatarClass('Ifeoma Adeyemi'));

    // Same person, same colour on every tab that renders them.
    expect(mentorshipPersonAvatarClass('Alex Rivera')).toBe(mentorshipPersonAvatarClass('Alex Rivera'));
  });

  it('resolves a row note, preferring this session draft over the stored one', () => {
    const addLabel = 'Add note';

    expect(mentorshipNoteDisplay({}, { id: 'mnt_1' }, addLabel)).toEqual({ hasNote: false, noteLabel: addLabel });
    expect(mentorshipNoteDisplay({}, { id: 'mnt_1', note: 'from the server' }, addLabel)).toEqual({ hasNote: true, noteLabel: 'from the server' });
    expect(mentorshipNoteDisplay({ mnt_1: 'edited here' }, { id: 'mnt_1', note: 'from the server' }, addLabel)).toEqual({
      hasNote: true,
      noteLabel: 'edited here',
    });
    // An explicit clear is a draft too, so it must beat the stored note.
    expect(mentorshipNoteDisplay({ mnt_1: '' }, { id: 'mnt_1', note: 'from the server' }, addLabel)).toEqual({ hasNote: false, noteLabel: addLabel });
    // Whitespace is not a note.
    expect(mentorshipNoteDisplay({ mnt_1: '   ' }, { id: 'mnt_1' }, addLabel)).toEqual({ hasNote: false, noteLabel: addLabel });
    // A neighbour's draft never leaks into this row.
    expect(mentorshipNoteDisplay({ mnt_2: 'theirs' }, { id: 'mnt_1' }, addLabel)).toEqual({ hasNote: false, noteLabel: addLabel });
  });

  it('resolves row actions against the caller label and icon maps', () => {
    const labels = { accepted: 'Accept', declined: 'Decline' };
    const icons = { accepted: 'fa-check', declined: 'fa-xmark' };

    expect(mentorshipRowActions(['accepted', 'declined'], labels, icons)).toEqual([
      { label: 'Accept', icon: 'fa-check' },
      { label: 'Decline', icon: 'fa-xmark' },
    ]);
    // Order follows the caller's list, and an empty list means the row shows no menu.
    expect(mentorshipRowActions(['declined'], labels, icons)).toEqual([{ label: 'Decline', icon: 'fa-xmark' }]);
    expect(mentorshipRowActions([], labels, icons)).toEqual([]);
  });

  it('matches people by name or email, but not by term', () => {
    const person = { id: '1', name: 'Alex Rivera', email: 'alex.rivera@example.com', status: 'accepted' as const, termName: 'Fall 2026' };

    expect(matchesMentorshipPersonSearch(person, '')).toBe(true);
    expect(matchesMentorshipPersonSearch(person, 'rivera')).toBe(true);
    expect(matchesMentorshipPersonSearch(person, 'ALEX.RIVERA')).toBe(true);
    // Term search was dropped deliberately: mentors carry no `termName`, so the shared
    // helper only matches the two fields both person shapes always have.
    expect(matchesMentorshipPersonSearch(person, 'fall')).toBe(false);
    expect(matchesMentorshipPersonSearch(person, 'winter')).toBe(false);
  });

  it('formats an inclusive UTC date range', () => {
    expect(formatMentorshipDateRange('2026-07-01', '2026-08-31')).toBe('Jul 1, 2026 – Aug 31, 2026');
  });

  it('offers mentee row actions that exclude the current status, and none once graduated', () => {
    expect(mentorshipMenteeActionsFor('accepted')).toEqual(['withdrawn', 'declined', 'graduated']);
    // Only an accepted mentee can graduate.
    expect(mentorshipMenteeActionsFor('pending')).toEqual(['withdrawn', 'declined']);
    expect(mentorshipMenteeActionsFor('declined')).toEqual(['withdrawn']);
    expect(mentorshipMenteeActionsFor('withdrawn')).toEqual(['declined']);
    // `graduated` is terminal.
    expect(mentorshipMenteeActionsFor('graduated')).toEqual([]);
  });

  it('reads an application as Applied until every prerequisite is submitted', () => {
    const applicant = (overrides: Partial<MentorshipProgramMentee>): MentorshipProgramMentee => ({
      id: 'app_1',
      name: 'Ifeoma Adeyemi',
      email: 'ifeoma.adeyemi@example.com',
      status: 'pending',
      termName: 'Fall 2026',
      ...overrides,
    });

    expect(mentorshipApplicantDisplayStatus(applicant({ tasksSubmitted: 2, tasksTotal: 5 }))).toBe('applied');
    expect(mentorshipApplicantDisplayStatus(applicant({ tasksSubmitted: 5, tasksTotal: 5 }))).toBe('tasks-completed');
    // No prerequisites assigned is not the same as having completed them.
    expect(mentorshipApplicantDisplayStatus(applicant({}))).toBe('applied');
    // Every resolved status displays as itself, whatever the task counts say.
    expect(mentorshipApplicantDisplayStatus(applicant({ status: 'accepted', tasksSubmitted: 1, tasksTotal: 5 }))).toBe('accepted');
    expect(mentorshipApplicantDisplayStatus(applicant({ status: 'graduated' }))).toBe('graduated');
  });

  it('offers applicant row actions that exclude the current status, and never re-accepts a graduate', () => {
    expect(mentorshipApplicantActionsFor('pending')).toEqual(['accepted', 'declined', 'withdrawn']);
    expect(mentorshipApplicantActionsFor('accepted')).toEqual(['declined', 'withdrawn']);
    expect(mentorshipApplicantActionsFor('declined')).toEqual(['accepted', 'withdrawn']);
    expect(mentorshipApplicantActionsFor('withdrawn')).toEqual(['accepted', 'declined']);
    expect(mentorshipApplicantActionsFor('graduated')).toEqual(['declined', 'withdrawn']);
  });

  it('formats task progress, and reports no label when nothing is assigned', () => {
    expect(formatMentorshipTaskProgress(7, 12)).toBe('7 of 12 submitted');
    expect(formatMentorshipTaskProgress(0, 12)).toBe('0 of 12 submitted');
    // A missing count is a mentee with tasks assigned but none submitted yet.
    expect(formatMentorshipTaskProgress(undefined, 9)).toBe('0 of 9 submitted');
    // No assigned tasks must not render as "0 of 0 submitted".
    expect(formatMentorshipTaskProgress(0, 0)).toBeNull();
    expect(formatMentorshipTaskProgress(3, undefined)).toBeNull();
  });

  it('builds two-letter initials from a display name', () => {
    expect(mentorshipPersonInitials('Alex Rivera')).toBe('AR');
    expect(mentorshipPersonInitials('Priya')).toBe('PR');
    expect(mentorshipPersonInitials('   ')).toBe('?');
  });
});
