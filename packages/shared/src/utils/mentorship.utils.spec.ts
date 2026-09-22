// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

import { createDefaultMentorshipTerm, createEmptyMentorshipEnrollForm } from '../constants/mentorship-enroll.constants';
import {
  MENTORSHIP_MENTEE_INTRODUCTION_MAX,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT,
  MOCK_MENTORSHIP_MENTEE_TASKS,
} from '../constants/mentorship-mentee.constants';
import { createEmptyMentorshipMentorForm, MENTORSHIP_MENTOR_INTRODUCTION_MAX } from '../constants/mentorship-mentor.constants';
import { MENTORSHIP_PROGRAM_AVATAR_PALETTE } from '../constants/mentorship.constants';
import type { MentorshipMentorRegisterForm, MentorshipProgramMentee } from '../interfaces/mentorship.interface';
import {
  buildMentorshipMenteeApplicationViews,
  buildMentorshipMenteeTaskView,
  buildMentorshipMenteeTaskViews,
  buildMentorshipProgramDetail,
  countSubmittedMentorshipMenteeTasks,
  createEmptyMentorshipMenteeForm,
  normalizeMentorshipMenteeTaskStatus,
  formatMentorshipDateRange,
  formatMentorshipMonthYear,
  formatMentorshipShortMonthYear,
  filterMentorshipApplicantTasks,
  formatMentorshipApplicantTaskDueLabel,
  formatMentorshipTaskProgress,
  formatMentorshipReviewUpdatedLabel,
  mentorshipMenteeTaskCompletion,
  mentorshipMentorReviewTasks,
  mentorshipMentorSubmittedTaskCount,
  mentorshipApplicantHasTasks,
  mentorshipApplicantTaskRows,
  getMentorshipEnrollStepErrors,
  getMentorshipMenteeRegisterErrors,
  getMentorshipMentorRegisterErrors,
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
  isMentorshipResumeFileName,
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
  mentorshipRowActions,
  parseMentorshipDateOnly,
  parseMentorshipMonthYear,
  toMentorshipDateOnly,
} from './mentorship.utils';

