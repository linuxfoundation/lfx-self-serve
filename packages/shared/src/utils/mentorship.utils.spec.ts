// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultMentorshipTerm,
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_RICH_TEXT_RAW_MAX,
  MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE,
} from '../constants/mentorship-enroll.constants';
import {
  MENTORSHIP_MENTEE_INTRODUCTION_MAX,
  MENTORSHIP_MENTEE_TASK_HINT_FILE_REQUIRED,
  MENTORSHIP_MENTEE_TASK_HINT_LOCKED,
  MENTORSHIP_MENTEE_TASK_HINT_START_FIRST,
  MENTORSHIP_MENTEE_TASK_STATUS_CLASSES,
} from '../constants/mentorship-mentee.constants';
import { createEmptyMentorshipMentorForm, MENTORSHIP_MENTOR_INTRODUCTION_MAX } from '../constants/mentorship-mentor.constants';
import { MENTORSHIP_PROGRAM_AVATAR_PALETTE } from '../constants/mentorship.constants';
import { htmlClipboardToText } from './html-utils';
import type {
  MentorshipMenteeApplication,
  MentorshipMenteeApplicationTask,
  MentorshipMenteeProfileDetails,
  MentorshipMenteeProfileFormValue,
  MentorshipMenteeTaskStatus,
  MentorshipMenteeTaskView,
} from '../interfaces/mentorship-mentee.interface';
import type { MentorshipMentorRegisterForm, MentorshipProgramMentee } from '../interfaces/mentorship.interface';
import {
  buildMentorshipMenteeApplicationView,
  buildMentorshipMenteeDemographicsUpdate,
  buildMentorshipMenteeProfileUpdate,
  buildMentorshipMenteeOverview,
  buildMentorshipMenteeTaskView,
  buildMentorshipProgramDetail,
  countSubmittedMentorshipMenteeTasks,
  createEmptyMentorshipMenteeForm,
  normalizeMentorshipMenteeTaskStatus,
  formatMentorshipDateRange,
  formatMentorshipMonthYear,
  getMentorshipMenteeTaskStatusOptions,
  isMentorshipMenteeUpdatableTaskStatus,
  mentorshipMenteeTaskStatusFields,
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
  mentorshipDescriptionLength,
  mentorshipOpenTermCount,
  mentorshipTermHasApplications,
  isMentorshipCiiProjectId,
  isMentorshipEnrollStepValid,
  isMentorshipHttpUrl,
  isMentorshipIsoDate,
  isMentorshipLogoFileName,
  isMentorshipResumeFileName,
  isMentorshipRichTextOverRawMax,
  isMentorshipTermsAccepted,
  matchesMentorshipPersonSearch,
  mentorshipApplicantActionsFor,
  mentorshipApplicantDisplayStatus,
  mentorshipMenteeActionsFor,
  mentorshipMenteeDisplayStatus,
  isMentorshipMenteeProfileUpdateEmpty,
  mentorshipMenteeProgressTasks,
  mentorshipMenteesForProgram,
  mentorshipMonthYearToStartDate,
  mentorshipNoteDisplay,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
  mentorshipPlainTextToHtml,
  mentorshipRowActions,
  parseMentorshipDateOnly,
  parseMentorshipMonthYear,
  toMentorshipDateOnly,
  toMentorshipUtcInstant,
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

  it('defaults an unrecognised status to pending', () => {
    expect(normalizeMentorshipMenteeTaskStatus('mystery' as never)).toBe('pending');
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

describe('mentorshipMenteeTaskStatusFields', () => {
  it('derives the flags and pill class from the normalised status', () => {
    expect(mentorshipMenteeTaskStatusFields('in_progress')).toEqual({
      status: 'in_progress',
      submitted: false,
      inProgress: true,
      statusClass: MENTORSHIP_MENTEE_TASK_STATUS_CLASSES.in_progress,
    });
    expect(mentorshipMenteeTaskStatusFields('complete')).toEqual({
      status: 'submitted',
      submitted: true,
      inProgress: false,
      statusClass: MENTORSHIP_MENTEE_TASK_STATUS_CLASSES.submitted,
    });
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
      submittedDate: '2026-09-12T00:00:00Z',
    });
    expect(view.submitted).toBe(true);
    expect(view.inProgress).toBe(false);
    expect(view.hasUploadedFile).toBe(true);
    expect(view.needsUpload).toBe(false);
    expect(view.fileUrl).toBe('https://files.example.com/r.pdf');
    expect(view.submittedDate).toBe('2026-09-12T00:00:00Z');
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
    expect(view.submittedDate).toBeNull();
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

  it('surfaces a submitFile URL as the file URL when fileUrl is absent', () => {
    const view = buildMentorshipMenteeTaskView({
      id: 't4',
      title: 'Uploaded via submitFile',
      description: 'The URL lives on submitFile only',
      status: 'submitted',
      submitFile: 'https://files.example.com/only-submitfile.pdf',
    });
    expect(view.hasUploadedFile).toBe(true);
    expect(view.needsUpload).toBe(false);
    expect(view.fileUrl).toBe('https://files.example.com/only-submitfile.pdf');
  });

  it('normalises an unrecognised status to a real, styled option', () => {
    const view = buildMentorshipMenteeTaskView({
      id: 't5',
      title: 'Unknown status',
      description: 'From an unrecognised backend value',
      status: 'mystery' as never,
      submitFile: null,
    });
    // Falls back to a selectable value so the dropdown, badge styling, and the
    // Pending filter all agree instead of leaving it blank/unstyled.
    expect(view.status).toBe('pending');
    expect(view.submitted).toBe(false);
    expect(view.inProgress).toBe(false);
    expect(view.statusClass).not.toBe('');
  });
});

describe('buildMentorshipMenteeTaskView requiresFile', () => {
  const build = (submitFile: string | null, fileUrl?: string): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView({ id: 't1', title: 'Task', description: 'Synthetic task', status: 'in_progress', submitFile, fileUrl });

  it('is true for submit_file "required" with no stored file', () => {
    expect(build('required').requiresFile).toBe(true);
  });

  it('is true for a URL submit_file with no stored file, even though View and Download show', () => {
    const view = build('https://files.example.com/template.pdf');
    expect(view.requiresFile).toBe(true);
    expect(view.hasUploadedFile).toBe(true);
  });

  it('is false when a file is stored', () => {
    expect(build('required', 'https://files.example.com/upload.pdf').requiresFile).toBe(false);
  });

  it('is false when the task needs no file', () => {
    expect(build(null).requiresFile).toBe(false);
  });
});

describe('isMentorshipMenteeUpdatableTaskStatus', () => {
  it('accepts in_progress and submitted only', () => {
    expect(isMentorshipMenteeUpdatableTaskStatus('in_progress')).toBe(true);
    expect(isMentorshipMenteeUpdatableTaskStatus('submitted')).toBe(true);
    for (const value of ['pending', 'incomplete', 'complete', 'IN_PROGRESS', '', null, undefined, 1]) {
      expect(isMentorshipMenteeUpdatableTaskStatus(value)).toBe(false);
    }
  });
});

describe('getMentorshipMenteeTaskStatusOptions', () => {
  const taskView = (status: MentorshipMenteeTaskStatus, submitFile: string | null = null, fileUrl?: string): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView({ id: 't1', title: 'Task', description: 'Synthetic task', status, submitFile, fileUrl });
  const disabledByValue = (view: MentorshipMenteeTaskView): Record<string, boolean> =>
    Object.fromEntries(getMentorshipMenteeTaskStatusOptions(view).options.map((option) => [option.value, option.disabled]));

  it('lets a pending task start but not skip to submitted', () => {
    const state = getMentorshipMenteeTaskStatusOptions(taskView('pending'));
    expect(disabledByValue(taskView('pending'))).toEqual({ pending: false, in_progress: false, submitted: true });
    expect(state.locked).toBe(false);
    expect(state.hint).toBe(MENTORSHIP_MENTEE_TASK_HINT_START_FIRST);
    expect(state.hintVisible).toBe(false);
  });

  it('lets an in-progress task be submitted, with no way back and no hint', () => {
    const state = getMentorshipMenteeTaskStatusOptions(taskView('in_progress'));
    expect(disabledByValue(taskView('in_progress'))).toEqual({ pending: true, in_progress: false, submitted: false });
    expect(state.locked).toBe(false);
    expect(state.hint).toBeNull();
    expect(state.hintVisible).toBe(false);
  });

  it('disables submitted with a visible hint when a file is required and not stored', () => {
    const view = taskView('in_progress', 'required');
    const state = getMentorshipMenteeTaskStatusOptions(view);
    expect(disabledByValue(view)).toEqual({ pending: true, in_progress: false, submitted: true });
    expect(state.hint).toBe(MENTORSHIP_MENTEE_TASK_HINT_FILE_REQUIRED);
    expect(state.hintVisible).toBe(true);
  });

  it('keeps submitted enabled when the required file is already stored', () => {
    const view = taskView('in_progress', 'required', 'https://files.example.com/upload.pdf');
    expect(disabledByValue(view)).toEqual({ pending: true, in_progress: false, submitted: false });
    expect(getMentorshipMenteeTaskStatusOptions(view).hint).toBeNull();
  });

  it('locks a submitted task with every option disabled and a hidden hint', () => {
    const view = taskView('submitted');
    const state = getMentorshipMenteeTaskStatusOptions(view);
    expect(state.locked).toBe(true);
    expect(disabledByValue(view)).toEqual({ pending: true, in_progress: true, submitted: true });
    expect(state.hint).toBe(MENTORSHIP_MENTEE_TASK_HINT_LOCKED);
    expect(state.hintVisible).toBe(false);
  });

  it('locks a complete task, which normalises to submitted', () => {
    const state = getMentorshipMenteeTaskStatusOptions({ ...taskView('submitted'), status: 'complete' });
    expect(state.locked).toBe(true);
    expect(state.options.every((option) => option.disabled)).toBe(true);
  });
});

function menteeTask(overrides: Partial<MentorshipMenteeApplicationTask> = {}): MentorshipMenteeApplicationTask {
  return {
    id: 'task-1',
    name: 'Task 1',
    description: 'Synthetic task',
    category: 'prerequisite',
    status: 'incomplete',
    submitFile: null,
    updatedOn: '2026-07-01T10:00:00Z',
    ...overrides,
  };
}

function menteeApplication(overrides: Partial<MentorshipMenteeApplication> = {}): MentorshipMenteeApplication {
  return {
    id: 'app-1',
    programId: 'prog-1',
    programName: 'Program One',
    projectName: 'Project One',
    term: { id: 'term-1', name: 'Fall 2026' },
    upstreamStatus: 'pending',
    createdOn: '2026-06-01T10:00:00Z',
    updatedOn: '2026-06-02T10:00:00Z',
    decisionExpectedDate: '2026-08-01',
    tasks: [],
    ...overrides,
  };
}

describe('mentorshipMenteeDisplayStatus', () => {
  it('shows an accepted application as active', () => {
    expect(mentorshipMenteeDisplayStatus(menteeApplication({ upstreamStatus: 'accepted' }))).toBe('active');
  });

  it('shows a graduated application as graduated', () => {
    expect(mentorshipMenteeDisplayStatus(menteeApplication({ upstreamStatus: 'graduated' }))).toBe('graduated');
  });

  it('shows a pending application with an open prerequisite task as in progress', () => {
    const app = menteeApplication({ tasks: [menteeTask({ status: 'submitted' }), menteeTask({ id: 'task-2', status: 'in_progress' })] });
    expect(mentorshipMenteeDisplayStatus(app)).toBe('in-progress');
  });

  it('shows a pending application with every prerequisite submitted as awaiting review', () => {
    const app = menteeApplication({
      tasks: [
        menteeTask({ status: 'submitted' }),
        menteeTask({ id: 'task-2', status: 'complete' }),
        menteeTask({ id: 'task-3', category: 'non_prerequisite' }),
      ],
    });
    expect(mentorshipMenteeDisplayStatus(app)).toBe('awaiting-review');
  });

  it('shows a pending application with no prerequisite tasks as awaiting review', () => {
    expect(mentorshipMenteeDisplayStatus(menteeApplication())).toBe('awaiting-review');
  });

  it('shows a pending application whose tasks were not read as in progress', () => {
    expect(mentorshipMenteeDisplayStatus(menteeApplication({ tasks: undefined }))).toBe('in-progress');
  });

  it('returns null for statuses that belong in Past Applications', () => {
    for (const upstreamStatus of ['declined', 'withdrawn', 'hold'] as const) {
      expect(mentorshipMenteeDisplayStatus(menteeApplication({ upstreamStatus }))).toBeNull();
    }
  });
});

describe('mentorshipMenteeProgressTasks', () => {
  const tasks = [menteeTask({ id: 'prereq' }), menteeTask({ id: 'regular', category: 'non_prerequisite' })];

  it('tracks prerequisite tasks while pending', () => {
    expect(mentorshipMenteeProgressTasks(menteeApplication({ tasks })).map((task) => task.id)).toEqual(['prereq']);
  });

  it('tracks non-prerequisite tasks once accepted or graduated', () => {
    for (const upstreamStatus of ['accepted', 'graduated'] as const) {
      const ids = mentorshipMenteeProgressTasks(menteeApplication({ upstreamStatus, tasks })).map((task) => task.id);
      expect(ids).toEqual(['regular']);
    }
  });

  it('tracks nothing when the tasks were not read', () => {
    expect(mentorshipMenteeProgressTasks(menteeApplication({ upstreamStatus: 'accepted', tasks: undefined }))).toEqual([]);
  });
});

describe('buildMentorshipMenteeApplicationView', () => {
  it('counts the tracked tasks and labels the progress by status', () => {
    const app = menteeApplication({
      upstreamStatus: 'accepted',
      tasks: [
        menteeTask({ id: 'prereq', status: 'incomplete' }),
        menteeTask({ id: 'a', category: 'non_prerequisite', status: 'complete', submittedOn: '2026-07-02T10:00:00Z' }),
        menteeTask({ id: 'b', category: 'non_prerequisite', status: 'in_progress' }),
        menteeTask({ id: 'c', category: 'non_prerequisite', status: 'incomplete' }),
      ],
    });
    const view = buildMentorshipMenteeApplicationView(app, 'active');
    expect(view.progressLabel).toBe('Tasks');
    expect(view.statusLabel).toBe('Active');
    expect(view.accepted).toBe(true);
    expect(view.submittedCount).toBe(1);
    expect(view.totalCount).toBe(3);
    expect(view.progressPercent).toBe(33);
    expect(view.tasks.map((task) => task.id)).toEqual(['a', 'b', 'c']);
    expect(view.tasks[0].submittedDate).toBe('2026-07-02T10:00:00Z');
  });

  it('uses the latest application or task change as the last update', () => {
    const app = menteeApplication({
      tasks: [menteeTask({ updatedOn: '2026-07-05T10:00:00Z' }), menteeTask({ id: 'task-2', updatedOn: '2026-06-20T10:00:00Z' })],
    });
    expect(buildMentorshipMenteeApplicationView(app, 'in-progress').lastUpdatedOn).toBe('2026-07-05T10:00:00Z');
  });

  it('reports zero progress and a null decision date when there is nothing to track', () => {
    const view = buildMentorshipMenteeApplicationView(menteeApplication({ decisionExpectedDate: undefined }), 'awaiting-review');
    expect(view.progressPercent).toBe(0);
    expect(view.progressLabel).toBe('Prerequisite Tasks');
    expect(view.accepted).toBe(false);
    expect(view.decisionExpectedDate).toBeNull();
  });

  it('drops the decision date once the application is accepted or graduated', () => {
    expect(buildMentorshipMenteeApplicationView(menteeApplication(), 'awaiting-review').decisionExpectedDate).toBe('2026-08-01');
    expect(buildMentorshipMenteeApplicationView(menteeApplication({ upstreamStatus: 'accepted' }), 'active').decisionExpectedDate).toBeNull();
    expect(buildMentorshipMenteeApplicationView(menteeApplication({ upstreamStatus: 'graduated' }), 'graduated').decisionExpectedDate).toBeNull();
  });

  it('labels a graduated card Graduated and tracks its non-prerequisite tasks', () => {
    const app = menteeApplication({
      upstreamStatus: 'graduated',
      tasks: [menteeTask({ id: 'prereq' }), menteeTask({ id: 'a', category: 'non_prerequisite', status: 'complete' })],
    });
    const view = buildMentorshipMenteeApplicationView(app, 'graduated');
    expect(view.statusLabel).toBe('Graduated');
    expect(view.progressLabel).toBe('Tasks');
    expect(view.accepted).toBe(true);
    expect(view.tasks.map((task) => task.id)).toEqual(['a']);
  });

  it('carries the program logo for the avatar, leaving it absent when the program has none', () => {
    const withLogo = menteeApplication({ programLogoUrl: 'https://example.com/logo.png' });
    expect(buildMentorshipMenteeApplicationView(withLogo, 'awaiting-review').programLogoUrl).toBe('https://example.com/logo.png');
    expect(buildMentorshipMenteeApplicationView(menteeApplication(), 'awaiting-review').programLogoUrl).toBeUndefined();
  });
});

describe('toMentorshipUtcInstant', () => {
  it('turns a date-only value into its UTC midnight instant', () => {
    expect(toMentorshipUtcInstant('2026-07-15')).toBe('2026-07-15T00:00:00Z');
  });

  it('leaves a full timestamp unchanged', () => {
    expect(toMentorshipUtcInstant('2026-07-15T10:30:00Z')).toBe('2026-07-15T10:30:00Z');
  });
});

describe('buildMentorshipMenteeOverview', () => {
  it('returns the empty phase when there are no applications', () => {
    expect(buildMentorshipMenteeOverview([])).toEqual({ phase: 'empty', pendingCount: 0, openTaskCount: 0, cards: [], past: [] });
  });

  it('orders cards active, awaiting review, in progress and sends the rest to Past Applications', () => {
    const overview = buildMentorshipMenteeOverview([
      menteeApplication({ id: 'in-progress', tasks: [menteeTask()] }),
      menteeApplication({ id: 'declined', upstreamStatus: 'declined', createdOn: '2026-01-01T00:00:00Z' }),
      menteeApplication({ id: 'awaiting' }),
      menteeApplication({ id: 'hold', upstreamStatus: 'hold', createdOn: '2026-03-01T00:00:00Z' }),
      menteeApplication({ id: 'accepted', upstreamStatus: 'accepted', tasks: [menteeTask({ category: 'non_prerequisite' })] }),
      menteeApplication({ id: 'graduated', upstreamStatus: 'graduated', tasks: [menteeTask({ category: 'non_prerequisite', status: 'complete' })] }),
    ]);
    expect(overview.phase).toBe('applicant');
    expect(overview.cards.map((card) => card.id)).toEqual(['accepted', 'graduated', 'awaiting', 'in-progress']);
    expect(overview.past.map((row) => [row.id, row.outcome, row.outcomeLabel, row.outcomeBadgeClass])).toEqual([
      ['hold', 'on-hold', 'On Hold', 'bg-blue-100 text-blue-700'],
      ['declined', 'not-selected', 'Not selected', 'bg-red-100 text-red-600'],
    ]);
    expect(overview.pendingCount).toBe(2);
    expect(overview.openTaskCount).toBe(2);
  });

  it('stays in the applicant phase when every application is in the past', () => {
    const overview = buildMentorshipMenteeOverview([menteeApplication({ upstreamStatus: 'withdrawn' })]);
    expect(overview.phase).toBe('applicant');
    expect(overview.cards).toEqual([]);
    expect(overview.past[0].outcome).toBe('withdrawn');
  });
});

describe('mentorshipDescriptionLength', () => {
  it('counts plain-text characters, ignoring tags and decoding entities', () => {
    expect(mentorshipDescriptionLength('<p>Hi &amp; <strong>bye</strong></p>')).toBe(8);
    expect(mentorshipDescriptionLength('')).toBe(0);
  });

  it('still strips tags for input exactly at MENTORSHIP_RICH_TEXT_RAW_MAX', () => {
    const html = `<p>${'a'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX - 7)}</p>`;
    expect(html.length).toBe(MENTORSHIP_RICH_TEXT_RAW_MAX);
    expect(mentorshipDescriptionLength(html)).toBe(MENTORSHIP_RICH_TEXT_RAW_MAX - 7);
  });

  it('returns the raw length for input over MENTORSHIP_RICH_TEXT_RAW_MAX, so it fails every rich-text cap', () => {
    const html = `<p>${'a'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX)}</p>`;
    expect(mentorshipDescriptionLength(html)).toBe(html.length);
    expect(mentorshipDescriptionLength(html)).toBeGreaterThan(MENTORSHIP_ENROLL_DESCRIPTION_MAX);
  });

  it('rejects adversarial nested-bracket input without running the quadratic strip loop (lfx-self-serve-ops#37)', () => {
    // The too-large message is only reachable through the raw-cap early return, so it proves the
    // strip was skipped. Stripping this payload would run for minutes and trip the test timeout.
    const half = 500_000;
    const hostile = `${'<'.repeat(half)}${'>'.repeat(half)}`;
    const length = mentorshipDescriptionLength(hostile);
    expect(length).toBeGreaterThan(MENTORSHIP_MENTEE_INTRODUCTION_MAX);
    expect(getMentorshipMenteeRegisterErrors({ ...createEmptyMentorshipMenteeForm(), introduction: hostile }).introduction).toBe(
      MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE
    );
  });
});

describe('isMentorshipRichTextOverRawMax', () => {
  it('is false at the raw cap and true one character over it', () => {
    expect(isMentorshipRichTextOverRawMax('a'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX))).toBe(false);
    expect(isMentorshipRichTextOverRawMax('a'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX + 1))).toBe(true);
  });
});

describe('rich-text fields over MENTORSHIP_RICH_TEXT_RAW_MAX', () => {
  // Short visible text wrapped in enough formatting to pass the raw cap — the plain-text limit is not
  // what the user hit, so the validators must say so instead of quoting a character count.
  const overRawCap = `<p>${'<strong>a</strong>'.repeat(Math.ceil(MENTORSHIP_RICH_TEXT_RAW_MAX / 18) + 1)}</p>`;

  it('reports formatting as the problem on the enroll description', () => {
    const form = { ...createEmptyMentorshipEnrollForm(), description: overRawCap };
    expect(getMentorshipEnrollStepErrors('details', form).description).toBe(MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE);
  });

  it('reports formatting as the problem on the mentor introduction', () => {
    const form = { ...createEmptyMentorshipMentorForm(), introduction: overRawCap };
    expect(getMentorshipMentorRegisterErrors(form).introduction).toBe(MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE);
  });

  it('reports formatting as the problem on the mentee introduction', () => {
    const form = { ...createEmptyMentorshipMenteeForm(), introduction: overRawCap };
    expect(getMentorshipMenteeRegisterErrors(form).introduction).toBe(MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE);
  });
});

describe('mentorshipPlainTextToHtml', () => {
  it('returns an empty string for null, undefined, empty and whitespace-only input', () => {
    expect(mentorshipPlainTextToHtml(null)).toBe('');
    expect(mentorshipPlainTextToHtml(undefined)).toBe('');
    expect(mentorshipPlainTextToHtml('')).toBe('');
    expect(mentorshipPlainTextToHtml(' \n\t \r\n ')).toBe('');
  });

  it('wraps each non-blank line in a paragraph and turns a blank line into an empty paragraph', () => {
    expect(mentorshipPlainTextToHtml('First\nSecond')).toBe('<p>First</p><p>Second</p>');
    expect(mentorshipPlainTextToHtml('First\n\nSecond')).toBe('<p>First</p><p><br></p><p>Second</p>');
  });

  it('collapses a run of blank lines into one empty paragraph', () => {
    expect(mentorshipPlainTextToHtml('First\n\n \n\t\n\nSecond')).toBe('<p>First</p><p><br></p><p>Second</p>');
  });

  it('escapes markup so a caller can never store tags', () => {
    expect(mentorshipPlainTextToHtml(`<script>alert("x")</script> & 'y'`)).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;</p>');
  });

  it('normalizes CRLF and lone CR line endings', () => {
    expect(mentorshipPlainTextToHtml('One\r\nTwo\rThree')).toBe('<p>One</p><p>Two</p><p>Three</p>');
  });

  it('round-trips through htmlClipboardToText to the same text', () => {
    expect(htmlClipboardToText(mentorshipPlainTextToHtml('One\nTwo'))).toBe('One\nTwo');
    expect(htmlClipboardToText(mentorshipPlainTextToHtml('One\n\nTwo'))).toBe('One\n\nTwo');
    expect(htmlClipboardToText(mentorshipPlainTextToHtml(`A & B <c> "d" 'e'\n\n\n\nF`))).toBe(`A & B <c> "d" 'e'\n\nF`);
  });
});

describe('buildMentorshipMenteeProfileUpdate', () => {
  const seed: MentorshipMenteeProfileDetails = {
    aboutMe: '<p>Hello world</p>',
    skillsHave: ['Go', 'Python'],
    skillsWant: ['Kubernetes'],
    additionalNotes: 'Evenings only',
  };
  const seededIntroduction = 'Hello world';
  const unchanged: MentorshipMenteeProfileFormValue = {
    introduction: seededIntroduction,
    skillsHave: ['Go', 'Python'],
    skillsWant: ['Kubernetes'],
    additionalNotes: 'Evenings only',
  };

  it('returns an empty request when nothing changed', () => {
    const request = buildMentorshipMenteeProfileUpdate(seed, seededIntroduction, unchanged);
    expect(request).toEqual({});
    expect(isMentorshipMenteeProfileUpdateEmpty(request)).toBe(true);
  });

  it('omits the introduction when it equals the seeded text, ignoring surrounding whitespace and CRLF', () => {
    const multiline = 'Line one\nLine two';
    expect(buildMentorshipMenteeProfileUpdate(seed, multiline, { ...unchanged, introduction: '  Line one\r\nLine two\r\n' })).toEqual({});
    expect(buildMentorshipMenteeProfileUpdate(seed, '  Line one\r\nLine two \n', { ...unchanged, introduction: multiline })).toEqual({});
  });

  it('sends the introduction only when it was edited, and an empty string when it was cleared', () => {
    expect(buildMentorshipMenteeProfileUpdate(seed, seededIntroduction, { ...unchanged, introduction: ' Hello there\r\n' })).toEqual({
      introduction: 'Hello there',
    });
    expect(buildMentorshipMenteeProfileUpdate(seed, seededIntroduction, { ...unchanged, introduction: '  ' })).toEqual({ introduction: '' });
  });

  it('sends the whole skill set when only the additional notes changed', () => {
    expect(buildMentorshipMenteeProfileUpdate(seed, seededIntroduction, { ...unchanged, additionalNotes: 'Weekends too' })).toEqual({
      skillSet: { skillsHave: ['Go', 'Python'], skillsWant: ['Kubernetes'], additionalNotes: 'Weekends too' },
    });
  });

  it('compares skills after trimming and detects a reorder', () => {
    expect(buildMentorshipMenteeProfileUpdate(seed, seededIntroduction, { ...unchanged, skillsHave: [' Go ', 'Python', ' '] })).toEqual({});
    expect(buildMentorshipMenteeProfileUpdate(seed, seededIntroduction, { ...unchanged, skillsHave: ['Python', 'Go'] })).toEqual({
      skillSet: { skillsHave: ['Python', 'Go'], skillsWant: ['Kubernetes'], additionalNotes: 'Evenings only' },
    });
  });

  it('omits additional notes when the trimmed notes are blank', () => {
    expect(buildMentorshipMenteeProfileUpdate(seed, seededIntroduction, { ...unchanged, additionalNotes: '   ' })).toEqual({
      skillSet: { skillsHave: ['Go', 'Python'], skillsWant: ['Kubernetes'] },
    });
  });

  it('treats missing stored notes and blank notes as the same', () => {
    const withoutNotes: MentorshipMenteeProfileDetails = { ...seed, additionalNotes: undefined };
    expect(buildMentorshipMenteeProfileUpdate(withoutNotes, seededIntroduction, { ...unchanged, additionalNotes: '' })).toEqual({});
  });

  it('never emits demographics or socioeconomics', () => {
    const request = buildMentorshipMenteeProfileUpdate(seed, seededIntroduction, {
      introduction: 'New',
      skillsHave: ['Rust'],
      skillsWant: ['Go'],
      additionalNotes: 'x',
    });
    expect(Object.keys(request).sort()).toEqual(['introduction', 'skillSet']);
  });
});

describe('buildMentorshipMenteeDemographicsUpdate', () => {
  const blank = {
    ageConsent: false,
    age: '',
    raceEthnicityConsent: false,
    raceEthnicity: '',
    genderConsent: false,
    gender: '',
    incomeConsent: false,
    income: '',
    educationConsent: false,
    education: '',
  };
  const stored = { age: '20-39', gender: 'female', raceEthnicity: 'asian', income: 'workingClass', education: 'college' };
  const storedForm = {
    ageConsent: true,
    age: '20-39',
    raceEthnicityConsent: true,
    raceEthnicity: 'asian',
    genderConsent: true,
    gender: 'female',
    incomeConsent: true,
    income: 'workingClass',
    educationConsent: true,
    education: 'college',
  };

  it('returns an empty request when no row changed, including a stored preferNotToSay row left unconsented', () => {
    expect(buildMentorshipMenteeDemographicsUpdate(stored, storedForm)).toEqual({});
    expect(buildMentorshipMenteeDemographicsUpdate({ age: 'preferNotToSay' }, blank)).toEqual({});
    expect(buildMentorshipMenteeDemographicsUpdate(undefined, blank)).toEqual({});
  });

  it(`returns an empty request when the user picks "I don't want to provide" over an unanswered row`, () => {
    expect(buildMentorshipMenteeDemographicsUpdate(undefined, { ...blank, ageConsent: true, age: 'preferNotToSay' })).toEqual({});
  });

  it('sends only the demographics group when only age changed and keeps the other rows original values', () => {
    expect(buildMentorshipMenteeDemographicsUpdate(stored, { ...storedForm, age: '40-60' })).toEqual({
      demographics: { age: '40-60', gender: 'female', raceEthnicity: 'asian' },
    });
  });

  it('sends only the socioeconomics group when only income changed', () => {
    expect(buildMentorshipMenteeDemographicsUpdate(stored, { ...storedForm, income: 'upperClass' })).toEqual({
      socioeconomics: { income: 'upperClass', education: 'college' },
    });
  });

  it('writes the preferNotToSay token when consent is withdrawn from an answered row', () => {
    expect(buildMentorshipMenteeDemographicsUpdate(stored, { ...storedForm, educationConsent: false, education: '' })).toEqual({
      socioeconomics: { income: 'workingClass', education: 'preferNotToSay' },
    });
  });

  it('writes the preferNotToSay token when the user picks it over an answered row', () => {
    expect(buildMentorshipMenteeDemographicsUpdate(stored, { ...storedForm, gender: 'preferNotToSay' })).toEqual({
      demographics: { age: '20-39', gender: 'preferNotToSay', raceEthnicity: 'asian' },
    });
  });

  it('treats consent checked with no answer as unanswered', () => {
    expect(buildMentorshipMenteeDemographicsUpdate(undefined, { ...blank, ageConsent: true, age: '' })).toEqual({});
    expect(buildMentorshipMenteeDemographicsUpdate({ age: '20-39' }, { ...blank, ageConsent: true, age: ' ' })).toEqual({
      demographics: { age: 'preferNotToSay' },
    });
  });

  it('preserves an original preferNotToSay token on an unchanged row inside a changed group', () => {
    expect(buildMentorshipMenteeDemographicsUpdate({ age: 'preferNotToSay', gender: 'male' }, { ...blank, genderConsent: true, gender: 'nonBinary' })).toEqual({
      demographics: { age: 'preferNotToSay', gender: 'nonBinary' },
    });
  });

  it('omits rows that were never answered and stay unconsented', () => {
    expect(buildMentorshipMenteeDemographicsUpdate(undefined, { ...blank, ageConsent: true, age: '61+' })).toEqual({ demographics: { age: '61+' } });
  });

  it('ignores an answer whose consent box is unchecked, as form.getRawValue reports a disabled control', () => {
    expect(buildMentorshipMenteeDemographicsUpdate(undefined, { ...blank, incomeConsent: true, income: 'upperMiddleClass', education: 'phd' })).toEqual({
      socioeconomics: { income: 'upperMiddleClass' },
    });
  });

  it('never emits introduction or skillSet', () => {
    const request = buildMentorshipMenteeDemographicsUpdate(stored, { ...storedForm, age: '61+', income: 'upperClass' });
    expect(Object.keys(request).sort()).toEqual(['demographics', 'socioeconomics']);
  });
});

describe('isMentorshipMenteeProfileUpdateEmpty', () => {
  it('is true for an empty request and false for any group', () => {
    expect(isMentorshipMenteeProfileUpdateEmpty({})).toBe(true);
    expect(isMentorshipMenteeProfileUpdateEmpty({ introduction: '' })).toBe(false);
    expect(isMentorshipMenteeProfileUpdateEmpty({ skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'] } })).toBe(false);
    expect(isMentorshipMenteeProfileUpdateEmpty({ demographics: { age: '61+' } })).toBe(false);
    expect(isMentorshipMenteeProfileUpdateEmpty({ socioeconomics: { income: 'upperClass' } })).toBe(false);
  });
});
