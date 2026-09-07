// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { createEmptyMentorshipEnrollForm } from '../constants/mentorship-enroll.constants';
import {
  buildMentorshipProgramDetail,
  formatMentorshipDateRange,
  formatMentorshipMonthYear,
  formatMentorshipShortMonthYear,
  getMentorshipEnrollStepErrors,
  getMentorshipTermDateErrors,
  isMentorshipTermEnded,
  mentorshipOpenTermCount,
  mentorshipTermHasApplications,
  isMentorshipCiiProjectId,
  isMentorshipEnrollStepValid,
  isMentorshipHttpUrl,
  isMentorshipIsoDate,
  isMentorshipLogoFileName,
  matchesMentorshipPersonSearch,
  mentorshipMonthYearToStartDate,
  mentorshipPersonInitials,
  mentorshipProgramSlug,
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

  it('requires at least one skill, term, required prerequisite, and accepted terms', () => {
    const form = createEmptyMentorshipEnrollForm();
    form.terms = [];

    expect(getMentorshipEnrollStepErrors('setup', form).skills).toBe('Add at least one skill.');
    expect(getMentorshipEnrollStepErrors('setup', form).terms).toBe('Add at least one program term.');
    expect(getMentorshipEnrollStepErrors('prerequisites', form).prerequisites).toBe('At least one prerequisite is required.');
    expect(getMentorshipEnrollStepErrors('prerequisites', form).termsAccepted).toBe('Please accept terms and conditions in order to proceed.');
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
  it('accepts digits only', () => {
    expect(isMentorshipCiiProjectId('1842')).toBe(true);
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
          { id: '2', name: 'B', email: 'b@example.com', status: 'invited', termName: 'Fall 2026' },
          { id: '3', name: 'C', email: 'c@example.com', status: 'accepted', termName: 'Fall 2026' },
        ],
        terms: [],
      }
    );

    expect(detail.tabCounts).toEqual({ mentees: 1, applicants: 0, mentors: 2, terms: 0 });
  });

  it('matches people by name, email, or term', () => {
    const person = { id: '1', name: 'Alex Rivera', email: 'alex.rivera@example.com', status: 'accepted' as const, termName: 'Fall 2026' };

    expect(matchesMentorshipPersonSearch(person, '')).toBe(true);
    expect(matchesMentorshipPersonSearch(person, 'rivera')).toBe(true);
    expect(matchesMentorshipPersonSearch(person, 'ALEX.RIVERA')).toBe(true);
    expect(matchesMentorshipPersonSearch(person, 'fall')).toBe(true);
    expect(matchesMentorshipPersonSearch(person, 'winter')).toBe(false);
  });

  it('formats an inclusive UTC date range', () => {
    expect(formatMentorshipDateRange('2026-07-01', '2026-08-31')).toBe('Jul 1, 2026 – Aug 31, 2026');
  });

  it('builds two-letter initials from a display name', () => {
    expect(mentorshipPersonInitials('Alex Rivera')).toBe('AR');
    expect(mentorshipPersonInitials('Priya')).toBe('PR');
    expect(mentorshipPersonInitials('   ')).toBe('?');
  });
});