describe('getMentorshipEnrollStepErrors', () => {
  /** Creates a form with all details-step fields filled to valid values. Override only the field under test. */
  const createValidDetailsForm = (): ReturnType<typeof createEmptyMentorshipEnrollForm> => {
    const form = createEmptyMentorshipEnrollForm();
    form.name = 'GridFlow Mentorship';
    form.projectId = 'proj-gridflow';
    form.technologies = ['GO'];
    form.description = '<p>Build a pipeline.</p>';
    form.repositoryUrl = 'https://github.com/lfenergy/gridflow';
    form.logoFileName = 'logo.png';
    return form;
  };

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
    expect(isMentorshipEnrollStepValid('details', createValidDetailsForm())).toBe(true);
  });

  it('rejects an unknown projectId that is not in the known project options', () => {
    const form = createValidDetailsForm();
    form.projectId = 'proj-unknown-not-in-allowlist';

    expect(getMentorshipEnrollStepErrors('details', form).projectId).toBe('Select a valid Linux Foundation project.');
  });

  it('rejects a whitespace-only projectId as blank', () => {
    const form = createValidDetailsForm();
    form.projectId = '   ';

    expect(getMentorshipEnrollStepErrors('details', form).projectId).toBe('Select a Linux Foundation project.');
  });

  it('accepts a valid projectId with surrounding whitespace after trimming', () => {
    const form = createValidDetailsForm();
    form.projectId = '  proj-gridflow  ';

    expect(getMentorshipEnrollStepErrors('details', form).projectId).toBeUndefined();
  });

  it('rejects a case-variant of a valid projectId (IDs are case-sensitive)', () => {
    const form = createValidDetailsForm();
    form.projectId = 'PROJ-GRIDFLOW';

    expect(getMentorshipEnrollStepErrors('details', form).projectId).toBe('Select a valid Linux Foundation project.');
  });

  it('rejects a non-numeric CII project ID', () => {
    const form = createValidDetailsForm();
    form.ciiProjectId = 'abc';

    expect(getMentorshipEnrollStepErrors('details', form).ciiProjectId).toBe('Invalid CII Project ID');
  });

  it('rejects a short program name and an invalid repository URL', () => {
    const form = createValidDetailsForm();
    form.name = 'Go';
    form.repositoryUrl = 'not-a-url';

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

  it('rejects dates that do not exist on the calendar', () => {
    expect(parseMentorshipDateOnly('2026-02-31')).toBeNull();
    expect(parseMentorshipDateOnly('not-a-date')).toBeNull();
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

  it('requires an introduction, skills, and both acknowledgements to become a mentor', () => {
    expect(getMentorshipMentorRegisterErrors(createEmptyMentorshipMentorForm())).toEqual({
      introduction: 'Introduction is required.',
      skills: 'Add at least one skill.',
      complianceAccepted: 'Please confirm the compliance statement.',
      termsAccepted: 'Please accept the terms and conditions.',
    });
  });

  it('registers a mentor who has neither applied to a program nor attached a resume', () => {
    // Both are optional: a mentor can register a profile now and apply to programs later.
    const complete: MentorshipMentorRegisterForm = {
      introduction: '<p>Maintainer on two CNCF projects.</p>',
      skills: ['Go'],
      resumeFileName: '',
      complianceAccepted: true,
      termsAccepted: true,
    };

    expect(getMentorshipMentorRegisterErrors(complete)).toEqual({});
  });

  it('treats markup with no text as an empty introduction', () => {
    const form = { ...createEmptyMentorshipMentorForm(), skills: ['Go'], complianceAccepted: true, termsAccepted: true };

    // The rich editor leaves an empty paragraph behind when the user clears the field.
    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: '<p></p>' }).introduction).toBe('Introduction is required.');
    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: '<p>  </p>' }).introduction).toBe('Introduction is required.');
    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: '<p>Hi</p>' }).introduction).toBeUndefined();
  });

  it('caps the introduction, since it reaches a mentor profile the whole platform can read', () => {
    const form = { ...createEmptyMentorshipMentorForm(), skills: ['Go'], complianceAccepted: true, termsAccepted: true };
    const atCap = `<p>${'a'.repeat(MENTORSHIP_MENTOR_INTRODUCTION_MAX)}</p>`;

    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: atCap }).introduction).toBeUndefined();
    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: `${atCap}<p>a</p>` }).introduction).toBe(
      `Introduction must be ${MENTORSHIP_MENTOR_INTRODUCTION_MAX} characters or fewer.`
    );
  });

  it('accepts only document extensions for a resume', () => {
    expect(isMentorshipResumeFileName('resume.pdf')).toBe(true);
    expect(isMentorshipResumeFileName('resume.DOCX')).toBe(true);
    expect(isMentorshipResumeFileName('resume.doc')).toBe(true);
    expect(isMentorshipResumeFileName('resume.png')).toBe(false);
    // No extension at all, and a name that only looks like one.
    expect(isMentorshipResumeFileName('resume')).toBe(false);
    expect(isMentorshipResumeFileName('')).toBe(false);
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

  it('computes mentee task completion from assigned statuses, excluding prerequisites', () => {
    const tasks = [{ status: 'completed' }, { status: 'completed' }, { status: 'in-progress' }] as MentorshipProgramMentee['tasks'];
    const withPrerequisite = [
      { status: 'completed', prerequisite: false },
      { status: 'completed', prerequisite: false },
      { status: 'pending', prerequisite: true },
    ] as MentorshipProgramMentee['tasks'];
    const countOnly = { tasks: [] as MentorshipProgramMentee['tasks'], tasksSubmitted: 7, tasksTotal: 12 };

    expect(mentorshipMenteeTaskCompletion({ tasks })).toEqual({ completed: 2, total: 3, percent: 67 });
    expect(mentorshipMenteeTaskCompletion({ tasks: withPrerequisite })).toEqual({ completed: 2, total: 2, percent: 100 });
    expect(mentorshipMenteeTaskCompletion(countOnly)).toEqual({ completed: 0, total: 0, percent: 0 });
    expect(mentorshipMenteeTaskCompletion({})).toEqual({ completed: 0, total: 0, percent: 0 });
  });

  it('flattens submitted and completed mentee tasks for the mentor Tasks tab', () => {
    const mentees: MentorshipProgramMentee[] = [
      {
        id: 'mnt_1',
        name: 'Hana Suzuki',
        email: 'hana@example.com',
        status: 'accepted',
        termName: 'Fall 2026',
        tasks: [
          {
            id: 'tsk_new',
            name: 'Backpressure design note',
            description: 'Wrote up two options.',
            status: 'submitted',
            prerequisite: false,
            createdOn: '2026-09-10',
            updatedOn: '2026-09-17T10:00:00.000Z',
            hasSubmission: true,
          },
          {
            id: 'tsk_old',
            name: 'Resume',
            description: 'Upload a resume.',
            status: 'completed',
            prerequisite: false,
            createdOn: '2026-07-01',
            updatedOn: '2026-08-15',
            hasSubmission: true,
          },
          {
            id: 'tsk_hidden',
            name: 'Blog',
            description: 'Draft.',
            status: 'in-progress',
            prerequisite: false,
            createdOn: '2026-08-20',
            updatedOn: '2026-09-10',
          },
        ],
      },
    ];

    expect(mentorshipMentorSubmittedTaskCount(mentees)).toBe(1);

    const rows = mentorshipMentorReviewTasks(mentees);
    expect(rows.map((row) => row.id)).toEqual(['mnt_1__tsk_new', 'mnt_1__tsk_old']);
    expect(rows[0]).toMatchObject({
      menteeName: 'Hana Suzuki',
      taskName: 'Backpressure design note',
      status: 'submitted',
      termName: 'Fall 2026',
      hasSubmission: true,
    });
  });

  it('labels recent review timestamps with hours and Yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));

    expect(formatMentorshipReviewUpdatedLabel('2026-09-17T10:00:00.000Z')).toBe('2 hours ago');
    expect(formatMentorshipReviewUpdatedLabel('2026-09-16T12:00:00.000Z')).toBe('Yesterday');

    // Date-only strings are normalized to UTC midnight (`T00:00:00Z`), which is
    // timezone-independent and SSR-safe. At the frozen clock (2026-09-17T12:00Z)
    // the diff is exactly 12 hours regardless of the host timezone.
    expect(formatMentorshipReviewUpdatedLabel('2026-09-17')).toBe('12 hours ago');

    vi.useRealTimers();
  });

  it('detects applicants with assigned tasks and resolves task row labels', () => {
    expect(mentorshipApplicantHasTasks({ tasks: [], tasksTotal: 0 })).toBe(false);
    expect(mentorshipApplicantHasTasks({ tasksTotal: 3 })).toBe(true);
    expect(mentorshipApplicantHasTasks({ tasks: [{ id: 'tsk_1' } as any] })).toBe(true);

    expect(formatMentorshipApplicantTaskDueLabel({ prerequisite: true })).toBe('Prerequisite Task');
    expect(formatMentorshipApplicantTaskDueLabel({ prerequisite: false, dueOn: '2026-10-15' })).toBe('Oct 15, 2026');
    expect(formatMentorshipApplicantTaskDueLabel({ prerequisite: false })).toBe('—');

    const tasks = [
      {
        id: 'tsk_1',
        name: 'Resume',
        description: 'Upload the most recent version of your resume.',
        status: 'submitted' as const,
        prerequisite: false,
        createdOn: '2026-05-14',
        updatedOn: '2026-09-01',
        hasSubmission: true,
      },
      {
        id: 'tsk_2',
        name: 'Cover Letter',
        description: 'A letter to the program covering the following topics:',
        status: 'pending' as const,
        prerequisite: true,
        createdOn: '2026-05-14',
        updatedOn: '2026-06-20',
      },
    ];

    expect(filterMentorshipApplicantTasks(tasks, true)).toEqual([tasks[0]]);
    expect(filterMentorshipApplicantTasks(tasks, false)).toEqual(tasks);
    expect(mentorshipApplicantTaskRows(tasks)[0]).toMatchObject({
      statusLabel: 'Submitted',
      statusBadgeClass: 'bg-emerald-100 text-emerald-700',
      createdLabel: 'May 14, 2026',
      dueLabel: '—',
      updatedLabel: 'Sep 1, 2026',
      canView: true,
      canDownload: true,
    });
    expect(mentorshipApplicantTaskRows(tasks)[1]).toMatchObject({
      statusLabel: 'Pending',
      statusBadgeClass: 'bg-gray-100 text-gray-600',
    });
  });

  it('builds two-letter initials from a display name', () => {
    expect(mentorshipPersonInitials('Alex Rivera')).toBe('AR');
    expect(mentorshipPersonInitials('Priya')).toBe('PR');
    expect(mentorshipPersonInitials('   ')).toBe('?');
  });
});

