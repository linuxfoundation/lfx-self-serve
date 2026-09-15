// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipMenteeDemographicRow, MentorshipMenteeRegisterForm } from '../interfaces/mentorship.interface';

export const MENTORSHIP_MENTEE_REGISTER_TITLE = 'Become a Mentee';

/**
 * Split around the `*` so the template can render it in red, matching how every
 * required-field marker elsewhere on this form is styled.
 */
export const MENTORSHIP_MENTEE_REGISTER_SUBTITLE_PREFIX = 'Register as a mentee to apply for LFX mentorship programs. Fields marked ';
export const MENTORSHIP_MENTEE_REGISTER_SUBTITLE_SUFFIX = ' are required.';

export const MENTORSHIP_MENTEE_INTRODUCTION_INTRO =
  'This information is displayed on your mentee profile page. Your name, email and avatar come from your LFX account.';
export const MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER = `What is your current experience level with open source contributions?

Why are you interested in this mentorship program?

Tell us something that makes you unique.`;

/** Matches `MENTORSHIP_MENTOR_INTRODUCTION_MAX`, since both feed the same kind of rich-text field. */
export const MENTORSHIP_MENTEE_INTRODUCTION_MAX = 3000;

export const MENTORSHIP_MENTEE_SKILLS_INTRO = 'Tell us about your current skills and the skills you want to grow, so we can match you with the right mentor.';
export const MENTORSHIP_MENTEE_SKILLS_HAVE_LABEL = 'What skills do you currently have?';
export const MENTORSHIP_MENTEE_SKILLS_WANT_LABEL = 'What skills would you like to improve?';
export const MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL = 'Anything else you want mentors to know?';
export const MENTORSHIP_MENTEE_ADDITIONAL_NOTES_PLACEHOLDER = 'Share any other context that would help a mentor get to know you.';
export const MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX = 1000;

export const MENTORSHIP_MENTEE_RESUME_INTRO = 'Optional, but mentors often look you up before accepting a mentee.';

export const MENTORSHIP_MENTEE_DEMOGRAPHICS_TITLE = 'Demographics';
export const MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO =
  'Optional and purely voluntary. Answers are confidential, are not shared with mentors, and are used only for aggregate diversity reporting.';

/** Identical consent text every demographic row's checkbox shows, per LFXV2 privacy copy. */
export const MENTORSHIP_MENTEE_DEMOGRAPHIC_CONSENT_LABEL = 'I consent to use of this information for the purpose listed above.';

export const MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_NOTE_PREFIX = 'You may request removal of this information from Mentorship at any time by writing to ';
export const MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_EMAIL = 'privacy@linuxfoundation.org';

/**
 * The five demographic questions, each pairing a consent checkbox with its answer
 * dropdown so the section can `@for` over one data-driven list instead of five
 * hand-written blocks. Question text and options are reproduced verbatim from the
 * program's demographic survey.
 */
export const MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS: MentorshipMenteeDemographicRow[] = [
  {
    consentControl: 'ageConsent',
    answerControl: 'age',
    question: 'How old are you?',
    options: [
      { text: '19 or younger', value: '-19' },
      { text: '20-39', value: '20-39' },
      { text: '40-60', value: '40-60' },
      { text: '61 or older', value: '61 or older' },
      { text: `I don't want to provide`, value: 'IDonotWantToProvide' },
    ],
  },
  {
    consentControl: 'raceEthnicityConsent',
    answerControl: 'raceEthnicity',
    question: 'What is your racial or ethnic identity?',
    options: [
      { text: 'American Indian or Alaska Native', value: 'americanIndianOrAlaskaNative' },
      { text: 'Asian', value: 'asian' },
      { text: 'Black or African American', value: 'blackOrAfricanAmerican' },
      { text: 'Hispanic or Latino', value: 'hispanicOrLatino' },
      { text: 'Native Hawaiian or Other Pacific Islander', value: 'nativeHawaiianOrPacificIslander' },
      { text: 'White', value: 'white' },
      { text: 'Two or more races', value: 'twoOrMoreRaces' },
      { text: `I don't want to provide`, value: 'IDonotWantToProvide' },
    ],
  },
  {
    consentControl: 'genderConsent',
    answerControl: 'gender',
    question: 'Which gender do you identify with?',
    options: [
      { text: 'Male', value: 'male' },
      { text: 'Female', value: 'female' },
      { text: 'Non-binary', value: 'nonBinary' },
      { text: `I don't want to provide`, value: 'IDonotWantToProvide' },
    ],
  },
  {
    consentControl: 'incomeConsent',
    answerControl: 'income',
    question: 'Which socioeconomic class do you identify with?',
    options: [
      { text: 'Working class', value: 'workingClass' },
      { text: 'Lower middle class', value: 'lowerMiddleClass' },
      { text: 'Upper middle class', value: 'upperMiddleClass' },
      { text: 'Upper class', value: 'upperClass' },
      { text: `I don't want to provide`, value: 'IDonotWantToProvide' },
    ],
  },
  {
    consentControl: 'educationConsent',
    answerControl: 'education',
    question: 'What is your education level?',
    options: [
      { text: 'Some high school', value: 'someHighSchool' },
      { text: 'Some college/technical training', value: 'someCollege' },
      { text: 'Completed college', value: 'college' },
      { text: `Completed master's degree`, value: 'masters' },
      { text: 'Completed Ph.D', value: 'phd' },
      { text: `I don't want to provide`, value: 'IDonotWantToProvide' },
    ],
  },
];

export const MENTORSHIP_MENTEE_ELIGIBILITY_TITLE = 'Eligibility Requirements';
export const MENTORSHIP_MENTEE_ELIGIBILITY_INTRO = 'Confirm each of the following before submitting your mentee registration.';

export const MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL = 'I confirm that I am 18 years of age or older.';
export const MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL = 'I confirm that I am legally authorized to work in the country in which I reside.';
export const MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL = 'I confirm that I do not already have an existing mentee profile registered with this program.';

export const MENTORSHIP_MENTEE_PLATFORM_USE_NOTE =
  'If your application is accepted, the program may publicize your participation, including your name, on program pages and promotional materials.';

export const MENTORSHIP_MENTEE_TERMS_INTRO =
  'Before you submit your mentee registration to the LFX Platform, review and accept the terms and conditions below.';

export const MENTORSHIP_MENTEE_EXPORT_DISCLAIMER =
  'At this moment we are not accepting applications from a person or entity restricted by U.S. export controls or sanction programs, or a resident of Cuba, Iran, North Korea, Syria, Sudan, Russian Federation or Crimea region of Ukraine.';

export function createEmptyMentorshipMenteeForm(): MentorshipMenteeRegisterForm {
  return {
    introduction: '',
    skillsHave: [],
    skillsWant: [],
    additionalNotes: '',
    resumeFileName: '',
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
    ageEligible: false,
    workAuthorized: false,
    noDuplicateProfile: false,
    complianceAccepted: false,
    termsAccepted: false,
  };
}
