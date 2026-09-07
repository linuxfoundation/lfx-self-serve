// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { createEmptyMentorshipEnrollForm } from '../constants/mentorship-enroll.constants';
import {
  formatMentorshipMonthYear,
  getMentorshipEnrollStepErrors,
  getMentorshipTermDateErrors,
  isMentorshipCiiProjectId,
  isMentorshipEnrollStepValid,
  isMentorshipHttpUrl,
  isMentorshipLogoFileName,
  mentorshipMonthYearToStartDate,
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
});

describe('isMentorshipCiiProjectId', () => {
  it('accepts digits only', () => {
    expect(isMentorshipCiiProjectId('1842')).toBe(true);
    expect(isMentorshipCiiProjectId('abc')).toBe(false);
    expect(isMentorshipCiiProjectId('')).toBe(false);
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
});