describe('getMentorshipMenteeRegisterErrors', () => {
  it('requires an introduction, both skills fields, and every eligibility / compliance / terms acknowledgement', () => {
    // An empty seed produces one error per required field — nothing more, nothing less.
    // Both `skillsHave` and `skillsWant` are required: they describe what the mentee
    // brings and what they want to grow, and both sides feed the mentor-match.
    expect(getMentorshipMenteeRegisterErrors(createEmptyMentorshipMenteeForm())).toEqual({
      introduction: 'Introduction is required.',
      skillsHave: 'Add at least one skill you currently have.',
      skillsWant: 'Add at least one skill you would like to improve.',
      ageEligible: 'Please confirm you are 18 years of age or older.',
      workAuthorized: 'Please confirm you are authorized to work in your country of residence.',
      noDuplicateProfile: 'Please confirm you do not already have a mentee profile.',
      complianceAccepted: 'Please confirm the compliance statement.',
      termsAccepted: 'Please accept the terms and conditions.',
    });
  });

  it('accepts a fully populated form — additional notes, resume, and demographic answers stay optional', () => {
    // `additionalNotes`, `resumeFileName`, and every demographic control are optional
    // by design: declining a demographic is a valid answer, and the resume is
    // validated by its picker at selection time.
    const complete = {
      ...createEmptyMentorshipMenteeForm(),
      introduction: '<p>Backend engineer looking to break into distributed systems.</p>',
      skillsHave: ['Go'],
      skillsWant: ['Kubernetes'],
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    };

    expect(getMentorshipMenteeRegisterErrors(complete)).toEqual({});
  });

  it('blocks submit when `skillsWant` is empty — it feeds the mentor match the same as `skillsHave`', () => {
    // Started life as an optional field flagged by Bugbot for a misleading `*` marker;
    // the fix was to make it mandatory rather than drop the marker, because a mentee
    // with no growth-goal cannot be matched against a mentor's teaching interests.
    const form = {
      ...createEmptyMentorshipMenteeForm(),
      introduction: '<p>Hi</p>',
      skillsHave: ['Go'],
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    };

    expect(getMentorshipMenteeRegisterErrors(form).skillsWant).toBe('Add at least one skill you would like to improve.');
    expect(getMentorshipMenteeRegisterErrors({ ...form, skillsWant: ['Kubernetes'] }).skillsWant).toBeUndefined();
  });

  it('treats markup with no text as an empty introduction (rich editor leaves a stray `<p></p>`)', () => {
    const form = {
      ...createEmptyMentorshipMenteeForm(),
      skillsHave: ['Go'],
      skillsWant: ['Kubernetes'],
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    };

    expect(getMentorshipMenteeRegisterErrors({ ...form, introduction: '<p></p>' }).introduction).toBe('Introduction is required.');
    expect(getMentorshipMenteeRegisterErrors({ ...form, introduction: '<p>  </p>' }).introduction).toBe('Introduction is required.');
    expect(getMentorshipMenteeRegisterErrors({ ...form, introduction: '<p>Hi</p>' }).introduction).toBeUndefined();
  });

  it('caps the introduction at MENTORSHIP_MENTEE_INTRODUCTION_MAX', () => {
    const form = {
      ...createEmptyMentorshipMenteeForm(),
      skillsHave: ['Go'],
      skillsWant: ['Kubernetes'],
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    };
    const atCap = `<p>${'a'.repeat(MENTORSHIP_MENTEE_INTRODUCTION_MAX)}</p>`;

    expect(getMentorshipMenteeRegisterErrors({ ...form, introduction: atCap }).introduction).toBeUndefined();
    expect(getMentorshipMenteeRegisterErrors({ ...form, introduction: `${atCap}<p>a</p>` }).introduction).toBe(
      `Introduction must be ${MENTORSHIP_MENTEE_INTRODUCTION_MAX} characters or fewer.`
    );
  });

  it('accepts the PrimeNG-array shape for the terms checkboxes, since binary=false writes an array', () => {
    // PrimeNG's checkbox with `binary` disabled writes a non-empty array. The
    // helper must not reject that shape — a visibly-checked box would otherwise be
    // read as unchecked and every eligibility error would still be raised.
    const form = {
      ...createEmptyMentorshipMenteeForm(),
      introduction: '<p>Hi</p>',
      skillsHave: ['Go'],
      skillsWant: ['Kubernetes'],
      // Array form, not boolean.
      ageEligible: ['yes'] as unknown as boolean,
      workAuthorized: ['yes'] as unknown as boolean,
      noDuplicateProfile: ['yes'] as unknown as boolean,
      complianceAccepted: ['yes'] as unknown as boolean,
      termsAccepted: ['yes'] as unknown as boolean,
    };

    expect(getMentorshipMenteeRegisterErrors(form)).toEqual({});
  });

  it('does not raise errors on the demographic fields — declining is a valid answer', () => {
    // Every demographic control (`age`, `raceEthnicity`, `gender`, `income`,
    // `education`) plus its consent checkbox stays untouched here; the returned
    // error object must never surface them.
    const form = {
      ...createEmptyMentorshipMenteeForm(),
      introduction: '<p>Hi</p>',
      skillsHave: ['Go'],
      skillsWant: ['Kubernetes'],
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    };

    const errors = getMentorshipMenteeRegisterErrors(form);
    expect(errors).toEqual({});
    // Belt-and-braces: the specific keys must not appear even with a defined value.
    for (const key of [
      'ageConsent',
      'age',
      'raceEthnicityConsent',
      'raceEthnicity',
      'genderConsent',
      'gender',
      'incomeConsent',
      'income',
      'educationConsent',
      'education',
    ] as const) {
      expect(errors).not.toHaveProperty(key);
    }
  });
});

