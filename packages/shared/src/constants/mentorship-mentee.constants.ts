// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipMenteeDemographicRow } from '../interfaces/mentorship.interface';

export const MENTORSHIP_MENTEE_REGISTER_TITLE = 'Become a Mentee';

/**
 * Split around the `*` so the template can render it in red, matching how every
 * required-field marker elsewhere on this form is styled.
 */
export const MENTORSHIP_MENTEE_REGISTER_SUBTITLE_PREFIX = 'Register as a mentee to apply for LFX mentorship programs. Fields marked ';
export const MENTORSHIP_MENTEE_REGISTER_SUBTITLE_SUFFIX = ' are required.';

export const MENTORSHIP_MENTEE_INTRODUCTION_INTRO =
  'This information is displayed on your mentee profile page. Your name, email and avatar come from your LFX account.';
export const MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER = `What is your current status, are you a student/transitioning into a new career?
What are your goals and aspirations? 
Why are you interested in this mentorship opportunity?
Tell us something that makes you unique as an applicant.`;

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
 * hand-written blocks. Question text is reproduced verbatim from the program's
 * demographic survey; `value`s are the persisted contract (#1509) — normalised as
 * compact tokens rather than the display copy, so a future rewording of a label does
 * not silently invalidate stored answers. The same `'preferNotToSay'` value repeats
 * on every row so callers can filter opt-outs uniformly.
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
      { text: '61 or older', value: '61+' },
      { text: `I don't want to provide`, value: 'preferNotToSay' },
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
      { text: `I don't want to provide`, value: 'preferNotToSay' },
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
      { text: `I don't want to provide`, value: 'preferNotToSay' },
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
      { text: `I don't want to provide`, value: 'preferNotToSay' },
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
      { text: 'Completed Ph.D.', value: 'phd' },
      { text: `I don't want to provide`, value: 'preferNotToSay' },
    ],
  },
];

export const MENTORSHIP_MENTEE_ELIGIBILITY_TITLE = 'Eligibility Requirements';
export const MENTORSHIP_MENTEE_ELIGIBILITY_INTRO = 'Confirm each of the following before submitting your mentee registration.';

export const MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL = 'I am at least 18 years of age, or will be by the time the mentorship program starts.';
export const MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL = 'I am eligible to work in the country I reside in for the duration of the mentorship.';
export const MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL =
  'I do not have another mentee profile on the LFX Mentorship platform and am not participating in another Linux Foundation mentorship program. Doing so will disqualify me from the program.';

export const MENTORSHIP_MENTEE_TERMS_INTRO =
  'Before you submit your mentee registration to the LFX Platform, review and accept the terms and conditions below.';

export const MENTORSHIP_MENTEE_EXPORT_DISCLAIMER =
  'At this moment we are not accepting applications from a person or entity restricted by U.S. export controls or sanction programs, or a resident of Cuba, Iran, North Korea, Syria, Sudan, Russian Federation or Crimea region of Ukraine.';

/**
 * Success-toast copy for a client-validated mentee submit. Kept honest because the
 * backend endpoint is not live yet (#1509): the toast reports what actually happened
 * (validation passed) rather than claiming the registration was sent to the platform.
 */
export const MENTORSHIP_MENTEE_SUBMIT_SUCCESS_SUMMARY = 'Registration validated';
export const MENTORSHIP_MENTEE_SUBMIT_SUCCESS_DETAIL =
  'Your mentee registration passed all checks. Submission to the mentorship platform will complete once the backend goes live.';
