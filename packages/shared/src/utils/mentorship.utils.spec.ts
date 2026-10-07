// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultMentorshipTerm,
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_ENROLL_LOGO_EMPTY,
  MENTORSHIP_ENROLL_LOGO_MAX_BYTES,
  MENTORSHIP_ENROLL_LOGO_TOO_LARGE,
  MENTORSHIP_ENROLL_LOGO_TYPE_ERROR,
  MENTORSHIP_RICH_TEXT_RAW_MAX,
  MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE,
  MENTORSHIP_SKILL_OPTIONS,
} from '../constants/mentorship-enroll.constants';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE,
  MENTORSHIP_MENTEE_COUNTRY_UNKNOWN_MESSAGE,
  MENTORSHIP_MENTEE_INTRODUCTION_MAX,
  MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS,
  MENTORSHIP_MENTEE_REGISTER_ERROR_INELIGIBLE,
  MENTORSHIP_MENTEE_REGISTER_ERROR_PROFILE_EXISTS,
  MENTORSHIP_MENTEE_REGISTER_FAILURE_OPTIONS,
  MENTORSHIP_MENTEE_TASK_HINT_FILE_REQUIRED,
  MENTORSHIP_MENTEE_TASK_HINT_LOCKED,
  MENTORSHIP_MENTEE_TASK_HINT_PAST_DUE,
  MENTORSHIP_MENTEE_TASK_HINT_START_FIRST,
  MENTORSHIP_MENTEE_TASK_STATUS_CLASSES,
} from '../constants/mentorship-mentee.constants';
import {
  createEmptyMentorshipMentorForm,
  MENTORSHIP_MENTOR_INTRODUCTION_MAX,
  MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE,
  MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS,
  MENTORSHIP_MENTOR_REGISTER_FAILURE_OPTIONS,
} from '../constants/mentorship-mentor.constants';
import {
  MENTORSHIP_CURRENT_MENTEE_ACTION_ICONS,
  MENTORSHIP_CURRENT_MENTEE_ACTION_LABELS,
  MENTORSHIP_CURRENT_MENTEE_ACTIONS_BY_STATUS,
  MENTORSHIP_PROGRAM_AVATAR_PALETTE,
  MENTORSHIP_REGISTER_ERROR_CONFLICT,
  MENTORSHIP_REGISTER_ERROR_FALLBACK,
  MENTORSHIP_REGISTER_ERROR_READ_ONLY,
  MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL,
} from '../constants/mentorship.constants';
import type {
  MentorshipMenteeApplication,
  MentorshipMenteeApplicationTask,
  MentorshipMenteeProfileDetails,
  MentorshipMenteeProfileFormValue,
  MentorshipMenteeRegisterForm,
  MentorshipMenteeTaskStatus,
  MentorshipMenteeTaskView,
} from '../interfaces/mentorship-mentee.interface';
import type { MentorshipEnrollImport, MentorshipEnrollValidationInput, MentorshipLfProject, MentorshipProgramMentee } from '../interfaces/mentorship.interface';
import type { MentorshipProgramTermRow } from '../interfaces/mentorship-admin.interface';
import type { MentorshipMentorRegisterForm } from '../interfaces/mentorship-mentor.interface';
import {
  buildMentorshipMenteeApplicationView,
  buildMentorshipMenteeDemographicsUpdate,
  buildMentorshipMenteeProfileUpdate,
  buildMentorshipMenteeOverview,
  buildMentorshipMenteeRegisterRequest,
  buildMentorshipMentorProfileUpdate,
  buildMentorshipMentorRegisterRequest,
  buildMentorshipMenteeTaskView,
  buildMentorshipProgramsUrl,
  countSubmittedMentorshipMenteeTasks,
  createEmptyMentorshipMenteeForm,
  normalizeMentorshipMenteeTaskStatus,
  formatMentorshipDateRange,
  formatMentorshipMonthYear,
  getMentorshipMenteeTaskStatusOptions,
  isMentorshipMenteeUpdatableTaskStatus,
  isMentorshipMentorTaskReviewDecision,
  mentorshipMenteeTaskStatusFields,
  mentorshipTaskDueCutoffMs,
  formatMentorshipShortMonthYear,
  filterMentorshipApplicantTasks,
  formFromMentorshipEnrollImport,
  formatMentorshipApplicantTaskDueLabel,
  formatMentorshipReviewUpdatedLabel,
  mentorshipMenteeTaskCompletion,
  mentorshipMentorReviewTasks,
  mentorshipMentorSubmittedTaskCount,
  mentorshipApplicantHasTasks,
  buildMentorshipAdminTaskUpdate,
  mentorshipTaskSubmittedCount,
  mentorshipApplicantTaskRows,
  getMentorshipEnrollLogoError,
  getMentorshipEnrollStepErrors,
  getMentorshipEnrollTermDateErrors,
  getMentorshipMenteeIntroductionError,
  getMentorshipMenteeRegisterErrors,
  getMentorshipMenteeRegisterRequestErrors,
  getMentorshipMentorProfileErrors,
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
  isMentorshipMentorProfileUpdateEmpty,
  isMentorshipRichTextOverRawMax,
  isMentorshipTaskPastDue,
  isMentorshipTermsAccepted,
  matchesMentorshipPersonSearch,
  mapMentorshipRegisterFailure,
  mentorshipApplicantDisplayStatus,
  mentorshipMenteeDisplayStatus,
  isMentorshipMenteeProfileUpdateEmpty,
  isMentorshipMentorInviteToken,
  mentorshipMenteeProgressTasks,
  mentorshipMonthYearToStartDate,
  mentorshipNoteDisplay,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
  mentorshipRowActions,
  parseMentorshipDateOnly,
  parseMentorshipMonthYear,
  toMentorshipDateOnly,
  toMentorshipEnrollCreateRequest,
  toMentorshipUtcEndOfDayInstant,
  toMentorshipUtcInstant,
  buildMentorshipGraduateTaskWarning,
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

  it('accepts any non-blank projectId because the picker offers live query-service projects', () => {
    const form = createValidDetailsForm();
    form.projectId = '0d3f1c52-7a1e-4b8e-9d5c-1a2b3c4d5e6f';

    expect(getMentorshipEnrollStepErrors('details', form).projectId).toBeUndefined();
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

  it('refuses the application windows upstream create refuses', () => {
    const term = { id: 'term-1', name: 'Term 1 - 2099', startDate: '2099-06-01', endDate: '2099-08-31', applicationStartDate: '2099-03-01' };
    const form = createEmptyMentorshipEnrollForm();
    form.skills = ['GO'];

    form.terms = [{ ...term, applicationEndDate: '2099-03-01' }];
    expect(getMentorshipEnrollStepErrors('setup', form).terms).toBe('Application end date must be after the application start date.');

    form.terms = [{ ...term, applicationEndDate: '2099-06-15' }];
    expect(getMentorshipEnrollStepErrors('setup', form).terms).toBe('Application end date must be before the term start month.');

    form.terms = [{ ...term, applicationEndDate: '2099-05-31' }];
    expect(getMentorshipEnrollStepErrors('setup', form).terms).toBeUndefined();
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

describe('getMentorshipEnrollLogoError', () => {
  it('accepts a png or jpeg within the limit, including exactly the limit', () => {
    expect(getMentorshipEnrollLogoError({ name: 'logo.png', size: 1024, type: 'image/png' })).toBe('');
    expect(getMentorshipEnrollLogoError({ name: 'logo.JPG', size: MENTORSHIP_ENROLL_LOGO_MAX_BYTES, type: 'image/jpeg' })).toBe('');
  });

  it('refuses another type first, then an empty file, then a file over the limit', () => {
    expect(getMentorshipEnrollLogoError({ name: 'notes.pdf', size: 10, type: 'application/pdf' })).toBe(MENTORSHIP_ENROLL_LOGO_TYPE_ERROR);
    expect(getMentorshipEnrollLogoError({ name: 'notes.pdf', size: MENTORSHIP_ENROLL_LOGO_MAX_BYTES + 1, type: 'application/pdf' })).toBe(
      MENTORSHIP_ENROLL_LOGO_TYPE_ERROR
    );
    expect(getMentorshipEnrollLogoError({ name: 'logo.png', size: 0, type: 'image/png' })).toBe(MENTORSHIP_ENROLL_LOGO_EMPTY);
    expect(getMentorshipEnrollLogoError({ name: 'logo.png', size: MENTORSHIP_ENROLL_LOGO_MAX_BYTES + 1, type: 'image/png' })).toBe(
      MENTORSHIP_ENROLL_LOGO_TOO_LARGE
    );
  });

  it('refuses a logo name whose content type the upload route would refuse, including an empty type', () => {
    expect(getMentorshipEnrollLogoError({ name: 'logo.png', size: 10, type: 'image/gif' })).toBe(MENTORSHIP_ENROLL_LOGO_TYPE_ERROR);
    expect(getMentorshipEnrollLogoError({ name: 'logo.png', size: 10, type: '' })).toBe(MENTORSHIP_ENROLL_LOGO_TYPE_ERROR);
  });
});

describe('toMentorshipEnrollCreateRequest', () => {
  const project: MentorshipLfProject = { id: 'proj-1', name: 'Acme Rocket', slug: 'acme-rocket', logoUrl: 'https://cdn.example/acme.png' };

  function validForm(overrides: Partial<MentorshipEnrollValidationInput> = {}): MentorshipEnrollValidationInput {
    const { logoPreviewUrl: _preview, ...base } = createEmptyMentorshipEnrollForm();
    return {
      ...base,
      name: '  Acme Rocket Mentorship  ',
      projectId: 'proj-1',
      technologies: ['Go', 'Kubernetes'],
      description: '<p>Build rockets.</p>',
      repositoryUrl: ' https://github.com/acme/rocket ',
      websiteUrl: ' https://rocket.example ',
      codeOfConductUrl: ' https://rocket.example/coc ',
      ciiProjectId: ' 1234 ',
      logoFileName: 'logo.png',
      skills: ['Rust'],
      terms: [
        {
          id: 'term-1-2027',
          name: '  Term 1 - 2027 ',
          startDate: '2027-03-01',
          endDate: '2027-05-01',
          applicationStartDate: '2027-01-01',
          applicationEndDate: '2027-02-28',
        },
      ],
      prerequisites: [{ id: 'p1', name: ' Resume ', description: ' Upload it. ', required: true, requireFile: true, dueDate: '2027-02-15' }],
      termsAccepted: true,
      ...overrides,
    };
  }

  it('copies the project and trims the text fields', () => {
    const request = toMentorshipEnrollCreateRequest(validForm(), project);

    expect(request).toMatchObject({
      projectId: 'proj-1',
      projectSlug: 'acme-rocket',
      projectName: 'Acme Rocket',
      projectLogoUrl: 'https://cdn.example/acme.png',
      name: 'Acme Rocket Mentorship',
      description: '<p>Build rockets.</p>',
      repositoryUrl: 'https://github.com/acme/rocket',
      websiteUrl: 'https://rocket.example',
      codeOfConductUrl: 'https://rocket.example/coc',
      ciiProjectId: '1234',
      termsAccepted: true,
    });
  });

  it('omits the optional fields that are empty', () => {
    const request = toMentorshipEnrollCreateRequest(validForm({ websiteUrl: '  ', codeOfConductUrl: '', ciiProjectId: ' ', technologies: [] }), {
      id: 'proj-1',
      name: 'Acme Rocket',
      slug: 'acme-rocket',
    });

    expect(request).not.toHaveProperty('projectLogoUrl');
    expect(request).not.toHaveProperty('websiteUrl');
    expect(request).not.toHaveProperty('codeOfConductUrl');
    expect(request).not.toHaveProperty('ciiProjectId');
    expect(request).not.toHaveProperty('industry');
  });

  it('joins technologies into industry, de-duplicated case-insensitively, and keeps them out of skills', () => {
    const request = toMentorshipEnrollCreateRequest(
      validForm({ technologies: [' Go ', 'go', '', 'Kubernetes', 'GO'], skills: ['Rust', ' rust ', ''] }),
      project
    );

    expect(request.industry).toBe('Go, Kubernetes');
    expect(request.skills).toEqual(['Rust']);
  });

  it('ends each term on the last day of its end month and sends no id', () => {
    const [term] = toMentorshipEnrollCreateRequest(validForm(), project).terms;

    expect(term).toEqual({
      name: 'Term 1 - 2027',
      startDate: '2027-03-01',
      endDate: '2027-05-31',
      applicationStartDate: '2027-01-01',
      applicationEndDate: '2027-02-28',
    });
  });

  it('keeps prerequisites in order, appends the challenge URL and nulls an empty due date', () => {
    const request = toMentorshipEnrollCreateRequest(
      validForm({
        prerequisites: [
          { id: 'p1', name: ' Resume ', description: ' Upload it. ', required: true, requireFile: true, dueDate: '2027-02-15' },
          { id: 'p2', name: 'Challenge', description: 'Solve it.', required: false, challengeUrl: ' https://code.example/c ', dueDate: '' },
        ],
      }),
      project
    );

    expect(request.prerequisites).toEqual([
      { name: 'Resume', description: 'Upload it.', required: true, requireFile: true, dueDate: '2027-02-15' },
      { name: 'Challenge', description: 'Solve it.\n\nChallenge: https://code.example/c', required: false, requireFile: false, dueDate: null },
    ]);
  });

  it('never carries the logo, import or status fields', () => {
    const request = toMentorshipEnrollCreateRequest(validForm({ importProgramId: 'mp_1' }), project) as unknown as Record<string, unknown>;

    for (const key of ['logoFileName', 'logoPreviewUrl', 'importProgramId', 'status', 'logo_url', 'logoUrl']) {
      expect(request).not.toHaveProperty(key);
    }
  });
});

describe('formFromMentorshipEnrollImport', () => {
  const imported: MentorshipEnrollImport = {
    name: 'Existing Program',
    project: { id: '11111111-1111-4111-8111-111111111111', name: 'Project One', slug: 'project-one' },
    description: '<p>Copied description</p>',
    repositoryUrl: 'https://github.com/example/repo',
    websiteUrl: 'https://example.org',
    codeOfConductUrl: 'https://example.org/coc',
    ciiProjectId: '1842',
    technologies: ['Go', 'Kubernetes'],
    skills: ['Java', 'Database'],
    prerequisites: [
      { id: 'imported-0', name: 'Resume', description: 'Upload the most recent version of your resume.', required: true, requireFile: true, custom: true },
      { id: 'imported-1', name: 'Essay', description: '', required: true, requireFile: false, custom: true, dueDate: '2027-01-15' },
    ],
  };

  it('copies the details, technologies and skills', () => {
    const form = formFromMentorshipEnrollImport('mp_1', imported);

    expect(form).toMatchObject({
      importProgramId: 'mp_1',
      name: 'Existing Program',
      projectId: '11111111-1111-4111-8111-111111111111',
      description: '<p>Copied description</p>',
      repositoryUrl: 'https://github.com/example/repo',
      websiteUrl: 'https://example.org',
      codeOfConductUrl: 'https://example.org/coc',
      ciiProjectId: '1842',
      technologies: ['Go', 'Kubernetes'],
      skills: ['Java', 'Database'],
    });
  });

  it('selects the standard prerequisites the program used and adds the rest as custom ones', () => {
    const form = formFromMentorshipEnrollImport('mp_1', imported);
    const standard = createEmptyMentorshipEnrollForm().prerequisites;

    expect(form.prerequisites).toHaveLength(standard.length + 1);
    expect(form.prerequisites.find((item) => item.id === 'prereq-resume')).toEqual({ ...standard[0], required: true });
    expect(form.prerequisites.filter((item) => item.required && !item.custom).map((item) => item.id)).toEqual(['prereq-resume']);
    expect(form.prerequisites.at(-1)).toEqual(imported.prerequisites[1]);
  });

  it('matches standard names ignoring case and gives the Coding Challenge back its URL', () => {
    const form = formFromMentorshipEnrollImport('mp_1', {
      ...imported,
      prerequisites: [
        {
          id: 'imported-0',
          name: 'coding challenge',
          description: 'Complete a code challenge\n\nChallenge: https://challenge.example/task',
          required: true,
          requireFile: false,
          custom: true,
        },
      ],
    });

    expect(form.prerequisites.find((item) => item.id === 'prereq-coding')).toMatchObject({ required: true, challengeUrl: 'https://challenge.example/task' });
    expect(form.prerequisites.some((item) => item.custom)).toBe(false);
  });

  it('reads the Coding Challenge URL only from a Challenge: line at the end of its description', () => {
    const importCoding = (description: string) => {
      const prerequisites = formFromMentorshipEnrollImport('mp_1', {
        ...imported,
        prerequisites: [{ id: 'imported-0', name: 'Coding Challenge', description, required: true, requireFile: false, custom: true }],
      }).prerequisites;
      const coding = prerequisites.find((item) => item.id === 'prereq-coding');
      return { selected: coding?.required, url: coding?.challengeUrl, custom: prerequisites.filter((item) => item.custom).map((item) => item.description) };
    };
    const base = 'Complete a code challenge';

    expect(importCoding(`${base}\n\tChallenge:  https://challenge.example/task  \n`)).toEqual({
      selected: true,
      url: 'https://challenge.example/task',
      custom: [],
    });
    expect(importCoding(base)).toEqual({ selected: true, url: '', custom: [] });
    for (const description of [
      'Challenge: https://challenge.example/task',
      `${base}\n\nChallenge: https://challenge.example/task\nMore text`,
      `${base}${'\n'.repeat(50_000)}More text`,
    ]) {
      expect(importCoding(description)).toEqual({ selected: false, url: '', custom: [description] });
    }
  });

  it('keeps a standard prerequisite the program changed as a custom one with its stored values', () => {
    const resume = { name: 'Resume', description: 'Upload the most recent version of your resume.', required: true, requireFile: true, custom: true };
    const changed = [
      { ...resume, id: 'imported-0', description: 'Upload a one-page resume.' },
      { ...resume, id: 'imported-1', requireFile: false },
      { ...resume, id: 'imported-2', dueDate: '2027-01-15' },
    ];

    for (const item of changed) {
      const form = formFromMentorshipEnrollImport('mp_1', { ...imported, prerequisites: [item] });

      expect(form.prerequisites.find((entry) => entry.id === 'prereq-resume')?.required).toBe(false);
      expect(form.prerequisites.at(-1)).toEqual(item);
    }
  });

  it('passes the prerequisites step for a program created from the standard list', () => {
    const used = createEmptyMentorshipEnrollForm().prerequisites.filter((item) => item.challengeUrl === undefined);
    const form = formFromMentorshipEnrollImport('mp_1', {
      ...imported,
      prerequisites: used.map((item, index) => ({
        id: `imported-${index}`,
        name: item.name,
        description: item.description,
        required: true,
        requireFile: item.requireFile === true,
        custom: true,
      })),
    });

    expect(form.prerequisites.filter((item) => item.required).map((item) => item.id)).toEqual(used.map((item) => item.id));
    expect(getMentorshipEnrollStepErrors('prerequisites', { ...form, termsAccepted: true })).toEqual({});
  });

  it('does not share its lists with the import', () => {
    const form = formFromMentorshipEnrollImport('mp_1', imported);

    expect(form.technologies).not.toBe(imported.technologies);
    expect(form.skills).not.toBe(imported.skills);
    expect(form.prerequisites.at(-1)).not.toBe(imported.prerequisites[1]);
  });

  it('starts with one default term, no logo and the terms not accepted', () => {
    const form = formFromMentorshipEnrollImport('mp_1', imported);

    expect(form.terms).toHaveLength(1);
    expect(form.terms[0]).toEqual(createDefaultMentorshipTerm());
    expect(form.logoFileName).toBe('');
    expect(form.logoPreviewUrl).toBe('');
    expect(form.termsAccepted).toBe(false);
  });

  it('leaves the project empty when the template has none', () => {
    expect(formFromMentorshipEnrollImport('mp_1', { ...imported, project: null }).projectId).toBe('');
  });
});

describe('buildMentorshipProgramsUrl', () => {
  it('links the program listing, with or without a trailing slash on the base', () => {
    expect(buildMentorshipProgramsUrl('https://mentorship.example.org')).toBe('https://mentorship.example.org/programs');
    expect(buildMentorshipProgramsUrl('https://mentorship.example.org/')).toBe('https://mentorship.example.org/programs');
    expect(buildMentorshipProgramsUrl('https://mentorship.example.org//')).toBe('https://mentorship.example.org/programs');
  });

  it('trims a long run of trailing slashes', () => {
    expect(buildMentorshipProgramsUrl(`https://mentorship.example.org${'/'.repeat(10_000)}`)).toBe('https://mentorship.example.org/programs');
    expect(buildMentorshipProgramsUrl('/'.repeat(10_000))).toBe('/programs');
  });

  it("links one program's page, URL-encoding its id", () => {
    expect(buildMentorshipProgramsUrl('https://mentorship.example.org/', 'prog_gridflow')).toBe('https://mentorship.example.org/programs/prog_gridflow');
    expect(buildMentorshipProgramsUrl('https://mentorship.example.org', 'prog/with space')).toBe('https://mentorship.example.org/programs/prog%2Fwith%20space');
  });
});

describe('getMentorshipEnrollTermDateErrors', () => {
  const term = { startDate: '2099-06-01', endDate: '2099-08-01', applicationStartDate: '2099-03-01' };

  it('reports the windows upstream create refuses on the application end date', () => {
    expect(getMentorshipEnrollTermDateErrors({ ...term, applicationEndDate: '2099-03-01' })).toEqual({
      applicationEndDate: 'Application end date must be after the application start date.',
    });
    expect(getMentorshipEnrollTermDateErrors({ ...term, applicationEndDate: '2099-06-15' })).toEqual({
      applicationEndDate: 'Application end date must be before the term start month.',
    });
    expect(getMentorshipEnrollTermDateErrors({ ...term, applicationEndDate: '2099-05-31' })).toEqual({});
  });

  it('reports the shared term rules first', () => {
    expect(getMentorshipEnrollTermDateErrors({ ...term, applicationEndDate: '2099-02-01' })).toEqual({
      applicationEndDate: 'Application end date must be on or after the application start date.',
    });
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
  const detailTerm = (name: string, status: MentorshipProgramTermRow['status'], id = name): MentorshipProgramTermRow => ({
    id,
    name,
    status,
    pending: 0,
    declined: 0,
    accepted: 0,
    graduated: 0,
    startDate: '2026-01-01',
    endDate: '2026-06-01',
    applicationStartDate: '2025-12-01',
    applicationEndDate: '2025-12-15',
  });
  it('requires an introduction, skills, and both acknowledgements to become a mentor', () => {
    expect(getMentorshipMentorRegisterErrors(createEmptyMentorshipMentorForm())).toEqual({
      introduction: 'Introduction is required.',
      skills: 'Add at least one skill.',
      complianceAccepted: 'Please confirm the compliance statement.',
      termsAccepted: 'Please accept the terms and conditions.',
    });
  });

  it('registers a mentor who has not applied to a program', () => {
    // Requests are optional: a mentor can register a profile now and apply to programs later.
    const complete: MentorshipMentorRegisterForm = {
      introduction: '<p>Maintainer on two CNCF projects.</p>',
      skills: ['Kubernetes'],
      complianceAccepted: true,
      termsAccepted: true,
    };

    expect(getMentorshipMentorRegisterErrors(complete)).toEqual({});
  });

  it('treats markup with no text as an empty introduction', () => {
    const form = { ...createEmptyMentorshipMentorForm(), skills: ['Kubernetes'], complianceAccepted: true, termsAccepted: true };

    // The rich editor leaves an empty paragraph behind when the user clears the field.
    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: '<p></p>' }).introduction).toBe('Introduction is required.');
    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: '<p>  </p>' }).introduction).toBe('Introduction is required.');
    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: '<p>Hi</p>' }).introduction).toBeUndefined();
  });

  it('caps the introduction, since it reaches a mentor profile the whole platform can read', () => {
    const form = { ...createEmptyMentorshipMentorForm(), skills: ['Kubernetes'], complianceAccepted: true, termsAccepted: true };
    const atCap = `<p>${'a'.repeat(MENTORSHIP_MENTOR_INTRODUCTION_MAX)}</p>`;

    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: atCap }).introduction).toBeUndefined();
    expect(getMentorshipMentorRegisterErrors({ ...form, introduction: `${atCap}<p>a</p>` }).introduction).toBe(
      `Introduction must be ${MENTORSHIP_MENTOR_INTRODUCTION_MAX} characters or fewer.`
    );
  });

  it('refuses a mentor skill the picker does not offer, since only a tampered request can carry one', () => {
    const form = { ...createEmptyMentorshipMentorForm(), introduction: '<p>Hi</p>', complianceAccepted: true, termsAccepted: true };

    expect(getMentorshipMentorRegisterErrors({ ...form, skills: ['Kubernetes', 'Not A Skill'] }).skills).toBe(MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL);
    expect(getMentorshipMentorRegisterErrors({ ...form, skills: ['Kubernetes'] }).skills).toBeUndefined();
  });

  it('checks only the mentor profile fields present in an edit', () => {
    expect(getMentorshipMentorProfileErrors({})).toEqual({});
    expect(getMentorshipMentorProfileErrors({ introduction: '<p>Hi</p>' })).toEqual({});
    expect(getMentorshipMentorProfileErrors({ skills: ['Kubernetes'] })).toEqual({});
    expect(getMentorshipMentorProfileErrors({ introduction: '<p></p>' })).toEqual({ introduction: 'Introduction is required.' });
    expect(getMentorshipMentorProfileErrors({ skills: [] })).toEqual({ skills: 'Add at least one skill.' });
    expect(getMentorshipMentorProfileErrors({ skills: ['Not A Skill'] })).toEqual({ skills: MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL });
  });

  it('sends only the mentor profile fields that changed', () => {
    const seed = { aboutMe: '<p>Hi</p>', skills: ['Kubernetes', 'Angular'] };

    expect(buildMentorshipMentorProfileUpdate(seed, { introduction: '<p>Hi</p>', skills: [' Kubernetes ', 'Angular', ''] })).toEqual({});
    expect(buildMentorshipMentorProfileUpdate(seed, { introduction: '<p>Hello</p>', skills: ['Kubernetes', 'Angular'] })).toEqual({
      introduction: '<p>Hello</p>',
    });
    // Order counts, and the whole list is sent, since upstream replaces it.
    expect(buildMentorshipMentorProfileUpdate(seed, { introduction: '<p>Hi</p>', skills: ['Angular', 'Kubernetes'] })).toEqual({
      skills: ['Angular', 'Kubernetes'],
    });
    expect(buildMentorshipMentorProfileUpdate({ aboutMe: '', skills: [] }, { introduction: '', skills: [] })).toEqual({});
  });

  it('treats a mentor profile update with no field present as empty', () => {
    expect(isMentorshipMentorProfileUpdateEmpty({})).toBe(true);
    expect(isMentorshipMentorProfileUpdateEmpty({ introduction: '' })).toBe(false);
    expect(isMentorshipMentorProfileUpdateEmpty({ skills: [] })).toBe(false);
  });

  it('builds the mentor register request from the form', () => {
    const request = buildMentorshipMentorRegisterRequest({
      introduction: '<p>Hi</p>',
      skills: ['Kubernetes'],
      complianceAccepted: true,
      termsAccepted: true,
    });

    expect(request).toEqual({ introduction: '<p>Hi</p>', skills: ['Kubernetes'], complianceAccepted: true, termsAccepted: true });
  });

  it('adds the LFX profile fields to the mentor register request only when there are some', () => {
    const form = { introduction: '<p>Hi</p>', skills: ['Kubernetes'], complianceAccepted: true, termsAccepted: true };
    const lfxProfile = { firstName: 'Test', lastName: 'User', logoUrl: 'https://example.com/avatar.png' };

    expect(buildMentorshipMentorRegisterRequest(form, lfxProfile).lfxProfile).toEqual(lfxProfile);
    expect(buildMentorshipMentorRegisterRequest(form, {})).not.toHaveProperty('lfxProfile');
    expect(buildMentorshipMentorRegisterRequest(form)).not.toHaveProperty('lfxProfile');
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
      { value: 'accepted', label: 'Accept', icon: 'fa-check' },
      { value: 'declined', label: 'Decline', icon: 'fa-xmark' },
    ]);
    // Order follows the caller's list, and an empty list means the row shows no menu.
    expect(mentorshipRowActions(['declined'], labels, icons)).toEqual([{ value: 'declined', label: 'Decline', icon: 'fa-xmark' }]);
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

  it('offers Current Mentees row actions by status, and none once the application ends', () => {
    const labelsFor = (status: MentorshipProgramMentee['status']): string[] =>
      mentorshipRowActions(
        MENTORSHIP_CURRENT_MENTEE_ACTIONS_BY_STATUS[status],
        MENTORSHIP_CURRENT_MENTEE_ACTION_LABELS,
        MENTORSHIP_CURRENT_MENTEE_ACTION_ICONS
      ).map((action) => action.label);

    // An application under review is decided.
    expect(labelsFor('pending')).toEqual(['Accept', 'Decline', 'Withdraw']);
    // Only an accepted mentee is given tasks or graduated.
    expect(labelsFor('accepted')).toEqual(['Create task', 'Graduate', 'Decline', 'Withdraw']);
    expect(labelsFor('declined')).toEqual([]);
    expect(labelsFor('withdrawn')).toEqual([]);
    expect(labelsFor('graduated')).toEqual([]);
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
      {
        id: 'mnt_2',
        name: 'Ravi Patel',
        email: 'ravi@example.com',
        status: 'graduated',
        termName: 'Fall 2026',
        tasks: [
          {
            id: 'tsk_leftover',
            name: 'Final report',
            description: 'Submitted after graduating.',
            status: 'submitted',
            prerequisite: false,
            createdOn: '2026-08-01',
            updatedOn: '2026-09-16',
          },
          {
            id: 'tsk_done',
            name: 'Demo',
            description: 'Recorded a demo.',
            status: 'completed',
            prerequisite: false,
            createdOn: '2026-08-01',
            updatedOn: '2026-09-01',
          },
        ],
      },
    ];

    // A graduated mentee's submitted task is not waiting on the mentor, so it is neither counted nor listed.
    expect(mentorshipMentorSubmittedTaskCount(mentees)).toBe(1);

    const rows = mentorshipMentorReviewTasks(mentees);
    expect(rows.map((row) => row.id)).toEqual(['mnt_1__tsk_new', 'mnt_2__tsk_done', 'mnt_1__tsk_old']);
    expect(rows[0]).toMatchObject({
      taskId: 'tsk_new',
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

  describe('buildMentorshipAdminTaskUpdate', () => {
    const task = {
      id: 'tsk_1',
      name: 'Read the guide',
      description: 'Start with chapter one',
      status: 'pending' as const,
      dueOn: '2026-09-30',
      requiresFileSubmission: false,
      prerequisite: false,
      createdOn: '2026-05-14',
      updatedOn: '2026-06-20',
    };
    const unchanged = {
      taskId: 'tsk_1',
      name: 'Read the guide',
      description: 'Start with chapter one',
      dueOn: '2026-09-30',
      requiresFileSubmission: false,
      assignedMenteeIds: [],
      status: 'pending' as const,
    };

    it('counts a submitted or completed task as one submitted task', () => {
      expect(['pending', 'in-progress', 'submitted', 'completed'].map((status) => mentorshipTaskSubmittedCount(status as 'pending'))).toEqual([0, 0, 1, 1]);
    });

    it('is empty when nothing changed', () => {
      expect(buildMentorshipAdminTaskUpdate(task, unchanged)).toEqual({});
    });

    it('carries only the fields that changed', () => {
      expect(buildMentorshipAdminTaskUpdate(task, { ...unchanged, name: 'Read the new guide', status: 'completed' })).toEqual({
        name: 'Read the new guide',
        status: 'completed',
      });
    });

    it('sends an empty due date when it was cleared, and the flag when it was switched', () => {
      expect(buildMentorshipAdminTaskUpdate(task, { ...unchanged, dueOn: undefined, requiresFileSubmission: true })).toEqual({
        dueDate: '',
        requiresFileSubmission: true,
      });
    });

    it('treats a task with no due date and a form with none as unchanged', () => {
      expect(buildMentorshipAdminTaskUpdate({ ...task, dueOn: undefined }, { ...unchanged, dueOn: undefined })).toEqual({});
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
      country: MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE,
      ageEligible: 'Please confirm you are 18 years of age or older.',
      workAuthorized: 'Please confirm you are authorized to work in your country of residence.',
      noDuplicateProfile: 'Please confirm you do not already have a mentee profile.',
      complianceAccepted: 'Please confirm the compliance statement.',
      termsAccepted: 'Please accept the terms and conditions.',
    });
  });

  it('requires an assigned ISO country code', () => {
    const form = { ...VALID_MENTEE_REGISTER_FORM };

    expect(getMentorshipMenteeRegisterErrors({ ...form, country: 'US' }).country).toBeUndefined();
    expect(getMentorshipMenteeRegisterErrors({ ...form, country: '  ' }).country).toBe(MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE);
    expect(getMentorshipMenteeRegisterErrors({ ...form, country: 'United States' }).country).toBe(MENTORSHIP_MENTEE_COUNTRY_UNKNOWN_MESSAGE);
    expect(getMentorshipMenteeRegisterErrors({ ...form, country: 'us' }).country).toBe(MENTORSHIP_MENTEE_COUNTRY_UNKNOWN_MESSAGE);
  });

  it('accepts a fully populated form — additional notes and demographic answers stay optional', () => {
    // `additionalNotes` and every demographic control are optional by design:
    // declining a demographic is a valid answer.
    const complete = {
      ...createEmptyMentorshipMenteeForm(),
      introduction: '<p>Backend engineer looking to break into distributed systems.</p>',
      skillsHave: ['Java'],
      skillsWant: ['Kubernetes'],
      country: 'KE',
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
      skillsHave: ['Java'],
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
      skillsHave: ['Java'],
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
      skillsHave: ['Java'],
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
      skillsHave: ['Java'],
      skillsWant: ['Kubernetes'],
      country: 'KE',
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
      skillsHave: ['Java'],
      skillsWant: ['Kubernetes'],
      country: 'KE',
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

const VALID_MENTEE_REGISTER_FORM: MentorshipMenteeRegisterForm = {
  ...createEmptyMentorshipMenteeForm(),
  introduction: '<p>Test intro</p>',
  skillsHave: ['Java'],
  skillsWant: ['Python'],
  country: 'KE',
  ageEligible: true,
  workAuthorized: true,
  noDuplicateProfile: true,
  complianceAccepted: true,
  termsAccepted: true,
};

describe('buildMentorshipMenteeRegisterRequest', () => {
  it('copies the introduction and both skill lists and trims the additional notes', () => {
    const request = buildMentorshipMenteeRegisterRequest({ ...VALID_MENTEE_REGISTER_FORM, additionalNotes: '  Test notes.  ' });

    expect(request.introduction).toBe('<p>Test intro</p>');
    expect(request.skillsHave).toEqual(['Java']);
    expect(request.skillsWant).toEqual(['Python']);
    expect(request.additionalNotes).toBe('Test notes.');
    expect(request.country).toBe('KE');
  });

  it('includes only the demographic answers whose consent is checked and non-empty', () => {
    const request = buildMentorshipMenteeRegisterRequest({
      ...VALID_MENTEE_REGISTER_FORM,
      ageConsent: true,
      age: '20-39',
      raceEthnicityConsent: false,
      raceEthnicity: 'asian',
      genderConsent: true,
      gender: '',
      incomeConsent: true,
      income: 'workingClass',
      educationConsent: false,
      education: '',
    });

    expect(request.demographics).toEqual({ age: '20-39', income: 'workingClass' });
  });

  it('omits demographics when no consent is checked, and sends preferNotToSay as-is when consented', () => {
    const declined = buildMentorshipMenteeRegisterRequest({ ...VALID_MENTEE_REGISTER_FORM, age: '20-39', raceEthnicity: 'asian' });
    expect(declined).not.toHaveProperty('demographics');

    const optedOut = buildMentorshipMenteeRegisterRequest({ ...VALID_MENTEE_REGISTER_FORM, genderConsent: true, gender: 'preferNotToSay' });
    expect(optedOut.demographics).toEqual({ gender: 'preferNotToSay' });
  });

  it('adds the LFX profile fields only when there are some', () => {
    const lfxProfile = { firstName: 'Test', lastName: 'User' };

    expect(buildMentorshipMenteeRegisterRequest(VALID_MENTEE_REGISTER_FORM, lfxProfile).lfxProfile).toEqual(lfxProfile);
    expect(buildMentorshipMenteeRegisterRequest(VALID_MENTEE_REGISTER_FORM, {})).not.toHaveProperty('lfxProfile');
    expect(buildMentorshipMenteeRegisterRequest(VALID_MENTEE_REGISTER_FORM)).not.toHaveProperty('lfxProfile');
  });

  it('coerces the five flags with isMentorshipTermsAccepted', () => {
    const request = buildMentorshipMenteeRegisterRequest({
      ...VALID_MENTEE_REGISTER_FORM,
      ageEligible: ['yes'] as unknown as boolean,
      workAuthorized: 'true' as unknown as boolean,
      noDuplicateProfile: 1 as unknown as boolean,
      complianceAccepted: false,
      termsAccepted: [] as unknown as boolean,
    });

    expect(request).toMatchObject({
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: false,
      termsAccepted: false,
    });
  });
});

describe('getMentorshipMenteeRegisterRequestErrors', () => {
  it('reports errors in form order, the order the submit toast reads the first one from', () => {
    const errors = getMentorshipMenteeRegisterRequestErrors({
      introduction: '',
      skillsHave: [],
      skillsWant: [],
      country: '',
      ageEligible: false,
      workAuthorized: false,
      noDuplicateProfile: false,
      complianceAccepted: false,
      termsAccepted: false,
    });

    expect(Object.keys(errors)).toEqual([
      'introduction',
      'skillsHave',
      'skillsWant',
      'country',
      'ageEligible',
      'workAuthorized',
      'noDuplicateProfile',
      'complianceAccepted',
      'termsAccepted',
    ]);
    expect(errors).toEqual(getMentorshipMenteeRegisterErrors(createEmptyMentorshipMenteeForm()));
  });

  it('rejects a skill outside the catalog on either side', () => {
    const request = buildMentorshipMenteeRegisterRequest(VALID_MENTEE_REGISTER_FORM);

    expect(getMentorshipMenteeRegisterRequestErrors({ ...request, skillsHave: ['Java', 'Not A Skill'] }).skillsHave).toBe(
      MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL
    );
    expect(getMentorshipMenteeRegisterRequestErrors({ ...request, skillsWant: ['not a skill'] }).skillsWant).toBe(MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL);
  });

  it('accepts every skill in MENTORSHIP_SKILL_OPTIONS', () => {
    const request = buildMentorshipMenteeRegisterRequest(VALID_MENTEE_REGISTER_FORM);
    const firstHalf = MENTORSHIP_SKILL_OPTIONS.slice(0, MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS);
    const secondHalf = MENTORSHIP_SKILL_OPTIONS.slice(MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS);

    expect(getMentorshipMenteeRegisterRequestErrors({ ...request, skillsHave: firstHalf, skillsWant: secondHalf })).toEqual({});
    expect(getMentorshipMenteeRegisterRequestErrors({ ...request, skillsHave: secondHalf, skillsWant: firstHalf })).toEqual({});
  });

  it('holds each list to the profile edit skills cap, so a registered profile stays editable', () => {
    const request = buildMentorshipMenteeRegisterRequest(VALID_MENTEE_REGISTER_FORM);
    const atCap = MENTORSHIP_SKILL_OPTIONS.slice(0, MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS);
    const overCap = MENTORSHIP_SKILL_OPTIONS.slice(0, MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS + 1);

    expect(getMentorshipMenteeRegisterRequestErrors({ ...request, skillsHave: atCap, skillsWant: atCap })).toEqual({});
    expect(getMentorshipMenteeRegisterRequestErrors({ ...request, skillsHave: overCap }).skillsHave).toBe(MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE);
    expect(getMentorshipMenteeRegisterRequestErrors({ ...request, skillsWant: overCap }).skillsWant).toBe(MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE);
  });

  it('gives the form validator the same result for the same values', () => {
    const form = { ...VALID_MENTEE_REGISTER_FORM, skillsHave: ['Not A Skill'], termsAccepted: false };

    expect(getMentorshipMenteeRegisterErrors(form)).toEqual(getMentorshipMenteeRegisterRequestErrors(buildMentorshipMenteeRegisterRequest(form)));
  });
});

describe('mapMentorshipRegisterFailure', () => {
  const menteeOptions = MENTORSHIP_MENTEE_REGISTER_FAILURE_OPTIONS;
  const mentorOptions = MENTORSHIP_MENTOR_REGISTER_FAILURE_OPTIONS;

  it('maps a 409 with the profile-exists code to profile-exists and any other 409 to conflict', () => {
    expect(mapMentorshipRegisterFailure(409, { code: MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE }, menteeOptions)).toEqual({
      kind: 'profile-exists',
      message: MENTORSHIP_MENTEE_REGISTER_ERROR_PROFILE_EXISTS,
    });
    expect(mapMentorshipRegisterFailure(409, { code: 'CONFLICT', error: 'slug already exists' }, menteeOptions)).toEqual({
      kind: 'conflict',
      message: MENTORSHIP_REGISTER_ERROR_CONFLICT,
    });
  });

  it('maps a 403 impersonation guard to read-only and any other 403 to the fallback', () => {
    expect(mapMentorshipRegisterFailure(403, { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }, menteeOptions)).toEqual({
      kind: 'read-only',
      message: MENTORSHIP_REGISTER_ERROR_READ_ONLY,
    });
    expect(mapMentorshipRegisterFailure(403, { code: 'FORBIDDEN' }, menteeOptions).kind).toBe('error');
  });

  it('keeps only known fields from a 400, first message per field', () => {
    const failure = mapMentorshipRegisterFailure(
      400,
      {
        code: 'VALIDATION_ERROR',
        errors: [
          { field: 'demographics', message: 'Not a form field.' },
          { field: 'skillsHave', message: 'Add at least one skill you currently have.' },
          { field: 'skillsHave', message: 'Second message for the same field.' },
          { field: 'introduction', message: '' },
          { field: 'termsAccepted', message: 42 },
          { field: 'introduction', message: 'Introduction is required.' },
        ],
      },
      menteeOptions
    );

    expect(failure).toEqual({
      kind: 'field-errors',
      message: 'Add at least one skill you currently have.',
      fieldErrors: { skillsHave: 'Add at least one skill you currently have.', introduction: 'Introduction is required.' },
    });
  });

  it('falls back when a 400 has no errors list or none that maps to a form field', () => {
    const fallback = { kind: 'error', message: MENTORSHIP_REGISTER_ERROR_FALLBACK };

    expect(mapMentorshipRegisterFailure(400, { error: 'bad request' }, menteeOptions)).toEqual(fallback);
    expect(mapMentorshipRegisterFailure(400, { errors: [{ field: 'body', message: 'Body must be an object.' }] }, menteeOptions)).toEqual(fallback);
    expect(mapMentorshipRegisterFailure(400, { errors: [null, 'text', 3] }, menteeOptions)).toEqual(fallback);
  });

  it('maps a 422 to the fixed ineligible copy whatever the upstream text says', () => {
    const expected = { kind: 'ineligible', message: MENTORSHIP_MENTEE_REGISTER_ERROR_INELIGIBLE };

    expect(mapMentorshipRegisterFailure(422, { error: 'age eligibility is required' }, menteeOptions)).toEqual(expected);
    expect(mapMentorshipRegisterFailure(422, null, menteeOptions)).toEqual(expected);
  });

  it('falls back for status 0, 5xx and unusable bodies', () => {
    const fallback = { kind: 'error', message: MENTORSHIP_REGISTER_ERROR_FALLBACK };

    expect(mapMentorshipRegisterFailure(0, null, menteeOptions)).toEqual(fallback);
    expect(mapMentorshipRegisterFailure(500, { error: 'boom' }, menteeOptions)).toEqual(fallback);
    expect(mapMentorshipRegisterFailure(401, 'Unauthorized', menteeOptions)).toEqual(fallback);
    expect(mapMentorshipRegisterFailure(500, undefined, menteeOptions)).toEqual(fallback);
  });

  it('reads the profile-exists code and copy from the options, so each role only matches its own code', () => {
    expect(mapMentorshipRegisterFailure(409, { code: MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE }, mentorOptions)).toEqual({
      kind: 'profile-exists',
      message: MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS,
    });
    expect(mapMentorshipRegisterFailure(409, { code: MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE }, mentorOptions).kind).toBe('conflict');
  });

  it('keeps only the mentor form fields from a mentor 400', () => {
    const failure = mapMentorshipRegisterFailure(
      400,
      {
        errors: [
          { field: 'skillsHave', message: 'Mentee field.' },
          { field: 'skills', message: 'Add at least one skill.' },
        ],
      },
      mentorOptions
    );

    expect(failure).toEqual({ kind: 'field-errors', message: 'Add at least one skill.', fieldErrors: { skills: 'Add at least one skill.' } });
  });

  it('falls back on a 422 when the options carry no ineligible copy', () => {
    expect(mapMentorshipRegisterFailure(422, { error: 'user not found' }, mentorOptions)).toEqual({
      kind: 'error',
      message: MENTORSHIP_REGISTER_ERROR_FALLBACK,
    });
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
    const view = buildMentorshipMenteeTaskView(
      {
        id: 't2',
        title: 'Coding challenge',
        description: 'Complete the challenge',
        status: 'in_progress',
        submitFile: 'required',
        dueDate: '2026-09-30T00:00:00Z',
      },
      Date.parse('2026-09-30T23:59:59Z')
    );
    expect(view.pastDue).toBe(false);
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

  it('marks a task past due once its due date has ended, and never one without a due date', () => {
    const input = { id: 't6', title: 'Late task', description: 'Synthetic task', status: 'in_progress' as const, submitFile: null };
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(buildMentorshipMenteeTaskView({ ...input, dueDate: '2026-09-30T00:00:00Z' }, now).pastDue).toBe(true);
    expect(buildMentorshipMenteeTaskView({ ...input, dueDate: '2026-10-01T00:00:00Z' }, now).pastDue).toBe(false);
    expect(buildMentorshipMenteeTaskView(input, now).pastDue).toBe(false);
  });
});

describe('isMentorshipTaskPastDue', () => {
  it('is false without a usable due date', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(isMentorshipTaskPastDue(undefined, now)).toBe(false);
    expect(isMentorshipTaskPastDue(null, now)).toBe(false);
    expect(isMentorshipTaskPastDue('', now)).toBe(false);
    expect(isMentorshipTaskPastDue('not-a-date', now)).toBe(false);
  });

  it('stays open through the last millisecond of the due date in UTC', () => {
    expect(isMentorshipTaskPastDue('2026-09-30T00:00:00Z', Date.parse('2026-09-30T23:59:59.999Z'))).toBe(false);
  });

  it('closes at midnight UTC after the due date', () => {
    expect(isMentorshipTaskPastDue('2026-09-30T00:00:00Z', Date.parse('2026-10-01T00:00:00Z'))).toBe(true);
  });

  it('reads a date-only value as that UTC day', () => {
    expect(isMentorshipTaskPastDue('2026-09-30', Date.parse('2026-09-30T12:00:00Z'))).toBe(false);
    expect(isMentorshipTaskPastDue('2026-09-30', Date.parse('2026-10-01T00:00:00Z'))).toBe(true);
  });

  it('uses the UTC day of a timestamp that carries a time of day', () => {
    expect(isMentorshipTaskPastDue('2026-09-30T18:00:00Z', Date.parse('2026-09-30T20:00:00Z'))).toBe(false);
    expect(isMentorshipTaskPastDue('2026-09-30T18:00:00Z', Date.parse('2026-10-01T00:00:00Z'))).toBe(true);
  });
});

describe('mentorshipTaskDueCutoffMs', () => {
  it('is the midnight UTC after the due date', () => {
    expect(mentorshipTaskDueCutoffMs('2026-09-30')).toBe(Date.parse('2026-10-01T00:00:00Z'));
    expect(mentorshipTaskDueCutoffMs('2026-09-30T18:00:00Z')).toBe(Date.parse('2026-10-01T00:00:00Z'));
  });

  it('is null without a usable due date', () => {
    expect(mentorshipTaskDueCutoffMs(undefined)).toBeNull();
    expect(mentorshipTaskDueCutoffMs(null)).toBeNull();
    expect(mentorshipTaskDueCutoffMs('')).toBeNull();
    expect(mentorshipTaskDueCutoffMs('not-a-date')).toBeNull();
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

describe('isMentorshipMentorTaskReviewDecision', () => {
  it('accepts complete and incomplete only', () => {
    expect(isMentorshipMentorTaskReviewDecision('complete')).toBe(true);
    expect(isMentorshipMentorTaskReviewDecision('incomplete')).toBe(true);
    for (const value of ['completed', 'submitted', 'in_progress', 'COMPLETE', '', null, undefined, 1]) {
      expect(isMentorshipMentorTaskReviewDecision(value)).toBe(false);
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

  it('lets a past-due pending task start but not be submitted, with a visible hint', () => {
    const view = { ...taskView('pending'), pastDue: true };
    const state = getMentorshipMenteeTaskStatusOptions(view);
    expect(disabledByValue(view)).toEqual({ pending: false, in_progress: false, submitted: true });
    expect(state.locked).toBe(false);
    expect(state.hint).toBe(MENTORSHIP_MENTEE_TASK_HINT_PAST_DUE);
    expect(state.hintVisible).toBe(true);
  });

  it('disables submitted on a past-due in-progress task, with a visible hint', () => {
    const view = { ...taskView('in_progress'), pastDue: true };
    const state = getMentorshipMenteeTaskStatusOptions(view);
    expect(disabledByValue(view)).toEqual({ pending: true, in_progress: false, submitted: true });
    expect(state.hint).toBe(MENTORSHIP_MENTEE_TASK_HINT_PAST_DUE);
    expect(state.hintVisible).toBe(true);
  });

  it('shows the past-due hint over the file-required one', () => {
    const state = getMentorshipMenteeTaskStatusOptions({ ...taskView('in_progress', 'required'), pastDue: true });
    expect(state.hint).toBe(MENTORSHIP_MENTEE_TASK_HINT_PAST_DUE);
  });

  it('keeps a past-due submitted task locked rather than past due', () => {
    const state = getMentorshipMenteeTaskStatusOptions({ ...taskView('submitted'), pastDue: true });
    expect(state.locked).toBe(true);
    expect(state.hint).toBe(MENTORSHIP_MENTEE_TASK_HINT_LOCKED);
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

  it('orders the tasks by name A to Z, ignoring case and reading numbers as numbers', () => {
    const app = menteeApplication({
      tasks: [
        menteeTask({ id: 'step-10', name: 'Step 10' }),
        menteeTask({ id: 'write', name: 'write a cover letter' }),
        menteeTask({ id: 'step-2', name: 'Step 2' }),
        menteeTask({ id: 'about', name: 'About you' }),
      ],
    });
    const ids = buildMentorshipMenteeApplicationView(app, 'in-progress').tasks.map((task) => task.id);
    expect(ids).toEqual(['about', 'step-2', 'step-10', 'write']);
  });

  it('marks each task past due against the time it is given', () => {
    const app = menteeApplication({
      tasks: [menteeTask({ id: 'late', name: 'A', dueDate: '2026-09-29' }), menteeTask({ id: 'open', name: 'B', dueDate: '2026-09-30' })],
    });
    const view = buildMentorshipMenteeApplicationView(app, 'in-progress', Date.parse('2026-09-30T12:00:00Z'));
    expect(view.tasks.map((task) => [task.id, task.pastDue])).toEqual([
      ['late', true],
      ['open', false],
    ]);
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

describe('toMentorshipUtcEndOfDayInstant', () => {
  it('turns a date-only value into the last millisecond of its UTC day', () => {
    expect(toMentorshipUtcEndOfDayInstant('2026-07-15')).toBe('2026-07-15T23:59:59.999Z');
  });

  it('leaves a full timestamp unchanged', () => {
    expect(toMentorshipUtcEndOfDayInstant('2026-07-15T10:30:00Z')).toBe('2026-07-15T10:30:00Z');
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

describe('getMentorshipMenteeIntroductionError', () => {
  it('requires text, not just markup', () => {
    expect(getMentorshipMenteeIntroductionError('')).toBe('Introduction is required.');
    expect(getMentorshipMenteeIntroductionError('<p></p>')).toBe('Introduction is required.');
  });

  it('counts the visible text against the max, not the markup', () => {
    expect(getMentorshipMenteeIntroductionError(`<p><strong>${'a'.repeat(3000)}</strong></p>`)).toBeUndefined();
    expect(getMentorshipMenteeIntroductionError(`<p>${'a'.repeat(3001)}</p>`)).toBe('Introduction must be 3000 characters or fewer.');
  });

  it('reports formatting as the problem over the raw max', () => {
    expect(getMentorshipMenteeIntroductionError(`<p>a</p>${'<p></p>'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX)}`)).toBe(MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE);
  });
});

describe('buildMentorshipMenteeProfileUpdate', () => {
  const seed: MentorshipMenteeProfileDetails = {
    aboutMe: '<p>Hello world</p>',
    skillsHave: ['Go', 'Python'],
    skillsWant: ['Kubernetes'],
    additionalNotes: 'Evenings only',
    country: 'KE',
  };
  const unchanged: MentorshipMenteeProfileFormValue = {
    introduction: '<p>Hello world</p>',
    skillsHave: ['Go', 'Python'],
    skillsWant: ['Kubernetes'],
    additionalNotes: 'Evenings only',
    country: 'KE',
  };

  it('returns an empty request when nothing changed', () => {
    const request = buildMentorshipMenteeProfileUpdate(seed, unchanged);
    expect(request).toEqual({});
    expect(isMentorshipMenteeProfileUpdateEmpty(request)).toBe(true);
  });

  it('sends the introduction HTML as is, only when it differs from the stored HTML', () => {
    expect(buildMentorshipMenteeProfileUpdate(seed, { ...unchanged, introduction: '<p>Hello <strong>there</strong></p>' })).toEqual({
      introduction: '<p>Hello <strong>there</strong></p>',
    });
    expect(buildMentorshipMenteeProfileUpdate(seed, { ...unchanged, introduction: '' })).toEqual({ introduction: '' });
  });

  it('leaves an empty stored introduction out while the editor stays empty', () => {
    const withoutAbout: MentorshipMenteeProfileDetails = { ...seed, aboutMe: '' };
    expect(buildMentorshipMenteeProfileUpdate(withoutAbout, { ...unchanged, introduction: '' })).toEqual({});
  });

  it('sends the whole skill set when only the additional notes changed', () => {
    expect(buildMentorshipMenteeProfileUpdate(seed, { ...unchanged, additionalNotes: 'Weekends too' })).toEqual({
      skillSet: { skillsHave: ['Go', 'Python'], skillsWant: ['Kubernetes'], additionalNotes: 'Weekends too' },
    });
  });

  it('compares skills after trimming and detects a reorder', () => {
    expect(buildMentorshipMenteeProfileUpdate(seed, { ...unchanged, skillsHave: [' Go ', 'Python', ' '] })).toEqual({});
    expect(buildMentorshipMenteeProfileUpdate(seed, { ...unchanged, skillsHave: ['Python', 'Go'] })).toEqual({
      skillSet: { skillsHave: ['Python', 'Go'], skillsWant: ['Kubernetes'], additionalNotes: 'Evenings only' },
    });
  });

  it('omits additional notes when the trimmed notes are blank', () => {
    expect(buildMentorshipMenteeProfileUpdate(seed, { ...unchanged, additionalNotes: '   ' })).toEqual({
      skillSet: { skillsHave: ['Go', 'Python'], skillsWant: ['Kubernetes'] },
    });
  });

  it('treats missing stored notes and blank notes as the same', () => {
    const withoutNotes: MentorshipMenteeProfileDetails = { ...seed, additionalNotes: undefined };
    expect(buildMentorshipMenteeProfileUpdate(withoutNotes, { ...unchanged, additionalNotes: '' })).toEqual({});
  });

  it('never emits demographics or socioeconomics', () => {
    const request = buildMentorshipMenteeProfileUpdate(seed, {
      introduction: '<p>New</p>',
      skillsHave: ['Rust'],
      skillsWant: ['Go'],
      additionalNotes: 'x',
      country: 'NG',
    });
    expect(Object.keys(request).sort()).toEqual(['country', 'introduction', 'skillSet']);
  });

  it('sends the country only when it differs from the stored one', () => {
    expect(buildMentorshipMenteeProfileUpdate(seed, { ...unchanged, country: 'NG' })).toEqual({ country: 'NG' });
    expect(buildMentorshipMenteeProfileUpdate({ ...seed, country: undefined }, { ...unchanged, country: 'KE' })).toEqual({ country: 'KE' });
    expect(buildMentorshipMenteeProfileUpdate({ ...seed, country: undefined }, { ...unchanged, country: '' })).toEqual({});
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

describe('isMentorshipMentorInviteToken', () => {
  it('accepts two base64url parts joined by a dot', () => {
    expect(isMentorshipMentorInviteToken('eyJwcm9ncmFtX2lkIjoicDEifQ.c2ln-_')).toBe(true);
  });

  it.each(['', 'nodot', '.sig', 'payload.', 'a.b.c', 'a.b/c', 'a.b=', `${'a'.repeat(512)}.b`])('rejects %j', (value) => {
    expect(isMentorshipMentorInviteToken(value)).toBe(false);
  });
});

describe('buildMentorshipGraduateTaskWarning', () => {
  it('has no warning when every task is submitted', () => {
    expect(buildMentorshipGraduateTaskWarning(3, 3)).toBeUndefined();
    expect(buildMentorshipGraduateTaskWarning(0, 0)).toBeUndefined();
  });

  it('never goes negative when more are submitted than counted', () => {
    expect(buildMentorshipGraduateTaskWarning(2, 5)).toBeUndefined();
  });

  it('counts the outstanding tasks, singular for one', () => {
    expect(buildMentorshipGraduateTaskWarning(4, 1)).toBe("3 tasks aren't Submitted or Completed.");
    expect(buildMentorshipGraduateTaskWarning(4, 3)).toBe("1 task isn't Submitted or Completed.");
  });
});