describe('normalizeMentorshipMenteeTaskStatus', () => {
  it('collapses the backend aliases to dropdown values', () => {
    expect(normalizeMentorshipMenteeTaskStatus('incomplete')).toBe('pending');
    expect(normalizeMentorshipMenteeTaskStatus('complete')).toBe('submitted');
  });

  it('passes selectable statuses through unchanged', () => {
    expect(normalizeMentorshipMenteeTaskStatus('pending')).toBe('pending');
    expect(normalizeMentorshipMenteeTaskStatus('in_progress')).toBe('in_progress');
    expect(normalizeMentorshipMenteeTaskStatus('submitted')).toBe('submitted');
  });
});

describe('countSubmittedMentorshipMenteeTasks', () => {
  it('counts only submitted and complete tasks', () => {
    const count = countSubmittedMentorshipMenteeTasks([
      { status: 'submitted' },
      { status: 'complete' },
      { status: 'pending' },
      { status: 'in_progress' },
      { status: 'incomplete' },
    ]);
    expect(count).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(countSubmittedMentorshipMenteeTasks([])).toBe(0);
  });
});

describe('buildMentorshipMenteeTaskView', () => {
  it('flags a submitted task with an uploaded file', () => {
    const view = buildMentorshipMenteeTaskView({
      id: 't1',
      title: 'Submit resume',
      description: 'Upload your resume',
      status: 'submitted',
      submitFile: 'https://files.example.com/r.pdf',
      fileUrl: 'https://files.example.com/r.pdf',
      submittedLabel: 'Sep 12, 2026',
    });
    expect(view.submitted).toBe(true);
    expect(view.inProgress).toBe(false);
    expect(view.hasUploadedFile).toBe(true);
    expect(view.needsUpload).toBe(false);
    expect(view.fileUrl).toBe('https://files.example.com/r.pdf');
    expect(view.submittedLabel).toBe('Sep 12, 2026');
    expect(view.statusClass).not.toBe('');
  });

  it('flags a task that still needs an upload', () => {
    const view = buildMentorshipMenteeTaskView({
      id: 't2',
      title: 'Coding challenge',
      description: 'Complete the challenge',
      status: 'in_progress',
      submitFile: 'required',
      dueDate: '2026-09-30T00:00:00Z',
    });
    expect(view.inProgress).toBe(true);
    expect(view.submitted).toBe(false);
    expect(view.hasUploadedFile).toBe(false);
    expect(view.needsUpload).toBe(true);
    expect(view.fileUrl).toBeNull();
    expect(view.dueDate).toBe('2026-09-30T00:00:00Z');
    expect(view.submittedLabel).toBeNull();
  });

  it('treats a task with no submission requirement as neither uploaded nor pending upload', () => {
    const view = buildMentorshipMenteeTaskView({
      id: 't3',
      title: 'Read the guide',
      description: 'No file needed',
      status: 'pending',
      submitFile: null,
    });
    expect(view.hasUploadedFile).toBe(false);
    expect(view.needsUpload).toBe(false);
  });
});

describe('buildMentorshipMenteeApplicationViews', () => {
  it('maps applications into display-ready cards with task rows', () => {
    const views = buildMentorshipMenteeApplicationViews(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT.applications);
    expect(views.length).toBe(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT.applications.length);
    const [first] = views;
    expect(first.programName).toBeTruthy();
    expect(first.statusLabel).toBeTruthy();
    expect(first.totalCount).toBeGreaterThan(0);
    expect(first.submittedCount).toBeLessThanOrEqual(first.totalCount);
  });
});

describe('buildMentorshipMenteeTaskViews', () => {
  it('maps every accepted task into a view', () => {
    const views = buildMentorshipMenteeTaskViews(MOCK_MENTORSHIP_MENTEE_TASKS.data);
    expect(views.length).toBe(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
    expect(views.every((v) => typeof v.statusClass === 'string')).toBe(true);
  });
});
